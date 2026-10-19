"""English rendering for Qwen Image 2.1, following the official enhancer guide.

Operation first; one general preservation clause that names what stays without
re-describing it; identity points at the reference image; affirmative wording;
<imageN> tags only when two or more images are sent; no output size in the text.
"""
from __future__ import annotations

from . import ir

ASPECT_NAMES = {
    'subject': 'person', 'face': 'facial identity', 'body': 'body shape and proportions', 'skin': 'skin tone and texture',
    'hair': 'hairstyle and hair color', 'wardrobe': 'clothing and accessories', 'environment': 'background and setting',
    'pose': 'body pose', 'expression': 'facial expression', 'action': 'action', 'lighting': 'lighting',
    'style': 'visual style and rendering medium', 'camera': 'camera angle and perspective', 'framing': 'framing and crop',
}
EDIT_OPERATIONS = {
    'environment': 'Replace the background and setting with {}.',
    'lighting': 'Relight the scene with {}.',
    'style': 'Render the whole image in this visual style: {}.',
    'camera': 'Change the camera angle and perspective to {}.',
    'framing': 'Reframe the shot as {}.',
    'subject': 'Replace the person with {}.',
    'face': 'Change the facial features to: {}.',
    'body': 'Change the body build to: {}.',
    'skin': 'Change the skin to: {}.',
    'hair': 'Change the hair to: {}.',
    'wardrobe': 'Change the clothing to {}.',
    'pose': 'Change the body pose to {}.',
    'action': 'Show the person {}.',
    'expression': 'Change the facial expression to {}.',
}
GENERATE_LABELS = {
    'style': 'Visual style', 'subject': 'Subject', 'face': 'Face', 'body': 'Body', 'skin': 'Skin', 'hair': 'Hair',
    'wardrobe': 'Clothing', 'pose': 'Pose', 'action': 'Action', 'expression': 'Expression',
    'environment': 'Setting', 'lighting': 'Lighting', 'camera': 'Camera', 'framing': 'Framing',
}
POSTURES = {
    'standing': 'The posture is clearly standing, with weight resting naturally on the feet.',
    'seated': 'The posture is clearly seated, with the hips supported.',
    'kneeling': 'The posture is clearly kneeling, with the knees supported.',
    'all_fours': 'The body is on all fours, with the knees on the surface and the hips above them.',
    'squatting': 'The body is in a deep squat, with the knees bent and the weight on the feet.',
    'lying': 'The body is lying down, supported along its length.',
    'supine': 'The body is lying on its back, with the back resting on the surface.',
    'prone': 'The body is lying face down, with the front of the torso resting on the surface.',
    'side_lying': 'The body is lying on its side, resting on one hip and shoulder.',
    'walking': 'The body is in a natural walking stride.',
    'running': 'The body is in a balanced running stride.',
}
GAZES = {
    'camera': 'The eyes look at the camera.', 'away': 'The eyes look away from the camera.',
    'down': 'The eyes look downwards.', 'up': 'The eyes look upwards.',
    'back': 'The head turns to look back over the shoulder.', 'closed': 'The eyes are closed.',
    # Written by the compiler when the body orientation needs a head turn to see the camera.
    'over_shoulder_camera': 'The head turns to look back over the shoulder toward the camera, no further than the neck '
                            'allows, and the eyes look at the camera.',
    'turn_to_camera': 'The head turns toward the camera, no further than the shoulder, and the eyes look at the camera.',
}
HEAD = 'The neck stays natural: the head turns no further than over the shoulder.'
ORIENTATIONS = {
    'front': 'The front of the body faces the camera.',
    'back': 'The body is seen from behind, with the back toward the camera.',
    'side': 'The body is seen in profile, side-on to the camera.',
    'three_quarter': 'The body is turned three-quarters toward the camera.',
}
SUPPORTS = {'floor': 'the floor', 'seat': 'a seat', 'bed': 'a bed', 'wall': 'a wall', 'table': 'a table'}
FRAMINGS = {
    'portrait': 'Show the whole face.',
    'half': 'Show the head, torso and arms.',
    'full': 'Show the entire body, including hands and feet.',
    'wide': 'Use a wide shot that shows the people and their surroundings.',
}


ORDINALS = {1: 'first', 2: 'second', 3: 'third', 4: 'fourth'}
CHARACTER_ASPECTS = 'facial identity, body shape, skin tone and hairstyle'


def _join(words) -> str:
    words = list(words)
    if len(words) <= 2:
        return ' and '.join(words)
    return ', '.join(words[:-1]) + ', and ' + words[-1]


def _sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith(('.', '!', '?')) else text + '.'


