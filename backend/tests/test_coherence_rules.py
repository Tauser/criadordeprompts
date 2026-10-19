import pytest

from conftest import item
from helpers import cat, codes, edit_request, generate_request, run
from prisma_studio.domain.catalog import Library
from prisma_studio.domain.verification import checklist


@pytest.fixture
def scene():
    return Library(items=[
        item('subject.woman', 'subject', 'one adult woman', req={'participants': 1}),
        item('pose.back', 'pose', 'standing with the back to the camera',
             req={'participants': 1, 'posture': 'standing', 'orientation': 'back', 'gaze': 'any'}),
        item('pose.front', 'pose', 'standing facing the camera',
             req={'participants': 1, 'posture': 'standing', 'orientation': 'front', 'gaze': 'any'}),
        item('pose.side', 'pose', 'standing in profile',
             req={'participants': 1, 'posture': 'standing', 'orientation': 'side', 'gaze': 'any'}),
        item('pose.full', 'pose', 'standing tall', req={'participants': 1, 'posture': 'standing', 'gaze': 'any',
                                                          'minimum_framing': 'full'}),
        item('expr.camera', 'expression', 'looking at the camera', req={'gaze': 'camera'}),
        item('expr.down', 'expression', 'looking down', req={'gaze': 'down'}),
        item('expr.shoulder', 'expression', 'looking over the shoulder', req={'gaze': 'back'}),
        item('cam.front', 'camera', 'camera in front', prov={'view': 'front'}),
        item('cam.three', 'camera', 'camera at three quarters', prov={'view': 'three_quarter'}),
        item('cam.macro', 'camera', 'macro lens', prov={'framing': 'portrait'}),
        item('frame.wide', 'framing', 'a wide shot', prov={'framing': 'wide'}),
        item('light.noon', 'lighting', 'midday sun', prov={'period': 'day', 'place': 'outdoor'}),
        item('light.golden', 'lighting', 'golden hour', prov={'period': 'golden'}),
        item('light.window', 'lighting', 'window light', prov={'period': 'day', 'place': 'indoor'}),
        item('env.night', 'environment', 'a rooftop at night', prov={'period': 'night', 'place': 'outdoor'}),
        item('env.beach', 'environment', 'a beach by day', prov={'period': 'day', 'place': 'outdoor'}),
        item('action.hug', 'action', 'hugging each other', req={'participants': 2, 'posture': 'any', 'gaze': 'any'}),
    ])


def test_back_view_with_camera_gaze_is_rewritten_as_a_look_over_the_shoulder(scene):
    assessment, compiled = run(generate_request({'pose': cat('pose.back'), 'expression': cat('expr.camera')}), scene)
    assert 'gaze_over_shoulder' in codes(assessment, 'adjusted') and assessment.valid
    assert 'over the shoulder toward the camera, no further than the neck allows' in compiled.text
    assert 'The eyes look at the camera.' not in compiled.text
    assert 'The neck stays natural: the head turns no further than over the shoulder.' in compiled.text


def test_profile_with_camera_gaze_turns_the_head(scene):
    assessment, compiled = run(generate_request({'pose': cat('pose.side'), 'expression': cat('expr.camera')}), scene)
    assert 'gaze_head_turn' in codes(assessment, 'adjusted')
    assert 'The head turns toward the camera, no further than the shoulder' in compiled.text


def test_hidden_face_gaze_is_not_judged(scene):
    assessment, compiled = run(generate_request({'pose': cat('pose.back'), 'expression': cat('expr.down')}), scene)
    assert 'gaze_not_visible' in codes(assessment, 'unknown')
    assert 'guide.gaze' not in {c.id for c in checklist(compiled.blocks)}
    assert 'guide.head' in {c.id for c in checklist(compiled.blocks)}


def test_front_body_looking_over_the_shoulder_is_a_warning(scene):
    assessment, _ = run(generate_request({'pose': cat('pose.front'), 'expression': cat('expr.shoulder')}), scene)
    assert 'gaze_back_facing_front' in codes(assessment, 'warning')


def test_camera_view_must_match_the_pose(scene):
    opposite, _ = run(generate_request({'pose': cat('pose.back'), 'camera': cat('cam.front')}), scene)
    assert 'conflicting_orientation' in codes(opposite, 'error')
    near, compiled = run(generate_request({'pose': cat('pose.front'), 'camera': cat('cam.three')}), scene)
    assert 'near_orientation' in codes(near, 'warning') and near.valid
    assert 'The front of the body faces the camera.' in compiled.text


def test_camera_view_gives_the_orientation_when_the_pose_has_none(scene):
    _, compiled = run(generate_request({'pose': cat('pose.full'), 'camera': cat('cam.front'),
                                        'expression': cat('expr.camera')}), scene)
    assert 'The front of the body faces the camera.' in compiled.text and 'The eyes look at the camera.' in compiled.text


def test_light_and_setting_must_agree(scene):
    night, _ = run(generate_request({'lighting': cat('light.noon'), 'environment': cat('env.night')}), scene)
    assert 'light_period' in codes(night, 'error')
    window, _ = run(generate_request({'lighting': cat('light.window'), 'environment': cat('env.beach')}), scene)
    assert 'light_place' in codes(window, 'warning') and window.valid
    golden, _ = run(generate_request({'lighting': cat('light.golden'), 'environment': cat('env.beach')}), scene)
    assert 'light_period_near' in codes(golden, 'warning') and golden.valid
    fine, _ = run(generate_request({'lighting': cat('light.noon'), 'environment': cat('env.beach')}), scene)
    assert not {'light_period', 'light_place'} & set(codes(fine))


def test_lens_and_framing_warnings(scene):
    tight, _ = run(generate_request({'pose': cat('pose.full'), 'camera': cat('cam.macro')}), scene)
    assert 'camera_framing' in codes(tight, 'warning')
    apart, _ = run(generate_request({'camera': cat('cam.macro'), 'framing': cat('frame.wide')}), scene)
    assert 'camera_vs_framing' in codes(apart, 'warning')


def test_explicit_people_count_is_not_silently_raised(scene):
    hug, _ = run(generate_request({'action': cat('action.hug')}, participants={'requested': 1}), scene)
    assert 'participants_mismatch' in codes(hug, 'error')
    extra, _ = run(edit_request({'subject': cat('subject.woman')}, references=(('t', 'alvo'), ('p', 'outro')),
                                characters=[{'reference_id': 'p'}], participants={'requested': 1}), scene)
    assert 'participants_mismatch' in codes(extra, 'error')
    crowd, _ = run(edit_request({'subject': cat('subject.woman')}, participants={'requested': 1, 'existing': 3}), scene)
    assert 'cannot_remove_people' in codes(crowd, 'warning')


def test_mask_limits_scene_changes(scene):
    framing, _ = run(edit_request({'framing': cat('frame.wide')}, mask=True), scene)
    assert 'mask_framing' in codes(framing, 'error')
    setting, _ = run(edit_request({'environment': cat('env.beach')}, mask=True), scene)
    assert 'mask_environment' in codes(setting, 'warning') and setting.valid


def test_output_settings_that_have_no_effect_are_reported(scene):
    request = generate_request({'environment': cat('env.beach')}, output={'profile': 'turbo', 'refine': True},
                               engine={'steps': 30, 'negative_prompt': 'blurry'})
    assessment, _ = run(request, scene)
    assert {'turbo_settings', 'turbo_refine'} <= set(codes(assessment, 'adjusted'))
    assert 'negative_ignored' in codes(assessment, 'warning')
