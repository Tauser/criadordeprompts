import io
import json

import pytest
from PIL import Image

from fakes import png
from helpers import cat
from prisma_studio.domain import face_detail
from prisma_studio.domain.request import Request
from prisma_studio.infrastructure.comfy.client import ComfyRejected
from prisma_studio.infrastructure.comfy.workflows import (ImageJob, face_boxes, face_detect_graph, image_graph,
                                                          people_count,
                                                          turbo_tail)
from prisma_studio.infrastructure.storage.files import crop_square, face_crop_box, paste_faces
from prisma_studio.worker.executor import extra_people
from test_executor import env  # noqa: F401 - shared fixture

FACE = {'x': 10, 'y': 8, 'width': 8, 'height': 10, 'label': 'face', 'score': 0.9}
OTHER = {'x': 40, 'y': 20, 'width': 9, 'height': 11, 'label': 'face', 'score': 0.7}


def couple(**output):
    return Request(mode='generate', participants={'requested': 2},
                   attributes={'environment': cat('env.garden'), 'action': cat('action.hug')}, output=output)


def single(**output):
    return Request(mode='generate', attributes={'subject': cat('subject.woman'), 'environment': cat('env.garden')},
                   output=output)


# domain ---------------------------------------------------------------------
def test_automatic_mode_follows_the_number_of_people():
    assert face_detail.enabled(None, 2) and face_detail.enabled(None, 3)
    assert not face_detail.enabled(None, 1) and not face_detail.enabled(None, None)
    assert face_detail.enabled(True, 1) and not face_detail.enabled(False, 2)


def test_prompt_asks_for_matching_level_eyes_and_keeps_the_style_without_image_tags():
    text = face_detail.prompt('Render the result as a watercolor painting.')
    assert 'level with each other' in text and 'iris color' in text
    assert text.endswith('Render the result as a watercolor painting.')
    assert '<image' not in face_detail.prompt('Render the whole image in the style of <image2>.')


# graphs ---------------------------------------------------------------------
def test_detect_graph_uses_full_range_detector_and_caps_faces():
    graph = face_detect_graph('shot.png', 2)
    detector = next(n for n in graph.values() if n['class_type'] == 'MediaPipeFaceLandmarker')['inputs']
    assert detector['detector_variant'] == 'full' and detector['num_faces'] == 2 and detector['min_confidence'] == 0.5


def test_face_boxes_reads_the_first_frame_and_drops_bad_entries():
    text = json.dumps([[FACE, {'x': 1, 'y': 2}, {**OTHER, 'width': 0}]])
    assert [b['x'] for b in face_boxes(text)] == [10.0]
    assert face_boxes('not json') == [] and face_boxes(None) == [] and face_boxes('[[]]') == []


def test_face_boxes_drop_a_face_reported_twice():
    # Measured on a three-person photo: the detector returned the middle face a second time, almost on top of itself.
    twice = {**FACE, 'x': 10.5, 'y': 8.2, 'width': 7.6, 'height': 9.5, 'score': 0.56}
    assert face_boxes(json.dumps([[twice, FACE, OTHER]])) == face_boxes(json.dumps([[FACE, OTHER]]))
    side_by_side = {**FACE, 'x': 16, 'score': 0.5}             # touching, but another face
    assert len(face_boxes(json.dumps([[FACE, side_by_side]]))) == 2


def test_img2img_graph_encodes_the_start_image_without_using_it_as_reference():
    graph = image_graph(ImageJob(mode='generate', prompt='face', init_image='crop.png', denoise=0.45,
                                 resolution=1024))
    assert graph['13']['class_type'] == 'VAEEncode' and graph['12']['inputs']['image'] == 'crop.png'
    assert graph['42']['inputs']['latent_image'] == ['13', 0] and graph['42']['inputs']['denoise'] == 0.45
    assert not any(k.startswith('images.') for k in graph['10']['inputs'])
    with pytest.raises(ValueError):
        image_graph(ImageJob(mode='edit', prompt='x', images=('a.png',), init_image='crop.png'))


