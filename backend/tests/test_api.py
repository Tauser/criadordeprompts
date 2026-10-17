from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import FakeComfy, png
from kppb.api.app import Container, create_app
from kppb.config import Config

CATALOG = Path(__file__).resolve().parents[2] / 'catalog' / 'defaults.json'


class NoProgress:
    def snapshot(self, _):
        return None

    def start(self):
        pass

    def stop(self):
        pass


@pytest.fixture
def client(tmp_path):
    config = Config(data_dir=tmp_path, catalog_path=CATALOG, frontend_dir=tmp_path / 'none', start_workers=False)
    container = Container(config, comfy=FakeComfy(), progress=NoProgress())
    container.executor.validate = False
    app = create_app(config, container)
    with TestClient(app) as test_client:
        test_client.container = container
        yield test_client


def tick(client, times=12):
    for _ in range(times):
        client.container.executor.tick()


def test_catalog_import_is_valid_and_complete(client):
    items = client.get('/api/library').json()['items']
    assert len(items) == 183
    common = [i for i in items if i['category'] in ('pose', 'action') and not i['adult']]
    assert all(i['requirements']['participants'] for i in common)


def test_full_edit_flow_over_http(client):
    upload = client.post('/api/files', files={'file': ('alvo.png', png(640, 480), 'image/png')}).json()
    request = {'mode': 'edit', 'target_id': 't', 'references': [{'id': 't', 'label': 'alvo'}],
               'attributes': {'face': {'intent': 'keep'},
                              'environment': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'environment.garden'}}}}
    prepared = client.post('/api/prepare', json=request).json()
    assert prepared['valid'] and prepared['prompt'].startswith('Edit the image.')
    body = {'request_id': 'abcdefghijklmnop', 'request': request, 'files': {'t': upload['hash']}}
    run = client.post('/api/runs', json=body).json()
    assert client.post('/api/runs', json=body).json()['id'] == run['id']
    tick(client)
    run = client.get(f'/api/runs/{run["id"]}').json()
    assert run['status'] == 'completed'
    file_hash = run['images'][0]['files'][0]
    assert client.get(f'/api/files/{file_hash}').headers['content-type'] == 'image/png'
    assert client.get('/api/runs/by-request/abcdefghijklmnop').json()['id'] == run['id']


def test_invalid_requests_return_field_issues(client):
    response = client.post('/api/runs', json={'request_id': 'abcdefghijklmnop2', 'request': {'mode': 'edit'},
                                              'files': {}})
    assert response.status_code == 422
    assert client.post('/api/prepare', json={'mode': 'generate', 'oops': 1}).status_code == 422


def test_cross_origin_writes_are_rejected(client):
    response = client.post('/api/prepare', json={'mode': 'generate'}, headers={'origin': 'http://evil.example'})
    assert response.status_code == 403


def test_library_save_conflict_and_validation(client):
    snapshot = client.get('/api/library').json()
    item = {'id': 'lighting.candle', 'category': 'lighting', 'label': 'Velas', 'prompt': 'warm candlelight'}
    saved = client.put('/api/library', json={'revision': snapshot['revision'], 'items': [item]}).json()
    assert saved['origins']['lighting.candle'] == 'user'
    stale = client.put('/api/library', json={'revision': snapshot['revision'], 'items': []})
    assert stale.status_code == 409
    duplicate = {**item, 'id': 'lighting.other', 'label': 'Suave e natural'}
    assert client.put('/api/library', json={'revision': saved['revision'], 'items': [duplicate]}).status_code == 400


def test_bad_upload_is_rejected(client):
    assert client.post('/api/files', files={'file': ('x.png', b'not an image', 'image/png')}).status_code == 400
