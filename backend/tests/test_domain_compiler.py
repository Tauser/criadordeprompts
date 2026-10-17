import random

import pytest

from helpers import cat, codes, edit_request, generate_request, keep, ref, run, text
from kppb.domain import ir
from kppb.domain.compiler import CompileError, compile_request
from kppb.domain.request import Request
from kppb.domain.rules import assess
from kppb.domain.vocabulary import CATEGORIES

IDENTITY = ('face', 'body', 'skin', 'hair')
DEFAULT_KEEP = {c: keep() for c in ('face', 'body', 'skin', 'hair', 'wardrobe', 'environment', 'lighting', 'style')}


def test_character_reference_is_one_transfer_without_contradiction(library):
    attributes = {**DEFAULT_KEEP, 'environment': cat('env.garden'), **{c: ref('p') for c in IDENTITY}}
    assessment, compiled = run(edit_request(attributes, references=(('t', 'alvo'), ('p', 'personagem'))), library)
    transfers = [b for b in compiled.blocks if isinstance(b, ir.Transfer)]
    assert transfers == [ir.Transfer(2, IDENTITY)]
    assert 'Replace the background and setting with a quiet garden.' in compiled.text
    assert 'Take the facial identity, body shape and proportions, skin tone and texture, and hairstyle and hair color ' \
           'from <image2>' in compiled.text
    assert 'copy' not in compiled.text.lower()
    keep_block = next(b for b in compiled.blocks if isinstance(b, ir.Keep))
    assert not set(keep_block.aspects) & set(IDENTITY)


def test_single_image_edit_uses_no_tags_and_one_general_preservation_clause(library):
    _, compiled = run(edit_request({**DEFAULT_KEEP, 'environment': cat('env.garden')}), library)
    assert '<image' not in compiled.text
    assert compiled.text.splitlines()[0] == 'Edit the image.'
    keep_lines = [line for line in compiled.text.splitlines() if line.startswith('Keep')]
    assert len(keep_lines) == 1


def test_free_attributes_disable_the_everything_else_clause(library):
    _, compiled = run(edit_request({'face': keep(), 'environment': cat('env.garden')}), library)
    assert 'Keep the facial identity from the image unchanged.' in compiled.text
    assert 'everything else' not in compiled.text


def test_catalog_and_text_sources_produce_the_same_structure(library):
    via_catalog = run(edit_request({**DEFAULT_KEEP, 'pose': cat('pose.standing')}), library)[1]
    via_text = run(edit_request({**DEFAULT_KEEP, 'pose': text('standing relaxed')}), library)[1]

    def kinds(compiled):
        return [(type(b).__name__, getattr(b, 'category', None)) for b in compiled.blocks if not isinstance(b, ir.Guidance)]
    assert kinds(via_catalog) == kinds(via_text)


def _blocks_without(compiled, kinds):
    return [b for b in compiled.blocks if not isinstance(b, kinds)]


def _random_requests(library, count=300):
    rng = random.Random(7)
    choices = {
        'environment': ['env.garden', 'env.studio'], 'pose': ['pose.seated', 'pose.standing'],
        'action': ['action.read', 'action.hug'], 'lighting': ['light.soft'], 'style': ['style.ink', 'style.real'],
    }
    for _ in range(count):
        mode = rng.choice(['edit', 'generate'])
        attributes = {}
        for category in CATEGORIES:
            options = ['free', 'text'] + (['keep', 'transfer'] if mode == 'edit' else [])
            if category in choices:
                options.append('catalog')
            pick = rng.choice(options)
            if pick == 'keep':
                attributes[category] = keep()
            elif pick == 'transfer':
                attributes[category] = ref('r')
            elif pick == 'text':
                attributes[category] = text(f'custom {category}')
            elif pick == 'catalog':
                attributes[category] = cat(rng.choice(choices[category]))
        extra = {'context': {'allow_new_supports': True}}
        if mode == 'edit':
            yield edit_request(attributes, references=(('t', 'alvo'), ('r', 'ref')), **extra)
        else:
            attributes = {k: v for k, v in attributes.items() if v['intent'] in ('set', 'free')}
            yield generate_request(attributes, **extra)


def test_details_never_remove_or_change_other_blocks(library):
    checked = 0
    for request in _random_requests(library):
        assessment, base = run(request, library)
        if base is None:
            continue
        with_details = Request.model_validate({**request.model_dump(), 'details': 'a red scarf'})
        _, compiled = run(with_details, library)
        assert _blocks_without(compiled, ir.Details) == list(base.blocks)
        checked += 1
    assert checked > 100


def test_adult_classification_never_changes_other_blocks(library):
    base_request = edit_request({**DEFAULT_KEEP, 'environment': cat('env.garden'), 'lighting': cat('light.soft')})
    _, base = run(base_request, library)
    adult = Request.model_validate({**base_request.model_dump(), 'content_mode': 'adult'})
    _, compiled = run(adult, library)
    assert compiled.text == base.text
    with_item = Request.model_validate({**adult.model_dump(), 'attributes': {**adult.model_dump()['attributes'],
                                        'pose': cat('pose.adult')},
                                        'confirmations': ['adults_only', 'consent_or_fictional']})
    _, compiled = run(with_item, library)
    for line in base.text.splitlines():
        if not line.startswith('Keep'):
            assert line in compiled.text