def test_turbo_img2img_starts_at_the_matching_sigma():
    assert turbo_tail(0.45) == '0.414568, 0'
    assert turbo_tail(1.0).startswith('1, 0.978453')
    assert turbo_tail(0.0) == '0.414568, 0'          # never fewer than one step
    graph = image_graph(ImageJob(mode='generate', prompt='face', profile='turbo', init_image='c.png', denoise=0.45))
    assert graph['40']['inputs']['sigmas'] == '0.414568, 0'


# crop and paste -------------------------------------------------------------
def test_crop_box_is_square_scaled_and_inside_the_picture():
    assert face_crop_box({'x': 100, 'y': 100, 'width': 80, 'height': 100}, (896, 1184)) == (60, 70, 160)
    left, top, side = face_crop_box({'x': 0, 'y': 2, 'width': 50, 'height': 60}, (896, 1184))
    assert (left, top) == (0, 0) and side == 96
    assert face_crop_box({'x': 850, 'y': 10, 'width': 40, 'height': 40}, (896, 1184))[0] == 896 - 64
    assert face_crop_box({'x': 0, 'y': 0, 'width': 900, 'height': 900}, (300, 200))[2] == 200


def test_a_face_hanging_over_the_edge_still_pastes():
    base = png(64, 48, (10, 10, 10))
    box = {'x': 58, 'y': 10, 'width': 12, 'height': 14}           # half of it past the right edge
    crop = face_crop_box(box, (64, 48))
    out = Image.open(io.BytesIO(paste_faces(base, [(png(256, 256, (250, 250, 250)), box, crop)])))
    assert out.size == (64, 48) and out.getpixel((0, 0)) == (10, 10, 10)


def test_paste_changes_only_the_face_oval():
    base = png(200, 160, (10, 10, 10))
    box = {'x': 80, 'y': 50, 'width': 40, 'height': 50}
    crop = face_crop_box(box, (200, 160))
    assert Image.open(io.BytesIO(crop_square(base, crop, 256))).size == (256, 256)
    out = Image.open(io.BytesIO(paste_faces(base, [(png(256, 256, (250, 250, 250)), box, crop)])))
    assert out.size == (200, 160)
    assert out.getpixel((100, 75))[0] > 200                    # face centre takes the refined face
    left, top, side = crop
    for point in [(left, top), (left + side - 1, top + side - 1), (5, 5)]:
        assert out.getpixel(point) == (10, 10, 10)            # crop edges and the rest stay untouched


# executor -------------------------------------------------------------------
def test_couple_run_redraws_each_small_face_and_keeps_the_raw_image(env):  # noqa: F811
    env.comfy.faces = [FACE, OTHER]
    run = env.service.create(couple(seed=7), 'faces-1', {}, None)
    assert run['settings']['face_detail'] is True
    run = env.run_until(run['id'])
    assert run['status'] == 'completed'
    image = env.repo.tasks(run['id'], 'image')[0]
    assert image['result']['detail'] == {'found': 2, 'refined': 2, 'expected': 2, 'people': None}
    assert image['result']['raw_files'] != image['result']['files']
    detect = env.repo.tasks(run['id'], 'face_detect')[0]
    assert next(n for n in detect['graph'].values()
                if n['class_type'] == 'MediaPipeFaceLandmarker')['inputs']['num_faces'] == 4   # 2 people + 2 to spot extras
    faces = env.repo.tasks(run['id'], 'face')
    assert [t['position'] for t in faces] == [0, 1] and all(t['seed'] == 7 for t in faces)
    graph = faces[0]['graph']
    assert graph['42']['inputs']['denoise'] == face_detail.DENOISE
    assert not any(n['class_type'] == 'LoraLoaderModelOnly' for n in graph.values())
    statuses = [e['status'] for e in env.repo.events(run['id']) if e['type'] == 'status']
    assert statuses == ['created', 'preparing', 'generating', 'detailing', 'completed']


def test_no_face_found_keeps_the_image_as_generated(env):  # noqa: F811
    run = env.run_until(env.service.create(couple(), 'faces-2', {}, None)['id'])
    image = env.repo.tasks(run['id'], 'image')[0]
    assert run['status'] == 'completed' and image['result']['detail'] == {'found': 0, 'refined': 0, 'expected': 2, 'people': None}
    assert 'raw_files' not in image['result'] and env.repo.tasks(run['id'], 'face') == []


