"""Portuguese -> English previews through the local text model. Never saves anything by itself."""
from __future__ import annotations

import threading
import uuid

from ..infrastructure.comfy.client import ComfyUnavailable
from ..infrastructure.comfy.workflows import TextJob, text_graph, text_output
from .enhancer import TRANSLATE_SYSTEM, clean_output


class TranslationService:
    def __init__(self, comfy):
        self.comfy = comfy
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def start(self, text: str) -> dict:
        text = (text or '').strip()
        if not text or len(text) > 4000:
            raise ValueError('O texto deve ter de 1 a 4.000 caracteres.')
        job_id = str(uuid.uuid4())
        graph = text_graph(TextJob(prompt=text, system_prompt=TRANSLATE_SYSTEM, max_length=2048))
        self.comfy.submit(graph, job_id)
        with self.lock:
            self.jobs[job_id] = {'status': 'queued', 'source': text}
            while len(self.jobs) > 200:
                self.jobs.pop(next(iter(self.jobs)))
        return {'id': job_id, 'status': 'queued'}

    def status(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job['status'] in ('completed', 'failed', 'cancelled'):
            return {'id': job_id, **job}
        try:
            state = self.comfy.job(job_id)
        except ComfyUnavailable:
            return {'id': job_id, **job, 'warning': 'ComfyUI indisponível no momento.'}
        if state.status == 'completed':
            text = clean_output(text_output(self.comfy.outputs(job_id)))
            job.update(status='completed' if text else 'failed', text=text or None,
                       error=None if text else 'A tradução veio vazia. O texto original foi preservado.')
        elif state.status in ('failed', 'cancelled'):
            job.update(status=state.status, error=state.error)
        elif state.status == 'missing':
            job.update(status='failed', error='A tradução não está mais no ComfyUI.')
        else:
            job['status'] = 'running' if state.status == 'in_progress' else 'queued'
        return {'id': job_id, **job}

    def cancel(self, job_id: str) -> dict:
        self.comfy.cancel(job_id)
        with self.lock:
            if job_id in self.jobs and self.jobs[job_id]['status'] in ('queued', 'running'):
                self.jobs[job_id]['status'] = 'cancelled'
        return self.status(job_id)