def test_no_aspect_is_both_kept_and_changed_in_random_requests(library):
    for request in _random_requests(library):
        assessment, compiled = run(request, library)
        if compiled is None:
            continue
        changed = {b.category for b in compiled.blocks if isinstance(b, ir.Operation)}
        changed |= {a for b in compiled.blocks if isinstance(b, ir.Transfer) for a in b.aspects}
        kept = {a for b in compiled.blocks if isinstance(b, ir.Keep) for a in b.aspects}
        assert not changed & kept


def test_every_block_is_rendered_and_missing_renderings_fail(library):
    request = generate_request({'subject': cat('subject.woman'), 'pose': cat('pose.seated'), 'action': cat('action.read')})
    assessment = assess(request, library)
    compiled = compile_request(request, assessment)
    assert {b.id for b in compiled.blocks} <= {s for s, _ in compiled.segments}
    with pytest.raises(CompileError):
        compile_request(request, assessment, renderer=lambda blocks: [('header', 'Create an image.')])


def test_generation_text_is_deterministic_and_style_leads(library):
    request = generate_request({'style': cat('style.ink'), 'subject': cat('subject.woman'),
                                'environment': cat('env.garden'), 'pose': cat('pose.seated'),
                                'action': cat('action.read')}, details='a red scarf')
    first = run(request, library)[1].text
    assert first == run(request, library)[1].text
    lines = first.splitlines()
    assert lines[:2] == ['Create an image.', 'Visual style: black ink illustration.']
    for expected in ('The posture is clearly seated, with the hips supported.', 'The eyes look downwards.',
                     'Show the entire body, including hands and feet.', 'Additional details: a red scarf.'):
        assert expected in lines


def test_manual_prompt_is_literal(library):
    request = Request(mode='generate', prompt_mode='manual', manual_prompt='  anything at all  ')
    assessment, compiled = run(request, library)
    assert compiled.text == 'anything at all'
    assert codes(assessment) == ['manual_text']


@pytest.mark.parametrize('attributes, expected', [
    ({'expression': cat('expr.closed'), 'action': cat('action.camera')}, 'conflicting_gaze'),
    ({'pose': cat('pose.seated'), 'action': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'pose.standing'}}},
     'wrong_category'),
    ({'lighting': cat('disabled.light')}, 'disabled_item'),
    ({'lighting': cat('nope')}, 'missing_item'),
    ({'pose': cat('pose.adult')}, 'adult_mode_required'),
    ({'face': ref('t')}, 'transfer_from_target'),
    ({'face': ref('ghost')}, 'missing_reference'),
    ({}, 'missing_change'),
])
def test_blocking_rules(library, attributes, expected):
    assessment = assess(edit_request(attributes), library)
    assert expected in codes(assessment, 'error')
    assert not assessment.valid


def test_policy_confirmations_for_adult_options(library):
    base = {'pose': cat('pose.adult')}
    generation = generate_request(base, content_mode='adult')
    assert 'confirm_adults' in codes(assess(generation, library), 'error')
    ok = generate_request(base, content_mode='adult', confirmations=['adults_only'])
    assert assess(ok, library).valid
    edit = edit_request(base, content_mode='adult', confirmations=['adults_only'])
    assert 'confirm_consent' in codes(assess(edit, library), 'error')
    edit_ok = edit_request(base, content_mode='adult', confirmations=['adults_only', 'consent_or_fictional'])
    assert assess(edit_ok, library).valid


def test_slots_put_target_first_and_drop_unused_references(library):
    request = edit_request({'face': ref('b'), 'environment': ref('c')},
                           references=(('t', 'alvo'), ('a', 'sobra'), ('b', 'rosto'), ('c', 'cenário')))
    assessment, compiled = run(request, library)
    assert assessment.slots == {'t': 1, 'b': 2, 'c': 3}
    assert 'unused_reference' in codes(assessment, 'warning')
    assert '<image2>' in compiled.text and '<image3>' in compiled.text and '<image4>' not in compiled.text


def test_participants_and_framing(library):
    request = edit_request({**DEFAULT_KEEP, 'action': cat('action.hug')}, participants={'existing': 1})
    _, compiled = run(request, library)
    assert 'at least 2 distinct people' in compiled.text
    locked = edit_request({'pose': cat('pose.seated'), 'framing': keep()},
                          context={'original_framing': 'portrait', 'allow_new_supports': True})
    assert 'framing_too_small' in codes(assess(locked, library), 'error')
    explicit = generate_request({'pose': cat('pose.seated'), 'framing': cat('frame.portrait')})
    assert 'framing_too_small' in codes(assess(explicit, library), 'error')


def test_kept_pose_with_action_allows_movement(library):
    _, compiled = run(edit_request({**DEFAULT_KEEP, 'pose': keep(), 'action': cat('action.read')}), library)
    assert 'body pose, apart from the movement the action needs' in compiled.text


def test_supports(library):
    unknown = edit_request({**DEFAULT_KEEP, 'pose': cat('pose.seated')})
    assert 'unknown_support' in codes(assess(unknown, library), 'unknown')
    missing = edit_request({'pose': cat('pose.seated'), 'environment': cat('env.studio')})
    assert 'missing_support' in codes(assess(missing, library), 'error')
    allowed = edit_request({'pose': cat('pose.seated'), 'environment': cat('env.studio')},
                           context={'allow_new_supports': True})
    assert assess(allowed, library).valid
