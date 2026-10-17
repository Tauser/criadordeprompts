import io
import json

from PIL import Image

from kppb.infrastructure.comfy.client import ComfyRejected, ComfyUnavailable, JobState
from kppb.infrastructure.comfy.workflows import IMAGE_OUTPUT_NODE, TEXT_OUTPUT_NODE


def png(width=64, height=48, color=(200, 30, 30), mode='RGB'):
    buffer = io.BytesIO()
    Image.new(mode, (width, height), color).save(buffer, format='PNG')
    return buffer.getvalue()


class FakeComfy:
    """Scripted ComfyUI: each job goes pending -> in_progress -> completed over successive polls."""

    def __init__(self, text_answer='A refined prompt.', object_info=None):
        self.jobs: dict[str, dict] = {}
        self.uploads: dict[str, bytes] = {}
        self.submits: list[str] = []
        self.cancels: list[str] = []
        self.offline = False
        self.fail_submit_once = False
        self.text_answer = text_answer
        self.object_info_data = object_info
        self.script = ['pending', 'in_progress', 'completed']

    def _check(self):
        if self.offline:
            raise ComfyUnavailable('offline')

    def object_info(self):
        self._check()
        if self.object_info_data is not None:
            return self.object_info_data
        return _PermissiveInfo()

    def submit(self, graph, prompt_id):
        self._check()
        if self.fail_submit_once:
            self.fail_submit_once = False
            self.jobs[prompt_id] = {'graph': graph, 'step': 0, 'status': None}   # accepted, but the answer is lost
            self.submits.append(prompt_id)
            raise ComfyUnavailable('connection reset')
        if prompt_id in self.jobs:
            raise ComfyRejected('duplicate prompt id')
        self.jobs[prompt_id] = {'graph': graph, 'step': 0, 'status': None}
        self.submits.append(prompt_id)
        return prompt_id

    def job(self, prompt_id):
        self._check()
        job = self.jobs.get(prompt_id)
        if job is None or job.get('vanished'):
            return JobState('missing')
        if job['status'] in ('cancelled', 'failed'):
            return JobState(job['status'], error='boom' if job['status'] == 'failed' else None)
        status = self.script[min(job['step'], len(self.script) - 1)]
        job['step'] += 1
        return JobState(status, start_time=1.0, end_time=2.0 if status == 'completed' else None)

    def outputs(self, prompt_id):
        graph = self.jobs[prompt_id]['graph']
        if IMAGE_OUTPUT_NODE in graph:
            return {IMAGE_OUTPUT_NODE: {'images': [{'filename': f'{prompt_id}.png', 'subfolder': 'kppb', 'type': 'output'}]}}
        prompt = graph['90']['inputs']['prompt']
        answer = self.text_answer(prompt) if callable(self.text_answer) else self.text_answer
        return {TEXT_OUTPUT_NODE: {'text': [answer]}}

    def cancel(self, prompt_id):
        self._check()
        self.cancels.append(prompt_id)
        job = self.jobs.get(prompt_id)
        if job and self.script[min(job['step'], len(self.script) - 1)] != 'completed':
            job['status'] = 'cancelled'
            return True
        return False

    def upload(self, data, filename, mime):
        self._check()
        self.uploads[filename] = data
        return filename

    def view(self, filename, subfolder, kind):
        self._check()
        return png(color=(len(filename) % 255, 10, 10))


class _PermissiveInfo(dict):
    def get(self, key, default=None):
        return {'input': {'required': {}, 'optional': {}}}


def judge_all(verdict):
    def answer(prompt):
        ids = [line.split('[', 1)[1].split(']', 1)[0] for line in prompt.splitlines() if '[' in line]
        return json.dumps({'results': [{'id': i, 'verdict': verdict} for i in ids]})
    return answer
