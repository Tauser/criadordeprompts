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
    'face': 'Change the face to {}.',
    'body': 'Change the body to {}.',
    'skin': 'Change the skin to {}.',
    'hair': 'Change the hair to {}.',
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
    'lying': 'The body is lying down, supported along its length.',
    'walking': 'The body is in a natural walking stride.',
    'running': 'The body is in a balanced running stride.',
}
GAZES = {
    'camera': 'The eyes look at the camera.', 'away': 'The eyes look away from the camera.',
    'down': 'The eyes look downwards.', 'up': 'The eyes look upwards.',
    'back': 'The head turns to look back over the shoulder.', 'closed': 'The eyes are closed.',
}
SUPPORTS = {'floor': 'the floor', 'seat': 'a seat', 'bed': 'a bed', 'wall': 'a wall', 'table': 'a table'}
FRAMINGS = {
    'portrait': 'Show the whole face.',
    'half': 'Show the head, torso and arms.',
    'full': 'Show the entire body, including hands and feet.',
    'wide': 'Use a wide shot that shows the people and their surroundings.',
}


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

    out: list[tuple[str, str]] = []
    for block in blocks:
        if isinstance(block, ir.Manual):
            out.append((block.id, block.text))
        elif isinstance(block, ir.Header):
            out.append((block.id, f'Edit {image(1)}.' if edit else 'Create an image.'))
        elif isinstance(block, ir.Operation):
            text = block.text.rstrip('. ')
            if edit:
                out.append((block.id, EDIT_OPERATIONS[block.category].format(text)))
            else:
                out.append((block.id, f'{GENERATE_LABELS[block.category]}: {text}.'))
        elif isinstance(block, ir.Transfer):
            aspects = _join(ASPECT_NAMES[a] for a in block.aspects)
            if edit:
                out.append((block.id, f'Take the {aspects} from {image(block.slot)} and apply them to {image(1)}; '
                                      f'use {image(block.slot)} only for these aspects.'))
            else:
                out.append((block.id, f'Use {image(block.slot)} as the reference for the {aspects}.'))
        elif isinstance(block, ir.Keep):
            names = [ASPECT_NAMES[a] for a in block.aspects]
            if block.allow_action_movement and 'body pose' in names:
                names[names.index('body pose')] = 'body pose, apart from the movement the action needs'
            target = image(1)
            if block.everything_else and names:
                text = f'Keep everything else in {target} unchanged, including the {_join(names)}.'
            elif block.everything_else:
                text = f'Keep everything else in {target} unchanged.'
            else:
                text = f'Keep the {_join(names)} from {target} unchanged.'
            out.append((block.id, text))
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


def _guidance(block: ir.Guidance) -> str:
    if block.key == 'posture':
        return POSTURES[block.value]
    if block.key == 'gaze':
        return GAZES[block.value]
    if block.key == 'new_supports':
        return 'Add only the support surfaces the pose or action needs.'
    options = [SUPPORTS[s] for s in block.value.split('|')]
    choice = options[0] if len(options) == 1 else ', '.join(options[:-1]) + ' or ' + options[-1]
    return f'The body rests on {choice}, with believable contact and weight.'
