from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import FakeComfy, png
from prisma_studio.api.app import Container, create_app
from prisma_studio.config import Config
from prisma_studio.domain.compiler import COMPILER_VERSION

CATALOG = Path(__file__).resolve().parents[2] / 'catalog' / 'defaults.json'


def test_unknown_translation_cancel_is_not_forwarded_to_comfy(client):
    assert client.post('/api/translations/unrelated-job/cancel').status_code == 404
    assert client.container.comfy.cancels == []


def test_group_clothing_scope_survives_prepare_and_persistence(client):
    request = {'mode': 'generate', 'wardrobe_scope': 'all', 'participants': {'requested': 2},
               'attributes': {'wardrobe': {'intent': 'set', 'value': {'kind': 'text', 'text': 'blue coats'}}}}
    preview = client.post('/api/prepare', json=request).json()
    assert preview['valid'] and 'both people in the scene' in preview['prompt']
    created = client.post('/api/runs', json={'request_id': 'wardrobe-scope-0001', 'request': request})
    assert created.status_code == 200
    run = created.json()
    assert run['request']['wardrobe_scope'] == 'all'
    assert run['settings']['compiler_version'] == COMPILER_VERSION
    assert [c['id'] for c in run['settings']['checks'] if c['id'].startswith('op.wardrobe')] == [
        'op.wardrobe.person.1', 'op.wardrobe.person.2']


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
    assert len(items) == 263
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
    item = {'id': 'lighting.user_candles', 'category': 'lighting', 'label': 'Velas', 'prompt': 'warm candlelight'}
    saved = client.put('/api/library', json={'revision': snapshot['revision'], 'items': [item]}).json()
    assert saved['origins']['lighting.user_candles'] == 'user'
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


def test_a_turbo_draft_is_redone_in_full_from_the_chosen_variation(client):
    request = {'mode': 'generate', 'attributes': {
        'environment': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'environment.garden'}}},
        'output': {'seed': 100, 'profile': 'turbo', 'variations': 4}}
    draft = client.post('/api/runs', json={'request_id': 'redo-test-0000001', 'request': request}).json()
    tick(client, 30)
    chosen = client.get(f'/api/runs/{draft["id"]}').json()['images'][2]
    full = client.post(f'/api/runs/{draft["id"]}/repeat', json={'request_id': 'redo-test-0000002', 'profile': 'qwen21',
                                                                 'seed': chosen['seed']}).json()
    assert full['settings']['profile'] == 'qwen21' and full['settings']['seed'] == chosen['seed'] == 102
    assert full['settings']['variations'] == 1 and full['prompt'] == draft['prompt']
    tick(client)
    done = client.get(f'/api/runs/{full["id"]}').json()
    assert done['status'] == 'completed'
    graph = next(t for t in client.container.runs.tasks(full['id'], 'image'))['graph']
    assert graph['42']['class_type'] == 'KSampler' and graph['42']['inputs']['steps'] == 40   # the full profile
    assert graph['42']['inputs']['seed'] == 102
    # A generation starts from the chosen draft, so the person and the clothes stay; only detail is added.
    assert full['files']['init'] == chosen['files'][0]
    assert graph['42']['inputs']['latent_image'] == ['13', 0] and graph['42']['inputs']['denoise'] == 0.55
    assert graph['12']['class_type'] == 'LoadImage'


def test_an_edit_draft_is_redone_in_full_with_the_same_seed(client):
    from fakes import png
    target = client.post('/api/files', files={'file': ('foto.png', png(320, 240), 'image/png')}).json()['hash']
    request = {'mode': 'edit', 'target_id': 't', 'references': [{'id': 't', 'label': 'foto.png'}],
               'attributes': {'environment': {'intent': 'set', 'value': {'kind': 'catalog',
                                                                        'item_id': 'environment.beach'}}},
               'output': {'seed': 7, 'profile': 'turbo', 'resolution': 0}}
    draft = client.post('/api/runs', json={'request_id': 'redo-edit-000001', 'request': request,
                                           'files': {'t': target}}).json()
    tick(client)
    full = client.post(f'/api/runs/{draft["id"]}/repeat', json={'request_id': 'redo-edit-000002', 'profile': 'qwen21',
                                                                 'seed': 7}).json()
    assert 'init' not in full['files'] and full['settings']['seed'] == 7    # the photo already holds the person
    tick(client)
    graph = next(t for t in client.container.runs.tasks(full['id'], 'image'))['graph']
    assert graph['42']['inputs']['steps'] == 40 and '12' not in graph