def test_large_faces_are_left_alone(env):  # noqa: F811
    env.comfy.faces = [{**FACE, 'width': face_detail.MAX_FACE + 1}]
    run = env.run_until(env.service.create(couple(), 'faces-3', {}, None)['id'])
    assert env.repo.tasks(run['id'], 'face') == []
    assert env.repo.tasks(run['id'], 'image')[0]['result']['detail'] == {'found': 1, 'refined': 0, 'expected': 2, 'people': None}


def test_single_person_only_counts_faces_unless_the_redraw_is_asked(env):  # noqa: F811
    env.comfy.faces = [FACE]
    run = env.run_until(env.service.create(single(), 'faces-4', {}, None)['id'])
    assert run['settings']['face_detail'] is False and len(env.repo.tasks(run['id'], 'face_detect')) == 1
    assert env.repo.tasks(run['id'], 'face') == []
    image = env.repo.tasks(run['id'], 'image')[0]
    assert image['result']['detail'] == {'found': 1, 'refined': 0, 'expected': 1, 'people': None}
    assert 'raw_files' not in image['result']
    run = env.run_until(env.service.create(single(face_detail=True), 'faces-5', {}, None)['id'])
    assert env.repo.tasks(run['id'], 'image')[0]['result']['detail']['refined'] == 1
    off = env.service.create(couple(face_detail=False), 'faces-6', {}, None)
    assert off['settings']['face_detail'] is False


def test_single_person_run_flags_an_extra_face_without_changing_the_picture(env):  # noqa: F811
    env.comfy.faces = [FACE, OTHER]
    run = env.run_until(env.service.create(single(), 'faces-10', {}, None)['id'])
    image = env.repo.tasks(run['id'], 'image')[0]
    assert run['status'] == 'completed' and extra_people(image['result'])
    assert len(image['result']['files']) == 1 and 'raw_files' not in image['result']
    assert env.repo.tasks(run['id'], 'face') == []


def test_a_failing_detection_never_fails_the_run(env):  # noqa: F811
    upload = env.comfy.upload

    def refuse(data, filename, mime):
        raise ComfyRejected('no detector')
    run = env.service.create(couple(), 'faces-7', {}, None)
    env.run_until(run['id'], statuses=('detailing',))
    env.comfy.upload = refuse
    run = env.run_until(run['id'])
    env.comfy.upload = upload
    assert run['status'] == 'completed'
    assert env.repo.tasks(run['id'], 'face_detect')[0]['status'] == 'failed'
    assert env.repo.tasks(run['id'], 'image')[0]['result']['detail'] == {'found': 0, 'refined': 0, 'expected': 2, 'people': None}


def test_a_box_outside_the_picture_is_skipped_and_the_run_completes(env):  # noqa: F811
    env.comfy.faces = [FACE, {**OTHER, 'x': 70}, {**OTHER, 'x': -30, 'width': 10}]   # 64x48 picture
    run = env.run_until(env.service.create(couple(retry=False), 'faces-10', {}, None)['id'])
    assert run['status'] == 'completed'
    image = env.repo.tasks(run['id'], 'image')[0]
    assert image['status'] == 'completed' and image['result']['files']
    assert image['result']['detail'] == {'found': 3, 'refined': 1, 'expected': 2, 'people': None}
    assert [t['position'] for t in env.repo.tasks(run['id'], 'face')] == [0]


def test_deleting_the_run_removes_the_raw_image_too(env):  # noqa: F811
    env.comfy.faces = [FACE]
    run = env.run_until(env.service.create(couple(), 'faces-8', {}, None)['id'])
    result = env.repo.tasks(run['id'], 'image')[0]['result']
    assert result['raw_files'][0] in env.repo.referenced_files()        # never collected as an orphan
    env.service.delete(run['id'])
    assert not env.store.path(result['raw_files'][0]).exists() and not env.store.path(result['files'][0]).exists()


