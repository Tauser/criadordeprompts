"""Prepares the reference photo of a person swap: finds the face, crops head, neck and shoulders, says if it faces
the camera. Measured on the edit model: a reference that shows the arms or a pose gets copied into the scene, and
a face in profile does not carry the identity, so the crop is tight and a turned face is flagged."""
from __future__ import annotations

import threading
import uuid

from ..infrastructure.comfy.client import ComfyRejected, ComfyUnavailable
from ..infrastructure.comfy.workflows import face_pose_graph, face_poses, text_output
from ..infrastructure.storage.files import bust_box, bust_png
from .people_count import EXTENSIONS, MIN_SCORE

MAX_TURN = 30                  # degrees: beyond this the face is too far from frontal to carry the identity
MAX_FACE_SHARE = 0.2           # face height / photo height above which the photo is a portrait, not a body


class BustService:
    def __init__(self, comfy, store, files, save):
        """`files(hash)` gives a stored file's record; `save(bytes)` stores and records a new file."""
        self.comfy, self.store, self.files, self.save = comfy, store, files, save
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def start(self, file_hash: str) -> dict:
        record = self.files(file_hash)
        if record is None:
            raise KeyError(file_hash)
        job_id = str(uuid.uuid4())
        job = {'status': 'queued', 'file': file_hash}
        try:
            ext = EXTENSIONS.get(record['mime'], 'png')
            name = self.comfy.upload(self.store.read(file_hash), f'prisma_{file_hash[:24]}.{ext}', record['mime'])
            self.comfy.submit(face_pose_graph(name, 4), job_id)
        except ComfyRejected:
            job.update(status='failed', error='O detector de rostos não está disponível no ComfyUI.')
        except ComfyUnavailable:
            job.update(status='failed', error='ComfyUI indisponível: tente de novo quando ele estiver no ar.')
        with self.lock:
            self.jobs[job_id] = job
            while len(self.jobs) > 200:
                self.jobs.pop(next(iter(self.jobs)))
        return {'id': job_id, **job}

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
                self._crop(job, face_poses(text_output(self.comfy.outputs(job_id))))
            elif state.status in ('failed', 'cancelled', 'missing'):
                job.update(status='failed', error=state.error or 'A detecção do rosto não terminou.')
            else:
                job['status'] = 'running' if state.status == 'in_progress' else 'queued'
        except ComfyUnavailable:
            return {'id': job_id, **job, 'warning': 'ComfyUI indisponível no momento.'}
        return {'id': job_id, **job}

    def _crop(self, job: dict, faces: list[dict]) -> None:
        faces = [f for f in faces if f['score'] >= MIN_SCORE] or faces
        if not faces:
            job.update(status='failed', error='Nenhum rosto encontrado nesta foto. Use uma foto em que o rosto apareça '
                                              'de frente e nítido.')
            return
        face = max(faces, key=lambda f: f['width'] * f['height'])
        record = self.files(job['file']) or {}
        data = self.store.read(job['file'])
        stored = self.save(bust_png(data, bust_box(face, (record.get('width') or 1, record.get('height') or 1))))
        turn = None if face['yaw'] is None else round(abs(face['yaw']))
        # A face taller than a fifth of the photo: the photo shows little more than the head, so no body to take.
        share = face['height'] / (record.get('height') or face['height'])
        job.update(status='completed', hash=stored.hash, width=stored.width, height=stored.height, turn=turn,
                   frontal=turn is not None and turn <= MAX_TURN, faces=len(faces), source=job['file'],
                   source_width=record.get('width'), source_height=record.get('height'),
                   shows_body=share <= MAX_FACE_SHARE)

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
