"""Check a graph against the installed ComfyUI's /object_info before it is queued."""
from __future__ import annotations


def _spec(info: dict, name: str):
    inputs = info.get('input', {})
    for group in ('required', 'optional'):
        if name in inputs.get(group, {}):
            return inputs[group][name]
    return None


def validate_graph(graph: dict, object_info: dict) -> list[str]:
    problems: list[str] = []
    for node_id, node in graph.items():
        cls = node.get('class_type')
        info = object_info.get(cls)
        if info is None:
            problems.append(f'Nó {node_id}: classe {cls} não está instalada.')
            continue
        if not info.get('input', {}).get('required') and not info.get('input', {}).get('optional'):
            continue                              # no schema to compare against
        values = node.get('inputs', {})
        for name in info.get('input', {}).get('required', {}):
            if name not in values:
                problems.append(f'Nó {node_id} ({cls}): entrada obrigatória "{name}" ausente.')
        for name, value in values.items():
            spec = _spec(info, name)
            if spec is None:
                base = name.split('.', 1)[0]
                if '.' in name and _spec(info, base) is not None:
                    continue                      # dynamic sub-input (Autogrow / DynamicCombo)
                problems.append(f'Nó {node_id} ({cls}): entrada desconhecida "{name}".')
                continue
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                if value[0] not in graph:
                    problems.append(f'Nó {node_id} ({cls}): "{name}" aponta para o nó inexistente {value[0]}.')
                continue
            kind = spec[0] if isinstance(spec, (list, tuple)) and spec else None
            options = spec[1] if isinstance(spec, (list, tuple)) and len(spec) > 1 and isinstance(spec[1], dict) else {}
            if isinstance(kind, list):
                if value not in kind:
                    problems.append(f'Nó {node_id} ({cls}): "{value}" não é um valor aceito em "{name}".')
            elif kind == 'COMBO' and isinstance(options.get('options'), list):
                if value not in options['options']:
                    problems.append(f'Nó {node_id} ({cls}): "{value}" não é um valor aceito em "{name}".')
            elif kind in ('INT', 'FLOAT') and isinstance(value, (int, float)) and not isinstance(value, bool):
                low, high = options.get('min'), options.get('max')
                if (low is not None and value < low) or (high is not None and value > high):
                    problems.append(f'Nó {node_id} ({cls}): {name}={value} fora da faixa [{low}, {high}].')
    return problems
