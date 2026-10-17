
import pytest

from fakes import FakeComfy, judge_all, png
from helpers import cat, keep
from prisma_studio.application.library import LibraryService
from prisma_studio.application.runs import RequestRejected, RunService
from prisma_studio.domain.request import Request
from prisma_studio.infrastructure.db.database import Database
from prisma_studio.infrastructure.db.repository import LibraryRepository, RunRepository
from prisma_studio.infrastructure.storage.files import FileStore
from prisma_studio.worker.executor import Executor


@pytest.fixture
def env(tmp_path, library):
    defaults = tmp_path / 'defaults.json'
    defaults.write_text(library.model_dump_json(), encoding='utf-8')
    db = Database(tmp_path / 'studio.db')
    repo = RunRepository(db)
    store = FileStore(tmp_path / 'files')
    comfy = FakeComfy()
    lib = LibraryService(defaults, LibraryRepository(db))
    executor = Executor(repo, comfy, store, poll_seconds=0)
    service = RunService(repo, lib, store, executor)

    class Env:
        pass
    e = Env()
    e.__dict__.update(db=db, repo=repo, store=store, comfy=comfy, executor=executor, service=service, lib=lib,
                      tmp=tmp_path)

    def put(data):
        stored = store.put(data)
        repo.record_file(stored)
        return stored.hash
    e.put = put

    def run_until(run_id, statuses=('completed', 'failed', 'cancelled', 'lost', 'review'), limit=40):
        for _ in range(limit):
            executor.tick()
            run = repo.get(run_id)
            if run['status'] in statuses:
                return run
        return repo.get(run_id)
    e.run_until = run_until
    return e


def generate(**output):
    return Request(mode='generate', attributes={'subject': cat('subject.woman'), 'environment': cat('env.garden')},
                   output=output)


def edit(**extra):
    return Request(mode='edit', target_id='t', references=[{'id': 't', 'label': 'alvo'}],
                   attributes={'face': keep(), 'environment': cat('env.garden')}, **extra)


def test_generation_happy_path_persists_everything(env):
    run = env.service.create(generate(variations=2, seed=10), 'req-1', {}, None)
    run = env.run_until(run['id'])
    assert run['status'] == 'completed'
    tasks = env.repo.tasks(run['id'], 'image')
    assert [t['seed'] for t in tasks] == [10, 11]
    assert all(t['status'] == 'completed' and t['result']['files'] for t in tasks)
    assert sorted(env.comfy.submits) == sorted(t['comfy_prompt_id'] for t in tasks)
    graph = tasks[0]['graph']
    assert graph['10']['inputs']['prompt'] == run['effective_prompt'] == run['prompt']
    assert graph['11']['inputs']['width'] == 896 and graph['11']['inputs']['height'] == 1184
    statuses = [e['status'] for e in env.repo.events(run['id']) if e['type'] == 'status']
    assert statuses == ['created', 'preparing', 'generating', 'completed']


def test_same_request_id_is_idempotent(env):
    first = env.service.create(generate(), 'same', {}, None)
    second = env.service.create(generate(), 'same', {}, None)
    assert first['id'] == second['id']
    assert len(env.repo.list()) == 1


def test_unconfirmed_submission_is_resolved_without_duplicates(env):
    env.comfy.fail_submit_once = True
    run = env.service.create(generate(), 'req-u', {}, None)
    env.executor.tick()
    env.executor.tick()
    task = env.repo.tasks(run['id'], 'image')[0]
    assert task['status'] == 'uncertain'
    run = env.run_until(run['id'])
    assert run['status'] == 'completed'
    assert env.comfy.submits.count(task['comfy_prompt_id']) == 1


def test_unconfirmed_submission_that_never_arrived_is_resubmitted_once(env):
    env.comfy.offline = True
    run = env.service.create(generate(), 'req-o', {}, None)
    env.comfy.offline = False
    env.executor.tick()                         # created -> preparing -> generating
    env.comfy.offline = True
    env.executor.tick()                         # submit fails before reaching ComfyUI? network down
    task = env.repo.tasks(run['id'], 'image')[0]
    assert task['status'] in ('created', 'uncertain')
    env.comfy.offline = False
    run = env.run_until(run['id'])
    assert run['status'] == 'completed'
    assert len(env.comfy.submits) == 1


def test_cancel_while_queued(env):
    env.comfy.script = ['pending']
    run = env.service.create(generate(), 'req-c', {}, None)
    env.executor.tick()
    env.executor.tick()
    env.service.cancel(run['id'])
    run = env.run_until(run['id'])
    assert run['status'] == 'cancelled'
    assert env.comfy.cancels


def test_cancel_after_completion_keeps_the_image(env):
    run = env.service.create(generate(), 'req-late', {}, None)
    for _ in range(4):
        env.executor.tick()
    task = env.repo.tasks(run['id'], 'image')[0]
    env.comfy.jobs[task['comfy_prompt_id']]['step'] = 2          # finished on the GPU, not yet observed
    env.service.cancel(run['id'])
    run = env.run_until(run['id'])
    task = env.repo.tasks(run['id'], 'image')[0]
    assert run['status'] == 'cancelled'
    assert task['status'] == 'completed' and task['result']['files']


