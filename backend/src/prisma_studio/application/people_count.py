"""Counts the people in a photo with ComfyUI's face detector, and RT-DETR's body detector when it is installed, to
suggest "Pessoas na foto". Never saves anything."""
from __future__ import annotations

import threading
import uuid

from ..infrastructure.comfy.client import ComfyRejected, ComfyUnavailable
from ..infrastructure.comfy.workflows import (PEOPLE_MODEL, PEOPLE_OUTPUT_NODE, face_boxes, face_detect_graph,
                                              people_count, text_output)

MAX_FACES = 10                 # the most people a request accepts
MIN_SCORE = 0.6                # the 'full' detector also scores hands and chests, mostly below this
MIN_RELATIVE_SIZE = 0.3        # faces far smaller than the largest are bystanders or false hits, not the subjects
EXTENSIONS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}


def count_faces(boxes: list[dict]) -> int:
    confident = [b for b in boxes if b['score'] >= MIN_SCORE]
    if not confident:
        return 0
    largest = max(max(b['width'], b['height']) for b in confident)
    return sum(1 for b in confident if max(b['width'], b['height']) >= MIN_RELATIVE_SIZE * largest)


class PeopleCounter:
    def __init__(self, comfy, store, files):
        self.comfy, self.store, self.files = comfy, store, files
        self.jobs: dict[str, dict] = {}
        self.counts: dict[str, int] = {}            # file hash -> people found, so choosing the same photo is instant
        self.lock = threading.Lock()
        self._bodies: bool | None = None            # RT-DETR installed; asked once per Studio start

    def start(self, file_hash: str) -> dict:
        record = self.files(file_hash)
        if record is None:
            raise KeyError(file_hash)
        job_id = str(uuid.uuid4())
        with self.lock:
            known = self.counts.get(file_hash)
        if known is not None:
            job = {'status': 'completed', 'count': known, 'file': file_hash}
        else:
            job = {'status': 'queued', 'file': file_hash}
            try:
                ext = EXTENSIONS.get(record['mime'], 'png')
                name = self.comfy.upload(self.store.read(file_hash), f'prisma_{file_hash[:24]}.{ext}', record['mime'])
                self.comfy.submit(face_detect_graph(name, MAX_FACES, people=self._bodies_installed()), job_id)
            except ComfyRejected:
                job.update(status='failed', error='O detector de rostos não está disponível no ComfyUI.')
            except ComfyUnavailable:
                job.update(status='failed', error='ComfyUI indisponível: informe o número manualmente.')
        with self.lock:
            self.jobs[job_id] = job
            while len(self.jobs) > 200:
                self.jobs.pop(next(iter(self.jobs)))
        return {'id': job_id, **job}

    def _bodies_installed(self) -> bool:
        if self._bodies is None:
            try:
                info = self.comfy.object_info()
                self._bodies = 'RTDETR_detect' in info and PEOPLE_MODEL in str(info.get('UNETLoader', {}))
            except Exception:                       # noqa: BLE001 - without the body detector the faces still count
                return False
        return self._bodies

    def status(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job['status'] in ('completed', 'failed', 'cancelled'):
            return {'id': job_id, **job}
        try:
            state = self.comfy.job(job_id)
            if state.status == 'completed':
                outputs = self.comfy.outputs(job_id)
                # Faces alone missed whoever was turned away, in profile or farther back: the photo then seemed to
                # hold fewer people, and the edit "added" someone who was already there, one person too many.
                bodies = people_count(text_output(outputs, PEOPLE_OUTPUT_NODE)) or 0
                count = min(MAX_FACES, max(count_faces(face_boxes(text_output(outputs))), bodies))
                job.update(status='completed', count=count)
                with self.lock:
                    self.counts[job['file']] = count
            elif state.status in ('failed', 'cancelled', 'missing'):
                job.update(status='failed', error=state.error or 'A contagem de pessoas não terminou.')
            else:
                job['status'] = 'running' if state.status == 'in_progress' else 'queued'
        except ComfyUnavailable:
            return {'id': job_id, **job, 'warning': 'ComfyUI indisponível no momento.'}
        return {'id': job_id, **job}

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
