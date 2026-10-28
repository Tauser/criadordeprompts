import pytest

from prisma_studio.domain import ir
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
    assert any(isinstance(b, ir.Guidance) and b.key == 'orientation' and b.value == 'front' for b in compiled.blocks)


def test_camera_view_gives_the_orientation_when_the_pose_has_none(scene):
    _, compiled = run(generate_request({'pose': cat('pose.full'), 'camera': cat('cam.front'),
                                        'expression': cat('expr.camera')}), scene)
    guides = {(b.key, b.value) for b in compiled.blocks if isinstance(b, ir.Guidance)}
    assert {('orientation', 'front'), ('gaze', 'camera')} <= guides


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


@pytest.fixture
def photo():
    return Library(items=[
        item('pose.stand', 'pose', 'standing relaxed', req={'participants': 1, 'posture': 'standing', 'gaze': 'any'}),
        item('frame.full', 'framing', 'full-body framing', prov={'framing': 'full'}),
        item('style.real', 'style', 'photorealistic photography'),
        item('wardrobe.dress', 'wardrobe', 'a red dress'),
        item('env.room', 'environment', 'a hotel room'),
        item('light.soft', 'lighting', 'soft light'),
    ])


KEEP_PERSON = {'subject': {'intent': 'keep'}, 'face': {'intent': 'keep'}, 'body': {'intent': 'keep'}}


def test_framing_the_photo_already_has_is_kept_instead_of_reframed(photo):
    request = edit_request({**KEEP_PERSON, 'framing': cat('frame.full'), 'environment': cat('env.room')},
                           context={'original_framing': 'full'})
    assessment, compiled = run(request, photo)
    assert 'framing_already_there' in codes(assessment, 'adjusted')
    assert 'Reframe' not in compiled.text and 'framing and crop' in compiled.text
    other, compiled = run(edit_request({**KEEP_PERSON, 'framing': cat('frame.full')},
                                       context={'original_framing': 'half'}), photo)
    assert 'framing_already_there' not in codes(other) and 'Reframe the shot' in compiled.text


def test_poses_carry_the_anatomy_guard(photo):
    _, compiled = run(edit_request({**KEEP_PERSON, 'pose': cat('pose.stand')}), photo)
    assert 'two legs and two feet, with natural adult proportions: the head is in scale with the shoulders' in compiled.text
    assert 'guide.anatomy' in {c.id for c in checklist(compiled.blocks)}
    _, scene_only = run(edit_request({**KEEP_PERSON, 'environment': cat('env.room')}), photo)
    assert 'exactly two arms' not in scene_only.text



def test_scenes_with_children_ask_for_proportions_by_age():
    family = Library(items=[
        item('action.family', 'action', 'two adults walking with a small child between them, holding hands',
             req={'participants': 3, 'posture': 'walking', 'gaze': 'any', 'children': True}),
        item('action.couple', 'action', 'two adults walking side by side and holding hands',
             req={'participants': 2, 'posture': 'walking', 'gaze': 'any'}),
        item('action.sexy', 'action', 'two adults in a slow, intimate dance', adult=True,
             req={'participants': 2, 'posture': 'standing', 'gaze': 'any'}),
        item('pose.kids', 'pose', 'three people standing in a row, a child in the middle',
             req={'participants': 3, 'posture': 'standing', 'gaze': 'any', 'children': True}),
    ])
    _, compiled = run(generate_request({'action': cat('action.family')}), family)
    assert "proportions natural for that person's age" in compiled.text and 'adult proportions' not in compiled.text
    assert "that person's age" in next(c.question for c in checklist(compiled.blocks) if c.id == 'guide.anatomy')
    _, adults = run(generate_request({'action': cat('action.couple')}), family)
    assert 'natural adult proportions' in adults.text
    mixed, _ = run(generate_request({'action': cat('action.sexy'), 'pose': cat('pose.kids')}, content_mode='adult',
                                    confirmations=['adults_only']), family)
    assert 'adult_with_children' in codes(mixed, 'error')
    with pytest.raises(ValueError):
        item('action.bad', 'action', 'two adults dancing close together', adult=True,
             req={'participants': 2, 'children': True})

def test_edits_that_endanger_the_body_are_flagged(photo):
    request = edit_request({**KEEP_PERSON, 'style': cat('style.real'), 'wardrobe': cat('wardrobe.dress'),
                            'environment': cat('env.room'), 'lighting': cat('light.soft')})
    assessment, _ = run(request, photo)
    assert {'style_redraws', 'hidden_body', 'many_changes'} <= set(codes(assessment, 'warning'))
    assert assessment.valid
    light, _ = run(edit_request({**KEEP_PERSON, 'lighting': cat('light.soft')}), photo)
    assert not {'style_redraws', 'hidden_body', 'many_changes'} & set(codes(light))


def test_a_new_pose_is_reframed_even_when_the_photo_has_that_framing(photo):
    library = Library(items=[*photo.items, item('pose.fours', 'pose', 'on hands and knees',
                                                req={'participants': 1, 'posture': 'all_fours', 'gaze': 'any'})])
    request = edit_request({**KEEP_PERSON, 'framing': cat('frame.full'), 'pose': cat('pose.fours'),
                            'camera': {'intent': 'keep'}}, context={'original_framing': 'full'})
    assessment, compiled = run(request, library)
    assert 'framing_already_there' not in codes(assessment) and 'Reframe the shot' in compiled.text
    assert 'posture_in_old_frame' in codes(assessment, 'warning')
    standing, _ = run(edit_request({**KEEP_PERSON, 'pose': cat('pose.stand'), 'camera': {'intent': 'keep'}}), library)
    assert 'posture_in_old_frame' not in codes(standing)
