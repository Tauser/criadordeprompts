"""End to end over real HTTP: Studio API + executor thread + ComfyClient against the fake ComfyUI server."""
import importlib.util
import socket
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import png
from prisma_studio.api.app import Container, create_app
from prisma_studio.config import Config
from prisma_studio.infrastructure.comfy.client import ComfyClient

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def stack(tmp_path):
    spec = importlib.util.spec_from_file_location('fake_comfy', ROOT / 'scripts' / 'fake_comfy.py')
    fake = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fake)
    fake.SECONDS = 0.4
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    server = ThreadingHTTPServer(('127.0.0.1', port), fake.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{port}'
    config = Config(data_dir=tmp_path, comfy_url=url, catalog_path=ROOT / 'catalog' / 'defaults.json',
                    frontend_dir=tmp_path / 'none')
    container = Container(config, comfy=ComfyClient(url))
    container.executor.poll_seconds = 0.1
    with TestClient(create_app(config, container)) as client:
        client.fake = fake
        yield client
    server.shutdown()


def wait(client, run_id, statuses, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f'/api/runs/{run_id}').json()
        if run['status'] in statuses:
            return run
        time.sleep(0.1)
    raise AssertionError(f'status final não atingido: {run["status"]}')


def test_generation_refine_review_and_verification(stack):
    request = {'mode': 'generate', 'attributes': {
        'environment': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'environment.garden'}},
        'subject': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'subject.woman'}}},
        'output': {'refine': True, 'verify': True, 'variations': 2}}
    run = stack.post('/api/runs', json={'request_id': 'e2e-request-000001', 'request': request}).json()
    run = wait(stack, run['id'], {'review', 'failed'})
    assert run['status'] == 'review' and run['refined_prompt'].endswith('crisp natural detail.')
    stack.post(f'/api/runs/{run["id"]}/review', json={'choice': 'refined'})
    run = wait(stack, run['id'], {'completed', 'failed'})
    assert run['status'] == 'completed', run['error']
    assert len(run['images']) == 2 and all(i['files'] and i['score'] is not None for i in run['images'])
    assert stack.get(f'/api/files/{run["images"][0]["files"][0]}').status_code == 200
    kinds = [t['kind'] for t in run['tasks']]
    assert kinds.count('verify') == 2 and kinds.count('refine') == 1
    assert all(t['started_at'] and t['ended_at'] for t in run['tasks'])


def test_masked_edit_and_cancel(stack):
    target = stack.post('/api/files', files={'file': ('a.png', png(300, 200), 'image/png')}).json()['hash']
    mask = stack.post('/api/files', files={'file': ('m.png', png(300, 200, color=255, mode='L'), 'image/png')}).json()['hash']
    request = {'mode': 'edit', 'target_id': 't', 'mask': True, 'references': [{'id': 't', 'label': 'alvo'}],
               'attributes': {'wardrobe': {'intent': 'set', 'value': {'kind': 'text', 'text': 'a red jacket'}}}}
    run = stack.post('/api/runs', json={'request_id': 'e2e-request-000002', 'request': request,
                                        'files': {'t': target}, 'mask': mask}).json()
    assert wait(stack, run['id'], {'completed', 'failed'})['status'] == 'completed'
    run = stack.post('/api/runs', json={'request_id': 'e2e-request-000003', 'request': request,
                                        'files': {'t': target}, 'mask': mask}).json()
    stack.fake.SECONDS = 30
    time.sleep(0.3)
    stack.post(f'/api/runs/{run["id"]}/cancel')
    assert wait(stack, run['id'], {'completed', 'cancelled', 'failed'})['status'] == 'cancelled'
