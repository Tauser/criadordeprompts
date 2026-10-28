"""Assess declared facts only. Unknown facts are reported, never assumed."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from .catalog import Item, Library
from .request import CatalogValue, Request, TextValue
from .text_audit import FIXED_HEAD
from .vocabulary import CATEGORIES, FRAMING_ORDER, agreed

# 'adjusted': the Studio rewrote the instruction to keep it coherent and says so.
Level = Literal['error', 'warning', 'adjusted', 'unknown']
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
    if request.swap is not None:
        return _assess_swap(request, refs, slots, issues, report)

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

    seen_characters: set[str] = set()
    for i, character in enumerate(request.characters):
        where = f'characters.{i}'
        if character.reference_id not in refs:
            report('missing_reference', where, 'A foto do personagem não foi anexada.')
        elif character.reference_id == request.target_id:
            report('character_is_target', where, 'A foto editada não pode ser também a de outro personagem.')
        elif character.reference_id in seen_characters:
            report('duplicate_character', where, 'Esta foto já está sendo usada para outro personagem.')
        seen_characters.add(character.reference_id)

    if any(item.adult for item in resolved.values()) and any(i.requirements.children for i in resolved.values()):
        report('adult_with_children', 'attributes', 'Uma opção adulta não pode ser combinada com uma cena que inclui '
               'crianças.', kind='policy')
    if any(item.adult for item in resolved.values()):
        if 'adults_only' not in request.confirmations:
            report('confirm_adults', 'confirmations', 'Confirme que todas as pessoas retratadas são adultas.',
                   kind='policy')
        if uses_person_photos(request) and 'consent_or_fictional' not in request.confirmations:
            report('confirm_consent', 'confirmations',
                   'Confirme que as pessoas das fotos são fictícias ou consentiram com este uso.', kind='policy')

    requirements = tuple(item.requirements for item in resolved.values())
    _check_conflicts(request, resolved, report)
    _check_body(request, resolved, report)
    _check_supports(request, resolved, report)
    _check_framing(request, resolved, report)
    _check_scene(request, resolved, report)
    _check_face_described(request, refs, report)
    _check_mask(request, report)
    _check_edit_load(request, resolved, report)
    total, existing = _participants(request, resolved, report)
    _check_cast(request, resolved, report)
    _check_sexes(request, resolved, total, report)
    if request.wardrobe_scope == 'all':
        if request.attribute('wardrobe').intent != 'set':
            report('wardrobe_scope_requires_set', 'attributes.wardrobe',
                   'Para aplicar a roupa a todas as pessoas, escolha uma opção ou descrição de roupa.')
        if total is None or total < 2:
            report('wardrobe_scope_requires_people', 'attributes.wardrobe',
                   'Informe ao menos duas pessoas em Cena ou adicione outro personagem para aplicar a roupa a todos.')

    _check_output(request, report)
    if (total or 0) > 1 and request.output.resolution == 1024:
        report('small_faces', 'output.resolution', 'Com duas ou mais pessoas, cada rosto fica pequeno em 1024 px e os '
               'olhos tendem a sair tortos ou de cores diferentes. Use 1536 para fotos em grupo.', 'warning')
    if request.details.strip():
        report('details_not_analyzed', 'details', 'Os detalhes adicionais são enviados literalmente, sem análise.',
               'unknown')
    changes = [c for c in CATEGORIES if request.attribute(c).intent in ('set', 'transfer')]
    if request.mode == 'edit' and not changes and not request.characters and not request.details.strip():
        report('missing_change', 'attributes', 'Nenhuma alteração foi pedida para a foto.')
    for ref in request.references:
        if ref.id not in slots:
            report('unused_reference', 'references', f'A referência "{ref.label}" não está associada a nenhum campo '
                   'e não será enviada.', 'warning')
    if request.mode == 'generate' and slots:
        report('generation_reference', 'references', 'Referências na geração ainda não foram validadas visualmente '
               'neste modelo.', 'warning', 'model')
    return Assessment(tuple(issues), resolved, slots, total, existing, requirements)


# A group pose or action that tells its roles apart by place: "the adult on the left", "the left adult's", "the front
# adult", "the adult behind".
PLACED_ROLES = re.compile(r'\b(?:adult|person|one)s? (?:on the (?:left|right)|in front|behind)\b'
                          r'|\b(?:left|right|front)(?: adult| person|-hand adult)\b', re.IGNORECASE)


def _group_moves(request, resolved) -> list[tuple[str, str]]:
    """(category, wording) of the pose and action that move two or more people; text counts, it may be a group."""
    moves = []
    for category in ('pose', 'action'):
        attribute = request.attribute(category)
        if attribute.intent != 'set':
            continue
        if isinstance(attribute.value, CatalogValue):
            item = resolved.get(category)
            if item is not None and (item.requirements.participants or 1) > 1:
                moves.append((category, ' '.join(filter(None, (item.prompt, item.edit_prompt)))))
        else:
            moves.append((category, attribute.value.text))
    return moves


def _check_cast(request, resolved, report) -> None:
    if not request.characters:
        return
    moves = _group_moves(request, resolved)
    present = request.participants.existing or 1
    if request.mode == 'edit' and moves and 1 + len(request.characters) > present:
        # Measured on the user's five two-person poses: editing a photo of one person into the pose while adding the
        # other got 2 to 3 pictures right in 10 (a person lost, doubled or given the other's body); creating the scene
        # from both character sheets got 8 in 10.
        report('edit_cast_and_group_move', 'characters', 'Acrescentar personagem e mudar para uma pose ou ação a dois '
               'na mesma edição costuma perder, duplicar ou trocar uma pessoa. Para essa cena, prefira Criar, com a '
               'pessoa principal e o personagem vindos das fichas.', 'warning')
    if any(PLACED_ROLES.search(text) for _, text in moves):
        # The roles then follow the order the pose describes them; measured, that gave the first person the other's
        # role and anatomy, while a chosen position put each person in the right role.
        for index, character in enumerate(request.characters):
            if character.position is None:
                report('character_position_needed', f'characters.{index}.position', 'Esta pose diz quem faz o quê '
                       'pelo lugar de cada pessoa (esquerda, direita, frente ou atrás). Escolha a posição do personagem; '
                       'sem ela os papéis podem sair trocados.', 'warning')


def people_sexes(request: Request, people: int) -> tuple:
    """The sex of each of the people in the result, in order; None where it was not given."""
    given = tuple(request.participants.sexes[:people])
    return given + (None,) * (people - len(given))


def _check_sexes(request, resolved, total, report) -> None:
    # Bodies in contact share one region of the picture: a man's chest or hips drifted onto the woman beside him when
    # nothing in the prompt said which body was whose.
    people = max(total or 1, 1 + len(request.characters))
    if people < 2 or not _group_moves(request, resolved) or None not in people_sexes(request, people):
        return
    report('sex_unknown', 'participants.sexes', 'Diga quem é mulher e quem é homem: sem isso, numa cena com contato, o '
           'corpo de uma pessoa pode passar para a outra.', 'warning')


def _slots(request: Request) -> dict[str, int]:
    """Image numbers in submission order: the edit target first, then each used reference once."""
    order: list[str] = []
    if request.mode == 'edit' and request.target_id:
        order.append(request.target_id)
    known = {ref.id for ref in request.references}
    used = {a.reference_id for a in request.attributes.values() if a.intent == 'transfer'}
    used |= {c.reference_id for c in request.characters}
    if request.swap is not None:
        used.add(request.swap.reference_id)
    if request.prompt_mode == 'manual':
        used = known
    for ref in request.references:
        if ref.id in used and ref.id not in order and ref.id in known:
            order.append(ref.id)
    return {ref_id: i + 1 for i, ref_id in enumerate(order)}


IDENTITY_CATEGORIES = ('subject', 'face', 'body', 'skin', 'hair')


def uses_person_photos(request: Request) -> bool:
    """True when a photo supplies a person: the edited photo, another character or an identity reference."""
    return (request.mode == 'edit' or bool(request.characters)
            or any(request.attribute(c).intent == 'transfer' for c in IDENTITY_CATEGORIES))


def _assess_swap(request, refs, slots, issues, report) -> Assessment:
    """A swap is its own kind of edit: one person in the photo, one person photo, and only the details on top."""
    swap = request.swap
    if request.mode != 'edit':
        report('swap_needs_edit', 'swap', 'A troca de pessoa é uma edição: escolha a foto a editar.')
    else:
        _check_target(request, refs, report)
    if swap.reference_id not in refs:
        report('missing_reference', 'swap', 'Anexe a foto da pessoa que vai entrar.')
    elif swap.reference_id == request.target_id:
        report('swap_same_photo', 'swap', 'A pessoa que entra precisa vir de outra foto, não da foto editada.')
    if (request.participants.existing or 1) > 1:
        report('swap_one_person', 'participants.existing', 'Por enquanto a troca funciona com uma pessoa só na foto.')
    if swap.mode == 'body' and request.output.profile == 'turbo':
        report('swap_turbo', 'output.profile', 'A troca de corpo foi medida no perfil Completo; no Turbo ela não foi '
               'testada.', 'warning')
    if request.characters or any(a.intent in ('set', 'transfer') for a in request.attributes.values()):
        report('swap_ignores_changes', 'swap', 'Na troca de pessoa, as outras mudanças do pedido não são aplicadas; '
               'só os Detalhes entram.', 'warning')
    return Assessment(tuple(issues), {}, slots, 1, 1, ())


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
    replaces_person = request.mode == 'edit' and request.attribute('subject').intent in ('set', 'transfer')
    if replaces_person and request.characters:
        # "Replace the person with two adults" invents new people, and the added character is never used.
        report('replace_person_with_cast', 'attributes.subject',
               'Trocar a pessoa da foto inventa pessoas novas e ignora o personagem adicionado. Para editar a foto '
               'com outro personagem, escolha "Manter da foto" no campo Pessoa.')
    elif replaces_person and request.attribute('face').intent == 'keep':
        report('replace_person_keep_identity', 'attributes.subject',
               'Trocar a pessoa e manter a identidade do rosto pode gerar instruções conflitantes. '
               'Para editar a mesma pessoa, escolha "Manter da foto" no campo Pessoa.', 'warning')
    for key, label in (('posture', 'posturas'), ('gaze', 'olhares')):
        facts = _declared(request, resolved, key)
        if facts and agreed({value for _, value in facts}) is None:
            for category, _ in facts:
                report(f'conflicting_{key}', f'attributes.{category}', f'As opções pedem {label} incompatíveis.')
    kept_pose = request.attribute('pose').intent == 'keep'
    kept_expression = request.attribute('expression').intent == 'keep'
    action = resolved.get('action')
    if kept_pose and action is not None and action.requirements.posture not in (None, 'any'):
        report('pose_follows_action', 'attributes.pose', 'Esta ação define a postura do corpo, então a pose da foto '
               'não será mantida. Manter as duas gera braços e mãos a mais.', 'warning')
    elif kept_pose and _declared(request, resolved, 'posture'):
        report('posture_vs_kept_pose', 'attributes.pose', 'A postura original não é conhecida; a ação pode exigir '
               'outra postura.', 'unknown')
    if kept_pose and _declared(request, resolved, 'orientation'):
        report('orientation_vs_kept_pose', 'attributes.pose', 'A orientação original do corpo não é conhecida; a ação '
               'pode exigir outra orientação.', 'unknown')
    if kept_expression and _declared(request, resolved, 'gaze'):
        report('gaze_vs_kept_expression', 'attributes.expression', 'A direção original do olhar não é conhecida.',
               'unknown')
    for category, item in resolved.items():
        if category in ('pose', 'action'):
            missing = [k for k in ('participants', 'posture', 'gaze') if getattr(item.requirements, k) is None]
            if missing:
                report('incomplete_metadata', f'attributes.{category}',
                       'A opção não declara: ' + ', '.join(missing) + '.', 'unknown')


def body_moves(request) -> bool:
    return any(request.attribute(c).intent in ('set', 'transfer') for c in ('pose', 'action'))


def framing_already_there(request, resolved) -> bool:
    """An edit that asks for the framing the photo already has: reframing would only invite the model to redraw.
    When the pose changes, the old crop no longer fits the body, so the reframe instruction stays."""
    framing = resolved.get('framing')
    return (request.mode == 'edit' and framing is not None and request.attribute('framing').intent == 'set'
            and framing.provides.framing is not None and framing.provides.framing == request.context.original_framing
            and not body_moves(request))


# Postures that rarely fit the crop of a photo taken of someone standing or sitting.
GROUND_POSTURES = ('lying', 'supine', 'prone', 'side_lying', 'all_fours')


IDENTITY_KEEPS = ('subject', 'face', 'body')


def _check_edit_load(request, resolved, report) -> None:
    if request.mode != 'edit':
        return
    if framing_already_there(request, resolved):
        report('framing_already_there', 'attributes.framing', 'A foto já tem esse enquadramento; ele é mantido em vez '
               'de pedir um reenquadramento.', 'adjusted')
    keeps_person = any(request.attribute(c).intent == 'keep' for c in IDENTITY_KEEPS)
    postures = {i.requirements.posture for c, i in resolved.items() if c in ('pose', 'action')}
    frame_locked = (request.attribute('framing').intent == 'keep'
                    or (request.attribute('framing').intent == 'free' and not request.context.allow_reframing))
    if postures & set(GROUND_POSTURES) and (frame_locked or request.attribute('camera').intent == 'keep'):
        report('posture_in_old_frame', 'attributes.pose', 'A nova postura deitada ou de quatro fica presa ao recorte '
               'e ao ângulo da foto original, e o modelo tende a distorcer corpo, cabeça e cenário para encaixá-la. '
               'Deixe Câmera e Enquadramento livres (ou peça Corpo inteiro) e, se puder, use resolução 1536.',
               'warning')
    if request.attribute('style').intent == 'set' and keeps_person:
        report('style_redraws', 'attributes.style', 'Mudar o estilo numa edição refaz a imagem inteira e enfraquece a '
               'preservação do corpo e do rosto. Deixe o estilo livre se a foto já tem o visual desejado.', 'warning')
    if request.attribute('wardrobe').intent == 'set' and request.attribute('body').intent == 'keep':
        report('hidden_body', 'attributes.wardrobe', 'Se a roupa nova mostrar partes do corpo que a foto não mostra, '
               'o modelo precisa inventá-las, e a forma do corpo pode mudar.', 'warning')
    changes = [c for c in CATEGORIES if request.attribute(c).intent in ('set', 'transfer')
               and not (c == 'framing' and framing_already_there(request, resolved))]
    if keeps_person and len(changes) >= 4:
        report('many_changes', 'attributes', f'{len(changes)} mudanças de uma vez: o modelo tende a refazer a pessoa. '
               'Para preservar corpo e rosto, faça a edição em etapas (por exemplo, cenário e luz primeiro, depois '
               'pose e roupa).', 'warning')


def available_supports(request, resolved):
    """Supports the scene offers: a tuple, 'new' when the setting is created with the image, or None if unknown."""
    environment = request.attribute('environment')
    if environment.intent == 'set' and 'environment' in resolved:
        return resolved['environment'].provides.supports
    if environment.intent in ('set', 'transfer') or request.mode == 'generate':
        return 'new'
    return request.context.supports


NEAR_VIEWS = {frozenset({'three_quarter', 'front'}), frozenset({'three_quarter', 'side'})}
HIDDEN_FACE_GAZES = ('down', 'up', 'away', 'closed')


def _orientation_facts(resolved) -> list[tuple[str, str]]:
    """(category, side of the body seen by the camera) from poses, actions and the camera's view."""
    facts = []
    for category, item in resolved.items():
        value = item.provides.view if category == 'camera' else item.requirements.orientation
        if value not in (None, 'any'):
            facts.append((category, value))
    return facts


