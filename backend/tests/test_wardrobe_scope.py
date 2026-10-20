import json
from pathlib import Path

import pytest

from helpers import cat, edit_request, generate_request, keep, run, text
from prisma_studio.domain.catalog import Library
from prisma_studio.domain.compiler import COMPILER_VERSION
from prisma_studio.domain.request import Request
from prisma_studio.domain.verification import checklist
from prisma_studio.domain.vocabulary import CATEGORIES


@pytest.mark.parametrize('mode', ['generate', 'edit'])
def test_clothing_can_explicitly_apply_to_both_people(mode, library):
    make = edit_request if mode == 'edit' else generate_request
    assessment, compiled = run(make({'wardrobe': text('a dark wool coat')}, wardrobe_scope='all',
                                    participants={'requested': 2}), library)
    assert assessment.valid
    assert 'Apply the clothing instruction to both people in the scene' in compiled.text
    # In an edit the person already in the photo is named, or the model keeps that person's outfit.
    assert ("the first person's current clothing changes too and is not kept" in compiled.text) == (mode == 'edit')
    assert compiled.text.count('scope.wardrobe') == 0
    assert len([b for b, _ in compiled.segments if b == 'scope.wardrobe']) == 1
    checks = [c for c in checklist(compiled.blocks) if c.id.startswith('op.wardrobe')]
    assert [c.id for c in checks] == ['op.wardrobe.person.1', 'op.wardrobe.person.2']
    assert all('dark wool coat' in c.question for c in checks)


def test_default_scope_stays_on_the_primary_person_in_a_group(library):
    _, compiled = run(generate_request({'wardrobe': text('a dark wool coat')}, participants={'requested': 2}), library)
    assert 'Apply the clothing instruction to the first person only.' in compiled.text
    assert 'both people' not in compiled.text


def test_three_people_are_not_rendered_as_both(library):
    _, compiled = run(generate_request({'wardrobe': text('matching blue coats')}, wardrobe_scope='all',
                                      participants={'requested': 3}), library)
    assert 'all 3 people in the scene' in compiled.text
    assert len([c for c in checklist(compiled.blocks) if c.id.startswith('op.wardrobe')]) == 3


@pytest.mark.parametrize('participants', [{}, {'requested': 1}])
def test_group_scope_needs_a_declared_group(library, participants):
    assessment, compiled = run(generate_request({'wardrobe': text('blue coats')}, wardrobe_scope='all',
                                                participants=participants), library)
    assert compiled is None
    assert 'wardrobe_scope_requires_people' in {i.code for i in assessment.issues}


@pytest.mark.parametrize('attribute', [{'intent': 'free'}, keep(), {'intent': 'transfer', 'reference_id': 'p'}])
def test_group_scope_does_not_silently_override_a_keep_or_reference_choice(library, attribute):
    request = edit_request({'wardrobe': attribute}, references=(('t', 'target'), ('p', 'reference')),
                           wardrobe_scope='all', participants={'existing': 2})
    assessment, compiled = run(request, library)
    assert compiled is None
    assert 'wardrobe_scope_requires_set' in {i.code for i in assessment.issues}


def test_added_character_is_included_without_changing_identity_or_scene():
    catalog = json.loads((Path(__file__).resolve().parents[2] / 'catalog/defaults.json').read_text(encoding='utf-8'))
    # The shipped catalog has no adult clothing option; this one exercises the confirmations.
    catalog['items'].append({'id': 'wardrobe.adult_test', 'category': 'wardrobe', 'label': 'Teste adulto',
                             'prompt': 'an adult-only outfit', 'adult': True,
                             'edit_prompt': 'Change the clothing to an adult-only outfit.'})
    library = Library.model_validate(catalog)
    item = library.index()['wardrobe.adult_test']
    request = edit_request({'wardrobe': cat(item.id), 'face': keep(), 'environment': keep()},
                           references=(('t', 'target'), ('p', 'character')), wardrobe_scope='all',
                           characters=[{'reference_id': 'p'}], content_mode='adult',
                           confirmations=['adults_only', 'consent_or_fictional'])
    assessment, compiled = run(request, library)
    assert assessment.valid and assessment.participants_total == 2
    assert item.edit_prompt in compiled.text
    assert 'both people in the scene' in compiled.text
    assert 'includes any characters added from reference images' in compiled.text
    assert 'Add a second person to the scene, next to the first person, with the facial identity, body shape, skin '         'tone and hairstyle' in compiled.text
    assert "the first person's facial identity; and the background and setting" in compiled.text
    assert compiled.version == COMPILER_VERSION
    without_confirmations = request.model_copy(update={'confirmations': frozenset()})
    denied, result = run(without_confirmations, library)
    assert result is None and {'confirm_adults', 'confirm_consent'} <= {i.code for i in denied.issues}


def test_manual_prompt_remains_literal_and_legacy_requests_still_load(library):
    request = Request(mode='generate', prompt_mode='manual', manual_prompt='Two adults wearing blue coats.',
                      wardrobe_scope='all')
    assert run(request, library)[1].text == request.manual_prompt
    assert Request.model_validate({'mode': 'generate'}).wardrobe_scope == 'primary'


