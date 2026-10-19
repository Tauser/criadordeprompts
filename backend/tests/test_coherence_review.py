import json

from fastapi.testclient import TestClient

from fakes import FakeComfy
from test_api import CATALOG, NoProgress
from prisma_studio.api.app import Container, create_app
from prisma_studio.application.coherence import CoherenceService, parse_review
from prisma_studio.config import Config

ISSUE = {'severity': 'error', 'quote': 'seen from behind', 'problem': 'O corpo está de costas e o rosto de frente.',
         'suggestion': 'Peça o olhar por cima do ombro.'}


def test_parse_review_reads_issues_and_normalises_them():
    answer = '<think>hmm</think> ' + json.dumps({'coherent': True, 'issues': [ISSUE, {'severity': 'fatal',
                                                                                      'problem': 'Outro.'}]})
    review = parse_review(answer)
    assert review['coherent'] is False                     # issues win over a contradictory flag
    assert review['issues'][0] == ISSUE and review['issues'][1]['severity'] == 'warning'


def test_parse_review_keeps_unexpected_answers_for_reading():
    assert parse_review('{"coherent": true, "issues": []}') == {'coherent': True, 'issues': []}
    assert parse_review('Não consigo responder.')['raw'] == 'Não consigo responder.'
    assert parse_review('{"coherent": false, "issues": []}')['coherent'] is None
    assert parse_review('{"issues": "none"}')['coherent'] is None
    joined = parse_review('{"coherent": false, "issues": [{"severity": "error", "quote": "a" and "b", "problem": "x"}]}')
    assert joined['issues'][0]['quote'] == 'a … b'


def test_review_runs_through_the_local_text_model():
    comfy = FakeComfy(text_answer=json.dumps({'coherent': False, 'issues': [ISSUE]}))
    service = CoherenceService(comfy)
    job = service.review('Create an image.')
    graph = comfy.jobs[job['id']]['graph']
    assert graph['90']['inputs']['prompt'].endswith(':\nCreate an image.')
    status = service.status(job['id'])
    while status['status'] in ('queued', 'running'):
        status = service.status(job['id'])
    assert status['status'] == 'completed' and status['result']['issues'] == [ISSUE]


def test_coherence_endpoint_reviews_the_compiled_prompt_and_rejects_invalid_requests(tmp_path):
    comfy = FakeComfy(text_answer='{"coherent": true, "issues": []}')
    config = Config(data_dir=tmp_path, catalog_path=CATALOG, frontend_dir=tmp_path / 'none', start_workers=False)
    with TestClient(create_app(config, Container(config, comfy=comfy, progress=NoProgress()))) as client:
        _check_endpoint(client)


def _check_endpoint(client):
    ok = client.post('/api/coherence', json={'mode': 'generate', 'details': 'a red scarf'})
    assert ok.status_code == 200 and 'a red scarf' in ok.json()['prompt']
    for _ in range(5):
        status = client.get(f'/api/coherence/{ok.json()["id"]}').json()
    assert status['result'] == {'coherent': True, 'issues': []}
    invalid = client.post('/api/coherence', json={'mode': 'generate', 'attributes': {'face': {'intent': 'keep'}}})
    assert invalid.status_code == 422 and invalid.json()['issues']


def test_adult_instructions_stay_out_of_the_review_and_subject_judgements_are_dropped():
    from conftest import item
    from helpers import cat, generate_request
    from prisma_studio.application.coherence import review_text, without_subject_judgement
    from prisma_studio.domain.catalog import Library
    library = Library(items=[item('wardrobe.none', 'wardrobe', 'no clothing', adult=True),
                             item('env.room', 'environment', 'a hotel room')])
    request = generate_request({'wardrobe': cat('wardrobe.none'), 'environment': cat('env.room')},
                               content_mode='adult', confirmations=['adults_only'])
    text, omitted = review_text(request, library)
    assert omitted == 1 and 'no clothing' not in text and 'a hotel room' in text
    assert 'not part of this review' in text
    review = {'coherent': False, 'issues': [
        {'severity': 'error', 'quote': 'nude', 'problem': 'A nudez viola a política de conteúdo.', 'suggestion': ''},
        {'severity': 'warning', 'quote': 'bed', 'problem': 'O apoio muda entre cama e chão.', 'suggestion': ''}]}
    cleaned = without_subject_judgement(review)
    assert cleaned['dropped'] == 1 and [i['quote'] for i in cleaned['issues']] == ['bed']
    only_policy = without_subject_judgement({'coherent': False, 'issues': review['issues'][:1]})
    assert only_policy['coherent'] is True and only_policy['issues'] == []


def test_a_cut_answer_keeps_the_issues_that_arrived_complete():
    cut = ('{"coherent": false, "issues": [{"severity": "error", "quote": "window", "problem": "A luz contradiz a '
           'janela.", "suggestion": "Use a janela."}, {"severity": "warning", "quote": "bed", "problem": "Texto cort')
    review = parse_review(cut)
    assert review['truncated'] and [i['quote'] for i in review['issues']] == ['window']


def test_repeated_findings_are_shown_once():
    issue = {'severity': 'error', 'quote': 'light', 'problem': 'A luz contradiz a janela.', 'suggestion': ''}
    assert len(parse_review(json.dumps({'coherent': False, 'issues': [issue] * 4}))['issues']) == 1
