"""Banco de casos: roda as edições de `benchmark/casos.json` no Studio e monta uma folha de comparação.

Uso (com o Studio e o ComfyUI ligados):
    .venv/Scripts/python.exe scripts/banco_de_casos.py              # todos os casos
    .venv/Scripts/python.exe scripts/banco_de_casos.py --casos 04 05  # só os que começam com esses números
    .venv/Scripts/python.exe scripts/banco_de_casos.py --manter       # deixa as gerações no Histórico

A folha sai em `benchmark/resultados/<data>-<commit>/folha.png`, com uma linha por caso e uma coluna por seed;
cada imagem traz o aviso de pessoa a mais quando a contagem de rostos acusar. Rodar antes e depois de uma mudança
e comparar as duas folhas é o teste: as seeds são fixas, então a diferença vem da mudança.
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / 'benchmark'
CELL = 384                      # altura de cada imagem na folha
TERMINAL = {'completed', 'failed', 'cancelled', 'lost'}


def call(base: str, method: str, path: str, body=None, raw: bytes | None = None, headers=None, timeout=60):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(base + path, data=data, method=method,
                                     headers=headers or ({'Content-Type': 'application/json'} if body is not None else {}))
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f'{method} {path}: {error.code} {error.read()[:500].decode(errors="replace")}') from error
    return payload if path.startswith('/api/files/') and method == 'GET' else json.loads(payload or b'null')


def upload(base: str, path: Path) -> str:
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
            f'Content-Type: {"image/png" if path.suffix.lower() == ".png" else "image/jpeg"}\r\n\r\n').encode() + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    return call(base, 'POST', '/api/files', raw=body,
                headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})['hash']


def value(text: str) -> dict:
    if text.startswith('texto:'):
        return {'kind': 'text', 'text': text[len('texto:'):]}
    return {'kind': 'catalog', 'item_id': text}


IDENTITY = ('face', 'body', 'skin', 'hair')        # what "principal" (the first person's ficha) lends


def build(spec: dict, case: dict, seed: int) -> tuple[dict, dict[str, str]]:
    """The request and the reference ids -> photo names it needs. A case with "modo": "gerar" generates from nothing;
    "principal" is a photo whose face, body, skin and hair go to the first person."""
    edit = case.get('modo', 'editar') == 'editar'
    # A character is a photo name, or {"foto": ..., "posicao": "left|right|behind|front"}.
    people = [p if isinstance(p, dict) else {'foto': p} for p in case.get('personagens', [])]
    refs = {'alvo': case['foto']} if edit else {}
    if 'principal' in case:
        refs['principal'] = case['principal']
    refs |= {f'p{i}': p['foto'] for i, p in enumerate(people, 2)}
    attributes = {c: {'intent': 'keep'} for c in spec['manter']
                  if edit and not ('principal' in case and c in IDENTITY)}
    if 'principal' in case:
        attributes |= {c: {'intent': 'transfer', 'reference_id': 'principal'} for c in IDENTITY}
    attributes |= {c: {'intent': 'set', 'value': value(v)} for c, v in case.get('mudar', {}).items()}
    if 'pose_de' in case:                            # the pose comes from another photo (sent as its skeleton)
        refs['pose'] = case['pose_de']
        attributes['pose'] = {'intent': 'transfer', 'reference_id': 'pose'}
    request = {
        'mode': 'edit' if edit else 'generate', 'target_id': 'alvo' if edit else None, 'attributes': attributes,
        'references': [{'id': ref_id, 'label': name} for ref_id, name in refs.items()],
        'characters': [{'reference_id': f'p{i}', **({'position': p['posicao']} if 'posicao' in p else {})}
                       for i, p in enumerate(people, 2)],
        'participants': {'existing': case['pessoas']} if edit else {},
        'context': {'allow_reframing': True, **case.get('contexto', {})} if edit else {},
        'details': case.get('detalhes', ''),
        'output': {'profile': spec['perfil'], 'resolution': spec['resolucao'], 'seed': seed, 'variations': 1,
                   **case.get('saida', {})},
    }
    if 'roupa_para' in case:
        request['wardrobe_scope'] = case['roupa_para']
    if case.get('conteudo') == 'adulto':             # the confirmations the Studio asks for in adult mode
        request |= {'content_mode': 'adult', 'confirmations': ['adults_only', 'consent_or_fictional']}
    return request, refs


def commit() -> str:
    try:
        return subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True,
                              check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return 'sem-git'


def _font(size: int):
    """A Windows font with accents; the built-in PIL font drops ç and ã."""
    for name in ('segoeui.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def sheet(rows: list[tuple[str, list[tuple[bytes | None, str]]]], title: str) -> Image.Image:
    font = _font(18)
    small = _font(15)
    cells = []
    for _, images in rows:
        line = []
        for data, note in images:
            if data:
                picture = Image.open(io.BytesIO(data)).convert('RGB')
                picture = picture.resize((round(picture.width * CELL / picture.height), CELL))
            else:
                picture = Image.new('RGB', (CELL * 3 // 4, CELL), (235, 235, 235))
            line.append((picture, note))
        cells.append(line)
    width = max(sum(p.width + 10 for p, _ in line) for line in cells) + 10
    out = Image.new('RGB', (width, 50 + len(rows) * (CELL + 60)), 'white')
    draw = ImageDraw.Draw(out)
    draw.text((10, 12), title, fill='black', font=font)
    y = 50
    for (name, _), line in zip(rows, cells):
        draw.text((10, y), name, fill='black', font=font)
        x = 10
        for picture, note in line:
            out.paste(picture, (x, y + 26))
            draw.text((x + 4, y + 30 + CELL), note, fill=(170, 30, 30) if '!' in note else (90, 90, 90), font=small)
            x += picture.width + 10
        y += CELL + 60
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--studio', default='http://127.0.0.1:8780')
    parser.add_argument('--casos', nargs='*', help='números dos casos a rodar (ex.: 04 05)')
    parser.add_argument('--manter', action='store_true', help='não apagar as gerações do Histórico no fim')
    parser.add_argument('--arquivo', type=Path, default=BENCH / 'casos.json',
                        help='outro arquivo de casos, por exemplo com itens da sua Biblioteca')
    args = parser.parse_args()
    spec = json.loads(args.arquivo.read_text(encoding='utf-8'))
    cases = [c for c in spec['casos'] if not args.casos or c['nome'].split()[0] in args.casos]
    if not cases:
        raise SystemExit('Nenhum caso com esses números.')

    hashes: dict[str, str] = {}
    jobs = []                                       # (case, seed, run id)
    for case in cases:
        for seed in spec['seeds']:
            request, refs = build(spec, case, seed)
            prepared = call(args.studio, 'POST', '/api/prepare', request)
            if not prepared['valid']:
                problems = '; '.join(i['message'] for i in prepared['issues'] if i['level'] == 'error')
                raise SystemExit(f'Caso inválido "{case["nome"]}": {problems}')
            for name in refs.values():
                hashes.setdefault(name, upload(args.studio, BENCH / 'fotos' / name))
            run = call(args.studio, 'POST', '/api/runs', {
                'request_id': str(uuid.uuid4()), 'request': request,
                'files': {ref_id: hashes[name] for ref_id, name in refs.items()}, 'mask': None})
            jobs.append((case, seed, run['id']))
    print(f'{len(jobs)} gerações na fila.', flush=True)

    started = time.time()
    results: dict[str, dict] = {}
    while len(results) < len(jobs):
        for _, _, run_id in jobs:
            if run_id not in results:
                run = call(args.studio, 'GET', f'/api/runs/{run_id}')
                if run['status'] in TERMINAL:
                    results[run_id] = run
                    print(f'  {len(results)}/{len(jobs)} prontas ({time.time() - started:.0f} s)', flush=True)
        time.sleep(3)

    rows: dict[str, list] = {}
    for case, seed, run_id in jobs:
        run = results[run_id]
        image = next((i for i in run['images'] if i['files']), None)
        data = call(args.studio, 'GET', f'/api/files/{image["files"][0]}') if image else None
        detail = (image or {}).get('detail') or {}
        note = f'seed {seed}'
        if run['status'] != 'completed':
            note += f' · {run["status"]}: {(run.get("error") or "")[:60]}'
        elif detail.get('expected') and max(detail.get('found', 0), detail.get('people') or 0) > detail['expected']:
            note += (f' · ! {detail.get("found", 0)} rostos, {detail.get("people") or "?"} corpos para '
                     f'{detail["expected"]} pessoas')
        rows.setdefault(case['nome'], []).append((data, note))

    stamp = datetime.now().strftime('%Y%m%d-%H%M')
    # The Studio that drew the pictures may run another checkout than this script: its compiler version is the truth.
    versions = sorted({r['settings'].get('compiler_version') or '?' for r in results.values()})
    version = '-'.join(versions)
    folder = BENCH / 'resultados' / f'{stamp}-compilador-{version}'
    folder.mkdir(parents=True, exist_ok=True)
    title = (f'Banco de casos · {stamp} · Studio com compilador {version} · script no commit {commit()} · '
             f'{spec["perfil"]} {spec["resolucao"]}')
    sheet(list(rows.items()), title).save(folder / 'folha.png')
    (folder / 'prompts.json').write_text(json.dumps(
        {results[r]['id']: {'caso': c['nome'], 'seed': s, 'prompt': results[r]['effective_prompt']} for c, s, r in jobs},
        ensure_ascii=False, indent=2), encoding='utf-8')
    if not args.manter:
        call(args.studio, 'POST', '/api/runs/delete', {'ids': [r for _, _, r in jobs]})
    print(f'Folha: {folder / "folha.png"} ({time.time() - started:.0f} s)')


if __name__ == '__main__':
    sys.exit(main())
