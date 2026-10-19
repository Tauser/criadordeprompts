"""Portuguese -> English previews through the local text model. Never saves anything by itself."""
from __future__ import annotations

import re
import threading
import uuid

from ..infrastructure.comfy.client import ComfyUnavailable
from ..infrastructure.comfy.workflows import TextJob, text_graph, text_output
from .enhancer import TRANSLATE_SYSTEM, clean_output


FIELD_LIMIT = 4000                     # the longest text a prompt field accepts


def translation_budget(text: str) -> int:
    """Tokens for the answer: about twice the source, so a looping model stops early instead of filling a field."""
    return max(96, min(1536, len(text) // 2 + 64))


def strip_repetition(text: str) -> str:
    """Remove the loops greedy decoding can fall into: repeated sentences and phrases repeated back to back."""
    text = re.sub(r'(.{12,160}?)(?:[ \t,;]*\1)+', r'\1', text, flags=re.S)
    parts = re.split(r'((?<=[.!?])\s+)', text.strip())          # sentence, separator, sentence, ...
    kept, seen = [], set()
    for i in range(0, len(parts), 2):
        key = re.sub(r'\W+', ' ', parts[i]).strip().lower()
        if key and key in seen:
            continue
        seen.add(key)
        kept.append(parts[i] + (parts[i + 1] if i + 1 < len(parts) else ''))
    return ''.join(kept).strip().rstrip(' ,;')


class TranslationService:
    system_prompt = TRANSLATE_SYSTEM
    budget = staticmethod(translation_budget)

    def __init__(self, comfy):
        self.comfy = comfy
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def start(self, text: str) -> dict:
        text = (text or '').strip()
        if not text or len(text) > 4000:
            raise ValueError('O texto deve ter de 1 a 4.000 caracteres.')
        return self._submit(text, {'source': text}, self.budget(text))

    def _submit(self, prompt: str, job: dict, max_length: int = 2048) -> dict:
        job_id = str(uuid.uuid4())
        graph = text_graph(TextJob(prompt=prompt, system_prompt=self.system_prompt, max_length=max_length))
        self.comfy.submit(graph, job_id)
        with self.lock:
            self.jobs[job_id] = {'status': 'queued', **job}
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
            self._finish(job, clean_output(text_output(self.comfy.outputs(job_id))))
        elif state.status in ('failed', 'cancelled'):
            job.update(status=state.status, error=state.error)
        elif state.status == 'missing':
            job.update(status='failed', error='A tradução não está mais no ComfyUI.')
        else:
            job['status'] = 'running' if state.status == 'in_progress' else 'queued'
        return {'id': job_id, **job}

    def _finish(self, job: dict, text: str) -> None:
        text = strip_repetition(text)
        source = job.get('source', '')
        if not text:
            job.update(status='failed', text=None, error='A tradução veio vazia. O texto original foi preservado.')
        elif len(text) > FIELD_LIMIT or len(text) > 3 * len(source) + 400:
            job.update(status='failed', text=None, error='A tradução saiu repetida ou longa demais e foi descartada. '
                       'O texto original foi preservado; tente de novo ou divida o texto.')
        else:
            job.update(status='completed', text=text, error=None)

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job['status'] in ('completed', 'failed', 'cancelled'):
                return {'id': job_id, **job}
        self.comfy.cancel(job_id)
        with self.lock:
            if job_id in self.jobs and self.jobs[job_id]['status'] in ('queued', 'running'):
                self.jobs[job_id]['status'] = 'cancelled'
        return self.status(job_id)
