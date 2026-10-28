"""Who is a woman and who is a man: said once, carried by every list of people, and each body named whole."""
from helpers import cat, codes, edit_request, generate_request, keep, run, text
from prisma_studio.domain import ir

COUPLE = {'participants': {'sexes': ['female', 'male']}}


def test_a_couple_names_each_body_before_and_after_the_action(library):
    _, compiled = run(generate_request({'action': cat('action.hug')}, **COUPLE), library)
    prompt = compiled.text
    anchor = 'The first person is a woman and the second person is a man.'
    assert anchor in prompt and prompt.index(anchor) < prompt.index('Action:')
    assert 'The people performing this action are the first person (a woman) and the second person (a man)' in prompt
    assert 'exactly two distinct people, one woman and one man, and no one else' in prompt
    assert "The first person has a woman's body throughout: a female face, chest and hips." in prompt
    assert "The second person has a man's body throughout: a male face, chest and hips." in prompt
    assert 'Where the bodies touch or overlap, each body keeps its own anatomy.' in prompt
    assert 'genitals' not in prompt                    # the standard mode leaves them out


def test_the_adult_mode_names_the_genitals(library):
    request = generate_request({'action': cat('action.hug')}, content_mode='adult', **COUPLE,
                               confirmations=['adults_only', 'consent_or_fictional'])
    _, compiled = run(request, library)
    assert 'a female face, breasts, hips and genitals' in compiled.text
    assert 'a male face, a flat male chest, male hips and male genitals' in compiled.text


def test_without_sexes_the_prompt_is_unchanged(library):
    _, compiled = run(generate_request({'action': cat('action.hug')}), library)
    assert not any(isinstance(b, ir.Sexes) for b in compiled.blocks)
    assert 'woman' not in compiled.text
    assert 'Where the bodies touch' not in compiled.text
    assert 'the first person and the second person' in compiled.text


def test_only_the_known_sexes_are_said_and_the_count_stays_plain(library):
    request = generate_request({'action': cat('action.hug')}, participants={'sexes': [None, 'male']})
    _, compiled = run(request, library)
    assert 'The second person is a man.' in compiled.text
    assert 'the first person and the second person (a man)' in compiled.text
    assert 'exactly two distinct people and no one else' in compiled.text
    assert "The second person has a man's body throughout" in compiled.text and 'woman' not in compiled.text


def test_two_women_are_counted_as_two_women(library):
    request = generate_request({'action': cat('action.hug')}, participants={'sexes': ['female', 'female']})
    _, compiled = run(request, library)
    assert 'exactly two distinct people, two women, and no one else' in compiled.text


def test_one_person_gets_no_sex_sentence(library):
    _, compiled = run(generate_request({'pose': cat('pose.standing')}, participants={'sexes': ['female']}), library)
    assert 'woman' not in compiled.text


def test_an_added_character_is_introduced_with_their_sex(library):
    attributes = {c: keep() for c in ('face', 'body', 'skin', 'hair', 'environment')}
    attributes['action'] = cat('action.hug')
    request = edit_request(attributes, references=(('t', 'alvo'), ('p', 'pessoa')),
                           characters=[{'reference_id': 'p'}], participants={'existing': 1, 'sexes': ['female', 'male']})
    _, compiled = run(request, library)
    assert 'Add a second person, a man, to the scene' in compiled.text
    assert compiled.text.index('The first person is a woman') < compiled.text.index('Add a second person')


def test_clothing_for_a_mixed_couple_fits_each_body(library):
    request = generate_request({'wardrobe': text('linen summer clothes'), 'action': cat('action.hug')},
                               wardrobe_scope='all', **COUPLE)
    _, compiled = run(request, library)
    assert 'Each person wears it in the version that fits their own body.' in compiled.text
    same = generate_request({'wardrobe': text('linen summer clothes'), 'action': cat('action.hug')},
                            wardrobe_scope='all', participants={'sexes': ['female', 'female']})
    assert 'version that fits' not in run(same, library)[1].text


def test_a_group_move_without_everyones_sex_warns(library):
    missing, _ = run(generate_request({'action': cat('action.hug')}, participants={'sexes': ['female']}), library)
    assert 'sex_unknown' in codes(missing, 'warning')
    given, _ = run(generate_request({'action': cat('action.hug')}, **COUPLE), library)
    assert 'sex_unknown' not in codes(given)
    alone, _ = run(generate_request({'pose': cat('pose.standing')}), library)
    assert 'sex_unknown' not in codes(alone)
