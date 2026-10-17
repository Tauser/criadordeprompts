import pytest
from pydantic import ValidationError

from prisma_studio.domain.request import Attribute, Request


@pytest.mark.parametrize('data', [
    {'intent': 'set'},
    {'intent': 'transfer'},
    {'intent': 'keep', 'reference_id': 'x'},
    {'intent': 'free', 'value': {'kind': 'text', 'text': 'x'}},
    {'intent': 'set', 'value': {'kind': 'text', 'text': '   '}},
])
def test_attribute_shape_is_enforced(data):
    with pytest.raises(ValidationError):
        Attribute.model_validate(data)


def test_request_rejects_unknown_fields_and_mixed_modes():
    with pytest.raises(ValidationError):
        Request.model_validate({'mode': 'generate', 'surprise': 1})
    with pytest.raises(ValidationError):
        Request(mode='generate', target_id='t')
    with pytest.raises(ValidationError):
        Request(mode='generate', prompt_mode='manual')
    with pytest.raises(ValidationError):
        Request.model_validate({'mode': 'generate', 'output': {'width': 512}})


def test_request_round_trips_through_json():
    request = Request(mode='edit', target_id='t', references=[{'id': 't', 'label': 'alvo'}],
                      attributes={'face': {'intent': 'keep'}}, confirmations=['adults_only'])
    assert Request.model_validate_json(request.model_dump_json()) == request
