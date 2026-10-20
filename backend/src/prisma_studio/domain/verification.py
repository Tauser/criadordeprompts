"""Checklist derived from the compiled blocks and parsing of the judge's answer."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from . import ir
from .render_qwen21 import ANATOMY, ASPECT_NAMES, FACES, FRAMINGS, GAZES, ORIENTATIONS, POSTURES, SUPPORTS
from .rules import HIDDEN_FACE_GAZES

VERDICTS = ('met', 'partial', 'unmet', 'unknown')
SCORES = {'met': 1.0, 'partial': 0.5, 'unmet': 0.0, 'unknown': 0.0}


FACE_INTEGRITY = ('Every visible face is free of deformities: the eyes, eyebrows, nose, mouth, teeth and ears are complete '
                  'and correctly placed, with no smeared, melted, doubled or lopsided features')
IDENTITY_CATEGORIES = ('subject', 'face', 'body', 'skin', 'hair', 'expression')


@dataclass(frozen=True)
class Check:
    id: str
    question: str


def checklist(blocks) -> list[Check]:
    acting = any(isinstance(b, ir.Operation) and b.category == 'action' for b in blocks)
    hidden_face = any(isinstance(b, ir.Guidance) and b.key == 'orientation' and b.value == 'back' for b in blocks)
    header = next((b for b in blocks if isinstance(b, ir.Header)), None)
    edit = header is not None and header.mode == 'edit'
    checks: list[Check] = []
    wardrobe_scope = next((b for b in blocks if isinstance(b, ir.WardrobeScope)), None)
    for block in blocks:
        if isinstance(block, ir.Operation):
            question = (f'The image fulfills this edit instruction: {block.text}' if block.is_instruction
                        else f'The {ASPECT_NAMES[block.category]} matches: {block.text}')
            if block.category == 'wardrobe' and edit and not block.is_instruction:
                question = (f'The clothing is visibly different from the outfit in the original images and now '
                            f'matches: {block.text}')
            if block.category == 'pose' and acting:
                question += ' (the arms and hands may follow the action instead)'
            if block.category == 'wardrobe' and wardrobe_scope:
                total = wardrobe_scope.total if wardrobe_scope.target == 'all' else 1
                for person in range(1, total + 1):
                    checks.append(Check(f'{block.id}.person.{person}', f'For person {person}: {question}'))
            else:
                checks.append(Check(block.id, question))
        elif isinstance(block, ir.Transfer):
            aspects = ', '.join(ASPECT_NAMES[a] for a in block.aspects)
            checks.append(Check(block.id, f'The {aspects} match reference image {block.slot}'))
        elif isinstance(block, ir.Character):
            checks.append(Check(block.id, f'Another distinct person in the image matches the appearance of reference '
                                          f'image {block.slot}'))
        elif isinstance(block, ir.Keep) and block.aspects:
            aspects = ', '.join(ASPECT_NAMES[a] for a in block.aspects)
            checks.append(Check(block.id, f'The {aspects} are unchanged from the original image 1'))
        elif isinstance(block, ir.Participants) and block.total == 1:
            checks.append(Check(block.id, 'The image shows exactly one person'))
        elif isinstance(block, ir.Participants):
            checks.append(Check(block.id, f'The image shows {"at least " if edit else ""}{block.total} distinct people'))
        elif isinstance(block, ir.MinimumFraming):
            checks.append(Check(block.id, FRAMINGS[block.framing]))
        elif (isinstance(block, ir.Guidance) and block.key == 'gaze' and hidden_face
              and block.value in HIDDEN_FACE_GAZES):
            continue                                 # the face is out of view: the gaze cannot be judged
        elif isinstance(block, ir.Guidance) and block.key == 'anatomy':
            checks.append(Check(block.id, ANATOMY.rstrip('.')))
        elif isinstance(block, ir.Guidance) and block.key == 'faces' and not hidden_face:
            checks.append(Check(block.id, f'{FACE_INTEGRITY}; {FACES[0].lower()}{FACES[1:].rstrip(".")}'))
        elif isinstance(block, ir.Guidance) and block.key == 'head':
            checks.append(Check(block.id, 'The head and neck look anatomically natural, turned no further than over '
                                          'the shoulder'))
        elif isinstance(block, ir.Guidance) and block.key in ('posture', 'orientation', 'gaze'):
            names = {'posture': POSTURES, 'orientation': ORIENTATIONS, 'gaze': GAZES}[block.key]
            checks.append(Check(block.id, names.get(block.value, block.value)))
        elif isinstance(block, ir.Guidance) and block.key == 'support':
            checks.append(Check(block.id, f'The body is supported by {SUPPORTS[block.value]}, not split between different surfaces'))
        elif isinstance(block, ir.Details):
            checks.append(Check(block.id, f'These details are present: {block.text}'))
    # Faces are judged in every picture of people, not only in groups: deformities are what spoils a result most.
    has_people = edit or any(isinstance(b, (ir.Character, ir.Participants)) or (isinstance(b, ir.Operation)
                             and b.category in IDENTITY_CATEGORIES) for b in blocks)
    if has_people and not hidden_face and not any(c.id == 'guide.faces' for c in checks):
        checks.append(Check('faces', FACE_INTEGRITY))
    return checks


JUDGE_SYSTEM = (
    'You are a strict visual inspector. You receive the generated image first, followed by any reference images, '
    'and a checklist. For each item decide only from what is visible: "met", "partial", "unmet" or '
    '"unknown" when it cannot be judged. Answer with JSON only, as {"results": [{"id": "...", "verdict": "...", '
    '"note": "short reason"}]}, one entry per checklist item, in the same order. '
    'Copy each id exactly from its square brackets; do not replace ids with sequential numbers. '
    'Look at every face up close: small faces in a group often have uneven eyes or a deformed nose or mouth. When a '
    'face is too small or blurry to confirm it is free of defects, answer "partial", not "met".')


def _bare(value) -> str:
    """Judges sometimes copy the brackets the checklist puts around each id."""
    return str(value).strip().strip('[]').strip()


FACE_CLOSEUP = ('The last image is an enlarged close-up of the faces in the generated image, not a reference: '
                'judge the faces from it.')
FACE_CHECKS = ('faces', 'guide.faces')


def judge_prompt(checks: list[Check], face_closeup: bool = False) -> str:
    lines = [f'[{c.id}] {c.question}' for c in checks]
    return (FACE_CLOSEUP + '\n' if face_closeup else '') + 'Checklist:\n' + '\n'.join(lines)


def parse_verdicts(text: str, checks: list[Check]) -> dict[str, dict]:
    """Return {check id: {verdict, note}}; anything missing or malformed becomes 'unknown'."""
    if '</think>' in text.lower():
        text = re.split(r'</think>', text, flags=re.I)[-1]
    match = re.search(r'\{.*\}', text, flags=re.S)
    results: dict[str, dict] = {}
    if match:
        try:
            data = json.loads(match.group(0))
        except ValueError:
            data = None
        entries = data.get('results') if isinstance(data, dict) else None
        entries = entries if isinstance(entries, list) else []
        ids = [_bare(entry.get('id')) for entry in entries if isinstance(entry, dict)]
        expected = {c.id for c in checks}
        # Some local judges return the ordinal numbers from older checklists instead of the block IDs.
        # Accept only a complete, unique 1..N set; partial or mixed IDs cannot be mapped safely.
        numbered = (bool(checks) and len(entries) == len(ids) == len(checks)
                    and set(ids) == {str(i + 1) for i in range(len(checks))} and not expected.intersection(ids))
        aliases = {str(i + 1): c.id for i, c in enumerate(checks)} if numbered else {}
        for entry in entries:
            if isinstance(entry, dict) and entry.get('verdict') in VERDICTS:
                key = _bare(entry.get('id'))
                results[aliases.get(key, key)] = {'verdict': entry['verdict'],
                                                  'note': str(entry.get('note', ''))[:300]}
    return {c.id: results.get(c.id, {'verdict': 'unknown', 'note': 'Sem resposta válida do avaliador.'})
            for c in checks}


def score(verdicts: dict[str, dict]) -> float:
    if not verdicts:
        return 0.0
    return round(sum(SCORES[v['verdict']] for v in verdicts.values()) / len(verdicts), 3)