def test_added_character_gets_the_clothing_and_joins_the_group_action(library):
    request = edit_request({'wardrobe': text('beachwear'), 'action': cat('action.hug'), 'face': keep()},
                           references=(('t', 'target'), ('p', 'character')), wardrobe_scope='all',
                           characters=[{'reference_id': 'p'}], participants={'existing': 1})
    assessment, compiled = run(request, library)
    assert assessment.valid
    order = [b for b, _ in compiled.segments]
    # The first person changes clothes before the new person is introduced.
    assert order.index('op.wardrobe') < order.index('scope.wardrobe') < order.index('character.2') < order.index('op.action')
    assert "Keep the first person's facial identity from <image1> unchanged." in compiled.text
    assert "use <image2> only for this person's identity" in compiled.text
    assert 'The second person wears the requested clothing, not the clothing from <image2>.' in compiled.text
    assert 'The second person takes part in the requested action together with the first person.' in compiled.text
    assert 'The people performing this action are the first person and the second person.' in compiled.text
    assert 'Every person wears it, the first person and the second person.' in compiled.text


def test_primary_scope_leaves_the_added_character_in_their_own_clothes(library):
    request = edit_request({'wardrobe': text('beachwear'), 'action': cat('action.read')},
                           references=(('t', 'target'), ('p', 'character')),
                           characters=[{'reference_id': 'p'}], participants={'existing': 1})
    _, compiled = run(request, library)
    assert 'not the clothing from <image2>' not in compiled.text
    assert 'takes part in the requested action' not in compiled.text


def test_replacing_the_person_is_blocked_when_a_character_is_added(library):
    request = edit_request({'subject': text('two adults'), 'action': cat('action.hug')},
                           references=(('t', 'target'), ('p', 'character')), characters=[{'reference_id': 'p'}],
                           participants={'existing': 1})
    assessment, compiled = run(request, library)
    assert compiled is None
    assert 'replace_person_with_cast' in {i.code for i in assessment.issues}


def test_an_action_with_its_own_posture_releases_the_kept_pose():
    from prisma_studio.domain.catalog import Item
    walk = Item.model_validate({'id': 'action.walk', 'category': 'action', 'label': 'walk', 'prompt': 'walking together',
                                'requirements': {'participants': 2, 'posture': 'walking'}})
    request = edit_request({'action': cat('action.walk'), 'pose': keep(), 'subject': keep(), 'face': keep(),
                            'wardrobe': text('swimwear')}, references=(('t', 'target'), ('p', 'character')),
                           wardrobe_scope='all', characters=[{'reference_id': 'p'}], participants={'existing': 1})
    assessment, compiled = run(request, Library(items=[walk]))
    assert 'pose_follows_action' in {i.code for i in assessment.issues}
    keep_text = dict(compiled.segments)['keep']
    assert 'body pose' not in keep_text and 'the person,' not in keep_text
    assert 'the original outfit is no longer worn' in compiled.text
    wardrobe = [c for c in checklist(compiled.blocks) if c.id.startswith('op.wardrobe')]
    assert all('visibly different from the outfit in the original' in c.question for c in wardrobe)


def test_groups_ask_for_matching_eyes_and_suggest_a_larger_size(library):
    assessment, compiled = run(generate_request({'wardrobe': text('blue coats')}, participants={'requested': 2}),
                               library)
    assert 'each person\'s two eyes match in size, shape and color' in compiled.text
    assert 'guide.faces' in {c.id for c in checklist(compiled.blocks)}
    assert 'small_faces' in {i.code for i in assessment.issues}
    single, compiled = run(generate_request({'wardrobe': text('a blue coat')}), library)
    assert 'two eyes match' not in compiled.text and 'small_faces' not in {i.code for i in single.issues}


def test_every_picture_of_people_checks_the_faces_for_deformities(library):
    _, single = run(edit_request({'wardrobe': text('a blue coat')}), library)
    face = [c for c in checklist(single.blocks) if c.id == 'faces']
    assert len(face) == 1 and 'free of deformities' in face[0].question
    _, group = run(generate_request({'wardrobe': text('blue coats')}, participants={'requested': 2}), library)
    checks = {c.id: c.question for c in checklist(group.blocks)}
    assert 'faces' not in checks and 'free of deformities' in checks['guide.faces']
    assert 'two eyes match' in checks['guide.faces']


def test_scene_wide_keep_makes_way_for_the_new_clothing(library):
    kept = {c: keep() for c in CATEGORIES if c != 'wardrobe'}         # as the edit form starts: everything kept
    request = edit_request({**kept, 'wardrobe': text('beachwear')},
                           references=(('t', 'target'), ('p', 'character')), wardrobe_scope='all',
                           characters=[{'reference_id': 'p'}], participants={'existing': 1})
    _, compiled = run(request, library)
    assert "Apart from the requested clothing, keep everything else in <image1> unchanged, including the first " \
        "person's facial identity" in compiled.text
