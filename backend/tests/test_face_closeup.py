from prisma_studio.domain.verification import FACE_CLOSEUP, Check, judge_prompt
from prisma_studio.infrastructure.comfy.workflows import FACE_MODEL, TextJob, text_graph


def test_judge_graph_appends_a_face_closeup_after_the_references():
    g = text_graph(TextJob(prompt='p', system_prompt='s', images=('out.png', 'ref.png'), face_crops=2))
    assert g['86']['inputs']['model_name'] == FACE_MODEL
    assert g['87']['inputs']['num_faces'] == 2 and g['87']['inputs']['image'] == ['300', 0]
    assert g['88']['inputs']['bboxes'] == ['87', 1]
    batch = g['85']['inputs']
    assert batch == {'images.image0': ['300', 0], 'images.image1': ['301', 0], 'images.image2': ['88', 0]}


def test_judge_graph_without_closeup_is_unchanged():
    g = text_graph(TextJob(prompt='p', system_prompt='s', images=('out.png',)))
    assert not {'86', '87', '88'} & set(g)


def test_judge_is_told_which_image_is_the_closeup():
    checks = [Check('faces', 'Faces are fine')]
    assert judge_prompt(checks, face_closeup=True).startswith(FACE_CLOSEUP)
    assert FACE_CLOSEUP not in judge_prompt(checks)
