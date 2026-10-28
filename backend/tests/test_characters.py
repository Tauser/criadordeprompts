from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import FakeComfy, png
from prisma_studio.api.app import Container, create_app
from prisma_studio.config import Config
from prisma_studio.infrastructure.db import repository

CATALOG = Path(__file__).resolve().parents[2] / 'catalog' / 'defaults.json'
MISSING = 'Foto não encontrada no Studio. Envie-a novamente.'


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


def upload(client, color=(200, 30, 30)):
    return client.post('/api/files', files={'file': ('foto.png', png(320, 240, color=color), 'image/png')}).json()['hash']


def create(client, name='Ana', photos=None, notes=''):
    photos = photos or [upload(client)]
    return client.post('/api/characters', json={'name': name, 'notes': notes, 'photos': photos})


def test_create_returns_the_character_and_list_is_ordered_by_name(client):
    photo = upload(client)
    created = create(client, '  Bruno  ', [photo], notes='camiseta azul, fala baixo').json()
    assert set(created) == {'id', 'name', 'notes', 'photos', 'sex', 'created_at', 'updated_at'}
    assert created['sex'] is None
    assert created['name'] == 'Bruno' and created['notes'] == 'camiseta azul, fala baixo'
    assert created['photos'] == [photo]
    create(client, 'carla')
    create(client, 'Ana')
    names = [c['name'] for c in client.get('/api/characters').json()['characters']]
    assert names == ['Ana', 'Bruno', 'carla']
    assert client.get('/api/characters').json()['characters'][1] == created


def test_notes_default_to_empty_and_photo_order_is_kept(client):
    first, second = upload(client, (1, 2, 3)), upload(client, (9, 9, 9))
    character = client.post('/api/characters', json={'name': 'Dora', 'photos': [second, first]}).json()
    assert character['notes'] == '' and character['photos'] == [second, first]


def test_invalid_names_notes_and_photos_return_422(client):
    photo = upload(client)
    assert create(client, '   ', [photo]).status_code == 422
    assert create(client, 'a' * 61, [photo]).status_code == 422
    assert create(client, 'Ok', [photo], notes='n' * 501).status_code == 422
    assert client.post('/api/characters', json={'name': 'Ok', 'photos': []}).status_code == 422
    assert client.post('/api/characters', json={'name': 'Ok', 'photos': [photo] * 2}).status_code == 422
    seven = [f'{i:064x}' for i in range(7)]
    assert client.post('/api/characters', json={'name': 'Ok', 'photos': seven}).status_code == 422
    assert client.get('/api/characters').json()['characters'] == []


def test_unknown_photo_returns_422_with_the_portuguese_message(client):
    response = create(client, photos=['f' * 64])
    assert response.status_code == 422
    assert response.json()['error'] == MISSING
    assert client.get('/api/characters').json()['characters'] == []


def test_update_changes_only_the_given_fields(client):
    photo, other = upload(client, (1, 1, 1)), upload(client, (5, 5, 5))
    character = create(client, 'Ana', [photo], notes='antes').json()
    updated = client.put(f'/api/characters/{character["id"]}', json={'notes': 'agora de jaqueta'}).json()
    assert updated['notes'] == 'agora de jaqueta' and updated['name'] == 'Ana' and updated['photos'] == [photo]
    renamed = client.put(f'/api/characters/{character["id"]}',
                         json={'name': '  Ana Clara ', 'photos': [other, photo]}).json()
    assert renamed['name'] == 'Ana Clara' and renamed['photos'] == [other, photo]
    assert renamed['updated_at'] >= character['updated_at']
    assert client.get('/api/characters').json()['characters'] == [renamed]


