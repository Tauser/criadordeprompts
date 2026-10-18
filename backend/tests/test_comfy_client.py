import httpx
import pytest

from prisma_studio.infrastructure.comfy.client import ComfyClient, ComfyRejected, ComfyUnavailable


@pytest.mark.parametrize('status, body', [(200, 'not json'), (200, 'null'), (200, '[]'), (200, '{}'),
                                        (200, '{"prompt_id":"another-id"}'), (500, 'internal error'),
                                        (502, '{}'), (408, 'timeout')])
def test_ambiguous_submit_answer_remains_unconfirmed(status, body):
    http = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(status, text=body)))
    with http:
        client = ComfyClient(http=http)
        with pytest.raises(ComfyUnavailable):
            client.submit({}, 'chosen-id')


def test_definitive_refusal_does_not_become_an_uncertain_submission():
    http = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(400, json={'error': 'bad graph'})))
    with http, pytest.raises(ComfyRejected):
        ComfyClient(http=http).submit({}, 'chosen-id')


def test_success_keeps_the_id_used_for_reconciliation():
    http = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'prompt_id': 'chosen-id'})))
    with http:
        assert ComfyClient(http=http).submit({}, 'chosen-id') == 'chosen-id'


@pytest.mark.parametrize('status, body', [(503, 'unavailable'), (200, 'not-json'), (200, 'null')])
def test_observation_failure_remains_retryable_instead_of_failing_the_run(status, body):
    http = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(status, text=body)))
    with http, pytest.raises(ComfyUnavailable):
        ComfyClient(http=http).job('accepted-job')
