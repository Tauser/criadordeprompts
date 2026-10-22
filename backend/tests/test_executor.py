
import io
import threading

import pytest
from PIL import Image

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


def image_submits(env, run_id):
    """Submissions of the run's images; a single-person run also submits its face count."""
    ids = {t['comfy_prompt_id'] for t in env.repo.tasks(run_id, 'image')}
    return [prompt_id for prompt_id in env.comfy.submits if prompt_id in ids]


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
    assert sorted(image_submits(env, run['id'])) == sorted(t['comfy_prompt_id'] for t in tasks)
    graph = tasks[0]['graph']
    assert graph['10']['inputs']['prompt'] == run['effective_prompt'] == run['prompt']
    assert graph['11']['inputs']['width'] == 896 and graph['11']['inputs']['height'] == 1184
    statuses = [e['status'] for e in env.repo.events(run['id']) if e['type'] == 'status']
    assert statuses == ['created', 'preparing', 'generating', 'detailing', 'completed']


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
    assert len(image_submits(env, run['id'])) == 1


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
    assert len(image_submits(env, run['id'])) == 1


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


# --- interruptions and recovery ------------------------------------------------------------------------------

def test_lost_answer_for_a_job_that_never_arrived_waits_for_the_user(env):
    env.comfy.lose_submit_once = True
    run = env.service.create(generate(), 'req-lost-answer-1', {}, None)
    for _ in range(6):
        env.executor.tick()
    task = env.repo.tasks(run['id'], 'image')[0]
    assert task['status'] == 'uncertain' and env.comfy.submits == []      # never resubmitted on its own
    first_id = task['comfy_prompt_id']
    env.service.resubmit(run['id'], task['id'])
    run = env.run_until(run['id'])
    assert run['status'] == 'completed'
    submitted = image_submits(env, run['id'])
    assert len(submitted) == 1 and submitted[0] != first_id
    assert any(e['type'] == 'resubmit_confirmed' for e in env.repo.events(run['id']))


def test_restart_while_submitting_does_not_resend_an_accepted_job(env):
    run = env.service.create(generate(), 'req-crash-accepted', {}, None)
    env.executor.tick()                                     # created -> preparing -> generating
    env.executor.tick()                                     # task submitted and accepted
    task = env.repo.tasks(run['id'], 'image')[0]
    # simulate the crash window: ComfyUI accepted it but the process died before recording `queued`
    env.db.connection().execute("UPDATE tasks SET status='submitting' WHERE id=?", (task['id'],))
    fresh = Executor(env.repo, env.comfy, env.store, poll_seconds=0)
    for _ in range(10):
        fresh.tick()
    assert env.repo.get(run['id'])['status'] == 'completed'
    assert env.comfy.submits.count(task['comfy_prompt_id']) == 1


def test_restart_while_submitting_with_nothing_in_comfy_becomes_uncertain(env):
    run = env.service.create(generate(), 'req-crash-unknown', {}, None)
    env.executor.tick()
    env.executor.tick()
    task = env.repo.tasks(run['id'], 'image')[0]
    env.comfy.jobs.clear()
    env.comfy.submits.clear()
    env.db.connection().execute("UPDATE tasks SET status='submitting' WHERE id=?", (task['id'],))
    for _ in range(5):
        env.executor.tick()
    assert env.repo.task(task['id'])['status'] == 'uncertain' and env.comfy.submits == []


def test_run_without_prompt_fails_instead_of_running(env):
    run = env.service.create(generate(), 'req-no-prompt', {}, None)
    env.db.connection().execute('UPDATE runs SET prompt=NULL, effective_prompt=NULL WHERE id=?', (run['id'],))
    env.executor.tick()
    run = env.repo.get(run['id'])
    assert run['status'] == 'failed' and env.comfy.submits == []


def test_interrupted_task_batch_keeps_every_variation(env):
    run = env.service.create(generate(variations=4), 'req-batch', {}, None)
    env.repo.transition(run['id'], 'preparing')
    env.repo.update(run['id'], settings_json={**run['settings'], 'uploaded': {'images': [], 'mask': None}})
    env.repo.add_task(run['id'], 'image', 0, seed=run['settings']['seed'])
    env.repo.transition(run['id'], 'generating')             # crash after the first of four inserts
    run = env.run_until(run['id'])
    assert run['status'] == 'completed'
    assert sorted(t['position'] for t in env.repo.tasks(run['id'], 'image')) == [0, 1, 2, 3]


def test_tasks_are_unique_per_slot(env):
    run = env.service.create(generate(), 'req-unique', {}, None)
    first = env.repo.add_task(run['id'], 'refine')
    assert env.repo.add_task(run['id'], 'refine')['id'] == first['id']


# --- masks -----------------------------------------------------------------------------------------------------

def test_masked_edit_keeps_original_size_and_pixels_outside_the_mask(env):
    original = Image.new('RGB', (1000, 700))
    original.putdata([((x * 7) % 256, (y * 3) % 256, (x + y) % 256) for y in range(700) for x in range(1000)])
    buffer = io.BytesIO()
    original.save(buffer, format='PNG')
    target = env.put(buffer.getvalue())
    drawn = Image.new('L', (1000, 700), 0)
    drawn.paste(255, (300, 200, 700, 500))
    buffer = io.BytesIO()
    drawn.save(buffer, format='PNG')
    mask = env.put(buffer.getvalue())
    run = env.run_until(env.service.create(edit(mask=True), 'req-mask-pixels', {'t': target}, mask)['id'])
    assert run['status'] == 'completed'
    result = Image.open(io.BytesIO(env.store.read(env.repo.tasks(run['id'], 'image')[0]['result']['files'][0])))
    assert result.size == (1000, 700)
    result, weights = result.convert('RGB'), drawn.load()
    pixels, source = result.load(), original.load()
    outside = [(x, y) for x in range(0, 1000, 7) for y in range(0, 700, 7) if weights[x, y] == 0]
    assert outside and all(pixels[p] == source[p] for p in outside)
    assert pixels[500, 350] != source[500, 350]