def effective_orientation(resolved) -> str | None:
    """The orientation the prompt states: the body items' own value first, otherwise the camera's view."""
    facts = _orientation_facts(resolved)
    body = {v for c, v in facts if c != 'camera'}
    values = body or {v for _, v in facts}
    return next(iter(values)) if len(values) == 1 else None


def body_gaze(orientation: str | None, gaze: str | None) -> str | None:
    """The gaze actually written: looking at the camera from behind or in profile needs a head turn."""
    if gaze == 'camera' and orientation == 'back':
        return 'over_shoulder_camera'
    if gaze == 'camera' and orientation == 'side':
        return 'turn_to_camera'
    return gaze


def _check_body(request, resolved, report) -> None:
    facts = _orientation_facts(resolved)
    values = {value for _, value in facts}
    if len(values) > 1:
        if frozenset(values) in NEAR_VIEWS:
            for category, _ in facts:
                report('near_orientation', f'attributes.{category}', 'As opções pedem ângulos próximos, mas '
                       'diferentes, do corpo; o prompt usa o da pose.', 'warning')
        else:
            message = ('A câmera e a pose mostram lados diferentes do corpo; escolha um dos dois.'
                       if any(c == 'camera' for c, _ in facts) else 'As opções pedem orientações incompatíveis.')
            for category, _ in facts:
                report('conflicting_orientation', f'attributes.{category}', message)
        return
    orientation = effective_orientation(resolved)
    gaze_facts = _declared(request, resolved, 'gaze')
    gaze = agreed({v for _, v in gaze_facts}) if gaze_facts else None
    where = f'attributes.{gaze_facts[0][0]}' if gaze_facts else 'attributes.pose'
    if orientation == 'back' and gaze == 'camera':
        report('gaze_over_shoulder', where, 'De costas, olhar para a câmera foi ajustado para olhar por cima do '
               'ombro, sem girar a cabeça além do pescoço.', 'adjusted')
    elif orientation == 'side' and gaze == 'camera':
        report('gaze_head_turn', where, 'De perfil, olhar para a câmera foi ajustado para a cabeça girar em direção '
               'a ela, no máximo até o ombro.', 'adjusted')
    elif orientation == 'front' and gaze == 'back':
        report('gaze_back_facing_front', where, 'O corpo está de frente e o olhar vai para trás, por cima do ombro: '
               'a cabeça fica de costas para a câmera.', 'warning')
    elif orientation == 'back' and gaze in HIDDEN_FACE_GAZES:
        report('gaze_not_visible', where, 'De costas o rosto não aparece; o olhar não poderá ser verificado.',
               'unknown')
    if body_gaze(orientation, gaze) in ('back', 'over_shoulder_camera', 'turn_to_camera'):
        for category in ('pose', 'action'):
            item = resolved.get(category)
            if item and re.search(FIXED_HEAD, item.prompt.lower()):
                report('head_fixed_by_pose', f'attributes.{category}', 'O texto desta opção mantém a cabeça alinhada, '
                       'mas o olhar pede que ela gire: escolha outra opção ou outro olhar.', 'warning')


