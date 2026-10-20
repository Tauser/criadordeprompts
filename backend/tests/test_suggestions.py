import json
from pathlib import Path

from helpers import cat, edit_request, generate_request, keep
from prisma_studio.domain.catalog import Library
from prisma_studio.domain.suggestions import suggest
from prisma_studio.domain.rules import assess
from test_api import client  # noqa: F401 - fixture

CATALOG = Path(__file__).resolve().parents[2] / 'catalog' / 'defaults.json'
LIBRARY = Library.model_validate(json.loads(CATALOG.read_text(encoding='utf-8')))


def suggestions(request):
    return suggest(request, LIBRARY, assess(request, LIBRARY).resolved)


def by_field(found, field):
    return [s for s in found if s['field'] == field]


def item_of(suggestion):
    return (suggestion['attribute'] or {}).get('value', {}).get('item_id')


def test_an_action_that_places_the_body_frees_the_kept_pose():
    found = suggestions(edit_request({'action': cat('action.serious_formal_portrait'), 'pose': keep()}))
    [pose] = by_field(found, 'pose')
    assert pose['attribute'] == {'intent': 'free'} and pose['auto'] and pose['source'] == 'action'


def test_a_pose_on_the_ground_gets_the_full_frame_and_a_free_camera():
    request = edit_request({'pose': cat('pose.side'), 'framing': keep(), 'camera': keep()},
                           context={'original_framing': 'half'})
    found = suggestions(request)
    [framing] = by_field(found, 'framing')
    assert item_of(framing) == 'framing.full' and framing['auto'] and framing['label'] == 'Usar Corpo inteiro'
    [camera] = by_field(found, 'camera')
    assert camera['attribute'] == {'intent': 'free'} and camera['auto']


def test_an_unknown_crop_is_only_offered():
    found = suggestions(edit_request({'action': cat('action.serious_formal_portrait'), 'framing': keep()}))
    [framing] = by_field(found, 'framing')
    assert item_of(framing) == 'framing.half' and not framing['auto']


def test_a_locked_reframe_is_offered_with_the_switch_and_never_applied_alone():
    request = edit_request({'pose': cat('pose.side'), 'framing': {'intent': 'free'}},
                           context={'allow_reframing': False, 'original_framing': 'half'})
    [framing] = by_field(suggestions(request), 'framing')
    assert framing['context'] == {'allow_reframing': True} and not framing['auto']


def test_a_setting_without_the_surface_offers_settings_that_have_it():
    found = suggestions(generate_request({'pose': cat('pose.recline'), 'environment': cat('environment.beach')}))
    offered = by_field(found, 'environment')
    settings = [item_of(s) for s in offered if s['attribute']]
    assert len(settings) == 3 and all('seat' in LIBRARY.index()[i].provides.supports for i in settings)
    assert offered[-1]['context'] == {'allow_new_supports': True} and not any(s['auto'] for s in offered)
    assert 'assento' in offered[0]['reason']


def test_an_expression_that_looks_elsewhere_offers_ones_that_agree():
    found = suggestions(generate_request({'action': cat('action.serious_formal_portrait'),
                                          'expression': cat('expression.thoughtful')}))
    offered = [LIBRARY.index()[item_of(s)] for s in by_field(found, 'expression')]
    assert offered and offered[0].requirements.gaze == 'camera'
    assert all(i.requirements.gaze in ('camera', 'any') for i in offered)


def test_a_camera_on_the_wrong_side_offers_cameras_that_see_the_pose():
    found = suggestions(generate_request({'pose': cat('pose.lookback'), 'camera': cat('camera.front')}))
    offered = [item_of(s) for s in by_field(found, 'camera')]
    assert offered[0] == 'camera.over_shoulder' and 'camera.front' not in offered
    assert 'outro lado' in by_field(found, 'camera')[0]['reason']


def test_nothing_is_suggested_without_a_pose_or_action_or_in_manual_mode():
    assert suggestions(generate_request({'environment': cat('environment.beach')})) == []
    manual = generate_request({'pose': cat('pose.side')}, prompt_mode='manual', manual_prompt='x')
    assert suggestions(manual) == []


def test_prepare_returns_the_suggestions(client):  # noqa: F811
    body = {'mode': 'generate', 'attributes': {'pose': cat('pose.recline'), 'environment': cat('environment.beach')}}
    result = client.post('/api/prepare', json=body).json()
    assert any(s['field'] == 'environment' for s in result['suggestions'])


def test_automatic_suggestions_stay_once_applied_so_the_composer_does_not_undo_them():
    attributes = {'action': cat('action.serious_formal_portrait'), 'pose': keep(), 'framing': keep(), 'camera': keep()}
    context = {'original_framing': 'portrait'}
    first = suggestions(edit_request(attributes, context=context))
    applied = dict(attributes)
    for s in first:
        if s['auto']:
            applied[s['field']] = s['attribute']
    assert {s['field'] for s in first if s['auto']} == {'pose', 'framing'}
    again = suggestions(edit_request(applied, context=context))
    assert {(s['field'], json.dumps(s['attribute'])) for s in again if s['auto']} == \
        {(s['field'], json.dumps(s['attribute'])) for s in first if s['auto']}


def test_a_pose_on_the_ground_keeps_its_automatic_frame_and_camera_once_applied():
    applied = edit_request({'pose': cat('pose.side'), 'framing': cat('framing.full'), 'camera': {'intent': 'free'}})
    auto = {s['field'] for s in suggestions(applied) if s['auto']}
    assert auto == {'framing', 'camera'}
