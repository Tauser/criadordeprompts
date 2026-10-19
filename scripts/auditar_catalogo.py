"""Audit the library wording and sweep option combinations for conflicts and contradictory prompts.

Usage: python scripts/auditar_catalogo.py [--url http://127.0.0.1:8780] [--json saida.json]
Reads the live library from the running Studio (catalog plus your own items); without it, only the catalog file.
"""
from __future__ import annotations

import argparse
import collections
import itertools
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend' / 'src'))

from prisma_studio.domain.catalog import Library  # noqa: E402
from prisma_studio.domain.compiler import compile_request  # noqa: E402
from prisma_studio.domain.request import Request  # noqa: E402
from prisma_studio.domain.rules import assess  # noqa: E402
from prisma_studio.domain.text_audit import audit_item, contradictions_in_prompt  # noqa: E402


def load(url: str | None) -> tuple[Library, dict]:
    if url:
        try:
            snap = json.load(urllib.request.urlopen(url.rstrip('/') + '/api/library', timeout=5))
            return Library.model_validate({'items': snap['items']}), snap['origins']
        except OSError:
            print('Studio fora do ar: auditando só catalog/defaults.json.', file=sys.stderr)
    data = json.loads((ROOT / 'catalog' / 'defaults.json').read_text(encoding='utf-8'))
    return Library.model_validate(data), {i['id']: 'builtin' for i in data['items']}


def cat(item_id):
    return {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': item_id}}


def sweep(library: Library) -> dict:
    """Body options against gaze and camera choices, in a new image and in an edit that keeps the person."""
    items = [i for i in library.items if i.enabled]
    by = collections.defaultdict(list)
    for i in items:
        by[i.category].append(i)
    keep = {c: {'intent': 'keep'} for c in ('subject', 'face', 'body')}
    stats = collections.Counter()
    examples: dict[str, list] = collections.defaultdict(list)
    for body in by['pose'] + by['action']:
        for other in [None] + by['expression'] + by['camera']:
            for mode in ('generate', 'edit'):
                attrs = {body.category: cat(body.id)}
                if other is not None:
                    attrs[other.category] = cat(other.id)
                extra = {'content_mode': 'adult', 'confirmations': ['adults_only', 'consent_or_fictional']}
                if mode == 'edit':
                    request = Request(mode='edit', target_id='t', references=[{'id': 't', 'label': 'alvo'}],
                                      attributes={**keep, **attrs}, **extra)
                else:
                    request = Request(mode='generate', attributes=attrs, **extra)
                assessment = assess(request, library)
                stats['combinações'] += 1
                pair = f'{body.label} + {other.label if other else "—"} ({mode})'
                for issue in assessment.issues:
                    if issue.level in ('error', 'adjusted', 'warning') and issue.code not in (
                            'participants_mismatch', 'confirm_consent'):
                        stats[f'{issue.level}:{issue.code}'] += 1
                        if len(examples[issue.code]) < 4:
                            examples[issue.code].append(pair)
                if assessment.valid:
                    for problem in contradictions_in_prompt(compile_request(request, assessment).text):
                        stats['contradição no prompt'] += 1
                        if len(examples[problem]) < 6:
                            examples[problem].append(pair)
    for light, scene in itertools.product(by['lighting'], by['environment']):
        assessment = assess(Request(mode='generate', attributes={'lighting': cat(light.id),
                                                                  'environment': cat(scene.id)}), library)
        stats['luz × cenário'] += 1
        for issue in assessment.issues:
            if issue.code.startswith('light_'):
                stats[f'{issue.level}:{issue.code}'] += 1
                if len(examples[issue.code]) < 4:
                    examples[issue.code].append(f'{light.label} + {scene.label}')
    return {'stats': dict(stats), 'examples': dict(examples)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--url', default='http://127.0.0.1:8780')
    parser.add_argument('--json')
    args = parser.parse_args()
    library, origins = load(args.url)
    items = []
    for item in library.items:
        findings = audit_item(item)
        if findings:
            items.append({'id': item.id, 'label': item.label, 'category': item.category,
                          'origin': origins.get(item.id, 'builtin'),
                          'findings': [f.__dict__ for f in findings]})
    report = {'items': items, 'sweep': sweep(library)}
    counts = collections.Counter(f['code'] for i in items for f in i['findings'])
    print(f'Itens auditados: {len(library.items)} · com achados: {len(items)}')
    for code, n in counts.most_common():
        print(f'  {code}: {n}')
    print('\nVarredura de combinações:')
    for key, n in sorted(report['sweep']['stats'].items(), key=lambda kv: -kv[1]):
        print(f'  {key}: {n}')
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'\nRelatório completo em {args.json}')


if __name__ == '__main__':
    main()
