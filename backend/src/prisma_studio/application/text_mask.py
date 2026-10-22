"""Masks the area a short text describes ("the red shirt") with ComfyUI's SAM 3, for the mask editor to refine.

The result is stored like a mask painted in the editor: a single-channel PNG the size of the photo, white where the
area is. Nothing else is kept: the job lives in memory until it is pushed out by newer ones."""
from __future__ import annotations

import io
import threading
import uuid

from PIL import Image

from ..infrastructure.comfy.client import ComfyRejected, ComfyUnavailable
from ..infrastructure.comfy.workflows import image_outputs, text_mask_graph
from ..infrastructure.storage.files import normalized_png

KEEP = 50                          # finished jobs kept in memory
EXTENSIONS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}
TERMINAL = ('completed', 'failed', 'cancelled')


class TextMasker:
    def __init__(self, comfy, store, files, save):
        """`files(hash)` returns the stored record of a photo; `save(bytes)` stores a result and returns its hash."""
        self.comfy, self.store, self.files, self.save = comfy, store, files, save
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def start(self, file_hash: str, text: str) -> dict:
        record = self.files(file_hash)
        if record is None:
            raise KeyError(file_hash)
        job_id = str(uuid.uuid4())
        job = {'status': 'queued', 'file': file_hash, 'mask': None, 'error': None, 'empty': False}
        try:
            ext = EXTENSIONS.get(record['mime'], 'png')
            name = self.comfy.upload(self.store.read(file_hash), f'prisma_{file_hash[:24]}.{ext}', record['mime'])
            self.comfy.submit(text_mask_graph(name, text), job_id)
        except ComfyRejected:
            job.update(status='failed', error='O SAM 3 não está disponível no ComfyUI.')
        except ComfyUnavailable:
            job.update(status='failed', error='ComfyUI indisponível: tente de novo quando ele estiver aberto.')
        with self.lock:
            self.jobs[job_id] = job
            while len(self.jobs) > KEEP:
                self.jobs.pop(next(iter(self.jobs)))
        return {'id': job_id, **job}

    def status(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job['status'] in TERMINAL:
            return {'id': job_id, **job}
        try:
            state = self.comfy.job(job_id)
            if state.status == 'completed':
                self._finish(job_id, job)
            elif state.status in ('failed', 'cancelled', 'missing'):
                job.update(status='failed', error=state.error or 'A seleção por texto não terminou.')
            else:
                job['status'] = 'running' if state.status == 'in_progress' else 'queued'
        except ComfyUnavailable:
            return {'id': job_id, **job, 'warning': 'ComfyUI indisponível no momento.'}
        return {'id': job_id, **job}

    def _finish(self, job_id: str, job: dict) -> None:
        images = image_outputs(self.comfy.outputs(job_id))
        if not images:
            job.update(status='failed', error='O ComfyUI não devolveu a máscara.')
            return
        first = images[0]
        picture = self.comfy.view(first['filename'], first.get('subfolder', ''), first['type'])
        record = self.files(job['file'])
        if record is None:
            job.update(status='failed', error='A foto não está mais disponível.')
            return
        mask = normalized_png(picture, (record['width'], record['height']), mask=True)
        if Image.open(io.BytesIO(mask)).getextrema() == (0, 0):
            job.update(status='completed', mask=None, empty=True)       # nothing matched: black everywhere
            return
        job.update(status='completed', mask=self.save(mask), empty=False)

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job['status'] in ('queued', 'running'):
            try:
                self.comfy.cancel(job_id)
            except (ComfyUnavailable, ComfyRejected):
                pass
            job['status'] = 'cancelled'
        return {'id': job_id, **job}