def render(blocks) -> list[tuple[str, str]]:
    header = next((b for b in blocks if isinstance(b, ir.Header)), None)
    multi = header is not None and header.image_count >= 2
    edit = header is not None and header.mode == 'edit'

    def image(slot: int) -> str:
        if multi:
            return f'<image{slot}>'
        return 'the image' if edit else 'the reference image'

    cast = any(isinstance(b, ir.Character) for b in blocks)
    out: list[tuple[str, str]] = []
    for block in blocks:
        if isinstance(block, ir.Manual):
            out.append((block.id, block.text))
        elif isinstance(block, ir.Header):
            out.append((block.id, f'Edit {image(1)}.' if edit else 'Create an image.'))
        elif isinstance(block, ir.Operation):
            out.append((block.id, _operation(block, edit, blocks)))
        elif isinstance(block, ir.WardrobeScope):
            target = ('both people in the scene' if block.total == 2 else f'all {block.total} people in the scene') \
                if block.target == 'all' else 'the first person only'
            text = f'Apply the clothing instruction to {target}.'
            if block.target == 'all':
                text += ' This includes any characters added from reference images.'
            out.append((block.id, text))
        elif isinstance(block, ir.Transfer):
            aspects = _join(ASPECT_NAMES[a] for a in block.aspects)
            if edit:
                to = f'the first person in {image(1)}' if cast else image(1)
                out.append((block.id, f'Take the {aspects} from {image(block.slot)} and apply them to {to}; '
                                      f'use {image(block.slot)} only for these aspects.'))
            else:
                whose = ' of the first person' if cast else ''
                out.append((block.id, f'Use {image(block.slot)} as the reference for the {aspects}{whose}.'))
        elif isinstance(block, ir.Character):
            out.append((block.id, _character(block, image(block.slot))))
        elif isinstance(block, ir.Keep):
            names = [ASPECT_NAMES[a] for a in block.aspects]
            if block.allow_action_movement and 'body pose' in names:
                names[names.index('body pose')] = 'body pose, apart from the movement the action needs'
            gaze_changes = any(isinstance(b, ir.Guidance) and b.key == 'gaze' for b in blocks)
            if gaze_changes and 'facial expression' in names:
                names[names.index('facial expression')] = 'facial expression, apart from the requested gaze direction'
            target = image(1)
            if block.everything_else and names:
                text = f'Keep everything else in {target} unchanged, including the {_join(names)}.'
            elif block.everything_else:
                text = f'Keep everything else in {target} unchanged.'
            else:
                text = f'Keep the {_join(names)} from {target} unchanged.'
            out.append((block.id, text))
        elif isinstance(block, ir.Participants) and block.total == 1:
            out.append((block.id, 'The result shows exactly one person.' if block.edit
                        else 'The scene contains exactly one person.'))
        elif isinstance(block, ir.Participants):
            if block.edit:
                text = (f'The scene contains at least {block.total} distinct people: keep the people already present '
                        'and add only the missing ones, each with a separate body and identity.')
            else:
                text = f'The scene contains {block.total} distinct people, each with a separate body and identity.'
            out.append((block.id, text))
        elif isinstance(block, ir.MinimumFraming):
            out.append((block.id, FRAMINGS[block.framing]))
        elif isinstance(block, ir.Guidance):
            out.append((block.id, _guidance(block)))
        elif isinstance(block, ir.Details):
            out.append((block.id, 'Additional details: ' + _sentence(block.text)))
        else:  # pragma: no cover - guarded by the compiler's coverage check
            raise TypeError(f'Bloco sem renderização: {block!r}')
    if header is not None and not edit:
        out.append(('closing', 'Keep anatomy, perspective and lighting coherent.'))
    return out


BODY_EMPHASIS = {
    'pose': 'Reposition the head, torso, arms, hands, legs and feet exactly as described, so the new pose is '
            'unmistakable.',
    'action': 'Make the hands, any held object and every point of contact clearly visible and readable.',
}


def _operation(block: ir.Operation, edit: bool, blocks) -> str:
    text = block.text.rstrip('. ')
    if edit and block.is_instruction:
        return _sentence(text)
    has_pose = any(isinstance(b, ir.Operation) and b.category == 'pose' for b in blocks)
    if block.category == 'action':
        group = (block.participants or 1) > 1
        subject = '' if group else 'the person '
        sentence = f'Show {subject}{text}' if edit else f'Action: {text}'
        if has_pose and not group:
            sentence += '; keep the requested pose for the torso and legs, and let the arms and hands follow this action'
        return f'{sentence}. {BODY_EMPHASIS["action"]}'
    if edit:
        sentence = EDIT_OPERATIONS[block.category].format(text)
    else:
        sentence = f'{GENERATE_LABELS[block.category]}: {text}.'
    if block.category == 'pose':
        sentence += ' ' + BODY_EMPHASIS['pose']
    return sentence


def _character(block: ir.Character, source: str) -> str:
    ordinal = ORDINALS.get(block.ordinal, f'person number {block.ordinal}')
    text = (f'The {ordinal} person has the {CHARACTER_ASPECTS} of the person in {source}; '
            f'use {source} only for this person\'s appearance.')
    if block.description:
        text += f' The {ordinal} person: ' + _sentence(block.description)
    return text


def _guidance(block: ir.Guidance) -> str:
    if block.key == 'posture':
        return POSTURES[block.value]
    if block.key == 'gaze':
        return GAZES[block.value]
    if block.key == 'orientation':
        return ORIENTATIONS[block.value]
    if block.key == 'head':
        return HEAD
    if block.key == 'new_supports':
        return 'Add only the support surfaces the pose or action needs.'
    surface = SUPPORTS[block.value]
    if block.key == 'support':
        return (f'The body is supported by {surface}, with believable contact and weight; it does not rest partly '
                'on another surface unless the pose describes it.')
    return f'Part of the body rests on {surface}, with believable contact and weight.'