def _check_scene(request, resolved, report) -> None:
    light, scene = resolved.get('lighting'), resolved.get('environment')
    if light and scene:
        for key in ('period', 'place'):
            a, b = getattr(light.provides, key), getattr(scene.provides, key)
            if a in (None, 'any') or b in (None, 'any') or a == b:
                continue
            if key == 'place':
                report('light_place', 'attributes.lighting', 'A luz e o cenário indicam ambientes diferentes '
                       '(interno e externo).', 'warning')
            elif 'night' in (a, b):
                report('light_period', 'attributes.lighting', 'A luz e o cenário indicam horários incompatíveis '
                       '(noite e dia).')
            else:
                report('light_period_near', 'attributes.lighting', 'A luz e o cenário indicam horários diferentes.',
                       'warning')
    camera = resolved.get('camera')
    usual = camera.provides.framing if camera else None
    if usual is None:
        return
    minimums = [i.requirements.minimum_framing for i in resolved.values() if i.requirements.minimum_framing]
    if minimums and FRAMING_ORDER[usual] < max(FRAMING_ORDER[m] for m in minimums):
        report('camera_framing', 'attributes.camera', 'A lente escolhida favorece um recorte mais fechado do que a '
               'pose precisa.', 'warning')
    framing = resolved.get('framing')
    visible = framing.provides.framing if framing else None
    if visible and abs(FRAMING_ORDER[visible] - FRAMING_ORDER[usual]) >= 2:
        report('camera_vs_framing', 'attributes.camera', 'A lente e o enquadramento pedem recortes muito '
               'diferentes.', 'warning')


