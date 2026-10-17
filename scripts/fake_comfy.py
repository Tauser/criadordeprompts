"""A small stand-in for ComfyUI, for trying the interface without a GPU.

python scripts/fake_comfy.py [--port 8199] [--seconds 6]
Then start the Studio with KPPB_COMFY_URL=http://127.0.0.1:8199
"""
from __future__ import annotations

import argparse
import io
import json
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from PIL import Image, ImageDraw

JOBS: dict[str, dict] = {}
CLASSES = ['UNETLoader', 'CLIPLoader', 'VAELoader', 'QwenImage21Cache', 'TextEncodeQwenImage21', 'LoadImage',
           'EmptySD3LatentImage', 'KSampler', 'SamplerCustom', 'ManualSigmas', 'KSamplerSelect', 'VAEDecode',
           'LoadImageMask', 'GrowMask', 'FeatherMask', 'ImageCompositeMasked', 'SaveImage', 'TextGenerate',
           'PrimitiveStringMultiline', 'BatchImagesNode', 'PreviewAny']
SECONDS = 6.0


def picture(seed: str) -> bytes:
    rnd = int(uuid.UUID(seed)) if len(seed) == 36 else hash(seed)
    image = Image.new('RGB', (768, 1024), ((rnd >> 8) % 200 + 30, (rnd >> 16) % 200 + 30, (rnd >> 24) % 200 + 30))
    ImageDraw.Draw(image).text((30, 30), 'fake ComfyUI ' + seed[:8], fill=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


def state(job_id: str) -> str:
    job = JOBS[job_id]
    if job.get('cancelled'):
        return 'cancelled'
    elapsed = time.time() - job['created']
    return 'pending' if elapsed < 1 else 'in_progress' if elapsed < SECONDS else 'completed'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, data, status=200, kind='application/json'):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/system_stats':
            return self.send({'system': {'comfyui_version': 'fake'}, 'devices': [{'name': 'Fake GPU'}]})
        if path == '/object_info':
            return self.send({name: {'input': {}} for name in CLASSES})
        if match := re.fullmatch(r'/api/jobs/([\w-]+)', path):
            job_id = match.group(1)
            if job_id not in JOBS:
                return self.send({'error': 'Job not found'}, 404)
            s = state(job_id)
            data = {'id': job_id, 'status': s}
            if s == 'completed':
                data.update(execution_start_time=int(JOBS[job_id]['created'] * 1000 + 1000),
                            execution_end_time=int((JOBS[job_id]['created'] + SECONDS) * 1000))
            return self.send(data)
        if match := re.fullmatch(r'/history/([\w-]+)', path):
            job_id = match.group(1)
            if job_id not in JOBS or state(job_id) != 'completed':
                return self.send({})
            graph = JOBS[job_id]['graph']
            if '60' in graph:
                outputs = {'60': {'images': [{'filename': f'{job_id}.png', 'subfolder': 'kppb', 'type': 'output'}]}}
            else:
                prompt = graph['90']['inputs']['prompt']
                if prompt.startswith('Checklist:'):
                    ids = re.findall(r'\[([^\]]+)\]', prompt)
                    text = json.dumps({'results': [{'id': i, 'verdict': ['met', 'partial', 'met'][n % 3],
                                                    'note': 'simulado'} for n, i in enumerate(ids)]})
                else:
                    text = prompt.replace('\n', ' ') + ' Rendered with crisp natural detail.'
                outputs = {'92': {'text': [text]}}
            return self.send({job_id: {'outputs': outputs, 'status': {'status_str': 'success'}}})
        if path == '/view':
            name = parse_qs(urlsplit(self.path).query).get('filename', ['x'])[0]
            return self.send(picture(name.split('.')[0]), kind='image/png')
        return self.send({'error': 'not found'}, 404)

    def do_POST(self):
        path = urlsplit(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length)
        if path == '/prompt':
            data = json.loads(raw)
            job_id = data.get('prompt_id') or str(uuid.uuid4())
            JOBS[job_id] = {'graph': data['prompt'], 'created': time.time()}
            return self.send({'prompt_id': job_id, 'number': len(JOBS), 'node_errors': {}})
        if match := re.fullmatch(r'/api/jobs/([\w-]+)/cancel', path):
            job = JOBS.get(match.group(1))
            if job and state(match.group(1)) in ('pending', 'in_progress'):
                job['cancelled'] = True
                return self.send({'cancelled': True})
            return self.send({'cancelled': False})
        if path == '/upload/image':
            name = re.search(rb'filename="([^"]+)"', raw)
            return self.send({'name': name.group(1).decode() if name else 'upload.png', 'subfolder': '', 'type': 'input'})
        return self.send({'error': 'not found'}, 404)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8199)
    parser.add_argument('--seconds', type=float, default=6)
    args = parser.parse_args()
    SECONDS = args.seconds
    print(f'Fake ComfyUI em http://127.0.0.1:{args.port}')
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
