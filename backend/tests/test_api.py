from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import FakeComfy, png
from prisma_studio.api.app import Container, create_app
from prisma_studio.config import Config

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


def test_graph_validation_against_object_info_shapes():
    from prisma_studio.infrastructure.comfy.validation import validate_graph
    from prisma_studio.infrastructure.comfy.workflows import ImageJob, image_graph
    graph = image_graph(ImageJob(mode='generate', prompt='x', width=512, height=512))
    info = {cls: {'input': {'required': {}}} for cls in {n['class_type'] for n in graph.values()}}
    info['UNETLoader'] = {'input': {'required': {'unet_name': [['qwen_image_2.1_int8_convrot.safetensors']],
                                                 'weight_dtype': [['default']]}}}
    info['TextEncodeQwenImage21'] = {'input': {'required': {'clip': ['CLIP'], 'prompt': ['STRING', {}],
        'negative_prompt': ['STRING', {}], 'resolution': ['INT', {'min': 0, 'max': 4096}],
        'images': ['COMFY_AUTOGROW_V3', {}]}, 'optional': {'vae': ['VAE']}}}
    info['KSampler'] = {'input': {'required': {'steps': ['INT', {'min': 1, 'max': 10000}],
                                               'sampler_name': ['COMBO', {'options': ['euler']}]}}}
    for node in graph.values():                       # every other input exists, untyped
        spec = info[node['class_type']]['input']
        spec.setdefault('optional', {})
        for name in node['inputs']:
            if name not in spec['required'] and not name.startswith('images.'):
                spec['optional'].setdefault(name, ['*'])
    assert validate_graph(graph, info) == []
    info['UNETLoader']['input']['required']['unet_name'] = [['other.safetensors']]
    info['KSampler']['input']['required']['steps'] = ['INT', {'min': 50, 'max': 60}]
    problems = validate_graph(graph, info)
    assert any('unet_name' in p for p in problems) and any('steps=40' in p for p in problems)
    del info['VAEDecode']
    assert any('VAEDecode' in p for p in validate_graph(graph, info))


def test_common_pose_and_action_texts_are_concrete(client):
    import re
    vague = re.compile(r'\b(naturally|comfortably|nicely|natural pose|plausible)\b', re.I)
    items = [i for i in client.get('/api/library').json()['items']
             if i['category'] in ('pose', 'action') and not i['adult']]
    for item in items:
        assert not vague.search(item['prompt']), item['id']
        assert item['requirements']['posture'] and item['requirements']['gaze'], item['id']
        assert item['prompt_pt'], item['id']


def test_delete_runs_removes_unshared_files_only(client):
    shared = client.post('/api/files', files={'file': ('a.png', png(64, 64), 'image/png')}).json()['hash']
    request = {'mode': 'edit', 'target_id': 't', 'references': [{'id': 't', 'label': 'alvo'}],
               'attributes': {'environment': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'environment.garden'}}}}
    first = client.post('/api/runs', json={'request_id': 'delete-test-000001', 'request': request, 'files': {'t': shared}}).json()
    second = client.post('/api/runs', json={'request_id': 'delete-test-000002', 'request': request, 'files': {'t': shared}}).json()
    assert client.post('/api/runs/delete', json={'ids': [first['id']]}).status_code == 409   # still open
    tick(client, 20)
    output = client.get(f'/api/runs/{first["id"]}').json()['images'][0]['files'][0]
    result = client.post('/api/runs/delete', json={'ids': [first['id']]}).json()
    assert result['deleted'] == [first['id']] and result['files_removed'] == 1
    assert client.get(f'/api/runs/{first["id"]}').status_code == 404
    assert client.get(f'/api/files/{output}').status_code == 404
    assert client.get(f'/api/files/{shared}').status_code == 200          # still used by the second run
    client.post('/api/runs/delete', json={'ids': [second['id']], 'keep_files': [shared]})
    assert client.get(f'/api/files/{shared}').status_code == 200          # kept: still attached in the editor


def test_repeat_run_with_new_or_same_seed(client):
    request = {'mode': 'generate', 'attributes': {
        'environment': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'environment.garden'}}},
        'output': {'seed': 77}}
    first = client.post('/api/runs', json={'request_id': 'repeat-test-000001', 'request': request}).json()
    tick(client)
    same = client.post(f'/api/runs/{first["id"]}/repeat', json={'request_id': 'repeat-test-000002', 'same_seed': True}).json()
    new = client.post(f'/api/runs/{first["id"]}/repeat', json={'request_id': 'repeat-test-000003'}).json()
    again = client.post(f'/api/runs/{first["id"]}/repeat', json={'request_id': 'repeat-test-000003'}).json()
    assert same['settings']['seed'] == 77 and same['prompt'] == first['prompt']
    assert new['id'] == again['id'] and new['id'] != first['id']
    tick(client)
    assert client.get(f'/api/runs/{same["id"]}').json()['status'] == 'completed'