# Text about the face or hair makes the image model follow the words and ignore the reference photo that gives the identity.
FACE_WORDS = (
    r'\b(?:'
    r'(?:blue|green|brown|hazel|gr[ae]y|black|dark|light|amber)[- ]eyed|(?:blue|green|brown|hazel|gr[ae]y|black|dark|light|amber) eyes|'
    r'olhos? (?:azuis|verdes|castanhos|pretos|negros|cinzas|claros|escuros|amendoados)|'
    r'(?:(?:short|long|curly|wavy|straight|dark|light|red|black|brown|gr[ae]y|white|blond|blonde)\s+)*'
    r'(?:blond(?:e|es)?|brunettes?|redheads?)(?:\s+hair)?|'
    r'(?:(?:short|long|curly|wavy|straight|dark|light|red|black|brown|gr[ae]y|white)\s+)+hair|'
    r'bald|careca|loir[oa]s?|ruiv[oa]s?|'
    r'cabelos? (?:curtos?|longos?|cacheados?|ondulados?|lisos?|pretos?|castanhos?|grisalhos?|brancos?)|'
    r'beards?|mustaches?|moustaches?|goatee|stubble|barbas?|barbudo|bigodes?|cavanhaque|'
    r'freckles?|freckled|sardas?|sardento'
    r')\b'
    # Chin, lips, nose and jaw stay out: poses name them for position ("chin lifted"), not for who the person is.
)


