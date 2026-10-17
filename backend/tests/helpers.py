from kppb.domain.compiler import compile_request
from kppb.domain.request import Request
from kppb.domain.rules import assess


def cat(item_id):
    return {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': item_id}}


def text(value):
    return {'intent': 'set', 'value': {'kind': 'text', 'text': value}}


def keep():
    return {'intent': 'keep'}


def ref(ref_id):
    return {'intent': 'transfer', 'reference_id': ref_id}


def edit_request(attributes, references=(('t', 'alvo.png'),), **extra):
    return Request(mode='edit', target_id=references[0][0], attributes=attributes,
                   references=[{'id': i, 'label': label} for i, label in references], **extra)


def generate_request(attributes, **extra):
    return Request(mode='generate', attributes=attributes, **extra)


def run(request, library):
    assessment = assess(request, library)
    return assessment, (compile_request(request, assessment) if assessment.valid else None)


def codes(assessment, level=None):
    return [i.code for i in assessment.issues if level is None or i.level == level]
