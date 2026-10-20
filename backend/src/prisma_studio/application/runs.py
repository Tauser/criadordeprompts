"""Run use cases: validate and compile, persist before anything reaches ComfyUI, review, cancel."""
from __future__ import annotations

import secrets
from dataclasses import asdict

from ..domain import face_detail
from ..domain.compiler import compile_request
from ..domain.request import Request
from ..domain.rules import assess, automatic_participants
from ..domain.verification import checklist
from ..infrastructure.comfy.workflows import generation_size
from ..infrastructure.db.repository import TERMINAL, MissingFile


class RequestRejected(ValueError):
    def __init__(self, message: str, issues=None):
        super().__init__(message)
        self.issues = issues or []


def issue_dict(issue) -> dict:
    return asdict(issue)


def prepare(request: Request, library) -> dict:
    assessment = assess(request, library)
    result = {'valid': assessment.valid, 'status': assessment.status,
              'issues': [issue_dict(i) for i in assessment.issues], 'slots': assessment.slots,
              'prompt': None, 'segments': [], 'checks': []}
    automatic, reason = automatic_participants(request, assessment.resolved)
    result['participants'] = {'total': assessment.participants_total, 'automatic': automatic, 'reason': reason}
    if assessment.valid:
        compiled = compile_request(request, assessment)
        result.update(prompt=compiled.text, segments=[{'block': b, 'text': t} for b, t in compiled.segments],
                      checks=[asdict(c) for c in checklist(compiled.blocks)], compiler_version=compiled.version)
    return result