def _check_face_described(request, refs, report) -> None:
    """A face or hair described in text while a reference photo supplies the identity: one warning, never an error."""
    identity = [c for c in ('face', 'hair') if request.attribute(c).intent == 'transfer'
                and request.attribute(c).reference_id in refs]
    sources = [(f'characters.{i}', 'A descrição do personagem', c.description)
               for i, c in enumerate(request.characters) if c.reference_id in refs]
    if identity:
        sources += [(f'attributes.{category}', 'O texto', attribute.value.text)
                    for category, attribute in request.attributes.items()
                    if category not in identity and attribute.intent == 'set' and isinstance(attribute.value, TextValue)]
        sources.append(('details', 'O texto', request.details))
    for where, label, source in sources:
        match = re.search(FACE_WORDS, source, re.IGNORECASE)
        if match:
            report('face_described', where, f'{label} fala do rosto ou do cabelo ("{match.group(0)}"): com foto de '
                   'referência, isso faz o modelo ignorar a foto. Descreva só roupa, pose e cena.', 'warning', 'model')
            return


MASK_RULES = (
    ('framing', 'error', 'Com máscara não é possível reenquadrar: só a área pintada muda.'),
    ('camera', 'error', 'Com máscara não é possível mudar a câmera: só a área pintada muda.'),
    ('environment', 'warning', 'Com máscara, o cenário só muda dentro da área pintada.'),
    ('lighting', 'warning', 'Com máscara, a luz só muda dentro da área pintada.'),
    ('pose', 'warning', 'Com máscara, o corpo fora da área pintada não se move; a pose pode ficar quebrada.'),
    ('action', 'warning', 'Com máscara, o corpo fora da área pintada não se move; a ação pode ficar quebrada.'),
)