def test_an_extra_face_is_flagged_and_loses_the_best_pick(env):  # noqa: F811
    third = {**FACE, 'x': 24, 'y': 30}
    answers = iter([[FACE, OTHER, third], [FACE, OTHER]])       # variation 1 shows a third person, variation 2 does not
    env.comfy.faces = lambda: next(answers)
    run = env.run_until(env.service.create(couple(variations=2), 'faces-9', {}, None)['id'], limit=200)
    first, second = env.repo.tasks(run['id'], 'image')
    assert first['result']['detail']['found'] == 3 and extra_people(first['result'])
    assert not extra_people(second['result']) and run['best_task_id'] == second['id']


def test_fewer_faces_than_people_is_not_an_alarm():
    assert not extra_people({'detail': {'found': 1, 'refined': 1, 'expected': 2}})
    assert not extra_people({'detail': {'found': 2, 'refined': 0}}) and not extra_people(None)


def test_bodies_are_counted_with_rt_detr_only_when_it_is_installed():
    graph = face_detect_graph('shot.png', 3, people=True)
    detector = next(n for n in graph.values() if n['class_type'] == 'RTDETR_detect')['inputs']
    assert detector['class_name'] == 'person'
    assert not any(n['class_type'] == 'RTDETR_detect' for n in face_detect_graph('shot.png', 3).values())
    sure, unsure = {'label': 'person', 'score': 0.9}, {'label': 'person', 'score': 0.55}
    # Measured: whole people scored 0.79+; half-hidden riders and false hits 0.51-0.61 are not counted.
    assert people_count(json.dumps([[sure, sure, unsure]])) == 2
    assert people_count(json.dumps([sure])) == 1 and people_count(None) is None and people_count('x') is None


def test_an_extra_body_is_flagged_even_without_an_extra_face(env):  # noqa: F811
    env.executor._people_model = True
    env.comfy.faces = [FACE, OTHER]
    env.comfy.people = [{'label': 'person', 'score': 0.9}] * 3       # a third person, turned away from the camera
    run = env.run_until(env.service.create(couple(), 'faces-10', {}, None)['id'])
    image = env.repo.tasks(run['id'], 'image')[0]
    assert image['result']['detail']['people'] == 3 and image['result']['detail']['found'] == 2
    assert extra_people(image['result'])
    detect = env.repo.tasks(run['id'], 'face_detect')[0]
    assert any(n['class_type'] == 'RTDETR_detect' for n in detect['graph'].values())


def test_plano_b_draws_one_more_picture_when_every_one_has_the_wrong_count(env):  # noqa: F811
    env.comfy.faces = [FACE, OTHER, {**FACE, 'x': 2}]           # three faces for a couple, in every picture
    run = env.run_until(env.service.create(couple(seed=5), 'retry-1', {}, None)['id'])
    images = env.repo.tasks(run['id'], 'image')
    assert run['status'] == 'completed' and [t['position'] for t in images] == [0, 1]
    assert images[1]['seed'] == 6                                # the next seed, once: it is wrong too and stops
    assert [e['type'] for e in env.repo.events(run['id'])].count('retry_wrong_count') == 1
    statuses = [e['status'] for e in env.repo.events(run['id']) if e['type'] == 'status']
    assert statuses == ['created', 'preparing', 'generating', 'detailing', 'generating', 'detailing', 'completed']


def test_plano_b_stays_quiet_when_a_picture_is_right_or_it_is_switched_off(env):  # noqa: F811
    env.comfy.faces = [FACE, OTHER]
    run = env.run_until(env.service.create(couple(), 'retry-2', {}, None)['id'])
    assert len(env.repo.tasks(run['id'], 'image')) == 1
    env.comfy.faces = [FACE, OTHER, {**FACE, 'x': 2}]
    run = env.run_until(env.service.create(couple(retry=False), 'retry-3', {}, None)['id'])
    assert len(env.repo.tasks(run['id'], 'image')) == 1


def test_fewer_faces_alone_proves_nobody_is_missing():
    from prisma_studio.worker.executor import missing_people, right_count
    turned = {'detail': {'found': 1, 'expected': 2, 'people': 2}}       # a face turned away, two bodies
    assert not missing_people(turned) and right_count(turned)
    unknown = {'detail': {'found': 1, 'expected': 2, 'people': None}}   # no body count: nothing concluded
    assert not missing_people(unknown)
    gone = {'detail': {'found': 1, 'expected': 2, 'people': 1}}
    assert missing_people(gone) and not right_count(gone)
