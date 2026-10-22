import random

import pytest

from helpers import cat, codes, edit_request, generate_request, keep, ref, run, text
from prisma_studio.domain import ir
from prisma_studio.domain.compiler import CompileError, compile_request
from prisma_studio.domain.request import Request
from prisma_studio.domain.rules import assess
from prisma_studio.domain.vocabulary import CATEGORIES

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


def test_pose_and_action_are_rendered_as_explicit_body_instructions(library):
    _, compiled = run(edit_request({**DEFAULT_KEEP, 'pose': cat('pose.seated'), 'action': cat('action.read')},
                                   context={'allow_new_supports': True}), library)
    assert 'Change the body pose to sitting upright. Reposition the head, torso, arms, hands, legs and feet' in compiled.text
    assert 'Show the person reading a book; keep the requested pose for the torso and legs, and let the arms and hands follow this action. Make the hands' in compiled.text
    _, group = run(generate_request({'action': cat('action.hug')}), library)
    assert 'Action: hugging each other. Make the hands' in group.text
    _, edit_group = run(edit_request({**DEFAULT_KEEP, 'action': cat('action.hug')}, participants={'existing': 1}), library)
    assert 'Show hugging each other.' in edit_group.text and 'the person hugging' not in edit_group.text


def test_kept_expression_yields_to_a_declared_gaze(library):
    _, compiled = run(edit_request({**DEFAULT_KEEP, 'expression': keep(), 'action': cat('action.read')}), library)
    assert 'facial expression, apart from the requested gaze direction' in compiled.text
    assert 'The eyes look downwards.' in compiled.text


def test_kept_expression_yields_to_what_the_action_shows_on_the_face(library):
    # Measured: "both smiling" in a high five stayed serious while the expression was kept as a whole.
    _, compiled = run(edit_request({**DEFAULT_KEEP, 'expression': keep(), 'action': cat('action.hug')},
                                   participants={'existing': 2}), library)
    assert 'facial expression, apart from what the action shows on the face' in compiled.text
    _, still = run(edit_request({**DEFAULT_KEEP, 'expression': keep(), 'pose': cat('pose.standing'),
                                 'environment': cat('env.studio')}), library)
    assert 'facial expression' in still.text and 'apart from what the action' not in still.text


def test_second_character_comes_from_its_own_reference(library):
    request = generate_request({'subject': cat('subject.woman'), 'environment': cat('env.garden')},
                               references=[{'id': 'a', 'label': 'Ana'}, {'id': 'b', 'label': 'Bia'}],
                               characters=[{'reference_id': 'b', 'description': 'standing on the left'}])
    request = request.model_copy(update={'attributes': {**request.attributes, 'face': Request.model_validate(
        {'mode': 'generate', 'attributes': {'face': ref('a')}}).attributes['face']}})
    assessment, compiled = run(request, library)
    assert assessment.valid
    assert assessment.slots == {'a': 1, 'b': 2}
    assert assessment.participants_total == 2
    assert ir.Character(2, 2, 'standing on the left') in compiled.blocks
    assert 'Use <image1> as the reference for the facial identity of the first person.' in compiled.text
    assert ("The second person has the facial identity, body shape, skin tone and hairstyle of the person in <image2>; "
            "use <image2> only for this person's identity. The second person: standing on the left.") in compiled.text
    assert 'The scene contains 2 distinct people' in compiled.text


def test_second_character_in_an_edit_counts_as_a_change(library):
    request = edit_request({**DEFAULT_KEEP, 'framing': keep()}, references=(('t', 'alvo'), ('b', 'Bia')),
                           characters=[{'reference_id': 'b'}],
                           context={'allow_reframing': True})
    assessment, compiled = run(request, library)
    assert 'missing_change' not in codes(assessment)
    assert assessment.slots == {'t': 1, 'b': 2}
    # Not in the photo yet: the person is added, never swapped onto the first person's face.
    assert 'Add a second person to the scene, next to the first person' in compiled.text
    assert 'takes no facial features from <image2>' in compiled.text
    # Measured: otherwise the head comes straight from the reference, with its angle and light, and looks pasted on.
    assert ('Draw the second person anew in this scene: their head turns and tilts with their own body, sits '
            'naturally') in compiled.text
    assert 'never its head angle, facial expression, lighting or framing' in compiled.text
    assert "the first person's facial identity" in compiled.text
    assert 'Widen the framing only as much as needed' in compiled.text and 'framing and crop' not in compiled.text
    # Both already in the photo: the character only gives the second person an identity.
    present = request.model_copy(update={'participants': request.participants.model_copy(update={'existing': 2})})
    _, compiled = run(present, library)
    assert 'The second person has the facial identity' in compiled.text and 'Add a second' not in compiled.text
    assert 'Draw the second person anew' not in compiled.text
    locked = request.model_copy(update={'context': request.context.model_copy(update={'allow_reframing': False})})
    assert 'framing and crop' in run(locked, library)[1].text