def _check_mask(request, report) -> None:
    if request.mode != 'edit' or not request.mask:
        return
    for category, level, message in MASK_RULES:
        if request.attribute(category).intent in ('set', 'transfer'):
            report(f'mask_{category}', f'attributes.{category}', message, level)


def _check_output(request, report) -> None:
    output, engine = request.output, request.engine
    names = [lora.name for lora in engine.loras]
    if len(set(names)) != len(names):
        report('duplicate_lora', 'engine', 'O mesmo LoRA foi escolhido duas vezes.')
    if names:
        report('lora_not_analyzed', 'engine', 'LoRA não é analisado pelo Studio: confira se foi treinado para o Qwen '
               'Image 2.1 e compare com e sem ele na mesma seed.', 'unknown', 'model')
    turbo = output.profile == 'turbo'
    if turbo and (engine.steps is not None or engine.cfg is not None):
        report('turbo_settings', 'engine', 'O modo Turbo usa sempre 8 passos e CFG 1; os valores informados são '
               'ignorados.', 'adjusted')
    if turbo and output.refine:
        report('turbo_refine', 'output.refine', 'O aprimoramento não é usado no modo Turbo.', 'adjusted')
    if engine.negative_prompt.strip() and (turbo or (engine.cfg or 1) <= 1):
        report('negative_ignored', 'engine', 'O prompt negativo só tem efeito com CFG acima de 1.', 'warning')


