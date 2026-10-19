import json
from pathlib import Path

import pytest

from helpers import cat, edit_request, generate_request, keep, run, text
from prisma_studio.domain.catalog import Library
from prisma_studio.domain.compiler import COMPILER_VERSION
from prisma_studio.domain.request import Request
from prisma_studio.domain.verification import checklist


@pytest.mark.parametrize('mode', ['generate', 'edit'])
def test_clothing_can_explicitly_apply_to_both_people(mode, library):
    make = edit_request if mode == 'edit' else generate_request
    assessment, compiled = run(make({'wardrobe': text('a dark wool coat')}, wardrobe_scope='all',
                                    participants={'requested': 2}), library)
    assert assessment.valid
    assert 'Apply the clothing instruction to both people in the scene.' in compiled.text
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
    assert 'The second person has the facial identity, body shape, skin tone and hairstyle' in compiled.text
    assert 'facial identity and background and setting' in compiled.text
    assert compiled.version == COMPILER_VERSION
    without_confirmations = request.model_copy(update={'confirmations': frozenset()})
    denied, result = run(without_confirmations, library)
    assert result is None and {'confirm_adults', 'confirm_consent'} <= {i.code for i in denied.issues}


def test_manual_prompt_remains_literal_and_legacy_requests_still_load(library):
    request = Request(mode='generate', prompt_mode='manual', manual_prompt='Two adults wearing blue coats.',
                      wardrobe_scope='all')
    assert run(request, library)[1].text == request.manual_prompt
    assert Request.model_validate({'mode': 'generate'}).wardrobe_scope == 'primary'
