"""Measures "Descrever a partir da foto" against the annotated photos in eval/pose_reading.

Usage: python scripts/eval_pose_reading.py <label> [--comfy http://127.0.0.1:8188]

Runs the describer on every photo with the real ComfyUI, scores the draft against gold.json and writes
eval/pose_reading/results/<label>.json. Facts are right (expected wording found), wrong (the opposite found) or
missing (neither); metadata are right or wrong. The patterns are heuristics: read the drafts next to the numbers.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend' / 'src'))

from prisma_studio.application.reference_description import ReferenceDescriber  # noqa: E402
from prisma_studio.infrastructure.comfy.client import ComfyClient  # noqa: E402

EVAL = ROOT / 'eval' / 'pose_reading'


class PhotoStore:
    """The describer reads photos by name from the evaluation folder instead of the Studio's file store."""

    def read(self, name: str) -> bytes:
        return (EVAL / 'photos' / name).read_bytes()


PERSON = re.compile(r'(?:adult|person|child) (?:on the (?:left|right)|in the (?:center|middle|front|back)|in front|behind)')


def person_scope(text: str, person: str) -> str:
    """The stretches of text about one person: from each mention of them to the next mention of someone else."""
    marks = [(m.start(), m.group(0)) for m in PERSON.finditer(text)]
    parts = []
    for i, (start, who) in enumerate(marks):
        if who in person:
            end = next((s for s, other in marks[i + 1:] if other not in person), len(text))
            parts.append(text[start:end])
    return ' | '.join(parts)


def score_fact(fact: dict, text: str) -> str:
    scope = text
    if fact.get('person'):
        scope = person_scope(text, fact['person'])
        if not scope:
            return 'missing'
    if fact.get('contradict') and re.search(fact['contradict'], scope):
        return 'wrong'
    return 'right' if re.search(fact['expect'], scope) else 'missing'


def score_meta(expected: dict, draft: dict) -> dict[str, bool]:
    req = draft['requirements']
    out = {'participants': req.get('participants') == expected['participants'],
           'support': sorted(req.get('support_any_of') or []) == sorted(expected['support'])}
    for key in ('posture', 'gaze', 'orientation'):
        if expected.get(key) is not None:
            out[key] = req.get(key) in expected[key]
    return out


def describe(describer: ReferenceDescriber, name: str, category: str, timeout: float = 600) -> tuple[dict, float]:
    started = time.time()
    job = describer.start(name, category)
    while job['status'] in ('queued', 'running') and time.time() - started < timeout:
        time.sleep(2)
        job = describer.status(job['id'])
    return job, time.time() - started


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('label')
    parser.add_argument('--comfy', default='http://127.0.0.1:8188')
    parser.add_argument('--rescore', action='store_true', help='score the drafts already saved under this label again')
    args = parser.parse_args()
    gold = json.loads((EVAL / 'gold.json').read_text(encoding='utf-8'))
    out = EVAL / 'results' / f'{args.label}.json'
    saved = {p['file']: p for p in json.loads(out.read_text(encoding='utf-8'))['photos']} if args.rescore else {}
    describer = ReferenceDescriber(ComfyClient(args.comfy), PhotoStore(), lambda name: {'mime': 'image/jpeg'})
    report, totals = [], {'right': 0, 'wrong': 0, 'missing': 0, 'meta_right': 0, 'meta_total': 0}
    for photo in gold['photos']:
        category = 'pose' if photo['meta']['participants'] == 1 else 'action'
        if args.rescore:
            old = saved[photo['file']]
            job = {'status': old['status'], 'error': old.get('error'), 'findings': [{'code': c} for c in old.get('findings', [])],
                   'draft': {'prompt': old['prompt'], 'requirements': old['requirements']} if old.get('prompt') else None}
            seconds = old['seconds']
        else:
            job, seconds = describe(describer, photo['file'], category)
        entry = {'file': photo['file'], 'status': job['status'], 'seconds': round(seconds), 'error': job.get('error')}
        draft = job.get('draft')
        if draft:
            text = draft['prompt'].lower()
            facts = {f['id']: score_fact(f, text) for f in photo['facts']}
            meta = score_meta(photo['meta'], draft)
            entry.update(prompt=draft['prompt'], requirements=draft['requirements'], facts=facts, meta=meta,
                         findings=[f['code'] for f in job.get('findings', [])])
        else:
            facts = {f['id']: 'missing' for f in photo['facts']}
            meta = {}
            entry.update(facts=facts, meta=meta)
        for result in facts.values():
            totals[result] += 1
        totals['meta_right'] += sum(meta.values())
        totals['meta_total'] += len(score_meta(photo['meta'], {'requirements': {}})) if not meta else len(meta)
        report.append(entry)
        marks = ' '.join({'right': '+', 'wrong': 'x', 'missing': '.'}[r] for r in facts.values())
        print(f"{photo['file']:22} {entry['status']:9} {entry['seconds']:4}s  fatos [{marks}]  "
              f"metadados {sum(meta.values())}/{len(meta)}")
    facts_total = totals['right'] + totals['wrong'] + totals['missing']
    print(f"\nFatos: {totals['right']}/{facts_total} certos, {totals['wrong']} errados, {totals['missing']} ausentes. "
          f"Metadados: {totals['meta_right']}/{totals['meta_total']} certos.")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({'label': args.label, 'totals': totals, 'photos': report}, ensure_ascii=False, indent=2),
                   encoding='utf-8', newline='\n')
    print(f'Relatório: {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
