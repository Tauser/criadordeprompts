import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from helpers import cat, edit_request, generate_request, keep, run
from prisma_studio.domain.catalog import Item, Library
from prisma_studio.domain.verification import checklist


def instruction_item(**changes):
    return Item(id='wardrobe.custom', category='wardrobe', label='Roupa personalizada',
                prompt='a dark wool coat', edit_prompt='Replace the jacket with a dark wool coat', **changes)


def test_full_edit_instruction_is_used_once_without_category_wrapper():
    item = instruction_item()
    library = Library(items=[item])
    _, compiled = run(edit_request({'wardrobe': cat(item.id), 'face': keep()}), library)
    assert 'Replace the jacket with a dark wool coat.' in compiled.text
    assert 'Change the clothing to' not in compiled.text
    assert compiled.text.count(item.edit_prompt) == 1
    assert 'Keep the facial identity from the image unchanged.' in compiled.text
    assert item.edit_prompt in checklist(compiled.blocks)[0].question


def test_generation_uses_description_instead_of_edit_instruction():
    item = instruction_item()
    _, compiled = run(generate_request({'wardrobe': cat(item.id)}), Library(items=[item]))
    assert 'Clothing: a dark wool coat.' in compiled.text
    assert item.edit_prompt not in compiled.text


def test_legacy_item_keeps_its_existing_edit_template():
    item = instruction_item().model_copy(update={'edit_prompt': None})
    _, compiled = run(edit_request({'wardrobe': cat(item.id)}), Library(items=[item]))
    assert 'Replace the current clothing with a dark wool coat; the original outfit is no longer worn.' in compiled.text


def test_replacing_a_person_while_keeping_face_is_reported_without_silent_changes(library):
    request = edit_request({'subject': cat('subject.woman'), 'face': keep()})
    assessment, compiled = run(request, library)
    issue = next(issue for issue in assessment.issues if issue.code == 'replace_person_keep_identity')
    assert issue.level == 'warning' and assessment.valid
    assert 'Replace the person' in compiled.text
    assert 'Keep the facial identity' in compiled.text


def test_instruction_metadata_does_not_remove_adult_confirmations():
    item = instruction_item(adult=True)
    request = edit_request({'wardrobe': cat(item.id)}, content_mode='adult')
    assessment, compiled = run(request, Library(items=[item]))
    assert compiled is None
    assert {'confirm_adults', 'confirm_consent'} <= {issue.code for issue in assessment.issues}


@pytest.mark.parametrize('value', ['', '   ', 'x' * 2001])
def test_empty_or_oversized_edit_instruction_is_rejected(value):
    with pytest.raises(ValidationError):
        Item.model_validate({**instruction_item().model_dump(), 'edit_prompt': value})


def test_default_adult_options_are_only_between_adults():
    data = json.loads((Path(__file__).resolve().parents[2] / 'catalog/defaults.json').read_text(encoding='utf-8'))
    adult = [item for item in Library.model_validate(data).items if item.adult]
    young = re.compile(r'(?:child|children|kid|kids|toddler|baby|teen|teenager|minor|young girl|young boy|school)', re.I)
    assert not [item.id for item in adult if young.search(item.prompt) or young.search(item.label)]
    assert all(item.category == 'action' and 'adults' in item.prompt and (item.requirements.participants or 0) >= 2
               for item in adult)
