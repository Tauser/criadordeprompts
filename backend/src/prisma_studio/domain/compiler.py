"""Request -> IR -> text. Deterministic; every block must be rendered exactly once."""
from __future__ import annotations

from dataclasses import dataclass

from . import ir
from .request import CatalogValue, Request
from .rules import Assessment, available_supports, body_gaze, effective_orientation
from .vocabulary import CATEGORIES, FRAMING_ORDER, SUPPORT_PRIORITY, agreed

COMPILER_VERSION = '1.7.0'

# Operation order: scene first, then person changes; style leads in generation.
EDIT_ORDER = ('environment', 'lighting', 'style', 'camera', 'framing', 'subject', 'face', 'body', 'skin', 'hair',
              'wardrobe', 'pose', 'action', 'expression')
GENERATE_ORDER = ('style', 'subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'pose', 'action', 'expression',
                  'environment', 'lighting', 'camera', 'framing')


class CompileError(ValueError):
    pass


@dataclass(frozen=True)
class Compiled:
    text: str
    blocks: tuple
    segments: tuple[tuple[str, str], ...]     # (block id, rendered text)
    version: str = COMPILER_VERSION


def build_ir(request: Request, assessment: Assessment) -> list:
    if not assessment.valid:
        raise CompileError('Corrija os erros do pedido antes de compilar.')
    if request.prompt_mode == 'manual':
        return [ir.Manual(request.manual_prompt.strip())]
    edit = request.mode == 'edit'
    blocks: list = [ir.Header(request.mode, len(assessment.slots))]
    order = EDIT_ORDER if edit else GENERATE_ORDER
    for category in order:
        attribute = request.attribute(category)
        if attribute.intent != 'set':
            continue
        participants = None
        is_instruction = False
        if isinstance(attribute.value, CatalogValue):
            item = assessment.resolved[category]
            text, participants = item.prompt, item.requirements.participants
            if edit and item.edit_prompt is not None:
                text, is_instruction = item.edit_prompt, True
        else:
            text = attribute.value.text
        blocks.append(ir.Operation(category, text.strip(), participants, is_instruction=is_instruction))
        if category == 'wardrobe' and (assessment.participants_total or 0) > 1:
            blocks.append(ir.WardrobeScope(request.wardrobe_scope, assessment.participants_total))

    by_slot: dict[int, list[str]] = {}
    for category in CATEGORIES:
        attribute = request.attribute(category)
        if attribute.intent == 'transfer':
            by_slot.setdefault(assessment.slots[attribute.reference_id], []).append(category)
    for slot in sorted(by_slot):
        blocks.append(ir.Transfer(slot, tuple(by_slot[slot])))
    for index, character in enumerate(request.characters):
        blocks.append(ir.Character(assessment.slots[character.reference_id], index + 2, character.description.strip()))

    if edit:
        kept = tuple(c for c in CATEGORIES if request.attribute(c).intent == 'keep')
        free = [c for c in CATEGORIES if request.attribute(c).intent == 'free']
        if kept or not free:
            blocks.append(ir.Keep(kept, everything_else=not free,
                                  allow_action_movement=request.attribute('action').intent in ('set', 'transfer')))

    total = assessment.participants_total
    if total and (total > 1 or request.participants.requested == 1):   # an explicit "one person" is an instruction too
        blocks.append(ir.Participants(total, edit))

    minimums = [r.minimum_framing for r in assessment.requirements if r.minimum_framing]
    if (minimums and request.attribute('framing').intent == 'free'
            and (not edit or request.context.allow_reframing)):
        blocks.append(ir.MinimumFraming(max(minimums, key=FRAMING_ORDER.__getitem__)))

    # The body guidance follows the pose, action and expression it belongs to, always in the same order.
    body: list = []
    posture = agreed({r.posture for r in assessment.requirements} - {None, 'any'})
    if posture:
        body.append(ir.Guidance('posture', posture))
    needs = [r.support_any_of for r in assessment.requirements if r.support_any_of]
    for support, separate in _supports(needs, available_supports(request, assessment.resolved)):
        body.append(ir.Guidance(f'support:{support}' if separate else 'support', support))
    if edit and request.context.allow_new_supports and needs:
        body.append(ir.Guidance('new_supports', 'allowed'))
    orientation = effective_orientation(assessment.resolved)
    if orientation:
        body.append(ir.Guidance('orientation', orientation))
    gaze = body_gaze(orientation, agreed({r.gaze for r in assessment.requirements} - {None, 'any'}))
    if gaze:
        body.append(ir.Guidance('gaze', gaze))
    if posture or orientation:
        body.append(ir.Guidance('head', 'natural'))
    anchor = max((i for i, b in enumerate(blocks) if isinstance(b, ir.Operation)
                  and b.category in ('pose', 'action', 'expression')), default=len(blocks) - 1)
    blocks[anchor + 1:anchor + 1] = body
    if request.details.strip():
        blocks.append(ir.Details(request.details.strip()))
    _check_consistency(blocks)
    return blocks


def _supports(needs, available) -> list[tuple[str, bool]]:
    """One surface for the whole body: (support, separate) pairs. A single shared surface is preferred, taken from
    the ones the scene offers when they are known; separate surfaces appear only when no single one fits all."""
    if not needs:
        return []
    offered = set(available) if isinstance(available, tuple) else None
    pick = lambda options: next(s for s in SUPPORT_PRIORITY if s in options)   # noqa: E731
    common = set.intersection(*(set(n) for n in needs))
    if offered is not None and common & offered:
        return [(pick(common & offered), False)]
    if common:
        return [(pick(common), False)]
    chosen = {pick(set(n) & offered if offered and set(n) & offered else set(n)) for n in needs}
    return [(s, True) for s in sorted(chosen, key=SUPPORT_PRIORITY.index)]


def _check_consistency(blocks) -> None:
    changed = {b.category for b in blocks if isinstance(b, ir.Operation)}
    changed |= {a for b in blocks if isinstance(b, ir.Transfer) for a in b.aspects}
    kept = {a for b in blocks if isinstance(b, ir.Keep) for a in b.aspects}
    if changed & kept:
        raise CompileError('Atributo mantido e alterado ao mesmo tempo: ' + ', '.join(sorted(changed & kept)))
    ids = [b.id for b in blocks]
    if len(ids) != len(set(ids)):
        raise CompileError('Bloco duplicado na representação intermediária.')


def compile_request(request: Request, assessment: Assessment, renderer=None) -> Compiled:
    from .render_qwen21 import render
    blocks = build_ir(request, assessment)
    segments = tuple((renderer or render)(blocks))
    rendered = {block_id for block_id, _ in segments}
    missing = [b.id for b in blocks if b.id not in rendered]
    if missing:
        raise CompileError('Blocos sem texto no prompt: ' + ', '.join(missing))
    if len(rendered) != len(segments):
        raise CompileError('Um bloco foi renderizado mais de uma vez.')
    text = '\n'.join(part for _, part in segments)
    if not text.strip() or len(text) > 12000:
        raise CompileError('O prompt deve ter de 1 a 12.000 caracteres.')
    return Compiled(text, tuple(blocks), segments)
