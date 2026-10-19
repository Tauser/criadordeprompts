"""Contract violations (pydantic) as field issues the interface can point at, in Portuguese."""
from __future__ import annotations

CATEGORY_LABELS = {
    'subject': 'Pessoa', 'face': 'Rosto', 'body': 'Corpo', 'skin': 'Pele', 'hair': 'Cabelo', 'wardrobe': 'Roupa',
    'environment': 'Cenário', 'pose': 'Pose', 'expression': 'Expressão', 'action': 'Ação', 'lighting': 'Iluminação',
    'style': 'Estilo visual', 'camera': 'Câmera', 'framing': 'Enquadramento',
}
FIELD_LABELS = {
    'details': 'Detalhes adicionais', 'manual_prompt': 'Prompt manual', 'target_id': 'Foto alvo',
    'references': 'Referências', 'characters': 'Outro personagem', 'confirmations': 'Confirmações',
    'output.width': 'Largura', 'output.height': 'Altura', 'output.seed': 'Seed', 'output.variations': 'Variações',
    'output.resolution': 'Resolução', 'output.aspect': 'Formato', 'output.profile': 'Execução', 'output': 'Tamanho',
    'engine.steps': 'Passos', 'engine.cfg': 'CFG', 'engine.denoise': 'Denoise',
    'engine.negative_prompt': 'Prompt negativo', 'participants.requested': 'Pessoas pedidas',
    'participants.existing': 'Pessoas na foto', 'context': 'Cena',
}


def _field(loc: tuple) -> str:
    parts = [str(p) for p in loc if not isinstance(p, int)]
    if parts and parts[0] in ('attributes', 'output', 'engine', 'participants') and len(parts) > 1:
        return '.'.join(parts[:2])
    return parts[0] if parts else 'request'


def _label(field: str) -> str:
    if field.startswith('attributes.'):
        return CATEGORY_LABELS.get(field.split('.', 1)[1], 'Campo')
    return FIELD_LABELS.get(field) or FIELD_LABELS.get(field.split('.')[0]) or 'Pedido'


def _message(error: dict) -> str:
    kind, ctx = error.get('type', ''), error.get('ctx') or {}
    if kind == 'value_error':
        text = str(ctx.get('error') or error.get('msg', '')).removeprefix('Value error, ')
        return text[:1].lower() + text[1:]
    if kind == 'string_too_short':
        return 'não pode ficar vazio.'
    if kind == 'string_too_long':
        return f'texto longo demais (máximo de {ctx.get("max_length")} caracteres).'
    if kind in ('greater_than_equal', 'greater_than'):
        return f'o valor mínimo é {ctx.get("ge", ctx.get("gt"))}.'
    if kind in ('less_than_equal', 'less_than'):
        return f'o valor máximo é {ctx.get("le", ctx.get("lt"))}.'
    if kind == 'multiple_of':
        return f'use um múltiplo de {ctx.get("multiple_of")}.'
    if kind in ('int_parsing', 'float_parsing', 'int_type', 'float_type', 'int_from_float'):
        return 'informe um número inteiro.' if kind.startswith('int') else 'informe um número.'
    if kind == 'too_long':
        return f'no máximo {ctx.get("max_length")} itens.'
    if kind == 'missing':
        return 'campo obrigatório.'
    return 'valor não permitido.'


def contract_issues(errors: list[dict]) -> list[dict]:
    """One error issue per field and message, with the field's name in the text."""
    issues, seen = [], set()
    for error in errors:
        field = _field(tuple(error.get('loc', ())))
        message = f'{_label(field)}: {_message(error)}'
        if (field, message) in seen:
            continue
        seen.add((field, message))
        issues.append({'code': 'contract', 'level': 'error', 'kind': 'product', 'field': field, 'message': message})
    return issues
