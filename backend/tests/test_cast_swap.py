import io
import json
from pathlib import Path

from PIL import Image

from fakes import landmarks_text, png
from helpers import cat, edit_request, generate_request, keep
from prisma_studio.domain.catalog import Library
from prisma_studio.domain.compiler import compile_request
from prisma_studio.domain.rules import assess
from prisma_studio.domain.vocabulary import CATEGORIES
from prisma_studio.infrastructure.comfy.workflows import face_poses
from prisma_studio.infrastructure.storage.files import bust_box
from test_api import client  # noqa: F401 - fixture

CATALOG = Path(__file__).resolve().parents[2] / 'catalog' / 'defaults.json'
LIBRARY = Library.model_validate(json.loads(CATALOG.read_text(encoding='utf-8')))
REFS = (('t', 'cena.png'), ('a', 'ana.png'), ('b', 'bruno.png'))


def swap_request(swaps, existing=2, **extra):
    attributes = extra.pop('attributes', {c: keep() for c in CATEGORIES})
    return edit_request(attributes, references=REFS, swaps=swaps, participants={'existing': existing}, **extra)


def codes(request):
    return {i.code for i in assess(request, LIBRARY).issues}


def text(request):
    assessment = assess(request, LIBRARY)
    assert assessment.valid, [i.message for i in assessment.issues]
    return compile_request(request, assessment).text


def test_the_head_rotation_is_read_from_the_landmarks_output():
    faces = face_poses(landmarks_text([{'x': 10, 'y': 20, 'width': 50, 'height': 60, 'yaw': 4},
                                       {'x': 200, 'y': 30, 'width': 40, 'height': 52, 'yaw': -75, 'score': 0.7}]))
    assert [round(f['yaw']) for f in faces] == [4, -75]
    assert faces[1]['x'] == 200 and faces[1]['width'] == 40 and faces[1]['score'] == 0.7
    assert face_poses('nothing here') == [] and face_poses(None) == []


def test_the_bust_is_head_neck_and_shoulders_inside_the_photo():
    left, top, right, bottom = bust_box({'x': 100, 'y': 50, 'width': 40, 'height': 50}, (300, 400))
    assert (left, right) == (74, 166) and (top, bottom) == (25, 135)
    assert bust_box({'x': 0, 'y': 0, 'width': 40, 'height': 50}, (60, 80)) == (0, 0, 60, 80)


def test_two_people_become_two_others_by_place():
    prompt = text(swap_request([{'position': 1, 'reference_id': 'a'},
                                {'position': 2, 'reference_id': 'b', 'body': 'slim and tall'}]))
    assert 'The person on the left of <image1> becomes the person shown in <image2>' in prompt
    assert 'The person on the right of <image1> becomes the person shown in <image3>' in prompt
    assert 'the body build is slim and tall' in prompt
    assert 'never add them as extra people' in prompt
    assert 'the same head angle and gaze and the same facial expression' in prompt
    assert 'The result shows exactly 2 people' in prompt
    assert 'facial identity' not in prompt          # the kept aspects no longer freeze who the people are
    assert 'add only the missing ones' not in prompt


def test_only_the_chosen_person_changes_and_the_others_stay():
    prompt = text(swap_request([{'position': 2, 'reference_id': 'a'}], existing=3))
    assert 'The person in the center of <image1> becomes the person shown in <image2>' in prompt
    assert 'The person on the left of <image1> stays exactly the same person' in prompt
    assert 'The person on the right of <image1> stays exactly the same person' in prompt
    assert '<image3>' not in prompt


def test_one_person_takes_the_place_and_details_of_the_other():
    prompt = text(swap_request([{'position': 1, 'reference_id': 'a'}], existing=1))
    assert 'The person in <image1> becomes the person shown in <image2>' in prompt
    assert 'The result shows exactly one person.' in prompt


def test_a_requested_expression_or_pose_is_not_frozen_by_the_swap():
    attributes = {c: keep() for c in CATEGORIES}
    attributes['expression'] = cat('expression.smile')
    prompt = text(swap_request([{'position': 1, 'reference_id': 'a'}], existing=1, attributes=attributes))
    assert 'the same head angle and gaze.' in prompt and 'same facial expression' not in prompt
    attributes['pose'] = cat('pose.side')
    attributes['expression'] = keep()
    prompt = text(swap_request([{'position': 1, 'reference_id': 'a'}], existing=1, attributes=attributes))
    assert 'Every pose comes only from' not in prompt and 'stays in the same place' in prompt


