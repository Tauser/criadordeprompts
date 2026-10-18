"""Checklist derived from the compiled blocks and parsing of the judge's answer."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from . import ir
from .render_qwen21 import ASPECT_NAMES, FRAMINGS, GAZES, ORIENTATIONS, POSTURES

VERDICTS = ('met', 'partial', 'unmet', 'unknown')
SCORES = {'met': 1.0, 'partial': 0.5, 'unmet': 0.0, 'unknown': 0.0}


@dataclass(frozen=True)
class Check:
    id: str
    question: str


def checklist(blocks) -> list[Check]:
    header = next((b for b in blocks if isinstance(b, ir.Header)), None)
    edit = header is not None and header.mode == 'edit'
    checks: list[Check] = []
    wardrobe_scope = next((b for b in blocks if isinstance(b, ir.WardrobeScope)), None)
    for block in blocks:
        if isinstance(block, ir.Operation):
            question = (f'The image fulfills this edit instruction: {block.text}' if block.is_instruction
                        else f'The {ASPECT_NAMES[block.category]} matches: {block.text}')
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
        elif isinstance(block, ir.Guidance) and block.key in ('posture', 'orientation', 'gaze'):
            names = {'posture': POSTURES, 'orientation': ORIENTATIONS, 'gaze': GAZES}[block.key]
            checks.append(Check(block.id, names.get(block.value, block.value)))
        elif isinstance(block, ir.Details):
            checks.append(Check(block.id, f'These details are present: {block.text}'))
    return checks


JUDGE_SYSTEM = (
    'You are a strict visual inspector. You receive the generated image first, followed by any reference images, '
    'and a checklist. For each item decide only from what is visible: "met", "partial", "unmet" or '
    '"unknown" when it cannot be judged. Answer with JSON only, as {"results": [{"id": "...", "verdict": "...", '
    '"note": "short reason"}]}, one entry per checklist item, in the same order. '
    'Copy each id exactly from its square brackets; do not replace ids with sequential numbers.')


def judge_prompt(checks: list[Check]) -> str:
    lines = [f'[{c.id}] {c.question}' for c in checks]
    return 'Checklist:\n' + '\n'.join(lines)


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
        ids = [str(entry.get('id')) for entry in entries if isinstance(entry, dict)]
        expected = {c.id for c in checks}
        # Some local judges return the ordinal numbers from older checklists instead of the block IDs.
        # Accept only a complete, unique 1..N set; partial or mixed IDs cannot be mapped safely.
        numbered = (bool(checks) and len(entries) == len(ids) == len(checks)
                    and set(ids) == {str(i + 1) for i in range(len(checks))} and not expected.intersection(ids))
        aliases = {str(i + 1): c.id for i, c in enumerate(checks)} if numbered else {}
        for entry in entries:
            if isinstance(entry, dict) and entry.get('verdict') in VERDICTS:
                key = str(entry.get('id'))
                results[aliases.get(key, key)] = {'verdict': entry['verdict'],
                                                  'note': str(entry.get('note', ''))[:300]}
    return {c.id: results.get(c.id, {'verdict': 'unknown', 'note': 'Sem resposta válida do avaliador.'})
            for c in checks}


def score(verdicts: dict[str, dict]) -> float:
    if not verdicts:
        return 0.0
    return round(sum(SCORES[v['verdict']] for v in verdicts.values()) / len(verdicts), 3)