def _check_supports(request, resolved, report) -> None:
    context = request.context
    available = available_supports(request, resolved)
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


PARTICIPANT_SOURCES = {'action': 'pela ação', 'pose': 'pela pose', 'subject': 'pela pessoa escolhida'}


def automatic_participants(request, resolved) -> tuple[int | None, str | None]:
    """How many people the scene needs without the requested number, and what decides it (shown as the default)."""
    sources = [(item.requirements.participants, PARTICIPANT_SOURCES.get(category, 'pelas opções escolhidas'))
               for category, item in resolved.items() if item.requirements.participants]
    if request.characters:
        extra = len(request.characters)
        sources.append((1 + extra, f'pela pessoa principal + {extra} ' + ('personagens' if extra > 1 else 'personagem')))
    if request.mode == 'edit' and request.participants.existing:
        sources.append((request.participants.existing, 'pelas pessoas da foto'))
    if not sources:
        return None, None
    return max(sources, key=lambda source: source[0])


def _participants(request, resolved, report):
    counts = [item.requirements.participants for item in resolved.values() if item.requirements.participants]
    if request.participants.requested:
        counts.append(request.participants.requested)
    if request.characters:
        counts.append(1 + len(request.characters))
    existing = request.participants.existing if request.mode == 'edit' else None
    if existing:
        counts.append(existing)
    total = max(counts) if counts else None
    requested = request.participants.requested
    needed = [(f'attributes.{c}', item.requirements.participants) for c, item in resolved.items()
              if item.requirements.participants]
    if request.characters:
        needed.append(('characters', 1 + len(request.characters)))
    for where, count in needed:
        if requested and count > requested:
            report('participants_mismatch', where, f'Você pediu {requested} pessoa(s), mas esta escolha exige {count}.')
    if request.mode == 'edit' and requested and existing and existing > requested:
        report('cannot_remove_people', 'participants.requested', 'A foto já tem mais pessoas do que o pedido; o '
               'Studio não remove pessoas.', 'warning')
    if request.mode == 'edit' and existing is None and total and total > 1:
        # Guessed as one, a photo that already holds two got a third person "added" next to them.
        report('unknown_existing', 'participants.existing', 'Informe quantas pessoas já estão na foto.')
    present = (existing or 1) if request.mode == 'edit' else 1
    invented = (total or 0) - present - len(request.characters)
    if request.mode == 'edit' and invented > 0 and not requested:
        who = 'uma pessoa nova' if invented == 1 else f'{invented} pessoas novas'
        report('invented_people', 'participants.existing', f'As opções escolhidas pedem {total} pessoas: {who} será '
               'inventada e costuma sair parecida com quem já está na foto. Adicione um personagem para escolher quem é.',
               'warning')
    return total, existing
