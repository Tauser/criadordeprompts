import io

from PIL import Image

from fakes import png
from prisma_studio.infrastructure.comfy.workflows import TEXT_MASK_CHARS
from test_api import client  # noqa: F401 - fixture


def photo(client, name='mulher.png', width=320, height=240):  # noqa: F811
    return client.post('/api/files', files={'file': (name, png(width, height), 'image/png')}).json()


def finish(client, job, polls=6):  # noqa: F811
    status = job
    for _ in range(polls):
        status = client.get(f'/api/text-masks/{job["id"]}').json()
        if status['status'] in ('completed', 'failed', 'cancelled'):
            break
    return status


def test_graph_asks_sam3_for_the_text(client):  # noqa: F811
    stored = photo(client)
    job = client.post(f'/api/files/{stored["hash"]}/text-mask', json={'text': '  the red shirt  '}).json()
    assert job['status'] == 'queued'
    graph = client.container.comfy.jobs[job['id']]['graph']
    assert graph['A'] == {'class_type': 'CheckpointLoaderSimple',
                          'inputs': {'ckpt_name': 'sam3.1_multiplex_fp16.safetensors'}}
    assert graph['B']['inputs'] == {'clip': ['A', 1], 'text': 'the red shirt'}
    assert graph['D']['class_type'] == 'SAM3_Detect' and graph['D']['inputs']['conditioning'] == ['B', 0]
    assert graph['E']['inputs'] == {'mask': ['D', 0]}
    assert graph['60']['class_type'] == 'SaveImage' and graph['60']['inputs']['images'] == ['E', 0]


def test_job_completes_with_a_mask_the_size_of_the_photo(client):  # noqa: F811
    stored = photo(client)
    job = client.post(f'/api/files/{stored["hash"]}/text-mask', json={'text': 'the woman on the left'}).json()
    status = finish(client, job)
    assert status['status'] == 'completed' and status['error'] is None and status['empty'] is False
    mask = client.get(f'/api/files/{status["mask"]}')
    assert mask.headers['content-type'] == 'image/png'
    with Image.open(io.BytesIO(mask.content)) as image:
        assert image.size == (320, 240) and image.mode == 'L'
        assert image.getpixel((160, 120)) == 255      # the found object: white
        assert image.getpixel((2, 2)) == 0            # the rest: black, the editable area is only the object
    assert status['mask'] != stored['hash']


def test_nothing_found_completes_without_a_mask(client):  # noqa: F811
    stored = photo(client)
    client.container.comfy.sam_mask = png(40, 30, (0, 0, 0))
    job = client.post(f'/api/files/{stored["hash"]}/text-mask', json={'text': 'a purple unicorn'}).json()
    status = finish(client, job)
    assert status['status'] == 'completed' and status['mask'] is None and status['empty'] is True


def test_unknown_photo_is_not_found(client):  # noqa: F811
    response = client.post('/api/files/unknown/text-mask', json={'text': 'the red shirt'})
    assert response.status_code == 404


def test_text_limits(client):  # noqa: F811
    stored = photo(client)
    url = f'/api/files/{stored["hash"]}/text-mask'
    assert client.post(url, json={'text': ''}).status_code == 422
    assert client.post(url, json={'text': '   '}).status_code == 422
    assert client.post(url, json={'text': 'x' * (TEXT_MASK_CHARS + 1)}).status_code == 422
    assert client.post(url, json={'text': 'x' * TEXT_MASK_CHARS}).status_code == 200


def test_cancel_stops_only_the_owned_job(client):  # noqa: F811
    stored = photo(client)
    job = client.post(f'/api/files/{stored["hash"]}/text-mask', json={'text': 'the red shirt'}).json()
    cancelled = client.post(f'/api/text-masks/{job["id"]}/cancel').json()
    assert cancelled['status'] == 'cancelled'
    assert client.container.comfy.cancels == [job['id']]
    assert client.post('/api/text-masks/unknown/cancel').status_code == 404
    assert client.get('/api/text-masks/unknown').status_code == 404
