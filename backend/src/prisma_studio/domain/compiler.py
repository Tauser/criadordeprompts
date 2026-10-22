"""Request -> IR -> text. Deterministic; every block must be rendered exactly once."""
from __future__ import annotations

from dataclasses import dataclass

from . import ir
from .request import CatalogValue, Request
from .rules import Assessment, available_supports, body_gaze, effective_orientation, framing_already_there
from .vocabulary import CATEGORIES, FRAMING_ORDER, SUPPORT_PRIORITY, agreed

COMPILER_VERSION = '1.17.0'

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
    same_framing = framing_already_there(request, assessment.resolved)
    for category in order:
        attribute = request.attribute(category)
        if attribute.intent != 'set' or (category == 'framing' and same_framing):
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
    # The cast is introduced before clothing and action, so "both people" and group actions have someone to point
    # at: right after the header in an edit, right after the subject when generating.
    # In an edit, a character beyond the people already in the photo is a new person: it must be added, not swapped
    # onto the first person's face (unknown count: the photo is assumed to hold only the first person).
    present = (request.participants.existing or 1) if edit else 0
    cast = [ir.Character(assessment.slots[c.reference_id], i + 2, c.description.strip(), added=edit and i + 2 > present,
                         position=c.position)
            for i, c in enumerate(request.characters)]
    at = next((i + 1 for i, b in enumerate(blocks) if isinstance(b, ir.Operation) and b.category == 'subject'), 1)
    scope_all = next((i for i, b in enumerate(blocks) if isinstance(b, ir.WardrobeScope) and b.target == 'all'), None)
    if edit and scope_all is not None:
        # The person already in the photo changes clothes first: introduced after the new person, the clothing reads
        # as something only the new person gets, and the first person keeps the outfit from the photo.
        clothing = blocks[scope_all - 1:scope_all + 1]
        del blocks[scope_all - 1:scope_all + 1]
        blocks[at:at] = clothing
        at += len(clothing)
    blocks[at:at] = cast

    if edit:
        # An action that needs its own posture (walking, sitting...) cannot keep the original pose: holding both
        # leaves extra arms and hands, so the action wins.
        action_posture = (request.attribute('action').intent == 'set' and 'action' in assessment.resolved
                          and assessment.resolved['action'].requirements.posture not in (None, 'any'))
        kept = tuple(c for c in CATEGORIES
                     if (request.attribute(c).intent == 'keep' and not (c == 'pose' and action_posture))
                     or (c == 'framing' and same_framing))
        free = [c for c in CATEGORIES if request.attribute(c).intent == 'free']
        added = any(c.added for c in cast) or (assessment.participants_total or 0) > present
        widen = added and request.context.allow_reframing and 'framing' in kept
        if kept or not free:
            blocks.append(ir.Keep(tuple(c for c in kept if not (widen and c == 'framing')), everything_else=not free,
                                  allow_action_movement=request.attribute('action').intent in ('set', 'transfer'),
                                  people_added=added, widen=widen))

    total = assessment.participants_total
    if total and (total > 1 or request.participants.requested == 1):   # an explicit "one person" is an instruction too
        blocks.append(ir.Participants(total, edit))

    # Measured: with the clothing left free, bedroom scenes came out nude in standard mode, so the mode says it.
    if request.content_mode == 'standard' and request.attribute('wardrobe').intent == 'free':
        blocks.append(ir.Guidance('clothing', 'dressed'))
    # Adult content always shows grown people: "two adults" alone once gave a youthful face and build.
    if request.content_mode == 'adult' and not any(r.children for r in assessment.requirements):
        blocks.append(ir.Guidance('age', 'grown'))

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
    if any(request.attribute(c).intent in ('set', 'transfer') for c in ('pose', 'action')):
        # Complex poses are where extra legs and arms appear; with children in the scene, proportions follow each age.
        ages = 'mixed_ages' if any(r.children for r in assessment.requirements) else 'limbs'
        body.append(ir.Guidance('anatomy', ages))
    if (assessment.participants_total or 0) > 1:
        body.append(ir.Guidance('faces', 'eyes'))         # small faces in a group are where the eyes drift apart
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
