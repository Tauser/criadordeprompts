"""Options for two or more people that name their roles: who takes which is said outright, and can be swapped."""
import pytest
from conftest import item
from helpers import cat, codes, edit_request, generate_request, keep, run

from prisma_studio.domain.catalog import Library
from prisma_studio.domain.request import Request
from prisma_studio.domain.text_audit import audit_item

RIDE = dict(req={'participants': 2, 'posture': 'any', 'gaze': 'any'},
            roles=({'label': 'quem carrega', 'name': 'the carrier'}, {'label': 'quem monta', 'name': 'the rider'}))


def _library(**extra):
    return Library(items=[
        item('action.ride', 'action', 'two adults in a piggyback ride: the carrier bends forward and holds the knees '
             "of the rider, who sits high on the carrier's back", **{**RIDE, **extra}),
        item('action.hug', 'action', 'two adults hugging, the adult on the left resting the head on the shoulder of '
             'the adult on the right', req={'participants': 2, 'posture': 'any', 'gaze': 'any'}),
    ])


def test_named_roles_are_given_person_by_person_instead_of_by_order():
    text = run(generate_request({'action': cat('action.ride')}), _library())[1].text
    assert ('The people performing this action are the first person, as the carrier, and the second person, as the '
            'rider.') in text
    assert 'taking its roles in the order' not in text


def test_the_person_can_swap_who_takes_which_role():
    request = generate_request({'action': cat('action.ride')}, role_order=(1, 0))
    text = run(request, _library())[1].text
    assert 'the first person, as the rider, and the second person, as the carrier' in text


def test_an_order_that_does_not_fit_the_option_is_ignored():
    # A choice kept from another option with more roles: the option's own order is used.
    text = run(generate_request({'action': cat('action.ride')}, role_order=(2, 0, 1)), _library())[1].text
    assert 'the first person, as the carrier, and the second person, as the rider' in text
    with pytest.raises(ValueError):
        Request(mode='generate', role_order=(0, 0))


def test_without_named_roles_the_order_of_the_text_still_decides():
    text = run(generate_request({'action': cat('action.hug')}), _library())[1].text
    assert 'the first person and the second person, taking its roles in the order it describes them' in text


def test_named_roles_need_no_position_to_tell_who_is_who():
    library = Library(items=[
        *_library().items,
        item('pose.left', 'pose', 'two adults side by side, the adult on the left leaning on the adult on the right',
             req={'participants': 2, 'posture': 'standing', 'gaze': 'any'},
             roles=({'label': 'quem se apoia', 'name': 'the adult on the left'},
                    {'label': 'quem segura', 'name': 'the adult on the right'})),
    ])
    request = edit_request({c: keep() for c in ('face', 'body', 'skin', 'hair')} | {'pose': cat('pose.left')},
                           references=(('t', 'alvo'), ('b', 'Bia')), characters=[{'reference_id': 'b'}],
                           participants={'existing': 2})
    assert 'character_position_needed' not in codes(run(request, library)[0])


def test_roles_must_fit_the_option():
    with pytest.raises(ValueError):
        item('action.solo', 'action', 'waving', req={'participants': 1}, roles=RIDE['roles'][:1])
    with pytest.raises(ValueError):
        item('style.x', 'style', 'ink', roles=RIDE['roles'])
    with pytest.raises(ValueError):
        item('action.three', 'action', 'three adults', req={'participants': 3}, roles=RIDE['roles'])


def test_the_text_review_flags_a_role_its_text_never_names():
    option = item('action.ride', 'action', 'two adults in a piggyback ride', **RIDE)
    assert {f.code for f in audit_item(option)} >= {'role_not_in_text'}
    named = _library().items[0]
    assert 'role_not_in_text' not in {f.code for f in audit_item(named)}