def test_every_category_offers_common_options_with_complete_metadata(client):
    from prisma_studio.domain.vocabulary import CATEGORIES
    items = client.get('/api/library').json()['items']
    for category in CATEGORIES:
        assert any(i['category'] == category and not i['adult'] for i in items) or category == 'wardrobe', category
    for item in items:
        if item['adult']:
            continue
        r, p = item['requirements'], item['provides']
        if item['category'] in ('pose', 'action'):
            assert None not in (r['participants'], r['posture'], r['gaze'], r['support_any_of']), item['id']
        if item['category'] == 'expression':
            assert r['gaze'], item['id']
        if item['category'] == 'environment':
            assert p['supports'] is not None, item['id']


def test_contract_errors_name_the_fields(client):
    body = {'mode': 'generate', 'attributes': {'pose': {'intent': 'set', 'value': {'kind': 'text', 'text': '  '}}},
            'output': {'width': 1000, 'height': 1024}, 'engine': {'steps': 0}}
    response = client.post('/api/prepare', json=body)
    assert response.status_code == 422
    issues = {i['field']: i['message'] for i in response.json()['issues']}
    assert issues == {'attributes.pose': 'Pose: o texto não pode ficar vazio.',
                      'output.width': 'Largura: use um múltiplo de 32.', 'engine.steps': 'Passos: o valor mínimo é 1.'}


def wardrobe_run(client, n, text):
    request = {'mode': 'generate', 'attributes': {'wardrobe': {'intent': 'set', 'value': {'kind': 'text', 'text': text}}}}
    created = client.post('/api/runs', json={'request_id': f'history-run-{n:08d}', 'request': request})
    assert created.status_code == 200, created.text
    return created.json()


def test_history_search_treats_wildcards_literally(client):
    literal = wardrobe_run(client, 1, 'casaco_azul 100%')
    wardrobe_run(client, 2, 'vestido verde')
    search = lambda q: [r['id'] for r in client.get('/api/runs', params={'q': q}).json()['runs']]
    assert search('casaco_azul') == [literal['id']]
    assert search('CASACO_AZUL') == [literal['id']]               # case-insensitive
    assert search('100%') == [literal['id']]
    assert search('%') == [literal['id']]                         # a bare % is not a wildcard
    assert search('casacoXazul') == []                            # _ is not a wildcard either
    assert search('nao-existe-xyz') == []
    assert client.get('/api/runs', params={'q': 'nao-existe-xyz'}).json()['next_before'] is None
    assert len(search('  ')) == 2                                 # blank query means no filter


def test_history_filters_by_mode_and_status(client):
    first = client.post('/api/runs', json={'request_id': 'history-filter-0001', 'request': {
        'mode': 'generate', 'attributes': {'environment': {'intent': 'set', 'value': {
            'kind': 'catalog', 'item_id': 'environment.garden'}}}}}).json()
    tick(client)
    assert client.get(f'/api/runs/{first["id"]}').json()['status'] == 'completed'
    target = client.post('/api/files', files={'file': ('foto.png', png(320, 240), 'image/png')}).json()['hash']
    edit_request = {'mode': 'edit', 'target_id': 't', 'references': [{'id': 't', 'label': 'foto'}],
                    'attributes': {'environment': {'intent': 'set', 'value': {'kind': 'catalog',
                                                                             'item_id': 'environment.beach'}}}}
    edit = client.post('/api/runs', json={'request_id': 'history-filter-0002', 'request': edit_request,
                                          'files': {'t': target}}).json()
    queued = wardrobe_run(client, 3, 'blusa cinza')

    def ids(**params):
        return [r['id'] for r in client.get('/api/runs', params=params).json()['runs']]

    assert ids(mode='edit') == [edit['id']]
    assert set(ids(mode='generate')) == {first['id'], queued['id']}
    assert ids(status='completed') == [first['id']]
    assert set(ids(status='created')) == {edit['id'], queued['id']}
    assert ids(mode='edit', status='completed') == []
    assert ids(mode='generate', q='blusa') == [queued['id']]
    assert client.get('/api/runs', params={'mode': 'video'}).status_code == 422
    assert client.get('/api/runs', params={'status': 'apagado'}).status_code == 422


def test_history_paging_with_before_has_no_overlap(client):
    runs = [wardrobe_run(client, 10 + i, f'paginacao {i}') for i in range(5)]
    with client.container.db.transaction() as tx:              # distinct timestamps, as real clicks would give
        for i, run in enumerate(runs):
            tx.execute('UPDATE runs SET created_at=? WHERE id=?', (1000.0 + i, run['id']))
    everything = client.get('/api/runs').json()
    assert everything['next_before'] is None and len(everything['runs']) == 5
    seen, before, pages = [], None, 0
    while True:
        params = {'limit': 2, 'q': 'paginacao', **({'before': before} if before is not None else {})}
        page = client.get('/api/runs', params=params).json()
        seen += [r['id'] for r in page['runs']]
        pages += 1
        before = page['next_before']
        if before is None:
            break
    assert pages == 3
    assert seen == [r['id'] for r in reversed(runs)]           # newest first, no repeats, nothing skipped
