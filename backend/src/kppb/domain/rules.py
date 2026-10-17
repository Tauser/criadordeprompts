"""Assess declared facts only. Unknown facts are reported, never assumed."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .catalog import Item, Library
from .request import CatalogValue, Request
from .vocabulary import CATEGORIES, FRAMING_ORDER

Level = Literal['error', 'warning', 'unknown']
Kind = Literal['product', 'model', 'policy']


@dataclass(frozen=True)
class Issue:
    code: str
    level: Level
    kind: Kind
    field: str
    message: str


@dataclass(frozen=True)
class Assessment:
    issues: tuple[Issue, ...]
    resolved: dict[str, Item]               # category -> catalog item used by a "set"
    slots: dict[str, int]                    # reference id -> image number sent to the model
    participants_total: int | None
    participants_existing: int | None
    requirements: tuple                      # Requirements of every resolved item
    valid: bool = field(init=False)

    def __post_init__(self):
        object.__setattr__(self, 'valid', not any(i.level == 'error' for i in self.issues))

    @property
    def status(self) -> str:
        if not self.valid:
            return 'incompatible'
        return 'undetermined' if any(i.level == 'unknown' for i in self.issues) else 'compatible'


def assess(request: Request, library: Library) -> Assessment:
    issues: list[Issue] = []

    def report(code: str, field_: str, message: str, level: Level = 'error', kind: Kind = 'product') -> None:
        issues.append(Issue(code, level, kind, field_, message))

    refs = {}
    for i, ref in enumerate(request.references):
        if ref.id in refs:
            report('duplicate_reference', f'references.{i}', 'Referência repetida.')
        refs[ref.id] = ref

    slots = _slots(request)
    if request.prompt_mode == 'manual':
        if request.mode == 'edit':
            _check_target(request, refs, report)
        report('manual_text', 'manual_prompt', 'O prompt manual é enviado literalmente, sem análise.', 'unknown')
        return Assessment(tuple(issues), {}, slots, None, None, ())

    if request.mode == 'edit':
        _check_target(request, refs, report)
    elif request.output.resolution == 0:
        report('original_requires_target', 'output.resolution', 'A resolução "Original" existe apenas na edição.')

    index = library.index()
    resolved: dict[str, Item] = {}
    for category in CATEGORIES:
        attribute = request.attribute(category)
        where = f'attributes.{category}'
        if attribute.intent == 'keep' and request.mode != 'edit':
            report('keep_requires_target', where, 'Manter o original só existe na edição.')
        elif attribute.intent == 'transfer':
            ref_id = attribute.reference_id
            if ref_id not in refs:
                report('missing_reference', where, 'A referência indicada não foi anexada.')
            elif ref_id == request.target_id:
                report('transfer_from_target', where, 'Para usar a própria foto alvo, escolha "Manter".')
            else:
                report('reference_not_analyzed', where, 'A referência não é analisada visualmente antes do envio.',
                       'unknown', 'model')
        elif attribute.intent == 'set' and isinstance(attribute.value, CatalogValue):
            item = index.get(attribute.value.item_id)
            if item is None:
                report('missing_item', where, 'Opção não encontrada na biblioteca.')
            elif item.category != category:
                report('wrong_category', where, 'A opção pertence a outra categoria.')
            elif not item.enabled:
                report('disabled_item', where, 'A opção está desativada.')
            elif item.adult and request.content_mode != 'adult':
                report('adult_mode_required', where, 'Ative o conteúdo adulto para usar esta opção.', kind='policy')
            else:
                resolved[category] = item
        elif attribute.intent == 'set':
            report('text_not_analyzed', where, 'Descrição personalizada: a compatibilidade não é verificada.',
                   'unknown')

    if any(item.adult for item in resolved.values()):
        if 'adults_only' not in request.confirmations:
            report('confirm_adults', 'confirmations', 'Confirme que todas as pessoas retratadas são adultas.',
                   kind='policy')
        if request.mode == 'edit' and 'consent_or_fictional' not in request.confirmations:
            report('confirm_consent', 'confirmations',
                   'Confirme que a pessoa da foto é fictícia ou consentiu com esta edição.', kind='policy')

    requirements = tuple(item.requirements for item in resolved.values())
    _check_conflicts(request, resolved, report)
    _check_supports(request, resolved, report)
    _check_framing(request, resolved, report)
    total, existing = _participants(request, resolved, report)

    if request.details.strip():
        report('details_not_analyzed', 'details', 'Os detalhes adicionais são enviados literalmente, sem análise.',
               'unknown')
    changes = [c for c in CATEGORIES if request.attribute(c).intent in ('set', 'transfer')]
    if request.mode == 'edit' and not changes and not request.details.strip():
        report('missing_change', 'attributes', 'Nenhuma alteração foi pedida para a foto.')
    for ref in request.references:
        if ref.id not in slots:
            report('unused_reference', 'references', f'A referência "{ref.label}" não está associada a nenhum campo '
                   'e não será enviada.', 'warning')
    if request.mode == 'generate' and slots:
        report('generation_reference', 'references', 'Referências na geração ainda não foram validadas visualmente '
               'neste modelo.', 'warning', 'model')
    return Assessment(tuple(issues), resolved, slots, total, existing, requirements)


def _slots(request: Request) -> dict[str, int]:
    """Image numbers in submission order: the edit target first, then each used reference once."""
    order: list[str] = []
    if request.mode == 'edit' and request.target_id:
        order.append(request.target_id)
    known = {ref.id for ref in request.references}
    used = {a.reference_id for a in request.attributes.values() if a.intent == 'transfer'}
    if request.prompt_mode == 'manual':
        used = known
    for ref in request.references:
        if ref.id in used and ref.id not in order and ref.id in known:
            order.append(ref.id)
    return {ref_id: i + 1 for i, ref_id in enumerate(order)}


def _check_target(request, refs, report) -> None:
    if request.target_id is None:
        report('missing_target', 'target_id', 'Escolha a foto alvo da edição.')
    elif request.target_id not in refs:
        report('missing_target', 'target_id', 'A foto alvo não foi anexada.')


def _declared(request, resolved, key):
    """(category, value) for every declared fact, ignoring 'any'."""
    facts = []
    for category, item in resolved.items():
        value = getattr(item.requirements, key)
        if value not in (None, 'any'):
            facts.append((category, value))
    return facts


def _check_conflicts(request, resolved, report) -> None:
    for key, label in (('posture', 'postura'), ('gaze', 'olhar')):
        facts = _declared(request, resolved, key)
        if len({value for _, value in facts}) > 1:
            for category, _ in facts:
                report(f'conflicting_{key}', f'attributes.{category}', f'As opções pedem {label}s incompatíveis.')
    kept_pose = request.attribute('pose').intent == 'keep'
    kept_expression = request.attribute('expression').intent == 'keep'
    if kept_pose and _declared(request, resolved, 'posture'):
        report('posture_vs_kept_pose', 'attributes.pose', 'A postura original não é conhecida; a ação pode exigir '
               'outra postura.', 'unknown')
    if kept_expression and _declared(request, resolved, 'gaze'):
        report('gaze_vs_kept_expression', 'attributes.expression', 'A direção original do olhar não é conhecida.',
               'unknown')
    for category, item in resolved.items():
        if category in ('pose', 'action'):
            missing = [k for k in ('participants', 'posture', 'gaze') if getattr(item.requirements, k) is None]
            if missing:
                report('incomplete_metadata', f'attributes.{category}',
                       'A opção não declara: ' + ', '.join(missing) + '.', 'unknown')


def _check_supports(request, resolved, report) -> None:
    context = request.context
    environment = request.attribute('environment')
    if environment.intent == 'set' and 'environment' in resolved:
        available = resolved['environment'].provides.supports
    elif environment.intent in ('set', 'transfer') or request.mode == 'generate':
        available = 'new'                    # a new setting is created with the scene
    else:
        available = context.supports
    for category, item in resolved.items():
        needed = item.requirements.support_any_of
        if not needed or context.allow_new_supports or available == 'new':
            continue
        if available is None:
            report('unknown_support', f'attributes.{category}', 'Os apoios disponíveis não foram informados.',
                   'unknown')
        elif not set(needed) & set(available):
            report('missing_support', f'attributes.{category}', 'Nenhum dos apoios necessários está disponível. '
                   'Permita adicionar apoios ou mude o cenário.')


def _check_framing(request, resolved, report) -> None:
    framing = request.attribute('framing')
    if request.mode == 'edit' and not request.context.allow_reframing and framing.intent in ('set', 'transfer'):
        report('framing_locked', 'attributes.framing', 'O reenquadramento está bloqueado.')
    if framing.intent == 'set' and 'framing' in resolved:
        visible = resolved['framing'].provides.framing
    elif framing.intent == 'keep' or (framing.intent == 'free' and not request.context.allow_reframing):
        visible = request.context.original_framing if request.mode == 'edit' else None
    else:
        return                               # automatic minimum framing will be requested
    for category, item in resolved.items():
        minimum = item.requirements.minimum_framing
        if minimum is None:
            continue
        if visible is None:
            report('unknown_framing', f'attributes.{category}', 'O enquadramento disponível não é conhecido.',
                   'unknown')
        elif FRAMING_ORDER[visible] < FRAMING_ORDER[minimum]:
            report('framing_too_small', f'attributes.{category}', 'O enquadramento não mostra a pose pedida.')


def _participants(request, resolved, report):
    counts = [item.requirements.participants for item in resolved.values() if item.requirements.participants]
    if request.participants.requested:
        counts.append(request.participants.requested)
    existing = request.participants.existing if request.mode == 'edit' else None
    if existing:
        counts.append(existing)
    total = max(counts) if counts else None
    if request.mode == 'edit' and existing is None and total and total > 1:
        report('unknown_existing', 'participants.existing', 'Informe quantas pessoas já estão na foto.', 'unknown')
    return total, existing
