from fakes import png
from prisma_studio.application.people_count import count_faces
from test_api import client  # noqa: F401 - fixture


def box(side, score=0.9):
    return {'x': 0, 'y': 0, 'width': side, 'height': side, 'score': score}


def test_bystanders_and_weak_hits_are_not_counted():
    assert count_faces([box(200), box(180), box(40), box(190, score=0.4)]) == 2
    assert count_faces([]) == 0


def test_people_are_counted_once_per_photo(client):  # noqa: F811
    comfy = client.container.comfy
    comfy.faces = [box(220), box(200), box(30)]
    stored = client.post('/api/files', files={'file': ('casal.png', png(640, 480), 'image/png')}).json()
    job = client.post(f'/api/files/{stored["hash"]}/people').json()
    status = job
    for _ in range(5):
        status = client.get(f'/api/people-counts/{job["id"]}').json()
        if status['status'] == 'completed':
            break
    assert status['count'] == 2
    again = client.post(f'/api/files/{stored["hash"]}/people').json()
    assert again['status'] == 'completed' and again['count'] == 2
    assert len(comfy.submits) == 1                # the second request used the cached count


def test_counting_without_comfy_fails_gently(client):  # noqa: F811
    stored = client.post('/api/files', files={'file': ('foto.png', png(320, 240), 'image/png')}).json()
    client.container.comfy.offline = True
    job = client.post(f'/api/files/{stored["hash"]}/people').json()
    assert job['status'] == 'failed' and 'manualmente' in job['error']
    assert client.post('/api/files/unknown/people').status_code == 404


def test_prepare_says_how_many_people_the_choices_need(client):  # noqa: F811
    request = {'mode': 'generate', 'attributes': {
        'action': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'action.family_picnic'}}}}
    people = client.post('/api/prepare', json=request).json()['participants']
    assert people == {'total': 4, 'automatic': 4, 'reason': 'pela ação'}
    alone = client.post('/api/prepare', json={'mode': 'generate', 'attributes': {}}).json()['participants']
    assert alone['automatic'] is None
