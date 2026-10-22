import io

import pytest
from PIL import Image

from fakes import png
from prisma_studio.application.runs import RequestRejected
from prisma_studio.domain.request import Request
from prisma_studio.infrastructure.comfy.client import ComfyRejected
from prisma_studio.infrastructure.comfy.workflows import IMAGE_OUTPUT_NODE, UPSCALE_MODEL, UPSCALE_VAE, upscale_graph
from test_executor import edit, env, generate  # noqa: F401 - shared fixture
from test_face_detail import FACE, OTHER, couple


def upscaled_env(env):  # noqa: F811
    env.executor._upscale_model = True               # as if SeedVR2 were installed in ComfyUI
    return env


def test_upscale_runs_after_generation_and_replaces_the_picture(env):  # noqa: F811
    upscaled_env(env)
    run = env.run_until(env.service.create(generate(upscale=1.5, seed=7), 'up-1', {}, None)['id'])
    assert run['status'] == 'completed' and run['settings']['upscale'] == 1.5
    statuses = [e['status'] for e in env.repo.events(run['id']) if e['type'] == 'status']
    assert statuses == ['created', 'preparing', 'generating', 'detailing', 'upscaling', 'completed']
    image = env.repo.tasks(run['id'], 'image')[0]
    raw, upscaled = image['result']['raw_files'], image['result']['files']
    assert raw != upscaled and len(upscaled) == 1
    size = Image.open(io.BytesIO(env.store.read(upscaled[0]))).size
    assert image['result']['upscale'] == {'factor': 1.5, 'size': list(size)}
    task = env.repo.tasks(run['id'], 'upscale')[0]
    assert task['position'] == image['position'] and task['status'] == 'completed'
    assert task['graph']['57']['inputs']['resize_type.multiplier'] == 1.5
    assert task['graph']['52']['inputs']['unet_name'] == UPSCALE_MODEL
    assert task['graph'][IMAGE_OUTPUT_NODE]['class_type'] == 'SaveImage'


def test_upscale_after_the_face_pass_keeps_every_earlier_picture_in_raw_files(env):  # noqa: F811
    upscaled_env(env)
    env.comfy.faces = [FACE, OTHER]
    run = env.run_until(env.service.create(couple(upscale=2), 'up-2', {}, None)['id'])
    assert run['status'] == 'completed'
    image = env.repo.tasks(run['id'], 'image')[0]
    assert len(image['result']['raw_files']) == 2 and image['result']['upscale']['factor'] == 2.0
    assert image['result']['files'][0] not in image['result']['raw_files']
    names = [e['status'] for e in env.repo.events(run['id']) if e['type'] == 'status']
    assert names == ['created', 'preparing', 'generating', 'detailing', 'upscaling', 'completed']
    env.service.delete(run['id'])
    for file_hash in [*image['result']['raw_files'], *image['result']['files']]:
        assert not env.store.path(file_hash).exists()


def test_missing_models_skip_the_stage_and_the_run_completes(env):  # noqa: F811
    run = env.run_until(env.service.create(generate(upscale=1.5), 'up-3', {}, None)['id'])
    assert run['status'] == 'completed'
    image = env.repo.tasks(run['id'], 'image')[0]
    assert image['result']['upscale'] == {'factor': 1.5, 'skipped': True}
    assert 'raw_files' not in image['result'] and env.repo.tasks(run['id'], 'upscale') == []
    assert image['result']['files']


def test_a_failing_upscale_keeps_the_picture_as_generated(env, monkeypatch):  # noqa: F811
    upscaled_env(env)
    submit = env.comfy.submit

    def refuse(graph, prompt_id):
        if 'SeedVR2Conditioning' in {n['class_type'] for n in graph.values()}:
            raise ComfyRejected('SeedVR2 out of memory')
        return submit(graph, prompt_id)
    monkeypatch.setattr(env.comfy, 'submit', refuse)
    run = env.run_until(env.service.create(generate(upscale=1.5), 'up-4', {}, None)['id'])
    assert run['status'] == 'completed'
    image = env.repo.tasks(run['id'], 'image')[0]
    assert image['result']['upscale'] == {'factor': 1.5, 'error': 'SeedVR2 out of memory'}
    assert 'raw_files' not in image['result'] and image['result']['files']
    assert env.repo.tasks(run['id'], 'upscale')[0]['status'] == 'failed'


def test_cancel_while_upscaling_stops_the_run_and_keeps_the_picture(env):  # noqa: F811
    upscaled_env(env)
    run = env.run_until(env.service.create(generate(upscale=1.5), 'up-5', {}, None)['id'], statuses=('upscaling',))
    assert run['status'] == 'upscaling'
    env.comfy.script = ['pending']
    env.executor.tick()
    env.service.cancel(run['id'])
    run = env.run_until(run['id'])
    assert run['status'] == 'cancelled'
    image = env.repo.tasks(run['id'], 'image')[0]
    assert image['result']['files'] and env.repo.tasks(run['id'], 'upscale')[0]['status'] == 'cancelled'


def test_upscale_is_rejected_with_a_mask(env):  # noqa: F811
    target = env.put(png(1000, 700))
    mask = env.put(png(1000, 700, color=255, mode='L'))
    with pytest.raises(RequestRejected, match='Ampliar'):
        env.service.create(edit(mask=True, output={'upscale': 1.5}), 'up-mask', {'t': target}, mask)


def test_upscale_factor_is_limited_to_the_offered_values():
    assert Request(mode='generate', output={'upscale': 2}).output.upscale == 2.0
    with pytest.raises(ValueError):
        Request(mode='generate', output={'upscale': 3})


def test_upscale_graph_uses_the_factor_the_models_and_the_output_node():
    graph = upscale_graph('shot.png', 1.5, 9, prefix='prisma/abc_up')
    assert graph['57']['inputs']['resize_type.multiplier'] == 1.5
    assert graph['57']['inputs']['scale_method'] == 'lanczos' and graph['1']['inputs']['image'] == 'shot.png'
    assert graph['52']['inputs']['unet_name'] == UPSCALE_MODEL and graph['51']['inputs']['vae_name'] == UPSCALE_VAE
    assert graph['54']['inputs']['seed'] == 9 and graph['54']['inputs']['steps'] == 1
    assert graph[IMAGE_OUTPUT_NODE]['class_type'] == 'SaveImage'
    assert graph[IMAGE_OUTPUT_NODE]['inputs'] == {'images': ['59', 0], 'filename_prefix': 'prisma/abc_up'}
    for node in graph.values():                       # every link points at a node of the graph
        for value in node['inputs'].values():
            if isinstance(value, list):
                assert value[0] in graph
