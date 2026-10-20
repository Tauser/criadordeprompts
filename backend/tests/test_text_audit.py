from conftest import item
from fastapi.testclient import TestClient

from fakes import FakeComfy
from helpers import cat, codes, generate_request, run
from prisma_studio.api.app import Container, create_app
from prisma_studio.config import Config
from prisma_studio.domain.catalog import Library
from prisma_studio.domain.text_audit import audit_item, contradictions_in_prompt
from test_api import CATALOG, NoProgress


def found(item_):
    return {f.code for f in audit_item(item_)}


def test_limb_counting_that_can_add_a_leg_is_flagged():
    assert 'ambiguous_limbs' in found(item('pose.a', 'pose', 'standing with one leg forward and the other leg back',
                                           req={'participants': 1}))
    assert 'both_and_one' in found(item('pose.b', 'pose', 'lying with both legs apart and one leg raised high up',
                                        req={'participants': 1}))
    assert not found(item('pose.c', 'pose', 'standing with the right leg forward and the left leg back, relaxed',
                          req={'participants': 1}, prompt_pt='em pé'))


def test_text_that_contradicts_its_metadata_is_flagged():
    fours = item('pose.d', 'pose', 'resting on hands and knees with the back flat and the head in line with the spine',
                 req={'participants': 1, 'posture': 'kneeling', 'orientation': 'back', 'support_any_of': ('bed',)})
    assert {'posture_words', 'fixed_head'} <= found(fours)
    kneel = item('pose.e', 'pose', 'kneeling upright with the shins flat on the ground behind the body',
                 req={'participants': 1, 'posture': 'kneeling', 'support_any_of': ('floor', 'bed')})
    assert 'surface_narrower' in found(kneel)
    chair = item('pose.f', 'pose', 'sitting on a chair with both feet flat on the floor and hands on the knees',
                 req={'participants': 1, 'posture': 'seated', 'support_any_of': ('seat',)})
    assert not {'surface_not_declared', 'surface_narrower'} & found(chair)       # feet on the floor are expected



def test_children_in_the_text_must_be_declared():
    undeclared = item('action.k', 'action', 'two adults swinging a small child between them by the hands',
                      req={'participants': 3}, prompt_pt='x')
    assert 'children_not_declared' in found(undeclared)
    declared = item('action.l', 'action', 'two adults swinging a small child between them by the hands',
                    req={'participants': 3, 'children': True}, prompt_pt='x')
    assert 'children_not_declared' not in found(declared)

def test_wording_habits_from_other_models_are_flagged():
    style = item('style.x', 'style', 'photo, (masterpiece:1.2), best quality')
    assert 'sd_syntax' in found(style)
    assert 'second_person' in found(item('pose.g', 'pose', 'lying on your back with your arms wide open to the sides',
                                         req={'participants': 1}))
    assert 'capitalized' not in found(item('light.r', 'lighting', 'Rembrandt lighting from one side', prompt_pt='x'))


def test_compiled_prompts_with_a_fixed_head_and_a_turn_are_caught():
    text = 'Pose: standing with the head straight.\nThe head turns to look back over the shoulder.'
    assert contradictions_in_prompt(text)
    library = Library(items=[
        item('pose.stand', 'pose', 'standing with the arms relaxed and the head straight',
             req={'participants': 1, 'posture': 'standing', 'gaze': 'any'}),
        item('expr.shoulder', 'expression', 'looking over the shoulder', req={'gaze': 'back'}),
    ])
    assessment, _ = run(generate_request({'pose': cat('pose.stand'), 'expression': cat('expr.shoulder')}), library)
    assert 'head_fixed_by_pose' in codes(assessment, 'warning')


def test_audit_endpoint_reviews_an_unsaved_item(tmp_path):
    config = Config(data_dir=tmp_path, catalog_path=CATALOG, frontend_dir=tmp_path / 'none', start_workers=False)
    with TestClient(create_app(config, Container(config, comfy=FakeComfy(), progress=NoProgress()))) as client:
        body = {'id': 'user.pose.x', 'category': 'pose', 'label': 'Teste', 'prompt': 'lying on your back',
                'requirements': {'participants': 1}}
        codes_found = {f['code'] for f in client.post('/api/library/audit', json=body).json()['findings']}
        assert {'second_person', 'too_vague', 'missing_pt'} <= codes_found


def test_the_shipped_catalog_has_no_contradictory_or_ambiguous_wording():
    import json
    data = json.loads(CATALOG.read_text(encoding='utf-8'))
    problems = {i.id: [f.code for f in audit_item(i) if f.level in ('conflict', 'ambiguity')]
                for i in Library.model_validate(data).items}
    assert {k: v for k, v in problems.items() if v} == {}


def test_clothing_written_for_one_person_is_flagged():
    single = item('wardrobe.s', 'wardrobe', 'a long red dress', prompt_pt='x',
                  edit_prompt='Dress the adult fictional character in a long red dress.')
    assert 'single_person' in found(single)
    neutral = item('wardrobe.n', 'wardrobe', 'a long red dress', prompt_pt='x',
                   edit_prompt='Change the clothing to a long red dress.')
    assert 'single_person' not in found(neutral)
