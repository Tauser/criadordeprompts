"""On-demand coherence review of the final prompt by the local text model. Advisory only: it never blocks a run."""
from __future__ import annotations

import json
import re

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
    'estar sempre em português do Brasil.')
SEVERITIES = ('error', 'warning')


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
    if not isinstance(data, dict) or not isinstance(data.get('issues', []), list):
        return {'coherent': None, 'issues': [], 'raw': (text or '').strip()[:4000]}
    issues = []
    for entry in data.get('issues', []):
        if not isinstance(entry, dict) or not str(entry.get('problem', '')).strip():
            continue
        issues.append({'severity': entry.get('severity') if entry.get('severity') in SEVERITIES else 'warning',
                       **{k: str(entry.get(k, '')).strip()[:600] for k in ('quote', 'problem', 'suggestion')}})
    if issues:
        return {'coherent': False, 'issues': issues}
    if data.get('coherent') is False:          # "incoherent" with nothing to show: let the person read the answer
        return {'coherent': None, 'issues': [], 'raw': (text or '').strip()[:4000]}
    return {'coherent': True, 'issues': []}


class CoherenceService(TranslationService):
    """Same lifecycle as the translation preview: kept in memory, cancelled by id, never persisted."""
    system_prompt = COHERENCE_SYSTEM

    def review(self, prompt: str) -> dict:
        prompt = (prompt or '').strip()
        if not prompt or len(prompt) > 12000:
            raise ValueError('O prompt deve ter de 1 a 12.000 caracteres.')
        return {**self._submit('Instruções a revisar (responda em português do Brasil):\n' + prompt, {'prompt': prompt}), 'prompt': prompt}

    def _finish(self, job: dict, text: str) -> None:
        if not text:
            job.update(status='failed', error='A análise veio vazia.')
        else:
            job.update(status='completed', result=parse_review(text))