def test_swaps_need_an_edit_a_count_and_one_photo_per_person():
    assert 'swap_requires_count' in codes(swap_request([{'position': 1, 'reference_id': 'a'}], existing=None))
    assert 'swap_position' in codes(swap_request([{'position': 3, 'reference_id': 'a'}]))
    assert 'swap_duplicate_photo' in codes(swap_request([{'position': 1, 'reference_id': 'a'},
                                                         {'position': 2, 'reference_id': 'a'}]))
    assert 'swap_duplicate_position' in codes(swap_request([{'position': 1, 'reference_id': 'a'},
                                                            {'position': 1, 'reference_id': 'b'}]))
    assert 'swap_is_target' in codes(swap_request([{'position': 1, 'reference_id': 't'}]))
    assert 'swap_with_characters' in codes(swap_request([{'position': 1, 'reference_id': 'a'}],
                                                        characters=[{'reference_id': 'b'}]))
    attributes = {c: keep() for c in CATEGORIES}
    attributes['face'] = {'intent': 'transfer', 'reference_id': 'b'}
    assert 'swap_with_identity_transfer' in codes(swap_request([{'position': 1, 'reference_id': 'a'}],
                                                               attributes=attributes))
    generate = generate_request({}, references=[{'id': 'a', 'label': 'a'}], swaps=[{'position': 1, 'reference_id': 'a'}])
    assert 'swap_requires_edit' in codes(generate)


def test_the_people_count_says_where_each_person_is(client):  # noqa: F811
    comfy = client.container.comfy
    comfy.faces = [{'x': 400, 'y': 40, 'width': 60, 'height': 70, 'score': 0.9},
                   {'x': 100, 'y': 50, 'width': 64, 'height': 72, 'score': 0.9}]
    stored = client.post('/api/files', files={'file': ('cena.png', png(640, 480), 'image/png')}).json()
    job = client.post(f'/api/files/{stored["hash"]}/people').json()
    for _ in range(5):
        job = client.get(f'/api/people-counts/{job["id"]}').json()
        if job['status'] == 'completed':
            break
    assert job['count'] == 2
    assert [p['x'] for p in job['people']] == [round(100 / 640, 4), round(400 / 640, 4)]     # left to right


def test_a_reference_becomes_a_bust_crop_and_a_turned_face_is_flagged(client):  # noqa: F811
    comfy = client.container.comfy
    stored = client.post('/api/files', files={'file': ('ana.png', png(400, 600), 'image/png')}).json()

    def crop(yaw):
        comfy.faces = [{'x': 150, 'y': 100, 'width': 100, 'height': 120, 'yaw': yaw}]
        job = client.post(f'/api/files/{stored["hash"]}/bust').json()
        for _ in range(5):
            job = client.get(f'/api/busts/{job["id"]}').json()
            if job['status'] != 'queued' and job['status'] != 'running':
                break
        return job

    front = crop(5)
    assert front['status'] == 'completed' and front['frontal'] is True and front['turn'] == 5
    assert front['source'] == stored['hash'] and front['shows_body'] is True        # a 120 px face in a 600 px photo
    data = client.get(f'/api/files/{front["hash"]}').content
    with Image.open(io.BytesIO(data)) as image:
        assert image.width <= 1024 and min(image.size) >= 512
    side = crop(70)
    assert side['frontal'] is False and side['turn'] == 70
    comfy.faces = []
    job = client.post(f'/api/files/{stored["hash"]}/bust').json()
    for _ in range(5):
        job = client.get(f'/api/busts/{job["id"]}').json()
    assert job['status'] == 'failed' and 'Nenhum rosto' in job['error']
    assert client.post('/api/files/unknown/bust').status_code == 404


# second pass: expressions (and face-only accessories) come back --------------------------------------------------
def test_expressions_are_told_in_words_and_compared():
    from prisma_studio.domain import expression
    assert expression.describe({'mouthSmileLeft': 0.95, 'mouthSmileRight': 0.93, 'jawOpen': 0.05}) \
        == 'a broad smile, the mouth not wide open'
    assert expression.describe({'mouthSmileLeft': 0.6, 'mouthSmileRight': 0.5, 'jawOpen': 0.4}) == 'a laugh with the mouth open'
    serious = expression.describe({'mouthSmileLeft': 0.0, 'jawOpen': 0.0, 'eyeBlinkLeft': 0.8, 'eyeBlinkRight': 0.7})
    assert serious.startswith('a calm, serious expression') and serious.endswith('the eyes closed')
    assert expression.describe(None) is None
    assert expression.differs({'mouthSmileLeft': 0, 'mouthSmileRight': 0}, {'mouthSmileLeft': 0.9, 'mouthSmileRight': 0.9})
    assert not expression.differs({'mouthSmileLeft': 0.9, 'mouthSmileRight': 0.9}, {'mouthSmileLeft': 0.8,
                                                                                     'mouthSmileRight': 0.85})


