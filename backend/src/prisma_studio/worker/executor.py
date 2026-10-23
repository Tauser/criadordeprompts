"""Durable executor: one step at a time, every transition persisted, state observed from ComfyUI."""
from __future__ import annotations

import logging
import threading
import uuid

from ..application.enhancer import check, clean_output, system_prompt
from ..domain import face_detail
from ..domain.verification import FACE_CHECKS, JUDGE_SYSTEM, Check, judge_prompt, parse_verdicts, score
from ..infrastructure.comfy.client import ComfyNotSent, ComfyRejected, ComfyUnavailable
from ..infrastructure.comfy.validation import validate_graph
from ..infrastructure.comfy.workflows import (FACE_MODEL, FACE_SIZE, MAX_EDIT_PIXELS, PEOPLE_MODEL, PEOPLE_OUTPUT_NODE,
                                              BFS_BODY, POSE_MODEL, UPSCALE_MODEL, UPSCALE_VAE, ImageJob, TextJob, face_boxes,
                                              face_detect_graph, image_graph, image_outputs, people_count, text_graph,
                                              text_output, upscale_graph)
from ..infrastructure.db.database import now
from ..infrastructure.storage.files import (MAX_RESULT_BYTES, composite_on_original, crop_square, face_crop_box,
                                            face_on_picture, fit_multiple_of_32, normalized_png, oriented_size,
                                            paste_faces)

log = logging.getLogger('prisma.executor')
TASK_DONE = {'completed', 'failed', 'cancelled', 'lost'}
MAX_UNEXPECTED_ERRORS = 3
MASK_FEATHER = 12                         # pixels of soft transition, always inside the drawn area
FACE_SLOTS = 16                           # face task position = image position * FACE_SLOTS + face index
EXTRA_FACES = 2                           # the detector looks past the expected count, so an extra person shows up
IMAGE_KINDS = {'image', 'face', 'upscale'}
PHASES = {'UNETLoader': 'loading_models', 'CLIPLoader': 'loading_models', 'VAELoader': 'loading_models',
          'QwenImage21Cache': 'loading_models', 'LoadImage': 'loading_images', 'LoadImageMask': 'loading_images',
          'TextEncodeQwenImage21': 'encoding', 'KSampler': 'sampling', 'SamplerCustom': 'sampling',
          'VAEDecode': 'decoding', 'GrowMask': 'compositing', 'FeatherMask': 'compositing',
          'ImageCompositeMasked': 'compositing', 'SaveImage': 'saving', 'TextGenerate': 'generating_text',
          'BatchImagesNode': 'loading_images', 'PreviewAny': 'saving', 'VAEEncode': 'encoding',
          'LoadMediaPipeFaceLandmarker': 'loading_models', 'MediaPipeFaceLandmarker': 'detecting_faces',
          'SeedVR2Preprocess': 'upscaling', 'SeedVR2Conditioning': 'upscaling', 'SeedVR2PostProcessing': 'upscaling',
          'ResizeImageMaskNode': 'upscaling', 'VAEEncodeTiled': 'upscaling', 'VAEDecodeTiled': 'upscaling'}


def swap_loras(settings: dict) -> tuple:
    """A body swap runs with the BFS body LoRA alone: the user's LoRAs would pull the new person elsewhere."""
    swap = settings.get('swap') or {}
    return ((BFS_BODY, 1.0),) if swap.get('mode') == 'body' else ()


def swap_cutouts(settings: dict) -> tuple:
    swap = settings.get('swap') or {}
    return (swap['slot'],) if swap.get('mode') == 'body' else ()


def extra_people(result: dict | None) -> bool:
    """More faces, or more whole bodies, than people asked for. Fewer proves nothing: a face turned away or a body
    hidden behind another is not found."""
    detail = (result or {}).get('detail') or {}
    expected = detail.get('expected')
    return bool(expected) and max(detail.get('found', 0), detail.get('people') or 0) > expected