def test_mask_with_custom_size_is_rejected(env):
    target = env.put(png(1000, 700))
    mask = env.put(png(1000, 700, color=255, mode='L'))
    request = edit(mask=True, output={'width': 1024, 'height': 1024})
    with pytest.raises(RequestRejected):
        env.service.create(request, 'req-mask-size', {'t': target}, mask)


# --- repetition and deletion --------------------------------------------------------------------------------

def test_repeat_reuses_the_prompt_that_was_actually_used(env):
    run = env.run_until(env.service.create(generate(), 'req-original', {}, None)['id'])
    env.repo.update(run['id'], effective_prompt='Approved refined prompt.')
    again = env.service.repeat(run['id'], 'req-repeat-frozen', same_seed=True)
    assert again['effective_prompt'] == 'Approved refined prompt.'
    assert again['settings']['seed'] == run['settings']['seed'] and again['settings']['refine'] is False
    assert again['settings']['repeat_of'] == run['id']
    again = env.run_until(again['id'])
    graph = env.repo.tasks(again['id'], 'image')[0]['graph']
    assert graph['10']['inputs']['prompt'] == 'Approved refined prompt.'
    assert env.service.repeat(run['id'], 'req-repeat-frozen')['id'] == again['id']      # idempotent


def test_delete_keeps_files_that_drafts_still_use(env):
    target = env.put(png(320, 320))
    run = env.service.create(edit(), 'req-delete-keep', {'t': target}, None)
    env.repo.transition(run['id'], 'cancelled')
    assert env.service.delete(run['id'], {target})['files_removed'] == 0
    assert env.repo.file(target) is not None and env.store.read(target)


def test_failed_cancel_does_not_block_the_other_runs(env, monkeypatch):
    from prisma_studio.infrastructure.comfy.client import ComfyRejected

    first = env.service.create(generate(), 'bad-cancel', {}, None)
    env.executor.tick()
    env.executor.tick()
    env.service.cancel(first['id'])

    def broken_cancel(_):
        raise ComfyRejected('cancel endpoint refused')

    monkeypatch.setattr(env.comfy, 'cancel', broken_cancel)
    second = env.service.create(generate(), 'after-bad-cancel', {}, None)
    assert env.run_until(second['id'])['status'] == 'completed'
    assert env.repo.get(first['id'])['status'] == 'failed'


def test_empty_refinement_cannot_be_approved(env):
    env.comfy.text_answer = ''
    run = env.run_until(env.service.create(generate(refine=True), 'empty-refined', {}, None)['id'])
    assert run['status'] == 'review'
    with pytest.raises(RequestRejected, match='texto aprimorado'):
        env.service.approve(run['id'], 'refined')
    assert env.repo.get(run['id'])['status'] == 'review'
    env.service.approve(run['id'], 'original')
    assert env.run_until(run['id'])['status'] == 'completed'


def test_uncertain_task_cannot_be_resubmitted_after_cancellation_is_requested(env):
    env.comfy.lose_submit_once = True
    run = env.service.create(generate(), 'cancel-uncertain', {}, None)
    env.executor.tick()
    env.executor.tick()
    task = env.repo.tasks(run['id'], 'image')[0]
    assert task['status'] == 'uncertain'
    env.service.cancel(run['id'])
    with pytest.raises(RequestRejected, match='cancelado'):
        env.service.resubmit(run['id'], task['id'])
    assert env.repo.task(task['id'])['status'] == 'uncertain'


def test_bulk_deletion_is_rolled_back_if_one_run_is_still_active(env):
    finished = env.run_until(env.service.create(generate(), 'delete-finished', {}, None)['id'])
    active = env.service.create(generate(), 'delete-still-active', {}, None)
    image = env.repo.tasks(finished['id'], 'image')[0]['result']['files'][0]
    with pytest.raises(ValueError, match='Pare o pedido'):
        env.service.delete_many([finished['id'], active['id']])
    assert env.repo.get(finished['id']) is not None
    assert env.store.read(image) and env.repo.file(image) is not None


def test_disk_cleanup_failure_does_not_restore_history_with_missing_images(env):
    run = env.run_until(env.service.create(generate(variations=2), 'cleanup-error', {}, None)['id'])
    hashes = sorted(t['result']['files'][0] for t in env.repo.tasks(run['id'], 'image'))

    def remove(file_hash):
        if file_hash == hashes[1]:
            raise PermissionError('test: locked file')
        env.store.delete(file_hash)

    assert env.repo.delete_many_with_files([run['id']], set(), remove) == 1
    assert env.repo.get(run['id']) is None
    assert env.repo.file(hashes[0]) is None
    assert env.repo.file(hashes[1]) is not None and env.store.read(hashes[1])


def test_stop_waits_for_in_flight_work_before_the_instance_lock_can_be_released(env, monkeypatch):
    entered, release, stopped = threading.Event(), threading.Event(), threading.Event()

    def blocked_tick():
        entered.set()
        release.wait(3)

    monkeypatch.setattr(env.executor, 'tick', blocked_tick)
    env.executor.start()
    assert entered.wait(1)

    def stop():
        env.executor.stop()
        stopped.set()

    stopper = threading.Thread(target=stop)
    stopper.start()
    try:
        assert not stopped.wait(0.05)
    finally:
        release.set()
        stopper.join(3)
    assert stopped.is_set() and not env.executor._thread.is_alive()
