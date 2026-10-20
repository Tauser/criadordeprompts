from test_api import client  # noqa: F401 - fixture

HUG = {'id': 'user.action.abc12345', 'category': 'action', 'label': 'Abraço', 'adult': False, 'enabled': True,
       'prompt': 'standing side by side, the adult on the left wrapping an arm around the waist of the other',
       'requirements': {'participants': 2, 'posture': 'standing'}, 'provides': {}}


def finish(client, job, polls=8):  # noqa: F811
    for _ in range(polls):
        job = client.get(f'/api/library/pose-tests/{job["id"]}').json()
        if job['status'] not in ('queued', 'running'):
            break
    return job


def test_a_pose_test_previews_the_english_text_and_saves_nothing(client):  # noqa: F811
    comfy = client.container.comfy
    library, runs = client.get('/api/library').json(), client.get('/api/runs').json()
    job = client.post('/api/library/pose-tests', json={'item': HUG}).json()
    graph = comfy.jobs[job['id']]['graph']
    prompt = graph['10']['inputs']['prompt']
    assert prompt == ('Create an image. Photograph of two adults in plain casual clothes in a plain light-gray studio: '
                      + HUG['prompt'])
    assert graph['1']['inputs']['unet_name'].startswith('qwen_image_2.1_turbo')
    assert graph['10']['inputs']['resolution'] == 1024 and graph['11']['inputs']['width'] == 1024
    job = finish(client, job)
    assert job['status'] == 'completed' and job['has_image'], job
    image = client.get(f'/api/library/pose-tests/{job["id"]}/image')
    assert image.status_code == 200 and image.content.startswith(b'\x89PNG')
    assert client.get('/api/library').json() == library
    assert client.get('/api/runs').json() == runs
    assert client.container.runs.file(__import__('hashlib').sha256(image.content).hexdigest()) is None


def test_one_person_and_children_wording(client):  # noqa: F811
    comfy = client.container.comfy
    single = {**HUG, 'requirements': {'participants': 1}}
    job = client.post('/api/library/pose-tests', json={'item': single}).json()
    assert 'Photograph of an adult in plain' in comfy.jobs[job['id']]['graph']['10']['inputs']['prompt']
    family = {**HUG, 'requirements': {'participants': 3, 'children': True}}
    job = client.post('/api/library/pose-tests', json={'item': family}).json()
    prompt = comfy.jobs[job['id']]['graph']['10']['inputs']['prompt']
    assert 'Photograph of three people in plain' in prompt and 'adult' not in prompt.split(':')[0]


def test_adult_option_needs_adult_mode_and_confirmation(client):  # noqa: F811
    comfy = client.container.comfy
    adult = {**HUG, 'adult': True}
    refused = client.post('/api/library/pose-tests', json={'item': adult})
    assert refused.status_code == 400 and 'conteúdo adulto' in refused.json()['error']
    refused = client.post('/api/library/pose-tests', json={'item': adult, 'content_mode': 'adult'})
    assert refused.status_code == 400 and 'adultas' in refused.json()['error']
    assert comfy.submits == []
    accepted = client.post('/api/library/pose-tests', json={'item': adult, 'content_mode': 'adult',
                                                            'confirmations': ['adults_only']})
    assert accepted.status_code == 200 and comfy.submits == [accepted.json()['id']]


def test_adult_option_with_children_is_refused(client):  # noqa: F811
    item = {**HUG, 'adult': True, 'requirements': {'participants': 2, 'children': True}}
    refused = client.post('/api/library/pose-tests', json={'item': item, 'content_mode': 'adult',
                                                           'confirmations': ['adults_only']})
    assert refused.status_code == 422 and client.container.comfy.submits == []


def test_only_poses_and_actions_and_cancel(client):  # noqa: F811
    comfy = client.container.comfy
    light = {**HUG, 'category': 'lighting', 'requirements': {}}
    assert client.post('/api/library/pose-tests', json={'item': light}).status_code == 400
    job = client.post('/api/library/pose-tests', json={'item': HUG}).json()
    assert client.post(f'/api/library/pose-tests/{job["id"]}/cancel').json()['status'] == 'cancelled'
    assert comfy.cancels == [job['id']]
    assert client.get(f'/api/library/pose-tests/{job["id"]}/image').status_code == 404