class RunService:
    def __init__(self, repository, library_service, store, executor=None):
        self.repository = repository
        self.library = library_service
        self.store = store
        self.executor = executor

    def create(self, request: Request, request_id: str, files: dict[str, str], mask: str | None) -> dict:
        existing = self.repository.by_request(request_id)
        if existing:
            return existing
        assessment = assess(request, self.library.library())
        if not assessment.valid:
            raise RequestRejected('O pedido tem erros.', [issue_dict(i) for i in assessment.issues])
        compiled = compile_request(request, assessment)
        ordered = sorted(assessment.slots, key=assessment.slots.get)
        missing = [ref_id for ref_id in ordered if ref_id not in files]
        if missing:
            raise RequestRejected('Anexe os arquivos das referências: ' + ', '.join(missing))
        for file_hash in [files[r] for r in ordered] + ([mask] if mask else []):
            if self.repository.file(file_hash) is None:
                raise RequestRejected('Arquivo não encontrado no Studio. Envie-o novamente.')
        if request.mask and not mask:
            raise RequestRejected('Desenhe a máscara da área a editar.')
        output = request.output
        if request.mask and output.width:
            raise RequestRejected('Na edição com máscara a imagem mantém o tamanho da foto. '
                                  'Remova o tamanho personalizado.')
        width, height = (output.width, output.height) if output.width else (
            generation_size(output.resolution, output.aspect) if request.mode == 'generate' else (None, None))
        settings = {
            'images': [files[r] for r in ordered], 'mask': mask if request.mask else None,
            'profile': output.profile, 'resolution': 0 if request.mask else output.resolution,
            'width': width, 'height': height, 'variations': output.variations,
            'seed': output.seed if output.seed is not None else secrets.randbelow(2**32),
            'verify': output.verify, 'refine': output.refine and output.profile == 'qwen21',
            'engine': request.engine.model_dump(), 'checks': [asdict(c) for c in checklist(compiled.blocks)],
            'compiler_version': compiled.version, 'participants': assessment.participants_total, 'blocks': [b.id for b in compiled.blocks],
            'face_detail': face_detail.enabled(output.face_detail, assessment.participants_total),
        }
        return self._insert(request_id, request.mode, request.model_dump(mode='json'),
                            {'references': files, 'mask': mask}, settings, prompt=compiled.text,
                            compiled={'segments': compiled.segments, 'version': compiled.version})

    def _insert(self, request_id: str, mode: str, request: dict, files: dict, settings: dict, *, prompt: str,
                effective_prompt: str | None = None, compiled: dict | None = None) -> dict:
        try:
            run, created = self.repository.create(request_id, mode, request, files, settings, prompt=prompt,
                                                  effective_prompt=effective_prompt, compiled=compiled)
        except MissingFile as error:
            raise RequestRejected('Arquivo não encontrado no Studio. Envie-o novamente.') from error
        if created:
            self._wake()
        return run

    def repeat(self, run_id: str, request_id: str, same_seed: bool = False) -> dict:
        """Run the frozen request again: same prompt actually used, settings and files; the library is not
        consulted again, so later edits to its items do not leak into the repetition."""
        existing = self.repository.by_request(request_id)
        if existing:
            return existing
        original = self._get(run_id)
        if not original['effective_prompt']:
            raise RequestRejected('Este pedido não tem um prompt registrado para repetir.')
        settings = {k: v for k, v in original['settings'].items() if k != 'uploaded'}
        if not same_seed:
            settings['seed'] = secrets.randbelow(2**32)
        settings['refine'] = False             # the prompt that was approved (or the original) is reused as is
        settings['repeat_of'] = original['id']
        return self._insert(request_id, original['mode'], original['request'], original['files'] or {}, settings,
                            prompt=original['prompt'] or original['effective_prompt'],
                            effective_prompt=original['effective_prompt'], compiled=original['compiled'])

    def approve(self, run_id: str, choice: str) -> dict:
        run = self._get(run_id)
        if run['status'] != 'review':
            raise RequestRejected('Este pedido não está aguardando revisão.')
        if choice not in ('refined', 'original'):
            raise RequestRejected('Escolha "refined" ou "original".')
        effective = run['refined_prompt'] if choice == 'refined' else run['prompt']
        if not effective or not effective.strip():
            raise RequestRejected('Não há texto aprimorado disponível. Escolha o prompt original.')
        self.repository.event(run_id, 'review', {'choice': choice})
        run = self.repository.transition(run_id, 'generating', effective_prompt=effective)
        self._wake()
        return run

    def cancel(self, run_id: str) -> dict:
        run = self._get(run_id)
        if run['status'] in TERMINAL:
            return run
        run = self.repository.update(run_id, cancel_requested=1)
        self.repository.event(run_id, 'cancel_requested', {})
        self._wake()
        return run

    def delete(self, run_id: str, keep_files: set[str] = frozenset()) -> dict:
        """Delete a finished run. Images no other run uses are removed from disk as well."""
        removed = self.repository.delete_with_files(run_id, set(keep_files), self.store.delete)
        return {'deleted': run_id, 'files_removed': removed}

    def delete_many(self, run_ids: list[str], keep_files: set[str] = frozenset()) -> dict:
        ids = list(dict.fromkeys(run_ids))
        removed = self.repository.delete_many_with_files(ids, set(keep_files), self.store.delete)
        return {'deleted': ids, 'files_removed': removed}

    def resubmit(self, run_id: str, task_id: str) -> dict:
        """The user decided: send again a task whose first submission could not be confirmed.
        If ComfyUI did receive the first one, both will run; that risk is what the user accepted."""
        run = self._get(run_id)
        if run['status'] in TERMINAL or run['cancel_requested']:
            raise RequestRejected('Este pedido foi encerrado ou está sendo cancelado e não pode reenviar etapas.')
        task = self.repository.task(task_id)
        if task is None or task['run_id'] != run_id or task['status'] != 'uncertain':
            raise RequestRejected('Esta etapa não está aguardando decisão de reenvio.')
        self.repository.event(run_id, 'resubmit_confirmed', {'task': task_id, 'previous': task['comfy_prompt_id']})
        self.repository.task_transition(task_id, 'created', comfy_prompt_id=None)
        self._wake()
        return self._get(run_id)

    def discard_uncertain(self, run_id: str) -> dict:
        run = self._get(run_id)
        if run['status'] != 'uncertain':
            raise RequestRejected('Este pedido não está em estado incerto.')
        return self.cancel(run_id)

    def _get(self, run_id: str) -> dict:
        run = self.repository.get(run_id)
        if run is None:
            raise KeyError(run_id)
        return run

    def _wake(self) -> None:
        if self.executor is not None:
            self.executor.wake()
