import pytest

from prisma_studio.domain.catalog import Item, Library, Provides, Requirements


def item(id_, category, prompt, **kw):
    req = kw.pop('req', {})
    prov = kw.pop('prov', {})
    return Item(id=id_, category=category, label=kw.pop('label', id_), prompt=prompt,
                requirements=Requirements(**req), provides=Provides(**prov), **kw)


@pytest.fixture
def library():
    return Library(items=[
        item('subject.woman', 'subject', 'one adult woman', req={'participants': 1}),
        item('style.real', 'style', 'photorealistic photography'),
        item('style.ink', 'style', 'black ink illustration'),
        item('env.garden', 'environment', 'a quiet garden', prov={'supports': ('floor', 'seat')}),
        item('env.studio', 'environment', 'a plain studio', prov={'supports': ('floor',)}),
        item('pose.seated', 'pose', 'sitting upright',
             req={'participants': 1, 'posture': 'seated', 'gaze': 'any', 'support_any_of': ('seat',),
                  'minimum_framing': 'full'}),
        item('pose.standing', 'pose', 'standing relaxed',
             req={'participants': 1, 'posture': 'standing', 'gaze': 'any', 'support_any_of': ('floor',)}),
        item('action.read', 'action', 'reading a book', req={'participants': 1, 'posture': 'any', 'gaze': 'down'}),
        item('action.hug', 'action', 'hugging each other', req={'participants': 2, 'posture': 'any', 'gaze': 'any'}),
        item('action.camera', 'action', 'looking at the camera', req={'participants': 1, 'posture': 'any',
                                                                     'gaze': 'camera'}),
        item('expr.closed', 'expression', 'eyes closed, relaxed', req={'gaze': 'closed'}),
        item('light.soft', 'lighting', 'soft window light'),
        item('frame.portrait', 'framing', 'a head-and-shoulders portrait', prov={'framing': 'portrait'}),
        item('pose.adult', 'pose', 'an adult-only pose', adult=True,
             req={'participants': 1, 'posture': 'standing', 'gaze': 'any'}),
        item('disabled.light', 'lighting', 'disabled light', enabled=False),
    ])
