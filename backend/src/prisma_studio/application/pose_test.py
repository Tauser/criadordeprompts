"""Quick preview of a pose or action draft: Turbo, 1024 px, a neutral person in a neutral studio.

Nothing is saved: not in the library, not in the history, not in the file store. The image lives in memory
until it is fetched or pushed out by newer tests."""
from __future__ import annotations

import secrets
import threading
import uuid

from ..domain.catalog import Item
from ..infrastructure.comfy.client import ComfyUnavailable
from ..infrastructure.comfy.workflows import ImageJob, generation_size, image_graph, image_outputs

CATEGORIES = ('pose', 'action')
KEEP = 20                          # finished tests kept in memory (with their image)
NUMBERS = {2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten'}


class PoseTestRefused(ValueError):
    pass


def people(item: Item) -> str:
    count = item.requirements.participants or 1
    if item.requirements.children:          # a scene with children is never described as adults
        return 'a person' if count == 1 else f'{NUMBERS[count]} people'
    return 'an adult' if count == 1 else f'{NUMBERS[count]} adults'


def preview_prompt(item: Item) -> str:
    return (f'Create an image. Photograph of {people(item)} in plain casual clothes in a plain light-gray studio: '
            f'{item.prompt.strip()}')


def check_policy(item: Item, content_mode: str, confirmations: set[str]) -> None:
    if item.category not in CATEGORIES:
        raise PoseTestRefused('Só poses e ações podem ser testadas.')
    if item.adult:
        if content_mode != 'adult':
            raise PoseTestRefused('Ative o conteúdo adulto para testar esta opção.')
        if 'adults_only' not in confirmations:
            raise PoseTestRefused('Confirme que todas as pessoas retratadas são adultas.')


class PoseTester:
    def __init__(self, comfy):
        self.comfy = comfy
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def start(self, item: Item, content_mode: str = 'standard', confirmations=()) -> dict:
        check_policy(item, content_mode, set(confirmations))
        count = item.requirements.participants or 1
        width, height = generation_size(1024, '3:4' if count == 1 else '1:1')
        job_id = str(uuid.uuid4())
        prompt = preview_prompt(item)
        graph = image_graph(ImageJob(mode='generate', prompt=prompt, profile='turbo', seed=secrets.randbelow(2**32),
                                     resolution=1024, width=width, height=height, prefix='prisma/pose-test'))
        self.comfy.submit(graph, job_id)
        with self.lock:
            self.jobs[job_id] = {'status': 'queued', 'prompt': prompt}
            while len(self.jobs) > KEEP:
                self.jobs.pop(next(iter(self.jobs)))
        return {'id': job_id, 'status': 'queued', 'prompt': prompt}

    def _view(self, job_id: str, job: dict) -> dict:
        return {'id': job_id, **{k: v for k, v in job.items() if k != 'image'}, 'has_image': 'image' in job}

    def status(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job['status'] in ('completed', 'failed', 'cancelled'):
            return self._view(job_id, job)
        try:
            state = self.comfy.job(job_id)
            if state.status == 'completed':
                images = image_outputs(self.comfy.outputs(job_id))
                if images:
                    first = images[0]
                    job['image'] = self.comfy.view(first['filename'], first.get('subfolder', ''), first['type'])
                    job.update(status='completed', error=None)
                else:
                    job.update(status='failed', error='O ComfyUI não devolveu a imagem.')
            elif state.status in ('failed', 'cancelled'):
                job.update(status=state.status, error=state.error)
            elif state.status == 'missing':
                job.update(status='failed', error='O teste não está mais no ComfyUI.')
            else:
                job['status'] = 'running' if state.status == 'in_progress' else 'queued'
        except ComfyUnavailable:
            return {**self._view(job_id, job), 'warning': 'ComfyUI indisponível no momento.'}
        return self._view(job_id, job)

    def image(self, job_id: str) -> bytes:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None or 'image' not in job:
            raise KeyError(job_id)
        return job['image']

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job['status'] in ('completed', 'failed', 'cancelled'):
                return self._view(job_id, job)
        self.comfy.cancel(job_id)
        with self.lock:
            if job_id in self.jobs and self.jobs[job_id]['status'] in ('queued', 'running'):
                self.jobs[job_id]['status'] = 'cancelled'
        return self.status(job_id)
