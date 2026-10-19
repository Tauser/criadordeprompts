import pytest
from pydantic import ValidationError

from fakes import FakeComfy
from helpers import cat, codes, generate_request, run
from prisma_studio.domain.request import Request
from prisma_studio.infrastructure.comfy.workflows import ImageJob, image_graph
from test_api import client, tick  # noqa: F401  (client is a fixture)


def test_loras_are_chained_between_the_model_and_the_cache():
    graph = image_graph(ImageJob(mode='generate', prompt='x', width=1024, height=1024,
                                 loras=(('a.safetensors', 0.6), ('b/c.safetensors', 1.0))))
    assert graph['30'] == {'class_type': 'LoraLoaderModelOnly',
                           'inputs': {'model': ['1', 0], 'lora_name': 'a.safetensors', 'strength_model': 0.6}}
    assert graph['31']['inputs']['model'] == ['30', 0]
    assert graph['4']['inputs']['model'] == ['31', 0]
    plain = image_graph(ImageJob(mode='generate', prompt='x', width=1024, height=1024))
    assert '30' not in plain and plain['4']['inputs']['model'] == ['1', 0]


@pytest.mark.parametrize('name', ['../evil.safetensors', 'model.ckpt', 'a|b.safetensors'])
def test_lora_names_outside_the_contract_are_refused(name):
    with pytest.raises(ValidationError):
        Request.model_validate({'mode': 'generate', 'engine': {'loras': [{'name': name}]}})


def test_loras_are_reported_as_not_analyzed(library):
    request = generate_request({'environment': cat('env.garden')},
                               engine={'loras': [{'name': 'a.safetensors'}, {'name': 'a.safetensors'}]})
    assessment, _ = run(request, library)
    assert 'lora_not_analyzed' in codes(assessment, 'unknown') and 'duplicate_lora' in codes(assessment, 'error')


def test_loras_reach_the_image_graph_and_the_list_comes_from_comfy(client):  # noqa: F811
    assert client.get('/api/loras').json() == {'available': True, 'loras': [
        'anatomy_fix_qwen21.safetensors', 'realism/ultra_real.safetensors']}
    request = {'mode': 'generate', 'attributes': {'environment': cat('environment.garden')},
               'engine': {'loras': [{'name': 'anatomy_fix_qwen21.safetensors', 'strength': 0.7}]}}
    created = client.post('/api/runs', json={'request_id': 'lora-run-000000001', 'request': request}).json()
    tick(client)
    comfy: FakeComfy = client.container.comfy
    graph = next(job['graph'] for job in comfy.jobs.values() if '30' in job['graph'])
    assert graph['30']['inputs'] == {'model': ['1', 0], 'lora_name': 'anatomy_fix_qwen21.safetensors',
                                     'strength_model': 0.7}
    assert client.get(f'/api/runs/{created["id"]}').json()['status'] == 'completed'
