"""The prompts of the case bank, compiled with the real catalog: who is who, and nobody more than asked for."""
import json
import sys
from pathlib import Path

import pytest

from prisma_studio.domain.catalog import Library
from prisma_studio.domain.compiler import compile_request
from prisma_studio.domain.request import Request
from prisma_studio.domain.rules import assess

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import banco_de_casos  # noqa: E402

SPEC = json.loads((ROOT / 'benchmark' / 'casos.json').read_text(encoding='utf-8'))
LIBRARY = Library.model_validate_json((ROOT / 'catalog' / 'defaults.json').read_text(encoding='utf-8'))


def compiled(case):
    request = Request.model_validate(banco_de_casos.build(SPEC, case, SPEC['seeds'][0])[0])
    assessment = assess(request, LIBRARY)
    assert assessment.valid, [i.message for i in assessment.issues if i.level == 'error']
    return assessment, compile_request(request, assessment).text


def first_line(lines, *needles):
    return next((i for i, line in enumerate(lines) if any(n in line for n in needles)), None)


@pytest.mark.parametrize('case', SPEC['casos'], ids=lambda c: c['nome'].split()[0])
def test_every_case_names_its_people_and_asks_for_no_one_more(case):
    assessment, text = compiled(case)
    lines = text.splitlines()
    total = assessment.participants_total or 1
    assert 'at least' not in text
    if total == 1:
        assert 'second person' not in text
        return
    # The first person is named no later than the second, so "the first person" never points at nobody.
    second = first_line(lines, 'second person')
    if second is not None:
        assert first_line(lines, 'first person') <= second
    # Nobody beyond the people asked for: an exact count, or each missing person added by name.
    added = sum(f'Add a {o} person' in text for o in ('second', 'third', 'fourth'))
    assert 'and no one else' in text or added + (case.get('pessoas') or 0) == total
    if 'principal' in case:
        lead = first_line(lines, 'of the first person', 'apply them to the first person')
        # The opening line of an edit that adds people only counts them; the second person is described later.
        described = first_line(lines[1:], 'second person') + 1
        assert lead is not None and lead < described
        assert 'keeps their own face' not in text           # the first person's face comes from their ficha


def test_a_group_from_the_catalog_alone_is_two_different_people():
    case = next(c for c in SPEC['casos'] if c['nome'].startswith('15 '))
    _, text = compiled(case)
    assert 'The first person: one fictional adult woman' in text
    assert 'look clearly different from each other' in text
    assert "The first person's hair:" in text and '\nHair:' not in text
    assert 'taking its roles in the order it describes them' in text


def test_an_edit_that_needs_someone_new_says_so():
    case = next(c for c in SPEC['casos'] if c['nome'].startswith('18 '))
    request = Request.model_validate(banco_de_casos.build(SPEC, case, 3)[0])
    assert 'invented_people' in [i.code for i in assess(request, LIBRARY).issues if i.level == 'warning']
