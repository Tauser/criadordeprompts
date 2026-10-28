from prisma_studio.domain import ir
from conftest import item
from helpers import cat, codes, generate_request, run
from prisma_studio.domain.catalog import Library
from prisma_studio.domain.verification import checklist
from prisma_studio.domain.vocabulary import agreed


def _library(**poses):
    items = [item('subject.woman', 'subject', 'one adult woman', req={'participants': 1})]
    for id_, req in poses.items():
        category = 'action' if id_.startswith('act') else 'pose'
        items.append(item(f'{category}.{id_}', category, id_.replace('_', ' '), req={'participants': 1, **req}))
    return Library(items=items)


def test_generic_lying_agrees_with_one_specific_lying_posture():
    assert agreed({'lying', 'supine'}) == 'supine'
    assert agreed({'supine'}) == 'supine'
    assert agreed({'supine', 'prone'}) is None
    assert agreed({'lying', 'supine', 'prone'}) is None
    assert agreed({'lying', 'all_fours'}) is None
    assert agreed(set()) is None


def test_posture_and_orientation_are_said_only_when_the_pose_text_does_not_say_them():
    library = _library(fours={'posture': 'all_fours', 'orientation': 'back', 'gaze': 'any'})
    _, compiled = run(generate_request({'subject': cat('subject.woman'), 'pose': cat('pose.fours')}), library)
    # "fours" alone says neither: the metadata adds them.
    assert 'The body is on all fours, with the knees on the surface and the hips above them.' in compiled.text
    assert 'The body is seen from behind, with the back toward the camera.' in compiled.text
    # A text that already says them is not repeated.
    said = generate_request({'subject': cat('subject.woman'),
                             'pose': {'intent': 'set', 'value': {'kind': 'text', 'text': 'on all fours, seen from behind'}}})
    library = _library(fours={'posture': 'all_fours', 'orientation': 'back', 'gaze': 'any'})
    _, text_pose = run(said, library)
    assert 'The body is on all fours' not in text_pose.text and 'The body is seen from behind' not in text_pose.text
    ids = {check.id for check in checklist(compiled.blocks)}
    assert {'guide.posture', 'guide.orientation'} <= ids


def test_generic_lying_action_does_not_conflict_with_a_specific_pose():
    library = _library(back={'posture': 'supine', 'gaze': 'any'}, act_rest={'posture': 'lying', 'gaze': 'any'})
    assessment, compiled = run(generate_request({'pose': cat('pose.back'), 'action': cat('action.act_rest')}), library)
    assert 'conflicting_posture' not in codes(assessment)
    assert any(isinstance(b, ir.Guidance) and b.key == 'posture' and b.value == 'supine' for b in compiled.blocks)


def test_different_lying_sides_and_orientations_conflict():
    library = _library(back={'posture': 'supine', 'orientation': 'front', 'gaze': 'any'},
                       act_side={'posture': 'prone', 'orientation': 'back', 'gaze': 'any'})
    assessment, _ = run(generate_request({'pose': cat('pose.back'), 'action': cat('action.act_side')}), library)
    assert {'conflicting_posture', 'conflicting_orientation'} <= set(codes(assessment, 'error'))


def _scene_library():
    return Library(items=[
        item('subject.woman', 'subject', 'one adult woman', req={'participants': 1}),
        item('env.bedroom', 'environment', 'a bedroom', prov={'supports': ('floor', 'seat', 'bed')}),
        item('env.beach', 'environment', 'a beach', prov={'supports': ('floor',)}),
        item('pose.fours', 'pose', 'on all fours',
             req={'participants': 1, 'posture': 'all_fours', 'orientation': 'back', 'gaze': 'down',
                  'support_any_of': ('floor', 'bed')}),
        item('expr.calm', 'expression', 'a calm face', req={'gaze': 'down'}),
    ])


def test_a_single_surface_is_chosen_from_the_scene():
    library = _scene_library()
    bedroom = generate_request({'pose': cat('pose.fours'), 'environment': cat('env.bedroom')})
    text = run(bedroom, library)[1].text
    assert 'The body is supported by a bed, with believable contact and weight; it does not rest partly' in text
    assert 'the floor' not in text
    beach = run(generate_request({'pose': cat('pose.fours'), 'environment': cat('env.beach')}), library)[1].text
    assert 'The body is supported by the floor' in beach
    free = run(generate_request({'pose': cat('pose.fours')}), library)[1].text   # new scene: most specific surface
    assert 'The body is supported by a bed' in free


def test_body_guidance_follows_the_pose_in_a_fixed_order():
    request = generate_request({'subject': cat('subject.woman'), 'pose': cat('pose.fours'),
                                'expression': cat('expr.calm'), 'environment': cat('env.bedroom')})
    compiled = run(request, _scene_library())[1]
    ids = [b.id for b in compiled.blocks]
    start = ids.index('op.expression') + 1
    assert ids[start:start + 4] == ['guide.posture', 'guide.support', 'guide.orientation', 'guide.gaze']
    # "on all fours" already says the posture; the surface picked from the scene, the side seen and the gaze are said.
    spoken = {block_id for block_id, _ in compiled.segments}
    assert {'guide.support', 'guide.orientation', 'guide.gaze'} <= spoken and 'guide.posture' not in spoken
    assert ids.index('op.pose') < ids.index('op.expression') < ids.index('op.environment')
    assert 'guide.support' in {check.id for check in checklist(compiled.blocks)}
