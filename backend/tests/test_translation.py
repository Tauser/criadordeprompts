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
