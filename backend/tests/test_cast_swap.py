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
    assert (left, right) == (60, 180) and (top, bottom) == (20, 150)
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