class Executor:
    def __init__(self, repository, comfy, store, progress=None, poll_seconds: float = 1.5, validate: bool = True):
        self.repository, self.comfy, self.store, self.progress = repository, comfy, store, progress
        self.poll_seconds, self.validate = poll_seconds, validate
        self._wake, self._stop = threading.Event(), threading.Event()
        self._thread: threading.Thread | None = None
        self._object_info: dict | None = None
        self._face_model: bool | None = None
        self._people_model: bool | None = None
        self._skeleton_models: bool | None = None
        self._upscale_model: bool | None = None
        self._missing: dict[str, int] = {}
        self._errors: dict[str, int] = {}
        self.reachable: bool | None = None

    # lifecycle --------------------------------------------------------------
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name='prisma-executor', daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join()                       # the instance lock must outlive any in-flight work

    def wake(self) -> None:
        self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:  # noqa: BLE001 - the loop must survive any single failure
                log.exception('Falha no executor')
            self._wake.wait(self.poll_seconds)
            self._wake.clear()

    # scheduling -------------------------------------------------------------
    def tick(self) -> None:
        active_found = False
        for run in self.repository.open_runs():
            if self._stop.is_set():
                break
            if run['cancel_requested']:
                self._step(run)
                continue
            if run['status'] == 'review':
                continue
            if active_found and run['status'] == 'created':
                continue                      # one GPU: start the next run only after this one is submitted
            active_found = True
            self._step(run)

    def _step(self, run: dict) -> None:
        try:
            if run['cancel_requested']:
                self._cancel(run)
            else:
                self._advance(run)
            self._errors.pop(run['id'], None)
        except Exception as error:  # noqa: BLE001 - one broken run must not stop the queue
            count = self._errors.get(run['id'], 0) + 1
            self._errors[run['id']] = count
            log.exception('Erro inesperado no pedido %s (%s/%s)', run['id'], count, MAX_UNEXPECTED_ERRORS)
            if count >= MAX_UNEXPECTED_ERRORS:
                self._errors.pop(run['id'], None)
                self.repository.transition(run['id'], 'failed', error=f'Erro interno do Studio: {error}'[:2000])

    def _advance(self, run: dict) -> None:
        status = run['status']
        try:
            if status == 'created':
                if not run['prompt'] or not run['effective_prompt'] or not run['settings'].get('variations'):
                    self.repository.transition(run['id'], 'failed', error='Pedido incompleto no banco: '
                                               'sem prompt ou configurações. Envie-o novamente.')
                    return
                self.repository.transition(run['id'], 'preparing')
                self._prepare(self.repository.get(run['id']))
            elif status == 'preparing':
                self._prepare(run)
            elif status == 'refining':
                self._refining(run)
            elif status == 'generating':
                self._generating(run)
            elif status == 'detailing':
                self._detailing(run)
            elif status == 'upscaling':
                self._upscaling(run)
            elif status == 'verifying':
                self._verifying(run)
        except ComfyUnavailable:
            self.reachable = False
        except (ComfyRejected, ValueError, OSError) as error:
            self.repository.transition(run['id'], 'failed', error=str(error)[:2000])

    # stages -----------------------------------------------------------------
    def _prepare(self, run: dict) -> None:
        settings = dict(run['settings'])
        if 'uploaded' not in settings:
            settings['uploaded'] = self._upload_inputs(run, settings)
            run = self.repository.update(run['id'], settings_json=settings)
        if settings['refine']:
            self.repository.add_task(run['id'], 'refine', seed=settings['seed'])
            self.repository.transition(run['id'], 'refining')
        else:
            self._create_image_tasks(run)
            self.repository.transition(run['id'], 'generating')

    def _upload_inputs(self, run: dict, settings: dict) -> dict:
        names, size = [], None
        for index, file_hash in enumerate(settings['images']):
            data = self.store.read(file_hash)
            if index == 0 and run['mode'] == 'edit' and (settings['mask'] or settings['resolution'] == 0):
                size = fit_multiple_of_32(*oriented_size(data), MAX_EDIT_PIXELS)
                data = normalized_png(data, size)
                names.append(self.comfy.upload(data, f'prisma_{file_hash[:24]}_{size[0]}x{size[1]}.png', 'image/png'))
            else:
                mime = self.repository.file(file_hash)['mime']
                ext = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime]
                names.append(self.comfy.upload(data, f'prisma_{file_hash[:24]}.{ext}', mime))
        mask = None
        if settings['mask']:
            data = normalized_png(self.store.read(settings['mask']), size, mask=True)
            mask = self.comfy.upload(data, f'prisma_mask_{settings["mask"][:24]}_{size[0]}x{size[1]}.png', 'image/png')
        init = None
        start = (run.get('files') or {}).get('init')
        if start:                                   # a draft redone in full starts from the chosen picture
            init = self.comfy.upload(self.store.read(start), f'prisma_{start[:24]}.png', 'image/png')
        return {'images': names, 'mask': mask, 'target_size': size, 'init': init}

    def _create_image_tasks(self, run: dict) -> None:
        """Idempotent: creates whichever of the requested variations are still missing, in one transaction."""
        settings = run['settings']
        existing = {t['position'] for t in self.repository.tasks(run['id'], 'image')}
        missing = [(p, (settings['seed'] + p) % 2**53) for p in range(settings['variations']) if p not in existing]
        if missing:
            self.repository.add_tasks(run['id'], 'image', missing)

    def _refining(self, run: dict) -> None:
        task = self.repository.tasks(run['id'], 'refine')[0]
        uploaded = run['settings']['uploaded']
        job = TextJob(prompt=run['prompt'], system_prompt=system_prompt(run['mode']),
                      images=tuple(uploaded['images']) if run['mode'] == 'edit' else (), max_length=2048)
        task = self._drive(task, lambda: text_graph(job))
        if task['status'] == 'completed':
            refined = clean_output(task['result'].get('text'))
            problems = check(run['prompt'], refined, self._blocks(run), len(uploaded['images']))
            self.repository.event(run['id'], 'refine_checked', {'problems': problems})
            self.repository.transition(run['id'], 'review', refined_prompt=refined)
        elif task['status'] in TASK_DONE:
            self.repository.event(run['id'], 'refine_unavailable', {'error': task['error']})
            self.repository.transition(run['id'], 'review', refined_prompt=None)

    def _generating(self, run: dict) -> None:
        self._create_image_tasks(run)
        settings, uploaded = run['settings'], run['settings']['uploaded']
        engine = settings['engine']
        tasks = self.repository.tasks(run['id'], 'image')
        for task in tasks:
            if self._stop.is_set():
                return
            def build(task=task):
                return image_graph(ImageJob(
                    mode=run['mode'], prompt=run['effective_prompt'], profile=settings['profile'], seed=task['seed'],
                    resolution=settings['resolution'], width=settings['width'], height=settings['height'],
                    images=tuple(uploaded['images']), mask=uploaded['mask'],
                    negative_prompt=engine.get('negative_prompt', ''), steps=engine.get('steps'),
                    cfg=engine.get('cfg'), sampler=engine.get('sampler'), scheduler=engine.get('scheduler'),
                    denoise=engine.get('denoise'), prefix=f'prisma/{run["id"][:8]}', init_image=uploaded.get('init'),
                    loras=swap_loras(settings)
                    or tuple((lora['name'], lora['strength']) for lora in engine.get('loras') or ()),
                    cutouts=swap_cutouts(settings),
                    skeletons=tuple(settings.get('skeleton_slots') or ()) if self._skeleton_models_installed() else ()))
            self._drive(task, build)
        tasks = self.repository.tasks(run['id'], 'image')
        if not all(t['status'] in TASK_DONE for t in tasks):
            return
        done = [t for t in tasks if t['status'] == 'completed']
        for task in done:
            self._store_outputs(task, run)
        if not done:
            self.repository.transition(run['id'], 'failed', error=next((t['error'] for t in tasks if t['error']),
                                                                       'Nenhuma imagem foi gerada.'))
        elif settings.get('face_detail') or settings.get('participants'):
            self.repository.transition(run['id'], 'detailing')
        else:
            self._after_faces(run, done)

    def _after_faces(self, run: dict, done: list[dict]) -> None:
        if run['settings'].get('upscale'):
            self.repository.transition(run['id'], 'upscaling')
        else:
            self._images_ready(run, done)

    def _images_ready(self, run: dict, done: list[dict]) -> None:
        settings = run['settings']
        if settings['verify'] and settings['checks']:
            self.repository.transition(run['id'], 'verifying')
        else:
            best = next((t for t in done if not extra_people(t['result'])), done[0])
            self.repository.transition(run['id'], 'completed', best_task_id=best['id'])

    def _detailing(self, run: dict) -> None:
        """Per image: count the faces; with face_detail, redraw each small one from its crop and paste it back. A
        failure here only leaves that face (or image) as generated: the pass improves a result, it never loses one."""
        settings = run['settings']
        detects = {t['position']: t for t in self.repository.tasks(run['id'], 'face_detect')}
        faces = {t['position']: t for t in self.repository.tasks(run['id'], 'face')}
        waiting = False
        for image in self.repository.tasks(run['id'], 'image'):
            if self._stop.is_set():
                return
            if image['status'] != 'completed' or 'detail' in image['result']:
                continue
            file_hash = image['result']['files'][0]
            detect = detects.get(image['position']) or self.repository.add_task(run['id'], 'face_detect',
                                                                                image['position'])

            def detect_graph(file_hash=file_hash):
                name = self.comfy.upload(self.store.read(file_hash), f'prisma_{file_hash[:24]}.png', 'image/png')
                return face_detect_graph(name, max(1, settings.get('participants') or 1) + EXTRA_FACES,
                                         people=self._people_model_installed())
            detect = self._drive_optional(detect, detect_graph)
            if detect['status'] not in TASK_DONE:
                waiting = True
                continue
            data = self.store.read(file_hash)
            size = oriented_size(data)
            found = face_boxes(detect['result'].get('text')) if detect['status'] == 'completed' else []
            pending = []
            redraw = found[:FACE_SLOTS] if settings.get('face_detail') else []
            for index, box in enumerate(redraw):
                if max(box['width'], box['height']) > face_detail.MAX_FACE:
                    continue                      # already large enough to carry its own detail
                if not face_on_picture(box, size):
                    continue                      # the detector reported a box outside the picture
                slot = image['position'] * FACE_SLOTS + index
                crop = face_crop_box(box, size)
                task = faces.get(slot) or self.repository.add_task(run['id'], 'face', slot, seed=image['seed'])

                def face_graph(task=task, crop=crop, index=index, data=data, file_hash=file_hash):
                    name = self.comfy.upload(crop_square(data, crop, FACE_SIZE),
                                             f'prisma_face_{file_hash[:24]}_{index}.png', 'image/png')
                    return image_graph(self._face_job(run, task['seed'], name))
                pending.append((self._drive_optional(task, face_graph), box, crop))
            if not all(task['status'] in TASK_DONE for task, _, _ in pending):
                waiting = True
                continue
            people = people_count(detect['result'].get('people')) if detect['status'] == 'completed' else None
            self._paste_faces(image, data, len(found), people, settings.get('participants'), pending)
        if not waiting:
            done = [t for t in self.repository.tasks(run['id'], 'image') if t['status'] == 'completed']
            self._after_faces(run, done)

    def _upscaling(self, run: dict) -> None:
        """Ampliar no fim: each finished picture is redrawn larger by SeedVR2. Like the face pass it only improves a
        result: a failure keeps the picture as it was, and without the models the stage is skipped."""
        settings = run['settings']
        factor = settings['upscale']
        if not self._upscale_model_installed():
            for image in self.repository.tasks(run['id'], 'image'):
                if image['status'] == 'completed' and 'upscale' not in image['result']:
                    self.repository.task_transition(image['id'], 'completed', result_json={
                        **image['result'], 'upscale': {'factor': factor, 'skipped': True}})
            self._images_ready(run, [t for t in self.repository.tasks(run['id'], 'image') if t['status'] == 'completed'])
            return
        upscales = {t['position']: t for t in self.repository.tasks(run['id'], 'upscale')}
        waiting = False
        for image in self.repository.tasks(run['id'], 'image'):
            if self._stop.is_set():
                return
            if image['status'] != 'completed' or 'upscale' in image['result']:
                continue
            file_hash, seed = image['result']['files'][0], image['seed']
            task = upscales.get(image['position']) or self.repository.add_task(run['id'], 'upscale', image['position'],
                                                                              seed=seed)

            def build(file_hash=file_hash, seed=seed):
                name = self.comfy.upload(self.store.read(file_hash), f'prisma_{file_hash[:24]}.png', 'image/png')
                return upscale_graph(name, factor, seed, prefix=f'prisma/{run["id"][:8]}_up')
            task = self._drive_optional(task, build)
            if task['status'] not in TASK_DONE:
                waiting = True
                continue
            if task['status'] == 'completed':
                self._store_outputs(task, run)
                upscaled = self.repository.task(task['id'])['result']['files'][0]
                size = oriented_size(self.store.read(upscaled))
                # raw_files keep the pictures as they were before this stage (the first generated one, and the
                # face-detailed one when both passes ran), so deleting the run removes all of them.
                raw = list(dict.fromkeys([*(image['result'].get('raw_files') or []), *image['result']['files']]))
                result = {**image['result'], 'files': [upscaled], 'raw_files': raw,
                          'upscale': {'factor': factor, 'size': list(size)}}
            else:
                result = {**image['result'], 'upscale': {'factor': factor,
                                                         'error': task['error'] or 'Não foi possível ampliar.'}}
            self.repository.task_transition(image['id'], 'completed', result_json=result)
        if not waiting:
            done = [t for t in self.repository.tasks(run['id'], 'image') if t['status'] == 'completed']
            self._images_ready(run, done)

    def _face_job(self, run: dict, seed: int, name: str) -> ImageJob:
        """Img2img of one face crop: no LoRA and no reference image, so only the low denoise touches the face."""
        settings, engine = run['settings'], run['settings']['engine']
        style = dict((run.get('compiled') or {}).get('segments') or ()).get('op.style')
        return ImageJob(mode='generate', prompt=face_detail.prompt(style), profile=settings['profile'], seed=seed,
                        resolution=FACE_SIZE, init_image=name, denoise=face_detail.DENOISE,
                        negative_prompt=engine.get('negative_prompt', ''), steps=engine.get('steps'),
                        sampler=engine.get('sampler'), scheduler=engine.get('scheduler'),
                        prefix=f'prisma/{run["id"][:8]}_face')

    def _paste_faces(self, image: dict, data: bytes, found: int, people: int | None, expected: int | None,
                     pending: list) -> None:
        refined = []
        for task, box, crop in pending:
            if task['status'] == 'completed':
                output = task['result']['images'][0]
                refined.append((self.comfy.view(output['filename'], output.get('subfolder', ''), output['type']),
                                box, crop))
        result = {**image['result'], 'detail': {'found': found, 'refined': len(refined), 'expected': expected,
                                                'people': people}}
        if refined:
            with self.repository.db.write_lock:
                stored = self.store.put(paste_faces(data, refined), MAX_RESULT_BYTES)
                self.repository.record_file(stored)
            result.update(files=[stored.hash], raw_files=image['result']['files'])
        self.repository.task_transition(image['id'], 'completed', result_json=result)

    def _drive_optional(self, task: dict, build) -> dict:
        """Like `_drive`, but a graph this ComfyUI cannot run fails only the task, not the whole run."""
        try:
            return self._drive(task, build)
        except ValueError as error:
            return self.repository.task_transition(task['id'], 'failed', error=str(error)[:2000])

    def _verifying(self, run: dict) -> None:
        checks = [Check(**c) for c in run['settings']['checks']]
        refs = run['settings']['uploaded']['images']
        faces = (run['settings'].get('participants') or 1) if any(c.id in FACE_CHECKS for c in checks) else 0
        faces = faces if faces and self._face_model_installed() else 0
        images = {t['position']: t for t in self.repository.tasks(run['id'], 'image') if t['status'] == 'completed'}
        judges = {t['position']: t for t in self.repository.tasks(run['id'], 'verify')}
        for position, image_task in images.items():
            if position not in judges:
                judges[position] = self.repository.add_task(run['id'], 'verify', position)
            judge = judges[position]
            if judge['status'] in TASK_DONE:
                continue

            def build(image_task=image_task):
                file_hash = image_task['result']['files'][0]
                name = self.comfy.upload(self.store.read(file_hash), f'prisma_{file_hash[:24]}.png', 'image/png')
                return text_graph(TextJob(prompt=judge_prompt(checks, face_closeup=bool(faces)),
                                          system_prompt=JUDGE_SYSTEM, images=(name, *refs), max_length=1024,
                                          face_crops=faces))
            self._drive(judge, build)
        judges = {t['position']: t for t in self.repository.tasks(run['id'], 'verify')}
        if len(judges) < len(images) or not all(t['status'] in TASK_DONE for t in judges.values()):
            return
        best, best_rank = None, (False, -1.0)
        for position, judge in sorted(judges.items()):
            text = judge['result'].get('text', '') if judge['status'] == 'completed' else ''
            verdicts = parse_verdicts(text or '', checks)
            value = score(verdicts)
            self.repository.task_transition(images[position]['id'], 'completed', result_json={
                **images[position]['result'], 'verdicts': verdicts, 'score': value})
            rank = (not extra_people(images[position]['result']), value)   # a counted extra person loses first
            if rank > best_rank:
                best, best_rank = images[position]['id'], rank
        self.repository.transition(run['id'], 'completed', best_task_id=best)

    # task driver ------------------------------------------------------------
    def _drive(self, task: dict, build) -> dict:
        """Advance one task. A submission is sent at most once automatically: when its outcome is unknown the
        task becomes `uncertain` and only a sighting in ComfyUI or an explicit user decision moves it on."""
        status = task['status']
        if status == 'created':
            graph = build()
            self._validate(graph)
            prompt_id = str(uuid.uuid4())
            task = self.repository.task_transition(task['id'], 'submitting', comfy_prompt_id=prompt_id,
                                                   graph_json=graph)
            try:
                self.comfy.submit(task['graph'], task['comfy_prompt_id'])
            except ComfyNotSent:                    # no connection was made: nothing can have arrived
                self.reachable = False
                return self.repository.task_transition(task['id'], 'created', comfy_prompt_id=None)
            except ComfyUnavailable:
                self.reachable = False
                return self._uncertain(task, 'A resposta do ComfyUI ao envio se perdeu.')
            except ComfyRejected as error:
                return self.repository.task_transition(task['id'], 'failed', error=str(error)[:2000])
            return self.repository.task_transition(task['id'], 'queued', submitted_at=now(), error=None)
        if status in ('submitting', 'uncertain'):
            # Found after a restart (or still unconfirmed): the request may or may not have arrived.
            state = self.comfy.job(task['comfy_prompt_id'])
            if state.status != 'missing':
                self.repository.event(task['run_id'], 'submission_confirmed', {'task': task['id']})
                return self.repository.task_transition(task['id'], 'queued', submitted_at=task['submitted_at'] or now(),
                                                   error=None)
            if status == 'submitting':
                return self._uncertain(task, 'O Studio parou durante o envio e o ComfyUI não mostra o trabalho.')
            return task                             # keep waiting: a sighting or the user's decision resolves it
        if status in ('queued', 'running'):
            return self._observe(task)
        return task

    def _uncertain(self, task: dict, reason: str) -> dict:
        self.repository.event(task['run_id'], 'submission_uncertain', {'task': task['id'], 'reason': reason})
        return self.repository.task_transition(task['id'], 'uncertain', error=reason)

    def _observe(self, task: dict) -> dict:
        state = self.comfy.job(task['comfy_prompt_id'])
        self.reachable = True
        if state.status == 'missing':
            self._missing[task['id']] = self._missing.get(task['id'], 0) + 1
            if self._missing[task['id']] >= 3:
                return self.repository.task_transition(task['id'], 'lost', error='O trabalho sumiu do ComfyUI '
                                                       '(reinício ou fila limpa).')
            return task
        self._missing.pop(task['id'], None)
        if state.status == 'pending':
            return task
        if state.status == 'in_progress':
            return self.repository.task_transition(task['id'], 'running', started_at=state.start_time or task['started_at'] or now())
        timings = self._timings(task)
        if state.status == 'completed':
            outputs = self.comfy.outputs(task['comfy_prompt_id'])
            images = task['kind'] in IMAGE_KINDS
            result = {'images': image_outputs(outputs)} if images else {'text': text_output(outputs)}
            if PEOPLE_OUTPUT_NODE in outputs:
                result['people'] = text_output(outputs, PEOPLE_OUTPUT_NODE)
            if images and not result['images']:
                return self.repository.task_transition(task['id'], 'failed', error='O workflow terminou sem imagem.',
                                                       timings_json=timings)
            return self.repository.task_transition(task['id'], 'completed', result_json=result, timings_json=timings,
                                                   started_at=state.start_time or task['started_at'], ended_at=state.end_time or now())
        if state.status == 'cancelled':
            return self.repository.task_transition(task['id'], 'cancelled', timings_json=timings)
        return self.repository.task_transition(task['id'], 'failed', error=f'Falha no ComfyUI: {state.error or "veja o log"}',
                                               timings_json=timings)

    def _timings(self, task: dict) -> dict | None:
        if self.progress is None:
            return None
        snapshot = self.progress.snapshot(task['comfy_prompt_id'])
        if not snapshot:
            return None
        phases: dict[str, float] = {}
        graph = task.get('graph') or {}
        for node, seconds in snapshot['timings'].items():
            phase = PHASES.get(graph.get(str(node), {}).get('class_type'), 'other')
            phases[phase] = round(phases.get(phase, 0) + seconds, 3)
        return {'phases': phases, 'nodes': snapshot['timings'], 'cached': snapshot['cached']}

    def _store_outputs(self, task: dict, run: dict | None = None) -> None:
        if task['result'].get('files'):
            return
        run = run or self.repository.get(task['run_id'])
        settings = run['settings']
        masked = run['mode'] == 'edit' and settings.get('mask') and settings.get('images')
        files = []
        for image in task['result']['images']:
            data = self.comfy.view(image['filename'], image.get('subfolder', ''), image['type'])
            if masked:
                # Recompose on the untouched original: outside the drawn mask every pixel is the original's.
                data = composite_on_original(self.store.read(settings['images'][0]), data,
                                             self.store.read(settings['mask']), MASK_FEATHER)
            with self.repository.db.write_lock:
                stored = self.store.put(data, MAX_RESULT_BYTES)
                self.repository.record_file(stored)
            files.append(stored.hash)
        self.repository.task_transition(task['id'], 'completed', result_json={**task['result'], 'files': files})

    def _face_model_installed(self) -> bool:
        """The face close-up is optional: without the detection model the judge sees only the full image."""
        if self._face_model is None:                # asked once per Studio start
            try:
                if self._object_info is None:
                    self._object_info = self.comfy.object_info()
                self._face_model = FACE_MODEL in str(self._object_info.get('LoadMediaPipeFaceLandmarker', {}))
            except Exception:                       # noqa: BLE001 - a missing close-up never blocks the verdict
                return False
        return self._face_model

    def _upscale_model_installed(self) -> bool:
        """Ampliar no fim is optional: without the SeedVR2 nodes and models the pictures keep their generated size."""
        if self._upscale_model is None:             # asked once per Studio start
            try:
                if self._object_info is None:
                    self._object_info = self.comfy.object_info()
                self._upscale_model = ('SeedVR2Conditioning' in self._object_info
                                       and UPSCALE_MODEL in str(self._object_info.get('UNETLoader', {}))
                                       and UPSCALE_VAE in str(self._object_info.get('VAELoader', {})))
            except Exception:                       # noqa: BLE001 - a missing upscaler never blocks the run
                return False
        return self._upscale_model

    def _skeleton_models_installed(self) -> bool:
        """Without SDPose and RT-DETR the pose photo itself is sent, as before skeletons existed."""
        if self._skeleton_models is None:            # asked once per Studio start
            try:
                if self._object_info is None:
                    self._object_info = self.comfy.object_info()
                info = self._object_info
                self._skeleton_models = ('SDPoseDrawKeypoints' in info
                                         and POSE_MODEL in str(info.get('CheckpointLoaderSimple', {}))
                                         and PEOPLE_MODEL in str(info.get('UNETLoader', {})))
            except Exception:                       # noqa: BLE001 - a missing skeleton never blocks the run
                return False
        return self._skeleton_models

    def _people_model_installed(self) -> bool:
        """Counting bodies is optional: without RT-DETR the faces alone are counted."""
        if self._people_model is None:              # asked once per Studio start
            try:
                if self._object_info is None:
                    self._object_info = self.comfy.object_info()
                self._people_model = ('RTDETR_detect' in self._object_info
                                      and PEOPLE_MODEL in str(self._object_info.get('UNETLoader', {})))
            except Exception:                       # noqa: BLE001 - a missing detector never blocks the run
                return False
        return self._people_model

    def _validate(self, graph: dict) -> None:
        if not self.validate:
            return
        if self._object_info is None:
            self._object_info = self.comfy.object_info()
        problems = validate_graph(graph, self._object_info)
        if problems:
            self._object_info = self.comfy.object_info()   # refresh once: models may have been installed
            problems = validate_graph(graph, self._object_info)
        if problems:
            raise ValueError('O workflow não é executável neste ComfyUI: ' + ' '.join(problems[:8]))

    def _blocks(self, run: dict):
        from ..domain import ir
        total = run['settings'].get('participants')
        return [ir.Participants(total, run['mode'] == 'edit')] if total and total > 1 else []

    # cancellation -----------------------------------------------------------
    def _cancel(self, run: dict) -> None:
        try:
            for task in self.repository.tasks(run['id']):
                if task['status'] in TASK_DONE:
                    continue
                if task['status'] in ('created',):
                    self.repository.task_transition(task['id'], 'cancelled')
                    continue
                self.comfy.cancel(task['comfy_prompt_id'])
                state = self.comfy.job(task['comfy_prompt_id'])
                if state.status in ('cancelled', 'missing'):
                    self.repository.task_transition(task['id'], 'cancelled')
                elif state.status == 'completed':
                    self._observe(task)              # finished before the cancel landed: keep the result
                elif state.status == 'failed':
                    self.repository.task_transition(task['id'], 'failed', error=state.error)
        except ComfyUnavailable:
            self.reachable = False
            return                                    # try again on the next tick; intent stays recorded
        tasks = self.repository.tasks(run['id'])
        if all(t['status'] in TASK_DONE for t in tasks):
            for task in tasks:
                if task['kind'] == 'image' and task['status'] == 'completed':
                    self._store_outputs(self.repository.task(task['id']), run)
            self.repository.transition(run['id'], 'cancelled')
