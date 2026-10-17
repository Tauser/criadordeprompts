"""Checklist derived from the compiled blocks and parsing of the judge's answer."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from . import ir
from .render_qwen21 import ASPECT_NAMES, FRAMINGS, GAZES, POSTURES

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
    for block in blocks:
        if isinstance(block, ir.Operation):
            checks.append(Check(block.id, f'The {ASPECT_NAMES[block.category]} matches: {block.text}'))
        elif isinstance(block, ir.Transfer):
            aspects = ', '.join(ASPECT_NAMES[a] for a in block.aspects)
            checks.append(Check(block.id, f'The {aspects} match reference image {block.slot}'))
        elif isinstance(block, ir.Character):
            checks.append(Check(block.id, f'Another distinct person in the image matches the appearance of reference '
                                          f'image {block.slot}'))
        elif isinstance(block, ir.Keep) and block.aspects:
            aspects = ', '.join(ASPECT_NAMES[a] for a in block.aspects)
            checks.append(Check(block.id, f'The {aspects} are unchanged from the original image 1'))
        elif isinstance(block, ir.Participants):
            checks.append(Check(block.id, f'The image shows {"at least " if edit else ""}{block.total} distinct people'))
        elif isinstance(block, ir.MinimumFraming):
            checks.append(Check(block.id, FRAMINGS[block.framing]))
        elif isinstance(block, ir.Guidance) and block.key in ('posture', 'gaze'):
            checks.append(Check(block.id, (POSTURES | GAZES).get(block.value, block.value)))
        elif isinstance(block, ir.Details):
            checks.append(Check(block.id, f'These details are present: {block.text}'))
    return checks


JUDGE_SYSTEM = (
    'You are a strict visual inspector. You receive the generated image first, followed by any reference images, '
    'and a numbered checklist. For each item decide only from what is visible: "met", "partial", "unmet" or '
    '"unknown" when it cannot be judged. Answer with JSON only, as {"results": [{"id": "...", "verdict": "...", '
    '"note": "short reason"}]}, one entry per checklist item, in the same order.')


def judge_prompt(checks: list[Check]) -> str:
    lines = [f'{i + 1}. [{c.id}] {c.question}' for i, c in enumerate(checks)]
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
            for entry in data.get('results', []):
                if isinstance(entry, dict) and entry.get('verdict') in VERDICTS:
                    results[str(entry.get('id'))] = {'verdict': entry['verdict'],
                                                     'note': str(entry.get('note', ''))[:300]}
        except (ValueError, AttributeError):
            pass
    return {c.id: results.get(c.id, {'verdict': 'unknown', 'note': 'Sem resposta válida do avaliador.'})
            for c in checks}


def score(verdicts: dict[str, dict]) -> float:
    if not verdicts:
        return 0.0
    return round(sum(SCORES[v['verdict']] for v in verdicts.values()) / len(verdicts), 3)
