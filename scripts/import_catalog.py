"""Import the legacy catalog as data, applying the explicit review in catalog/review-v1.json.

Usage: python scripts/import_catalog.py <legacy defaults.json> [catalog/defaults.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend' / 'src'))

from prisma_studio.domain.catalog import Item, Library, merge  # noqa: E402


def new_id(old: dict) -> str:
    return f'{old["category"]}.{old["id"].rsplit(".", 1)[-1]}'.lower()


def convert(legacy: dict, review: dict) -> Library:
    items, seen = [], set()
    for old in legacy['items']:
        item_id = new_id(old)
        if item_id in review['drop']:
            continue
        requirements = {k: v for k, v in old.get('requirements', {}).items() if k != 'confirmations' and v is not None}
        provides = {k: v for k, v in old.get('provides', {}).items() if v is not None}
        category = old['category']
        if item_id in review['move']:
            move = review['move'][item_id]
            category = move['category']
            requirements = move.get('requirements', {})
            item_id = move['id']
        requirements.update(review['requirements'].get(item_id, {}))
        if category == 'expression':
            requirements = {k: v for k, v in requirements.items() if k == 'gaze'}
        rewrite = review.get('prompts', {}).get(item_id)
        prompt, prompt_pt = (rewrite['prompt'], rewrite['prompt_pt']) if rewrite else (old['prompt'], old.get('prompt_pt'))
        if item_id in review['supports']:
            provides['supports'] = review['supports'][item_id]
        if item_id in seen:
            raise SystemExit(f'Identificador repetido após a conversão: {item_id}')
        seen.add(item_id)
        items.append(Item(id=item_id, category=category, label=old['label'], prompt=prompt,
                          prompt_pt=prompt_pt, adult=bool(old.get('adult_only')),
                          enabled=bool(old.get('enabled', True)), requirements=requirements, provides=provides))
    additions = json.loads((ROOT / 'catalog' / 'additions-v1.json').read_text(encoding='utf-8'))
    for data in additions['items']:
        if data['id'] in seen:
            raise SystemExit(f'Identificador repetido nas adições: {data["id"]}')
        seen.add(data['id'])
        items.append(Item.model_validate(data))
    library = Library(items=items)
    merge(library, Library())
    return library


def main() -> None:
    source = Path(sys.argv[1])
    target = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'catalog' / 'defaults.json'
    review = json.loads((ROOT / 'catalog' / 'review-v1.json').read_text(encoding='utf-8'))
    library = convert(json.loads(source.read_text(encoding='utf-8')), review)
    data = library.model_dump(mode='json', exclude_defaults=False)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    counts: dict[str, int] = {}
    for item in library.items:
        counts[item.category] = counts.get(item.category, 0) + 1
    print(f'{len(library.items)} opções importadas: {counts}')


if __name__ == '__main__':
    main()
