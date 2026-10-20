import json

from fakes import png
from prisma_studio.application.reference_description import DescriptionRefused, draft_from_answer, review
from test_api import client  # noqa: F401 - fixture

HUG = {
    'label': 'Abraço de lado', 'participants': 2, 'posture': 'standing', 'gaze': 'camera', 'orientation': 'front',
    'support_any_of': ['floor'], 'minimum_framing': 'half', 'adult': False, 'children': False,
    'prompt': 'two adults standing side by side, the adult on the left wrapping the right arm around the waist of the '
              'adult on the right, the adult on the right resting the left hand on the chest of the adult on the left, '
              'both looking at the camera.',
    'edit_prompt': 'change the pose of the two adults so they stand side by side in a hug, keeping the faces unchanged',
    'prompt_pt': 'dois adultos em pé lado a lado, abraçados pela cintura, olhando para a câmera',
}


def answer(**changes):
    return 'Here it is:\n' + json.dumps({**HUG, **changes})


def describe(client, category='action', polls=8):  # noqa: F811
    stored = client.post('/api/files', files={'file': ('ref.png', png(640, 480), 'image/png')}).json()
    job = client.post('/api/library/descriptions', json={'file': stored['hash'], 'category': category}).json()
    for _ in range(polls):
        job = client.get(f'/api/library/descriptions/{job["id"]}').json()
        if job['status'] not in ('queued', 'running'):
            break
    return job


def test_a_photo_becomes_a_draft_that_is_not_saved(client):  # noqa: F811
    comfy = client.container.comfy
    comfy.text_answer = answer()
    before = client.get('/api/library').json()
    job = describe(client)
    assert job['status'] == 'completed', job
    draft = job['draft']
    assert draft['label'] == 'Abraço de lado (dois adultos)'
    assert draft['prompt'].startswith('two adults standing') and not draft['prompt'].endswith('.')
    assert draft['edit_prompt'].startswith('Change the pose') and draft['edit_prompt'].endswith('.')
    assert draft['requirements'] == {'participants': 2, 'posture': 'standing', 'gaze': 'camera', 'orientation': 'front',
                                     'support_any_of': ['floor'], 'minimum_framing': 'half'}
    assert not [f for f in job['findings'] if f['level'] in ('conflict', 'ambiguity')]
    graph = comfy.jobs[comfy.submits[-1]]['graph']
    assert any(n['class_type'] == 'LoadImage' for n in graph.values())          # the model sees the photo
    assert len(comfy.submits) == 1                                               # nothing to rewrite
    assert client.get('/api/library').json() == before


def test_wording_the_rules_cannot_fix_goes_back_to_the_model_once(client):  # noqa: F811
    comfy = client.container.comfy
    prompts = []

    def model(prompt):
        prompts.append(prompt)
        if len(prompts) == 1:
            return answer(prompt='two adults standing in a hug while she leans in, her hand on his shoulder, one arm around the waist and '
                                 'the other arm on the back, wearing jeans')
        return answer()
    comfy.text_answer = model
    job = describe(client)
    assert job['status'] == 'completed' and len(prompts) == 2
    assert 'right or left' in prompts[1] and 'he, she, his or her' in prompts[1]
    repair = comfy.jobs[comfy.submits[-1]]['graph']
    assert any(n['class_type'] == 'LoadImage' for n in repair.values())
    assert 'jeans' not in job['draft']['prompt']


def test_a_second_bad_answer_keeps_the_findings_for_the_person(client):  # noqa: F811
    client.container.comfy.text_answer = answer(prompt='two adults standing, one hand on the hip and the other hand '
                                                       'raised, the adult on the left looking at the camera')
    job = describe(client)
    assert job['status'] == 'completed'
    assert 'ambiguous_limbs' in {f['code'] for f in job['findings']}
    assert len(client.container.comfy.submits) == 2


def test_metadata_follows_the_text():
    draft = draft_from_answer({**HUG, 'prompt': 'two adults kneeling face to face on a bed, each resting the right '
                                                'hand on the shoulder of the other adult, looking away',
                               'posture': 'standing', 'support_any_of': ['floor'], 'gaze': 'camera'}, 'action')
    req = draft['requirements']
    assert (req['posture'], req['support_any_of']) == ('kneeling', ['bed'])
    findings, rewrite = review(draft)
    assert not [f for f in findings if f['level'] in ('conflict', 'ambiguity')] and not rewrite


