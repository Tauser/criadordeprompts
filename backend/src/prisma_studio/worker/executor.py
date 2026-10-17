"""Durable executor: one step at a time, every transition persisted, state observed from ComfyUI."""
from __future__ import annotations

import logging
import threading
import uuid

from ..application.enhancer import check, clean_output, system_prompt
from ..domain.verification import JUDGE_SYSTEM, Check, judge_prompt, parse_verdicts, score
from ..infrastructure.comfy.client import ComfyRejected, ComfyUnavailable
from ..infrastructure.comfy.validation import validate_graph
from ..infrastructure.comfy.workflows import (MAX_EDIT_PIXELS, ImageJob, TextJob, image_graph, image_outputs,
                                              text_graph, text_output)
from ..infrastructure.db.database import now
from ..infrastructure.storage.files import fit_multiple_of_32, normalized_png

log = logging.getLogger('prisma.executor')
TASK_DONE = {'completed', 'failed', 'cancelled', 'lost'}
PHASES = {'UNETLoader': 'loading_models', 'CLIPLoader': 'loading_models', 'VAELoader': 'loading_models',
          'QwenImage21Cache': 'loading_models', 'LoadImage': 'loading_images', 'LoadImageMask': 'loading_images',
          'TextEncodeQwenImage21': 'encoding', 'KSampler': 'sampling', 'SamplerCustom': 'sampling',
          'VAEDecode': 'decoding', 'GrowMask': 'compositing', 'FeatherMask': 'compositing',
          'ImageCompositeMasked': 'compositing', 'SaveImage': 'saving', 'TextGenerate': 'generating_text',
          'BatchImagesNode': 'loading_images', 'PreviewAny': 'saving'}


class Executor:
    def __init__(self, repository, comfy, store, progress=None, poll_seconds: float = 1.5, validate: bool = True):
        self.repository, self.comfy, self.store, self.progress = repository, comfy, store, progress
        self.poll_seconds, self.validate = poll_seconds, validate
        self._wake, self._stop = threading.Event(), threading.Event()
        self._thread: threading.Thread | None = None
        self._object_info: dict | None = None
        self._missing: dict[str, int] = {}
        self.reachable: bool | None = None

    # lifecycle --------------------------------------------------------------
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name='prisma-executor', daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

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
            if run['cancel_requested']:
                self._cancel(run)
                continue
            if run['status'] == 'review':
                continue
            if active_found and run['status'] == 'created':
                continue                      # one GPU: start the next run only after this one is submitted
            active_found = True
            self._step(run)

    def _step(self, run: dict) -> None:
        status = run['status']
        try:
            if status == 'created':
                self.repository.transition(run['id'], 'preparing')
                self._prepare(self.repository.get(run['id']))
            elif status == 'preparing':
                self._prepare(run)
            elif status == 'refining':
                self._refining(run)
            elif status == 'generating':
                self._generating(run)
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
                record = self.repository.file(file_hash)
                size = fit_multiple_of_32(record['width'], record['height'], MAX_EDIT_PIXELS)
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
        return {'images': names, 'mask': mask, 'target_size': size}

    def _create_image_tasks(self, run: dict) -> None:
        settings = run['settings']
        if self.repository.tasks(run['id'], 'image'):
            return
        for position in range(settings['variations']):
            self.repository.add_task(run['id'], 'image', position, seed=(settings['seed'] + position) % 2**53)

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
            def build(task=task):
                return image_graph(ImageJob(
                    mode=run['mode'], prompt=run['effective_prompt'], profile=settings['profile'], seed=task['seed'],
                    resolution=settings['resolution'], width=settings['width'], height=settings['height'],
                    images=tuple(uploaded['images']), mask=uploaded['mask'],
                    negative_prompt=engine.get('negative_prompt', ''), steps=engine.get('steps'),
                    cfg=engine.get('cfg'), sampler=engine.get('sampler'), scheduler=engine.get('scheduler'),
                    denoise=engine.get('denoise'), prefix=f'prisma/{run["id"][:8]}'))
            self._drive(task, build)
        tasks = self.repository.tasks(run['id'], 'image')
        if not all(t['status'] in TASK_DONE for t in tasks):
            return
        done = [t for t in tasks if t['status'] == 'completed']
        for task in done:
            self._store_outputs(task)
        if not done:
            self.repository.transition(run['id'], 'failed', error=next((t['error'] for t in tasks if t['error']),
                                                                       'Nenhuma imagem foi gerada.'))
        elif settings['verify'] and settings['checks']:
            self.repository.transition(run['id'], 'verifying')
        else:
            self.repository.transition(run['id'], 'completed', best_task_id=done[0]['id'])

    def _verifying(self, run: dict) -> None:
        checks = [Check(**c) for c in run['settings']['checks']]
        refs = run['settings']['uploaded']['images']
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
                return text_graph(TextJob(prompt=judge_prompt(checks), system_prompt=JUDGE_SYSTEM,
                                          images=(name, *refs), max_length=1024))
            self._drive(judge, build)
        judges = {t['position']: t for t in self.repository.tasks(run['id'], 'verify')}
        if len(judges) < len(images) or not all(t['status'] in TASK_DONE for t in judges.values()):
            return
        best, best_score = None, -1.0
        for position, judge in sorted(judges.items()):
            text = judge['result'].get('text', '') if judge['status'] == 'completed' else ''
            verdicts = parse_verdicts(text or '', checks)
            value = score(verdicts)
            self.repository.task_transition(images[position]['id'], 'completed', result_json={
                **images[position]['result'], 'verdicts': verdicts, 'score': value})
            if value > best_score:
                best, best_score = images[position]['id'], value
        self.repository.transition(run['id'], 'completed', best_task_id=best)

    # task driver ------------------------------------------------------------
    def _drive(self, task: dict, build) -> dict:
        status = task['status']
        if status == 'created':
            graph = build()
            self._validate(graph)
            prompt_id = str(uuid.uuid4())
            task = self.repository.task_transition(task['id'], 'submitting', comfy_prompt_id=prompt_id,
                                                   graph_json=graph)
            status = 'submitting'
        if status == 'submitting':
            try:
                self.comfy.submit(task['graph'], task['comfy_prompt_id'])
            except ComfyUnavailable:
                return self.repository.task_transition(task['id'], 'uncertain')
            except ComfyRejected as error:
                return self.repository.task_transition(task['id'], 'failed', error=str(error)[:2000])
            return self.repository.task_transition(task['id'], 'queued', submitted_at=now())
        if status == 'uncertain':
            state = self.comfy.job(task['comfy_prompt_id'])
            if state.status == 'missing':          # never accepted: resubmitting cannot duplicate it
                self.comfy.submit(task['graph'], task['comfy_prompt_id'])
            return self.repository.task_transition(task['id'], 'queued')
        if status in ('queued', 'running'):
            return self._observe(task)
        return task

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
            result = {'images': image_outputs(outputs)} if task['kind'] == 'image' else {'text': text_output(outputs)}
            if task['kind'] == 'image' and not result['images']:
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

    def _store_outputs(self, task: dict) -> None:
        if task['result'].get('files'):
            return
        files = []
        for image in task['result']['images']:
            stored = self.store.put(self.comfy.view(image['filename'], image.get('subfolder', ''), image['type']))
            self.repository.record_file(stored)
            files.append(stored.hash)
        self.repository.task_transition(task['id'], 'completed', result_json={**task['result'], 'files': files})

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
                    self._store_outputs(self.repository.task(task['id']))
            self.repository.transition(run['id'], 'cancelled')
