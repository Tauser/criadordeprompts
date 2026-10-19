import pytest

from fakes import FakeComfy
from prisma_studio.application.translation import TranslationService


def test_unknown_translation_does_not_cancel_an_unrelated_comfy_job():
    comfy = FakeComfy()
    comfy.submit({}, 'another-app-job')
    service = TranslationService(comfy)
    with pytest.raises(KeyError):
        service.cancel('another-app-job')
    assert comfy.cancels == []


def test_cancel_of_owned_translation_is_idempotent():
    comfy = FakeComfy()
    service = TranslationService(comfy)
    job = service.start('um jardim tranquilo')
    assert service.cancel(job['id'])['status'] == 'cancelled'
    assert service.cancel(job['id'])['status'] == 'cancelled'
    assert comfy.cancels == [job['id']]


def test_translation_budget_follows_the_source_length():
    from prisma_studio.application.translation import translation_budget
    assert translation_budget('um vestido') == 96 and translation_budget('x' * 4000) == 1536
    comfy = FakeComfy()
    job = TranslationService(comfy).start('um vestido preto')
    assert comfy.jobs[job['id']]['graph']['90']['inputs']['max_length'] == 96


def test_looping_translation_is_cleaned_or_discarded():
    def finish(answer, source='um vestido preto justo de alças finas'):
        comfy = FakeComfy(text_answer=answer)
        service = TranslationService(comfy)
        job = service.start(source)
        status = service.status(job['id'])
        while status['status'] in ('queued', 'running'):
            status = service.status(job['id'])
        return status
    cleaned = finish('a fitted black dress with thin straps, ' * 80)
    assert cleaned['status'] == 'completed' and cleaned['text'] == 'a fitted black dress with thin straps'
    runaway = finish(' '.join(f'Detail number {i} of the dress.' for i in range(200)))
    assert runaway['status'] == 'failed' and runaway['text'] is None and 'descartada' in runaway['error']