def test_children_are_never_adult_and_never_sensual():
    family = draft_from_answer({**HUG, 'prompt': 'two adults sitting on a sofa with a child between them, the child '
                                                 'pointing at a book', 'posture': 'seated', 'support_any_of': ['seat'],
                                'adult': True, 'children': False, 'participants': 3}, 'action')
    assert family['adult'] is False and family['requirements']['children'] is True
    assert '(' not in family['label']                                  # the model names who takes part with children
    try:
        draft_from_answer({**HUG, 'prompt': 'two adults and a child in a sensual pose', 'children': True}, 'action')
    except DescriptionRefused:
        pass
    else:
        raise AssertionError('a sensual scene with a child must be refused')


def test_refused_unknown_and_offline(client):  # noqa: F811
    client.container.comfy.text_answer = answer(prompt='a child sitting on the lap of an adult, seductive look',
                                                children=True)
    job = describe(client)
    assert job['status'] == 'failed' and 'criança' in job['error'] and 'draft' not in job
    assert client.post('/api/library/descriptions', json={'file': 'nope', 'category': 'pose'}).status_code == 404
    stored = client.post('/api/files', files={'file': ('r.png', png(64, 64), 'image/png')}).json()
    assert client.post('/api/library/descriptions', json={'file': stored['hash'], 'category': 'wardrobe'}).status_code == 400
    client.container.comfy.offline = True
    offline = client.post('/api/library/descriptions', json={'file': stored['hash'], 'category': 'pose'}).json()
    assert offline['status'] == 'failed' and 'ComfyUI' in offline['error']


def test_an_answer_that_is_not_json_fails_and_can_be_cancelled(client):  # noqa: F811
    client.container.comfy.text_answer = 'I cannot see the image.'
    assert describe(client)['status'] == 'failed'
    stored = client.post('/api/files', files={'file': ('r.png', png(64, 64), 'image/png')}).json()
    job = client.post('/api/library/descriptions', json={'file': stored['hash'], 'category': 'pose'}).json()
    assert client.post(f'/api/library/descriptions/{job["id"]}/cancel').json()['status'] == 'cancelled'


def test_possessives_and_what_to_keep_are_cleaned_up():
    draft = draft_from_answer({**HUG, 'prompt': 'two adults standing side by side, his right hand on the waist of the '
                                                'adult on the right', 'edit_prompt': 'Change the pose so that the two '
                               'adults stand side by side; keep the faces and the background unchanged.'}, 'action')
    assert 'the right hand on the waist' in draft['prompt']
    assert draft['edit_prompt'] == 'Change the pose so that the two adults stand side by side.'


def test_a_single_pose_names_nobody():
    draft = draft_from_answer({**HUG, 'participants': 1, 'support_any_of': ['floor'],
                               'prompt': 'A man standing with both fists raised, his head tilted up',
                               'edit_prompt': 'Change the pose of the man so that he stands with both fists raised.'},
                              'pose')
    assert draft['prompt'] == 'standing with both fists raised, the head tilted up'
    assert draft['edit_prompt'] == 'Change the pose of the person so that the person stands with both fists raised.'
    assert draft['label'] == 'Abraço de lado'


def test_a_group_is_made_of_adults_not_men_and_women():
    draft = draft_from_answer({**HUG, 'participants': 3, 'support_any_of': ['floor'],
                               'prompt': 'three adults standing in a row, the left woman and the right man raising '
                                         'both fists, two women laughing'}, 'action')
    assert draft['prompt'] == ('three adults standing in a row, the left adult and the right adult raising both fists, '
                               'two adults laughing')


def test_sexual_anatomy_never_enters_the_draft():
    draft = draft_from_answer({**HUG, 'participants': 1, 'support_any_of': ['bed'], 'adult': True,
                               'prompt': 'lying on the back on a bed, the torso upright on the pillows, the genitals '
                                         'exposed toward the camera, the right knee raised',
                               'edit_prompt': 'Change the pose so that the person lies on the back on a bed, nipples '
                                              'visible, the right knee raised.',
                               'prompt_pt': 'deitado de costas na cama, o tronco ereto nos travesseiros, a vagina '
                                            'à mostra, o joelho direito erguido'}, 'pose')
    assert draft['prompt'] == 'lying on the back on a bed, the torso upright on the bed, the right knee raised'
    assert draft['edit_prompt'] == 'Change the pose so that the person lies on the back on a bed, the right knee raised.'
    assert draft['prompt_pt'] == 'deitado de costas na cama, o tronco ereto nos travesseiros, o joelho direito erguido'


def test_a_long_description_is_cut_after_a_whole_part():
    long = 'standing upright, ' + ', '.join(f'detail number {i} of the right arm' for i in range(120))
    draft = draft_from_answer({**HUG, 'participants': 1, 'prompt': long}, 'pose')
    assert len(draft['prompt']) <= 2000 and draft['prompt'].endswith('of the right arm')


