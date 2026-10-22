from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import FakeComfy
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


def photo_request():
    """An edit with a target photo, a mask, two reference photos, a character, a fixed seed and photo facts."""
    return {'mode': 'edit', 'target_id': 'alvo', 'mask': True,
            'references': [{'id': 'alvo', 'label': 'foto'}, {'id': 'rosto', 'label': 'rosto'}],
            'characters': [{'reference_id': 'rosto', 'description': 'a amiga'}],
            'attributes': {'face': {'intent': 'transfer', 'reference_id': 'rosto'},
                           'pose': {'intent': 'keep'},
                           'environment': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'environment.garden'}}},
            'participants': {'requested': 2, 'existing': 1},
            'context': {'supports': ['floor'], 'allow_new_supports': True, 'allow_reframing': False,
                        'original_framing': 'half'},
            'confirmations': ['adults_only'],
            'output': {'seed': 42, 'resolution': 1024, 'aspect': '9:16'},
            'details': 'noite na rua'}


def save(client, name, request=None):
    return client.post('/api/presets', json={'name': name, 'request': request or photo_request()})


def test_saved_preset_keeps_choices_and_drops_photos_and_seed(client):
    created = save(client, 'Cena noturna na rua')
    assert created.status_code == 200
    preset = created.json()
    assert preset['name'] == 'Cena noturna na rua'
    request = preset['request']
    assert request['target_id'] is None and request['mask'] is False
    assert request['references'] == [] and request['characters'] == []
    assert request['output']['seed'] is None
    assert request['participants'] == {'requested': 2, 'existing': None}
    assert request['context'] == {'supports': None, 'allow_new_supports': True, 'allow_reframing': False,
                                  'original_framing': None}
    assert request['confirmations'] == []
    assert request['output']['aspect'] == '9:16' and request['details'] == 'noite na rua'
    assert request['attributes']['environment']['value'] == {'kind': 'catalog', 'item_id': 'environment.garden'}
    assert request['attributes']['pose'] == {'intent': 'keep', 'value': None, 'reference_id': None}
    # edit mode: a transferred attribute keeps the target instead, because "keep" is valid only in edit mode
    assert request['attributes']['face'] == {'intent': 'keep', 'value': None, 'reference_id': None}
    assert client.get('/api/presets').json()['presets'][0] == preset


def test_transfer_becomes_nothing_in_generate_mode(client):
    request = {'mode': 'generate', 'references': [{'id': 'rosto', 'label': 'rosto'}],
               'attributes': {'face': {'intent': 'transfer', 'reference_id': 'rosto'},
                              'lighting': {'intent': 'free'}}}
    preset = save(client, 'Sem rosto', request).json()['request']
    assert 'face' not in preset['attributes']
    assert preset['attributes']['lighting'] == {'intent': 'free', 'value': None, 'reference_id': None}
    assert preset['references'] == []


def test_list_is_newest_first(client):
    for name in ('primeiro', 'segundo', 'terceiro'):
        save(client, name)
    names = [p['name'] for p in client.get('/api/presets').json()['presets']]
    assert names == ['terceiro', 'segundo', 'primeiro']


def test_rename_trims_the_name_and_keeps_the_request(client):
    preset = save(client, 'Rascunho').json()
    renamed = client.put(f'/api/presets/{preset["id"]}', json={'name': '  Cena noturna  '})
    assert renamed.status_code == 200
    assert renamed.json()['name'] == 'Cena noturna'
    assert renamed.json()['request'] == preset['request']
    assert [p['name'] for p in client.get('/api/presets').json()['presets']] == ['Cena noturna']


def test_delete_removes_the_preset(client):
    preset = save(client, 'Apagar').json()
    assert client.delete(f'/api/presets/{preset["id"]}').status_code == 200
    assert client.get('/api/presets').json()['presets'] == []


def test_unknown_preset_ids_return_404(client):
    assert client.put('/api/presets/inexistente', json={'name': 'x'}).status_code == 404
    assert client.delete('/api/presets/inexistente').status_code == 404


def test_invalid_requests_and_names_return_422(client):
    assert client.post('/api/presets', json={'name': 'Ok', 'request': {'mode': 'sideways'}}).status_code == 422
    assert client.post('/api/presets', json={'name': '   ', 'request': photo_request()}).status_code == 422
    assert client.post('/api/presets', json={'name': 'a' * 81, 'request': photo_request()}).status_code == 422
    preset = save(client, 'Valido').json()
    assert client.put(f'/api/presets/{preset["id"]}', json={'name': ''}).status_code == 422


def test_limit_of_200_presets(client):
    for index in range(200):
        client.container.presets.create(f'pedido {index}', {'mode': 'generate'})
    response = save(client, 'Mais um')
    assert response.status_code == 409
    assert 'Apague' in response.json()['error']
