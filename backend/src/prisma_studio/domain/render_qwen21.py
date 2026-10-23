"""English rendering for Qwen Image 2.1, following the official enhancer guide.

Operation first; one general preservation clause that names what stays without
re-describing it; identity points at the reference image; affirmative wording;
<imageN> tags only when two or more images are sent; no output size in the text.
"""
from __future__ import annotations

from . import ir
from .vocabulary import PERSON_ASPECTS

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
    'wardrobe': 'Replace the current clothing with {}; the original outfit is no longer worn.',
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
ANATOMY = ('Each person has exactly two arms, two hands, two legs and two feet, with natural adult proportions: '
           'the head is in scale with the shoulders and torso, neither enlarged nor shrunk.')
ANATOMY_MIXED_AGES = ('Each person has exactly two arms, two hands, two legs and two feet, with proportions natural '
                      "for that person's age: each head is in scale with that person's own shoulders and torso, "
                      'neither enlarged nor shrunk.')
FACES = ("Every face is sharp and natural: each person's two eyes "
         'match in size, shape and color, are level with each other and look in the same direction.')
CLOTHED = 'Every person is fully dressed in everyday clothing.'
GROWN = 'Every person is clearly a grown adult, at least twenty-five years old, with a mature face and body.'
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
# Spelled from the picture, not from anyone's point of view: "her left" flips with the way the person faces.
PLACES = {'left': 'on the left side of the picture, beside {beside}',
          'right': 'on the right side of the picture, beside {beside}',
          'behind': 'just behind {beside}, farther from the camera',
          'front': 'just in front of {beside}, closer to the camera'}


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
            if block.target == 'all' and edit:
                text = (f'Apply the clothing instruction to {target}, starting with the first person, who is already in '
                        f"{image(1)}: the first person's current clothing changes too and is not kept.")
            if block.target == 'all':
                text += ' This includes any characters added from reference images.'
                if cast:
                    text += f' Every person wears it, {_people(block.total)}.'
            out.append((block.id, text))
        elif isinstance(block, ir.Transfer) and is_skeleton(block):
            # The pose photo reaches the model as its SDPose skeleton. Measured: given the photo itself, the edit
            # copied the person and the chair of the pose photo; given the skeleton, it kept the person and followed
            # the pose.
            # Measured on a seated skeleton: "follow its arm positions" left the old waving arm in place as a third
            # arm in one seed of four; "nothing of the old pose remains" removed it in four of four.
            img = image(block.slot)
            seat = ('Where the skeleton sits, kneels or lies, add the seat or surface that holds the body, matching the '
                    'scene.')
            if edit:
                who = f'the first person in {image(1)}' if cast else f'the person in {image(1)}'
                out.append((block.id, f'Redraw {who} in the pose of the skeleton in {img}: the head, torso, both arms '
                                      'and both legs all move to the skeleton\'s positions, and nothing of the old pose '
                                      f'remains. {seat} Use {img} only to guide the body pose; draw no skeleton lines '
                                      'or joint markers.'))
            else:
                whose = ' of the first person' if cast else ''
                out.append((block.id, f'The body pose{whose} follows the skeleton in {img}: the head, torso, both arms '
                                      f'and both legs in the skeleton\'s positions. {seat} Draw no skeleton lines or '
                                      'joint markers.'))
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
            out.append((block.id, _character(block, image(block.slot), blocks)))
        elif isinstance(block, ir.Keep):
            # "Keep the person unchanged" would also freeze the clothing and pose being changed: name the identity.
            names = [ASPECT_NAMES[a] if a != 'subject' else 'identity of the person' for a in block.aspects
                     if not (a == 'subject' and 'face' in block.aspects)]
            if block.allow_action_movement and 'body pose' in names:
                names[names.index('body pose')] = 'body pose, apart from the movement the action needs'
            gaze_changes = any(isinstance(b, ir.Guidance) and b.key == 'gaze' for b in blocks)
            # Measured: a kept expression beats the smile or laugh the action asks for ("both smiling" stayed serious).
            acting = any(isinstance(b, ir.Operation) and b.category == 'action' for b in blocks)
            freed = [part for part, on in (('the requested gaze direction', gaze_changes),
                                           ('what the action shows on the face', acting)) if on]
            if any(isinstance(b, ir.Transfer) and is_skeleton(b) for b in blocks) and 'background and setting' in names:
                names[names.index('background and setting')] = 'background and setting, apart from that seat'
            if freed and 'facial expression' in names:
                names[names.index('facial expression')] = 'facial expression, apart from ' + ' and '.join(freed)
            target = image(1)
            if block.people_added:
                # The identity of the people already there is kept per person: a scene-wide "keep the facial identity"
                # lets the model paste the new person's face onto the first person instead of adding someone.
                personal = {ASPECT_NAMES[a] for a in PERSON_ASPECTS} | {'identity of the person'}
                own = [n for n in names if n.split(',')[0] in personal]
                scene = [n for n in names if n not in own]
                parts = [f"the first person's {_join(own)}" if own else '', f'the {_join(scene)}' if scene else '']
                listed = '; and '.join(p for p in parts if p)
                # Spelled out, or "keep everything of the first person" wins over the new clothing.
                dressed = any(isinstance(b, ir.Operation) and b.category == 'wardrobe' for b in blocks)
                lead = 'Apart from the requested clothing, keep' if dressed else 'Keep'
                if not block.everything_else:
                    text = f'Keep {listed} from {target} unchanged.'
                elif listed:
                    text = f'{lead} everything else in {target} unchanged, including {listed}.'
                else:
                    text = f'{lead} everything else in {target} unchanged.'
                if block.widen:
                    text += ' Widen the framing only as much as needed to fit every person, with the same perspective.'
                out.append((block.id, text))
                continue
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


