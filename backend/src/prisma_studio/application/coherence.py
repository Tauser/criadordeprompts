"""On-demand coherence review of the final prompt by the local text model. Advisory only: it never blocks a run."""
from __future__ import annotations

import json
import re

from ..domain.compiler import compile_request
from ..domain.rules import assess
from .translation import TranslationService

COHERENCE_SYSTEM = (
    'Você revisa as instruções, escritas em inglês, de um pedido de geração ou edição de imagem antes do envio ao '
    'modelo de imagem. Aponte apenas o que deixaria a imagem incoerente: instruções que se contradizem; posições do '
    'corpo impossíveis ou ambíguas (para onde o corpo está virado, para onde a cabeça gira, qual superfície apoia '
    'cada parte do corpo, quantas pessoas); câmera, lente ou enquadramento que não conseguem mostrar o que foi pedido; '
    'luz que contradiz o cenário ou o horário; detalhes que contradizem instruções anteriores. Não julgue gosto, '
    'estilo nem o tema, e não reescreva as instruções. Cite cada contradição uma única vez. Responda somente com JSON, '
    'no formato {"coherent": true ou false, "issues": [{"severity": "error" ou "warning", "quote": "um único trecho '
    'curto da instrução, em inglês", "problem": "explicação em português do Brasil", "suggestion": "como corrigir, em português '
    'do Brasil"}]}. Use a lista vazia quando as instruções forem coerentes. Os campos "problem" e "suggestion" devem '
    'estar sempre em português do Brasil, com no máximo duas frases curtas cada.')
SEVERITIES = ('error', 'warning')
# The reviewer is asked about coherence, not about the subject; answers that judge the subject are dropped.
SUBJECT_JUDGEMENT = re.compile(r'pol[ií]tica|policy|nsfw|nudez|\bnud[oae]s?\b|sexual|expl[ií]cit|inapropriad|'
                               r'conte[uú]do seguro|seguro e n[aã]o|roupas? adequadas?', re.I)
OMITTED = '[{label}: instruction chosen by the person; it is not part of this review.]'


def review_text(request, library) -> tuple[str, int]:
    """The prompt as the reviewer sees it: segments that come from adult options are replaced by a placeholder, so
    the review covers pose, camera, light and the rest without passing judgement on the subject."""
    assessment = assess(request, library)
    compiled = compile_request(request, assessment)
    adult = {f'op.{c}' for c, item in assessment.resolved.items() if item.adult}
    lines, omitted = [], 0
    for block, text in compiled.segments:
        if block in adult:
            omitted += 1
            lines.append(OMITTED.format(label=block.removeprefix('op.').capitalize()))
        else:
            lines.append(text)
    return '\n'.join(lines), omitted


def without_subject_judgement(review: dict) -> dict:
    """Drops answers about the subject instead of coherence, and says how many were dropped."""
    kept = [i for i in review.get('issues', []) if not SUBJECT_JUDGEMENT.search(' '.join(i.values()))]
    dropped = len(review.get('issues', [])) - len(kept)
    if not dropped:
        return review
    return {**review, 'issues': kept, 'coherent': review.get('coherent') if kept else True, 'dropped': dropped}


def parse_review(text: str) -> dict:
    """{'coherent', 'issues'}; an answer that is not the expected JSON is returned as 'raw' for the person to read."""
    match = re.search(r'\{.*\}', text or '', flags=re.S)
    data = None
    if match:
        # Local models sometimes join two excerpts as "a" and "b"; read them as one quote.
        for candidate in (match.group(0), re.sub(r'"\s*(?:and|e|\+)\s*"', ' … ', match.group(0))):
            try:
                data = json.loads(candidate)
                break
            except ValueError:
                continue
    if data is None and text:
        # An answer cut short: keep the issues that arrived complete.
        complete = []
        for chunk in re.findall(r'\{[^{}]*"problem"[^{}]*\}', text, flags=re.S):
            try:
                complete.append(json.loads(chunk))
            except ValueError:
                continue
        if complete:
            data = {'coherent': False, 'issues': complete, 'truncated': True}
    if not isinstance(data, dict) or not isinstance(data.get('issues', []), list):
        return {'coherent': None, 'issues': [], 'raw': (text or '').strip()[:4000]}
    issues, seen = [], set()
    for entry in data.get('issues', []):
        if not isinstance(entry, dict) or not str(entry.get('problem', '')).strip():
            continue
        key = re.sub(r'\W+', ' ', str(entry['problem'])).strip().lower()
        if key in seen:                      # local models sometimes repeat the same finding
            continue
        seen.add(key)
        issues.append({'severity': entry.get('severity') if entry.get('severity') in SEVERITIES else 'warning',
                       **{k: str(entry.get(k, '')).strip()[:600] for k in ('quote', 'problem', 'suggestion')}})
    if issues:
        return {'coherent': False, 'issues': issues, **({'truncated': True} if data.get('truncated') else {})}
    if data.get('coherent') is False:          # "incoherent" with nothing to show: let the person read the answer
        return {'coherent': None, 'issues': [], 'raw': (text or '').strip()[:4000]}
    return {'coherent': True, 'issues': []}


class CoherenceService(TranslationService):
    """Same lifecycle as the translation preview: kept in memory, cancelled by id, never persisted."""
    system_prompt = COHERENCE_SYSTEM

    def review(self, prompt: str, reviewed: str | None = None, omitted: int = 0) -> dict:
        """prompt is what will be generated (to mark outdated reviews); reviewed is what the model reads."""
        prompt = (prompt or '').strip()
        reviewed = (reviewed or prompt).strip()
        if not prompt or len(reviewed) > 12000:
            raise ValueError('O prompt deve ter de 1 a 12.000 caracteres.')
        job = self._submit('Instruções a revisar (responda em português do Brasil):\n' + reviewed,
                           {'prompt': prompt, 'omitted': omitted})
        return {**job, 'prompt': prompt, 'omitted': omitted}

    def _finish(self, job: dict, text: str) -> None:
        if not text:
            job.update(status='failed', error='A análise veio vazia.')
        else:
            job.update(status='completed', result=without_subject_judgement(parse_review(text)))
