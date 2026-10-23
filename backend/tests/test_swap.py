from fakes import png
from helpers import cat, codes, keep
from prisma_studio.domain.request import Request
from prisma_studio.domain.rules import assess
from test_executor import env  # noqa: F401 - shared fixture

PHOTOS = [{'id': 't', 'label': 'cena'}, {'id': 'p', 'label': 'Ana'}]


def swap(mode='body', **extra):
    return Request(mode='edit', target_id='t', references=PHOTOS, swap={'reference_id': 'p', 'mode': mode},
                   **{'participants': {'existing': 1}, **extra})


def test_a_swap_needs_one_person_and_another_photo(library):
    assert assess(swap(), library).valid
    assert 'swap_one_person' in codes(assess(swap(participants={'existing': 2}), library), 'error')
    same = Request(mode='edit', target_id='t', references=PHOTOS, swap={'reference_id': 't'})
    assert 'swap_same_photo' in codes(assess(same, library), 'error')
    generate = Request(mode='generate', references=PHOTOS, swap={'reference_id': 'p'})
    assert 'swap_needs_edit' in codes(assess(generate, library), 'error')
    with_changes = swap(attributes={'environment': cat('env.garden'), 'face': keep()})
    assessment = assess(with_changes, library)
    assert assessment.valid and 'swap_ignores_changes' in codes(assessment, 'warning')
    assert 'swap_turbo' in codes(assess(swap(output={'profile': 'turbo'}), library), 'warning')
    assert 'swap_turbo' not in codes(assess(swap('head', output={'profile': 'turbo'}), library), 'warning')


def test_a_body_swap_runs_with_the_bfs_lora_and_the_person_on_gray(env):  # noqa: F811
    target, person = env.put(png(64, 48)), env.put(png(48, 64))
    run = env.service.create(swap(details='on a rainy night'), 'req-swap-body', {'t': target, 'p': person}, None)
    assert run['settings']['swap'] == {'mode': 'body', 'slot': 2}
    assert run['effective_prompt'].startswith('body_swap: start with <image1>')
    assert 'body from <image2>' in run['effective_prompt'] and 'Additional details: on a rainy night' in run['effective_prompt']
    run = env.run_until(run['id'])
    graph = env.repo.tasks(run['id'], 'image')[0]['graph']
    loras = [n['inputs']['lora_name'] for n in graph.values() if n['class_type'] == 'LoraLoaderModelOnly']
    assert loras == ['bfs_body_swap_v1.0_qwen_2.1.safetensors']
    assert graph['10']['inputs']['images.image_2'] == ['524', 0]
    assert graph['524']['class_type'] == 'ImageCompositeMasked' and graph['10']['inputs']['images.image_1'] == ['201', 0]


def test_a_head_swap_uses_no_lora_and_the_photo_as_it_is(env):  # noqa: F811
    target, person = env.put(png(64, 48)), env.put(png(48, 64))
    run = env.run_until(env.service.create(swap('head'), 'req-swap-head', {'t': target, 'p': person}, None)['id'])
    assert run['effective_prompt'].startswith('head_swap: start with <image1>')
    graph = env.repo.tasks(run['id'], 'image')[0]['graph']
    assert not any(n['class_type'] in ('LoraLoaderModelOnly', 'RemoveBackground') for n in graph.values())
    assert graph['10']['inputs']['images.image_2'] == ['202', 0]
