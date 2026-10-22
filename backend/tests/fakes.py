import io
import json

from PIL import Image

from prisma_studio.infrastructure.comfy.client import ComfyNotSent, ComfyRejected, ComfyUnavailable, JobState
from prisma_studio.infrastructure.comfy.workflows import IMAGE_OUTPUT_NODE, PEOPLE_OUTPUT_NODE, TEXT_OUTPUT_NODE


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
        self.lose_submit_once = False      # the answer is lost and the request never arrived
        self.text_answer = text_answer
        self.object_info_data = object_info
        self.script = ['pending', 'in_progress', 'completed']
        self.loras = ['anatomy_fix_qwen21.safetensors', 'realism/ultra_real.safetensors']
        self.faces = []                    # boxes the MediaPipe face detector reports (or a function of none)
        self.people: list[dict] = []       # bodies RT-DETR reports
        self.sam_mask = None               # PNG SAM 3 returns for a text graph; None = a small white area on black
        self.binaries: dict[str, bytes] = {}   # output pictures by file name

    def _check(self):
        if self.offline:
            raise ComfyNotSent('connection refused')

    def system_stats(self):
        self._check()
        return {'system': {'comfyui_version': '0.0-fake', 'ram_total': 32 * 2**30, 'ram_free': 12 * 2**30},
                'devices': [{'name': 'cuda:0 Fake GPU', 'vram_total': 12 * 2**30, 'vram_free': 3 * 2**30}]}

    def lora_names(self):
        self._check()
        return list(self.loras)

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
        if self.lose_submit_once:
            self.lose_submit_once = False
            raise ComfyUnavailable('read timeout')
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
            name = f'{prompt_id}.png'
            if graph.get('D', {}).get('class_type') == 'SAM3_Detect':
                self.binaries[name] = self.sam_mask if self.sam_mask is not None else _sam_mask()
            return {IMAGE_OUTPUT_NODE: {'images': [{'filename': name, 'subfolder': 'prisma', 'type': 'output'}]}}
        if any(node['class_type'] == 'MediaPipeFaceLandmarker' for node in graph.values()):
            faces = self.faces() if callable(self.faces) else self.faces
            out = {TEXT_OUTPUT_NODE: {'text': [json.dumps([faces])]}}
            if any(node['class_type'] == 'RTDETR_detect' for node in graph.values()):
                out[PEOPLE_OUTPUT_NODE] = {'text': [json.dumps([self.people])]}
            return out
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
        if filename in self.binaries:
            return self.binaries[filename]
        import hashlib
        digest = hashlib.sha256(filename.encode()).digest()
        return png(color=(digest[0], digest[1], digest[2]))


def _sam_mask():
    """A 40x30 picture, smaller than the test photos: white (found) in the middle, black elsewhere."""
    image = Image.new('RGB', (40, 30), (0, 0, 0))
    image.paste((255, 255, 255), (10, 8, 30, 26))
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


class _PermissiveInfo(dict):
    def get(self, key, default=None):
        return {'input': {'required': {}, 'optional': {}}}


def judge_all(verdict):
    def answer(prompt):
        ids = [line.split('[', 1)[1].split(']', 1)[0] for line in prompt.splitlines() if '[' in line]
        return json.dumps({'results': [{'id': i, 'verdict': verdict} for i in ids]})
    return answer