def test_sex_is_saved_changed_kept_and_cleared(client):
    character = client.post('/api/characters', json={'name': 'Ana', 'photos': [upload(client)], 'sex': 'female'}).json()
    assert character['sex'] == 'female'
    url = f'/api/characters/{character["id"]}'
    assert client.put(url, json={'notes': 'de vestido'}).json()['sex'] == 'female'     # left out: it stays
    assert client.put(url, json={'sex': 'male'}).json()['sex'] == 'male'
    assert client.put(url, json={'sex': None}).json()['sex'] is None                  # null clears it
    assert client.put(url, json={'sex': 'other'}).status_code == 422


def test_update_validates_like_create(client):
    character = create(client).json()
    url = f'/api/characters/{character["id"]}'
    assert client.put(url, json={'name': ''}).status_code == 422
    assert client.put(url, json={'notes': 'n' * 501}).status_code == 422
    assert client.put(url, json={'photos': []}).status_code == 422
    missing = client.put(url, json={'photos': ['e' * 64]})
    assert missing.status_code == 422 and missing.json()['error'] == MISSING


def test_unknown_character_ids_return_404(client):
    assert client.put('/api/characters/inexistente', json={'name': 'x'}).status_code == 404
    assert client.put('/api/characters/inexistente', json={'name': 'x'}).json()['error'] == 'Personagem não encontrado.'
    assert client.delete('/api/characters/inexistente').status_code == 404


def test_delete_removes_the_character_once(client):
    character = create(client).json()
    assert client.delete(f'/api/characters/{character["id"]}').json() == {'deleted': character['id']}
    assert client.get('/api/characters').json()['characters'] == []
    assert client.delete(f'/api/characters/{character["id"]}').status_code == 404


def test_the_limit_of_characters_returns_409(client, monkeypatch):
    monkeypatch.setattr(repository, 'CHARACTER_LIMIT', 2)
    assert create(client, 'Um').status_code == 200
    assert create(client, 'Dois').status_code == 200
    response = create(client, 'Três')
    assert response.status_code == 409
    assert response.json()['error'] == 'Já há 2 personagens. Apague algum antes de criar outro.'
    assert len(client.get('/api/characters').json()['characters']) == 2


def _run_using(client, photo):
    """A run that references `photo`, cancelled so that it can be deleted from the history."""
    run, _ = client.container.runs.create('run-' + 'a' * 20, 'edit', {}, {'references': {'x': photo}}, {},
                                          prompt='foto')
    client.container.runs.transition(run['id'], 'cancelled')
    return run['id']


def test_a_character_photo_survives_deleting_the_run_that_uploaded_it(client):
    photo = upload(client)
    run_id = _run_using(client, photo)
    create(client, 'Ana', [photo])
    result = client.post('/api/runs/delete', json={'ids': [run_id]}).json()
    assert result['files_removed'] == 0
    assert client.get(f'/api/files/{photo}').status_code == 200


def test_orphan_cleanup_keeps_character_photos_and_frees_them_after_deletion(client):
    photo = upload(client)
    character = create(client, 'Ana', [photo]).json()
    run_id = _run_using(client, photo)
    assert client.post('/api/runs/delete', json={'ids': [run_id]}).json()['files_removed'] == 0
    assert client.get(f'/api/files/{photo}').status_code == 200

    assert client.delete(f'/api/characters/{character["id"]}').status_code == 200
    run_id = _run_using(client, photo)              # the file is no longer protected once nothing uses it
    assert client.post('/api/runs/delete', json={'ids': [run_id]}).json()['files_removed'] == 1
    assert client.get(f'/api/files/{photo}').status_code == 404


def test_a_removed_photo_is_freed_by_cleanup_only_when_no_character_keeps_it(client):
    photo, kept = upload(client, (1, 0, 0)), upload(client, (0, 1, 0))
    character = create(client, 'Ana', [photo, kept]).json()
    client.put(f'/api/characters/{character["id"]}', json={'photos': [kept]})
    run_id = _run_using(client, photo)
    assert client.post('/api/runs/delete', json={'ids': [run_id]}).json()['files_removed'] == 1
    assert client.get(f'/api/files/{photo}').status_code == 404
    assert client.get(f'/api/files/{kept}').status_code == 200
