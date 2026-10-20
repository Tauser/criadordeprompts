"""The value that would settle a conflict caused by the chosen pose or action, for the composer to offer.

Nothing here changes the request. Each suggestion names a field, the attribute (and context switches) that fit the
pose or action, and why. `auto` marks the ones the composer may apply by itself while the person has not touched that
field; the others are only offered next to the field, one click away. Conflicts between the chosen options themselves
(light × setting, lens × framing) are only offered, with the source 'scene'.
"""
from __future__ import annotations

from .catalog import Item, Library, available
from .rules import GROUND_POSTURES, NEAR_VIEWS, effective_orientation
from .vocabulary import FRAMING_ORDER, agreed

FRAMING_NAMES = {'portrait': 'rosto', 'half': 'meio corpo', 'full': 'corpo inteiro', 'wide': 'plano aberto'}
GAZE_NAMES = {'camera': 'para a câmera', 'away': 'desviado', 'down': 'para baixo', 'up': 'para cima',
              'back': 'por cima do ombro', 'closed': 'de olhos fechados'}
SUPPORT_NAMES = {'floor': 'chão', 'seat': 'assento', 'bed': 'cama', 'wall': 'parede', 'table': 'mesa'}
MAX_CHOICES = 3


def _catalog(item: Item) -> dict:
    return {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': item.id}}


def _source(resolved: dict) -> tuple[str, Item] | None:
    """The body option that drives the suggestions: the action when there is one, else the pose."""
    for category in ('action', 'pose'):
        if category in resolved:
            return category, resolved[category]
    return None


def suggest(request, library: Library, resolved: dict) -> list[dict]:
    if request.prompt_mode == 'manual':
        return []
    out = _from_body(request, library, resolved)
    return out + _from_scene(request, library, resolved, {s['field'] for s in out})


PLACE_NAMES = {'indoor': 'interno', 'outdoor': 'externo'}
PERIOD_NAMES = {'day': 'de dia', 'night': 'à noite', 'golden': 'na hora dourada', 'blue': 'na hora azul'}


def _concrete(item: Item, key: str) -> str | None:
    value = getattr(item.provides, key)
    return None if value in (None, 'any') else value


def _matching(candidates: list[Item], wanted: dict[str, str], current: Item) -> list[Item]:
    """Items that clash with none of `wanted`, those that share its values first; only those when there are any."""
    fitting = [i for i in candidates if i.id != current.id
               and all(_concrete(i, k) in (None, v) for k, v in wanted.items())]
    score = {i.id: sum(_concrete(i, k) == v for k, v in wanted.items()) for i in fitting}
    if any(score.values()):
        fitting = [i for i in fitting if score[i.id]]
    return sorted(fitting, key=lambda i: (-score[i.id], i.label))[:MAX_CHOICES]


def _from_scene(request, library: Library, resolved: dict, taken: set[str]) -> list[dict]:
    """Offers for conflicts between the chosen options themselves (light × setting, lens × framing), never applied
    alone. A field that already has an offer for the pose or action keeps only that one."""
    out: list[dict] = []

    def add(field: str, item: Item, reason: str) -> None:
        out.append({'field': field, 'attribute': _catalog(item), 'context': {}, 'label': item.label,
                    'reason': reason, 'source': 'scene', 'auto': False})

    # Light and setting that point to another place or time of day (light_place, light_period, light_period_near).
    light, scene = resolved.get('lighting'), resolved.get('environment')
    if light and scene and any(_concrete(light, k) and _concrete(scene, k) not in (None, _concrete(light, k))
                               for k in ('period', 'place')):
        def wanted(item: Item) -> dict[str, str]:
            return {k: _concrete(item, k) for k in ('place', 'period') if _concrete(item, k)}

        def describe(values: dict[str, str]) -> str:
            parts = [PLACE_NAMES[values['place']]] if 'place' in values else []
            if 'period' in values:
                parts.append(PERIOD_NAMES.get(values['period'], values['period']))
            return ', '.join(parts)
        if 'lighting' not in taken:
            for item in _matching(available(library, request.content_mode, 'lighting'), wanted(scene), light):
                add('lighting', item, f'Combina com o cenário: {describe(wanted(scene))}.')
        if 'environment' not in taken:
            for item in _matching(available(library, request.content_mode, 'environment'), wanted(light), scene):
                add('environment', item, f'Combina com a luz: {describe(wanted(light))}.')

    # Lens whose usual crop is two or more steps away from the chosen framing (camera_vs_framing).
    camera, framing = resolved.get('camera'), resolved.get('framing')
    usual = camera.provides.framing if camera else None
    visible = framing.provides.framing if framing else None
    if usual and visible and abs(FRAMING_ORDER[usual] - FRAMING_ORDER[visible]) >= 2 and 'camera' not in taken:
        needs = [i.requirements.minimum_framing for i in resolved.values() if i.requirements.minimum_framing]
        need = max((FRAMING_ORDER[n] for n in needs), default=None)
        fitting = [i for i in available(library, request.content_mode, 'camera')
                   if i.provides.framing and i.id != camera.id
                   and abs(FRAMING_ORDER[i.provides.framing] - FRAMING_ORDER[visible]) < 2
                   and (need is None or FRAMING_ORDER[i.provides.framing] >= need)]
        fitting.sort(key=lambda i: (abs(FRAMING_ORDER[i.provides.framing] - FRAMING_ORDER[visible]), i.label))
        for item in fitting[:MAX_CHOICES]:
            add('camera', item, f'O enquadramento é {FRAMING_NAMES[visible]}.')
    return out


def _from_body(request, library: Library, resolved: dict) -> list[dict]:
    found = _source(resolved)
    if found is None:
        return []
    source, body = found
    options = {c: available(library, request.content_mode, c)
               for c in ('framing', 'camera', 'environment', 'expression')}
    out: list[dict] = []

    def add(field: str, attribute: dict | None, label: str, reason: str, auto: bool = False,
            context: dict | None = None) -> None:
        out.append({'field': field, 'attribute': attribute, 'context': context or {}, 'label': label,
                    'reason': reason, 'source': source, 'auto': auto})

    edit = request.mode == 'edit'
    postures = {i.requirements.posture for c, i in resolved.items() if c in ('pose', 'action')}
    ground = bool(postures & set(GROUND_POSTURES))

    # Automatic suggestions are still listed once the field holds their value, so the composer keeps it there.
    # The pose of the photo cannot be kept when the action places the body.
    if source == 'action' and body.requirements.posture not in (None, 'any') \
            and request.attribute('pose').intent in ('keep', 'free'):
        add('pose', {'intent': 'free'}, 'Deixar a pose livre', 'A ação já define a posição do corpo.', auto=True)

    # Framing: the smallest crop that shows the pose.
    needs = [i.requirements.minimum_framing for c, i in resolved.items()
             if c in ('pose', 'action') and i.requirements.minimum_framing]
    need = max(needs, key=FRAMING_ORDER.get) if needs else None
    if need:
        framing = request.attribute('framing')
        if framing.intent == 'set' and 'framing' in resolved:
            visible = resolved['framing'].provides.framing
        elif framing.intent == 'keep' or (framing.intent == 'free' and edit and not request.context.allow_reframing):
            visible = request.context.original_framing if edit else None
        else:
            visible = 'automatic'
        small = visible not in (None, 'automatic') and FRAMING_ORDER[visible] < FRAMING_ORDER[need]
        unknown = visible is None and edit
        target = next((i for i in options['framing'] if i.provides.framing == need), None)
        holds = target is not None and framing.intent == 'set' and 'framing' in resolved \
            and resolved['framing'].id == target.id
        reopen = {'allow_reframing': True} if edit and not request.context.allow_reframing else None
        # A pose on the ground never fits the old crop, nor does a known smaller one; an unknown crop is only offered.
        original = request.context.original_framing
        fills = edit and reopen is None and (ground or (original is not None
                                                        and FRAMING_ORDER[original] < FRAMING_ORDER[need]))
        if target and (small or unknown or (holds and fills)):
            add('framing', _catalog(target), f'Usar {target.label}',
                f'A {"ação" if source == "action" else "pose"} precisa de {FRAMING_NAMES[need]}.',
                auto=fills and (framing.intent in ('keep', 'free') or holds), context=reopen)
    if edit and ground and request.attribute('camera').intent in ('keep', 'free'):
        add('camera', {'intent': 'free'}, 'Deixar a câmera livre', 'Uma postura deitada ou de quatro não cabe no '
            'ângulo da foto original.', auto=True)

    # Setting without the surface the body rests on.
    needed = body.requirements.support_any_of
    environment = resolved.get('environment')
    if needed and environment and environment.provides.supports is not None \
            and not set(needed) & set(environment.provides.supports) and not request.context.allow_new_supports:
        names = ' ou '.join(SUPPORT_NAMES[s] for s in needed)
        fitting = [i for i in options['environment'] if set(needed) & set(i.provides.supports or ())]
        light = resolved.get('lighting')
        if light is not None:            # settings that also agree with the chosen light come first
            fitting.sort(key=lambda i: any(getattr(light.provides, k) not in (None, 'any') and
                                           getattr(i.provides, k) not in (None, 'any', getattr(light.provides, k))
                                           for k in ('period', 'place')))
        for item in fitting[:MAX_CHOICES]:
            add('environment', _catalog(item), item.label, f'Esta {"ação" if source == "action" else "pose"} '
                f'precisa de {names}.')
        add('environment', None, 'Permitir acrescentar o apoio', f'O Studio pede {names} dentro do cenário escolhido.',
            context={'allow_new_supports': True})

    # Expression whose gaze contradicts the body.
    gaze = agreed({i.requirements.gaze for c, i in resolved.items()
                   if c in ('pose', 'action') and i.requirements.gaze not in (None, 'any')})
    expression = resolved.get('expression')
    if gaze and expression and expression.requirements.gaze not in (None, 'any', gaze):
        fitting = sorted((i for i in options['expression'] if i.requirements.gaze in (gaze, 'any')),
                         key=lambda i: i.requirements.gaze != gaze)
        for item in fitting[:MAX_CHOICES]:
            add('expression', _catalog(item), item.label, f'O olhar da {"ação" if source == "action" else "pose"} '
                f'é {GAZE_NAMES.get(gaze, gaze)}.')

    # Camera that shows another side of the body, or crops tighter than the pose needs.
    camera = resolved.get('camera')
    orientation = effective_orientation({c: i for c, i in resolved.items() if c != 'camera'})
    view = camera.provides.view if camera else None
    wrong_side = (camera is not None and orientation and view not in (None, 'any', orientation)
                  and frozenset({view, orientation}) not in NEAR_VIEWS)
    tight = (camera is not None and need and camera.provides.framing
             and FRAMING_ORDER[camera.provides.framing] < FRAMING_ORDER[need])
    if wrong_side or tight:
        def fits(item: Item) -> bool:
            side = item.provides.view in (None, 'any', orientation) or not orientation
            crop = not need or not item.provides.framing or FRAMING_ORDER[item.provides.framing] >= FRAMING_ORDER[need]
            return side and crop and item.id != camera.id
        fitting = sorted((i for i in options['camera'] if fits(i)),
                         key=lambda i: (i.provides.view != orientation, i.label))
        reason = ('A câmera mostra outro lado do corpo.' if wrong_side
                  else f'A lente recorta mais fechado do que {FRAMING_NAMES[need]}.')
        for item in fitting[:MAX_CHOICES]:
            add('camera', _catalog(item), item.label, reason)
    return out