def test_the_restore_prompt_names_each_person_by_place():
    from prisma_studio.domain.render_qwen21 import restore_prompt
    text = restore_prompt(2, {1: 'body', 2: 'face'}, {1: 'a broad smile, the mouth not wide open', 2: None})
    assert 'the person on the left of <image1> has a broad smile, the mouth not wide open' in text
    assert 'on the right of <image1> has' not in text                       # not measured: not named
    assert 'add nothing that is not in <image2>' in text                    # a face-only swap gets its accessories back
    assert 'never the identity or the body of the people' in text
    assert 'Eyewear' not in restore_prompt(1, {1: 'body'}, {1: 'a slight smile with the lips closed'})


def test_a_body_swap_keeps_no_clothing_and_a_face_swap_keeps_the_body():
    body = text(swap_request([{'position': 1, 'reference_id': 'a'}], existing=1))
    assert 'body shape, build, weight and proportions come from <image2>' in body
    assert 'clothing and accessories' not in body.split('\n')[2]            # the reference's clothing comes along
    assert 'never copy its pose, posture, position, head angle, expression or background' in body
    face = text(swap_request([{'position': 1, 'reference_id': 'a', 'mode': 'face'}], existing=1))
    assert 'the body, clothing and accessories stay as in <image1>' in face
    assert 'expression, clothing or background' in face


def test_a_swap_run_gets_a_second_edit_and_a_measured_check(tmp_path):
    from fakes import FakeComfy
    from prisma_studio.api.app import Container, create_app
    from prisma_studio.config import Config
    from fastapi.testclient import TestClient
    from test_api import NoProgress
    config = Config(data_dir=tmp_path, catalog_path=CATALOG, frontend_dir=tmp_path / 'none', start_workers=False)
    container = Container(config, comfy=FakeComfy(), progress=NoProgress())
    container.executor.validate = False
    smiling = {'mouthSmileLeft': 0.9, 'mouthSmileRight': 0.9, 'jawOpen': 0.05}
    container.comfy.faces = [{'x': 100, 'y': 40, 'width': 60, 'height': 70, 'shapes': smiling},
                             {'x': 400, 'y': 40, 'width': 60, 'height': 70, 'shapes': smiling}]
    with TestClient(create_app(config, container)) as client:
        hashes = [client.post('/api/files', files={'file': (f'{n}.png', png(640, 480, c), 'image/png')}).json()['hash']
                  for n, c in (('cena', (10, 10, 10)), ('ana', (200, 10, 10)), ('bruno', (10, 200, 10)))]
        request = swap_request([{'position': 1, 'reference_id': 'a'}, {'position': 2, 'reference_id': 'b', 'mode': 'face'}],
                               output={'face_detail': False, 'resolution': 0}).model_dump(mode='json')
        run = client.post('/api/runs', json={'request_id': 'swap-run-000000001', 'request': request,
                                             'files': dict(zip(('t', 'a', 'b'), hashes))}).json()
        assert container.runs.get(run['id'])['settings']['swap'] == {'total': 2, 'people': [{'position': 1, 'mode': 'body'},
                                                                  {'position': 2, 'mode': 'face'}]}
        for _ in range(30):
            container.executor.tick()
            if container.runs.get(run['id'])['status'] in ('completed', 'failed'):
                break
        done = container.runs.get(run['id'])
        assert done['status'] == 'completed', done.get('error')
        image = container.runs.tasks(run['id'], 'image')[0]['result']
        assert image['restore'] == {'expressions': {'1': 'a broad smile, the mouth not wide open',
                                                    '2': 'a broad smile, the mouth not wide open'},
                                    'checked': True, 'mismatch': []}
        assert image['raw_files'] != image['files']
        restore = container.runs.tasks(run['id'], 'restore')[0]
        assert 'the person on the left of <image1> has a broad smile' in restore['graph']['10']['inputs']['prompt']
        statuses = [e['status'] for e in container.runs.events(run['id']) if e['type'] == 'status']
        assert statuses == ['created', 'preparing', 'generating', 'restoring', 'completed']
        view = client.get(f'/api/runs/{run["id"]}').json()
        assert view['images'][0]['restore']['checked'] is True