def test_hair_clothing_and_background_are_left_out_of_the_detail():
    draft = draft_from_answer({**HUG, 'participants': 2, 'support_any_of': ['floor'],
                               'prompt': 'two adults standing side by side; the adult on the left with a short dark bob '
                                         'haircut, head tilted back, right fist raised; the adult on the right with '
                                         'cropped hair, left fist raised; both wearing striped jerseys and jeans, '
                                         'standing against a plain studio backdrop with soft lighting',
                               'prompt_pt': 'dois adultos em pé lado a lado; a pessoa da esquerda com cabelo chanel, '
                                            'cabeça inclinada para trás; fundo cinza de estúdio'}, 'action')
    assert draft['prompt'] == ('two adults standing side by side; the adult on the left, head tilted back, right fist '
                               'raised; the adult on the right, left fist raised')
    assert draft['prompt_pt'] == 'dois adultos em pé lado a lado; a pessoa da esquerda, cabeça inclinada para trás'


def test_the_edit_instruction_loses_the_photo_and_what_to_keep_whole():
    draft = draft_from_answer({**HUG, 'participants': 3, 'support_any_of': ['floor'],
                               'prompt': 'three adults standing, a single adult man in the center',
                               'edit_prompt': 'Change the pose of the three adults in the input photo so that they '
                                              'stand in a row, fists raised; all three keep the faces unchanged.'},
                              'action')
    assert draft['edit_prompt'] == 'Change the pose of the three adults so that they stand in a row, fists raised.'
    assert draft['prompt'] == 'three adults standing, a single adult in the center'


def test_the_setting_stays_out_of_the_pose():
    draft = draft_from_answer({**HUG, 'participants': 2, 'posture': 'seated', 'support_any_of': ['seat'],
                               'prompt': 'two adults sitting on a gray velvet sofa in a cozy living room, the adult on '
                                         'the left resting the right elbow on the armrest, the adult on the right '
                                         'holding a red mug with both hands, a floor lamp glowing behind them',
                               'prompt_pt': 'dois adultos sentados numa poltrona de veludo cinza na sala de estar, o '
                                            'adulto da esquerda com o cotovelo direito no braço do sofá'}, 'action')
    assert draft['prompt'] == ('two adults sitting on a seat, the adult on the left resting the right elbow on the side '
                               'of the seat, the adult on the right holding a mug with both hands')
    assert draft['prompt_pt'] == ('dois adultos sentados num assento, o adulto da esquerda com o cotovelo direito na '
                                  'lateral do assento')
    assert draft['requirements']['support_any_of'] == ['seat']


def test_the_auditor_points_out_colors_and_materials_in_a_pose():
    from conftest import item
    from prisma_studio.domain.text_audit import audit_item
    pose = item('pose.x', 'pose', 'sitting on a leather seat with both hands on the knees and the back straight',
                prompt_pt='x', req={'participants': 1, 'posture': 'seated', 'support_any_of': ['seat']})
    assert 'scene_details' in {f.code for f in audit_item(pose)}


def test_furniture_parts_lists_of_what_stays_and_the_label_are_generic():
    draft = draft_from_answer({**HUG, 'participants': 2, 'posture': 'seated', 'support_any_of': ['seat', 'wall'],
                               'label': 'Conversar no sofá',
                               'prompt': 'two adults seated on a couch, the right arm along the sofa backrest',
                               'edit_prompt': 'Change the pose so that the two adults sit on a couch, the right arm '
                                              'along the backrest; the mug, the sofa, the wall remain unchanged.'},
                              'action')
    assert draft['label'] == 'Conversar (dois adultos)'
    assert draft['prompt'] == 'two adults seated on a seat, the right arm along the back of the seat'
    assert draft['edit_prompt'] == ('Change the pose so that the two adults sit on a seat, the right arm along the back '
                                    'of the seat.')
    assert draft['requirements']['support_any_of'] == ['seat']


def test_a_list_of_what_to_keep_goes_as_a_whole_and_bare_words_are_read():
    from prisma_studio.application.reference_description import parse_answer
    draft = draft_from_answer({**HUG, 'participants': 2, 'posture': 'seated', 'support_any_of': ['seat'],
                               'edit_prompt': 'Change the pose of the two adults on the sofa so that they sit side by '
                                              'side, leaning in; keep the cream sweaters, the red mug, the white wall '
                                              'and the soft lighting exactly as in the original photo.'}, 'action')
    assert draft['edit_prompt'] == 'Change the pose of the two adults on the seat so that they sit side by side, leaning in.'
    assert parse_answer('{"posture": standing, "gaze": any, "children": false}') == {
        'posture': 'standing', 'gaze': 'any', 'children': False}