def test_comfy_offline_during_cancel_keeps_retrying(env):
    env.comfy.script = ['in_progress']
    run = env.service.create(generate(), 'req-off', {}, None)
    env.executor.tick()
    env.executor.tick()
    env.executor.tick()
    env.service.cancel(run['id'])
    env.comfy.offline = True
    env.executor.tick()
    assert env.repo.get(run['id'])['status'] == 'generating'
    env.comfy.offline = False
    assert env.run_until(run['id'])['status'] == 'cancelled'


def test_vanished_job_becomes_lost(env):
    env.comfy.script = ['pending']
    run = env.service.create(generate(), 'req-l', {}, None)
    env.executor.tick()
    env.executor.tick()
    task = env.repo.tasks(run['id'], 'image')[0]
    env.comfy.jobs[task['comfy_prompt_id']]['vanished'] = True
    run = env.run_until(run['id'])
    assert run['status'] == 'failed'
    assert env.repo.tasks(run['id'], 'image')[0]['status'] == 'lost'


def test_restart_continues_from_the_database(env):
    run = env.service.create(generate(), 'req-r', {}, None)
    env.executor.tick()
    env.executor.tick()
    fresh = Executor(RunRepository(Database(env.tmp / 'studio.db')), env.comfy, env.store, poll_seconds=0)
    for _ in range(10):
        fresh.tick()
    assert env.repo.get(run['id'])['status'] == 'completed'
    assert len(env.comfy.submits) == 1


def test_invalid_graph_fails_before_reaching_the_queue(env):
    env.comfy.object_info_data = {'UNETLoader': {'input': {'required': {'unet_name': [['other.safetensors']]}}}}
    run = env.run_until(env.service.create(generate(), 'req-v', {}, None)['id'])
    assert run['status'] == 'failed'
    assert 'não é executável' in run['error'] and env.comfy.submits == []


def test_refine_pauses_for_review_and_flags_refusals(env):
    env.comfy.text_answer = "I'm sorry, but I can't help with that."
    run = env.service.create(generate(refine=True), 'req-ref', {}, None)
    run = env.run_until(run['id'])
    assert run['status'] == 'review'
    checked = [e for e in env.repo.events(run['id']) if e['type'] == 'refine_checked'][0]
    assert [p['code'] for p in checked['problems']] == ['refusal']
    run = env.service.approve(run['id'], 'original')
    run = env.run_until(run['id'])
    assert run['status'] == 'completed' and run['effective_prompt'] == run['prompt']
    with pytest.raises(RequestRejected):
        env.service.approve(run['id'], 'refined')


def test_refined_prompt_is_used_only_after_approval(env):
    env.comfy.text_answer = 'Create an image of one adult woman in a quiet garden.'
    run = env.run_until(env.service.create(generate(refine=True), 'req-ok', {}, None)['id'])
    assert env.repo.tasks(run['id'], 'image') == []
    env.service.approve(run['id'], 'refined')
    run = env.run_until(run['id'])
    assert env.repo.tasks(run['id'], 'image')[0]['graph']['10']['inputs']['prompt'] == run['refined_prompt']


def test_verification_scores_variations(env):
    answers = iter([judge_all('unmet'), judge_all('met')])
    current = {}

    def answer(prompt):
        if prompt not in current:
            current[prompt] = []
        fn = next(answers)
        return fn(prompt)
    env.comfy.text_answer = answer
    run = env.run_until(env.service.create(generate(variations=2, verify=True), 'req-j', {}, None)['id'])
    assert run['status'] == 'completed'
    images = env.repo.tasks(run['id'], 'image')
    assert [t['result']['score'] for t in images] == [0.0, 1.0]
    assert run['best_task_id'] == images[1]['id']


def test_masked_edit_normalizes_target_and_mask_to_the_same_size(env):
    target = env.put(png(1000, 700))
    mask = env.put(png(500, 350, color=0, mode='L'))
    run = env.service.create(edit(mask=True), 'req-m', {'t': target}, mask)
    run = env.run_until(run['id'])
    assert run['status'] == 'completed'
    names = [n for n in env.comfy.uploads]
    assert any('992x672' in n for n in names) and any('mask' in n and '992x672' in n for n in names)
    graph = env.repo.tasks(run['id'], 'image')[0]['graph']
    assert graph['54']['class_type'] == 'ImageCompositeMasked' and graph['10']['inputs']['resolution'] == 0
    assert graph['60']['inputs']['images'] == ['54', 0]


def test_missing_files_and_invalid_requests_are_rejected(env):
    with pytest.raises(RequestRejected):
        env.service.create(edit(), 'req-x', {}, None)
    with pytest.raises(RequestRejected) as error:
        env.service.create(Request(mode='edit', target_id='t', references=[{'id': 't', 'label': 'a'}]), 'req-y',
                           {'t': env.put(png())}, None)
    assert any(i['code'] == 'missing_change' for i in error.value.issues)