def test_character_reference_rules(library):
    target = edit_request(dict(DEFAULT_KEEP), characters=[{'reference_id': 't'}])
    assert 'character_is_target' in codes(assess(target, library), 'error')
    missing = generate_request({}, characters=[{'reference_id': 'x'}])
    assert 'missing_reference' in codes(assess(missing, library), 'error')
    twice = generate_request({}, references=[{'id': 'b', 'label': 'Bia'}],
                             characters=[{'reference_id': 'b'}, {'reference_id': 'b'}])
    assert 'duplicate_character' in codes(assess(twice, library), 'error')


def test_adult_content_with_person_photos_needs_the_consent_confirmation(library):
    request = generate_request({'pose': cat('pose.adult')}, content_mode='adult', confirmations=['adults_only'],
                               references=[{'id': 'b', 'label': 'Bia'}], characters=[{'reference_id': 'b'}])
    assert 'confirm_consent' in codes(assess(request, library), 'error')
    confirmed = request.model_copy(update={'confirmations': frozenset({'adults_only', 'consent_or_fictional'})})
    assert 'confirm_consent' not in codes(assess(confirmed, library))
    without_photos = generate_request({'pose': cat('pose.adult')}, content_mode='adult', confirmations=['adults_only'])
    assert 'confirm_consent' not in codes(assess(without_photos, library))


BASE_SCENE = {'subject': cat('subject.woman'), 'environment': cat('env.garden')}


@pytest.mark.parametrize('description, warns', [
    ('short blond hair, blue eyes', True),
    ('olhos verdes e barba', True),
    ('wearing a red coat, standing on the left', False),
])
def test_face_described_for_a_character_with_a_reference(library, description, warns):
    request = generate_request(BASE_SCENE, references=[{'id': 'b', 'label': 'Bia'}],
                               characters=[{'reference_id': 'b', 'description': description}])
    assessment = assess(request, library)
    assert assessment.valid
    assert ('face_described' in codes(assessment, 'warning')) is warns


def test_face_described_warning_quotes_the_words_and_never_blocks(library):
    request = generate_request(BASE_SCENE, references=[{'id': 'b', 'label': 'Bia'}],
                               characters=[{'reference_id': 'b', 'description': 'short blond hair, blue eyes'}])
    assessment = assess(request, library)
    issue = next(i for i in assessment.issues if i.code == 'face_described')
    assert issue.field == 'characters.0' and issue.level == 'warning'
    assert '"short blond hair"' in issue.message
    assert run(request, library)[1] is not None


def test_face_transfer_with_face_text_in_another_attribute_warns(library):
    request = generate_request({'face': ref('b'), 'subject': text('a woman with green eyes')},
                               references=[{'id': 'b', 'label': 'Bia'}])
    assessment = assess(request, library)
    assert assessment.valid
    assert 'face_described' in codes(assessment, 'warning')
    assert next(i for i in assessment.issues if i.code == 'face_described').field == 'attributes.subject'


def test_hair_transfer_with_face_text_in_details_warns(library):
    request = generate_request({'hair': ref('b'), 'environment': cat('env.garden')},
                               references=[{'id': 'b', 'label': 'Bia'}], details='barba e sardas')
    assessment = assess(request, library)
    assert 'face_described' in codes(assessment, 'warning')
    assert next(i for i in assessment.issues if i.code == 'face_described').field == 'details'


def test_face_described_without_a_reference_providing_identity_does_not_warn(library):
    own_text = generate_request({**BASE_SCENE, 'face': text('blue eyes, short blond hair')})
    assert 'face_described' not in codes(assess(own_text, library))
    missing = generate_request(BASE_SCENE, characters=[{'reference_id': 'x', 'description': 'blue eyes'}])
    assessment = assess(missing, library)
    assert 'missing_reference' in codes(assessment, 'error')
    assert 'face_described' not in codes(assessment)
    transfer_only = generate_request({**BASE_SCENE, 'face': ref('b')}, references=[{'id': 'b', 'label': 'Bia'}])
    assert 'face_described' not in codes(assess(transfer_only, library))


def test_a_pose_that_names_the_chin_or_lips_is_not_a_described_face(library):
    # Poses name these parts for position, not identity; a warning here would be noise.
    request = generate_request({'face': ref('b'), 'pose': text('sitting with the chin lifted and the lips parted')},
                               references=[{'id': 'b', 'label': 'Bia'}])
    assert 'face_described' not in codes(assess(request, library))
