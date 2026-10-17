"""Run use cases: validate and compile, persist before anything reaches ComfyUI, review, cancel."""
from __future__ import annotations

import secrets
from dataclasses import asdict

from ..domain.compiler import compile_request
from ..domain.request import Request
from ..domain.rules import assess
from ..domain.verification import checklist
from ..infrastructure.comfy.workflows import generation_size
from ..infrastructure.db.repository import TERMINAL


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
        }
        run, created = self.repository.create(request_id, request.mode, request.model_dump(mode='json'),
                                              {'references': files, 'mask': mask}, settings)
        if created:
            run = self.repository.update(run['id'], prompt=compiled.text, effective_prompt=compiled.text,
                                         compiled_json={'segments': compiled.segments, 'version': compiled.version})
            self._wake()
        return run

    def approve(self, run_id: str, choice: str) -> dict:
        run = self._get(run_id)
        if run['status'] != 'review':
            raise RequestRejected('Este pedido não está aguardando revisão.')
        if choice not in ('refined', 'original'):
            raise RequestRejected('Escolha "refined" ou "original".')
        effective = run['refined_prompt'] if choice == 'refined' else run['prompt']
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