# The RareTutor head and body swap wording, measured on the user's photos (full profile): the body swap needs the BFS
# body LoRA (without it the model returned the source photo); the head swap kept the face better without its LoRA.
SWAP_TEXT = {
    'head': ('head_swap: start with <image1> as the base image, keeping its lighting, environment, and background. '
             'remove the head from <image1> completely and replace it with the head from {source}, strictly preserving '
             'the hair, eye color, nose structure from {source}. copy the direction of the eye, head rotation, micro '
             'expressions from <image1>, high quality, sharp details, 4k'),
    'body': ('body_swap: start with <image1> as the base image, keeping its lighting, environment, and background. '
             'replace the body from <image1> with the body from {source}, strictly preserving the clothing, body shape '
             'and proportions from {source}. strictly replicate the exact pose, arm positions, leg positions, hand '
             'gestures, head rotation, eye direction and micro expressions from <image1>'),
}


def swap_prompt(mode: str, slot: int) -> str:
    return SWAP_TEXT[mode].format(source=f'<image{slot}>')


def is_skeleton(block: ir.Transfer) -> bool:
    """A reference that lends only the pose is sent as its skeleton."""
    return tuple(block.aspects) == ('pose',)


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
        sentence += '.'
        if group and any(isinstance(b, ir.Character) for b in blocks):
            sentence += f' The people performing this action are {_people(block.participants)}.'
        return f'{sentence} {BODY_EMPHASIS["action"]}'
    if edit:
        sentence = EDIT_OPERATIONS[block.category].format(text)
    else:
        sentence = f'{GENERATE_LABELS[block.category]}: {text}.'
    if block.category == 'pose':
        sentence += ' ' + BODY_EMPHASIS['pose']
    return sentence


def _people(count: int) -> str:
    return _join(f'the {ORDINALS.get(n, f"person number {n}")} person' for n in range(1, count + 1))


def _character(block: ir.Character, source: str, blocks) -> str:
    """The reference lends only the identity: clothing and action come from the request when they cover this person."""
    ordinal = ORDINALS.get(block.ordinal, f'person number {block.ordinal}')
    if block.added:
        # Without an explicit "add", an edit model reads "has the face of <imageN>" as a face swap on the first person.
        beside = 'the first person' if block.ordinal == 2 else 'the other people'
        place = PLACES[block.position].format(beside=beside) if block.position else f'next to {beside}'
        action = next((b for b in blocks if isinstance(b, ir.Operation) and b.category == 'action'), None)
        # Measured on a piggyback: without the redraw the head came straight from the reference, with its angle,
        # expression and light, and looked pasted on; asked for, it tilted with the body and took the scene's light.
        text = (f'Add a {ordinal} person to the scene, {place}, drawn anew in this scene with the {CHARACTER_ASPECTS} '
                f'of the person in {source} and nothing else from {source}: not its head angle, facial expression, '
                f'lighting or framing. Their head turns and tilts with their own body'
                f'{" for the action" if action is not None else ""}, sits naturally on their own neck and shoulders, '
                "is in scale with the first person's head for its distance from the camera, and is lit by the light "
                f'of the scene. The first person keeps their own face and takes no facial features from {source}.')
    else:
        text = (f'The {ordinal} person has the {CHARACTER_ASPECTS} of the person in {source}; '
                f'use {source} only for this person\'s identity.')
        if block.position:
            beside = 'the first person' if block.ordinal == 2 else 'the other people'
            text += f' The {ordinal} person is ' + PLACES[block.position].format(beside=beside) + '.'
    if any(isinstance(b, ir.WardrobeScope) and b.target == 'all' for b in blocks):
        text += f' The {ordinal} person wears the requested clothing, not the clothing from {source}.'
    # Who takes part in a group action is said once, by the action itself ("The people performing this action...").
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
    if block.key == 'anatomy':
        return ANATOMY_MIXED_AGES if block.value == 'mixed_ages' else ANATOMY
    if block.key == 'faces':
        return FACES
    if block.key == 'clothing':
        return CLOTHED
    if block.key == 'age':
        return GROWN
    if block.key == 'new_supports':
        return 'Add only the support surfaces the pose or action needs.'
    surface = SUPPORTS[block.value]
    if block.key == 'support':
        return (f'The body is supported by {surface}, with believable contact and weight; it does not rest partly '
                'on another surface unless the pose describes it.')
    return f'Part of the body rests on {surface}, with believable contact and weight.'
