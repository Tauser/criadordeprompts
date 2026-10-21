"""Checks the wording of a library item against itself and against its own metadata.

The compiler trusts metadata; the image model reads the text. When the two disagree, or the text can be read two ways,
the model gets a contradiction the rules never see. These checks are heuristics on English text: a finding is a reason
to reread the item, not proof of an error.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .catalog import Item

LIMBS = r'(?:legs?|arms?|hands?|feet|foot|knees?|elbows?|forearms?|ankles?|shoulders?|thighs?|hips?)'
SURFACE_WORDS = {
    'floor': r'\b(?:floor|ground)\b', 'bed': r'\b(?:bed|mattress)\b',
    'seat': r'\b(?:chair|sofa|couch|stool|seat|bench|armchair)\b', 'table': r'\b(?:table|tabletop|desk)\b',
    'wall': r'\bwall\b',
}
POSTURE_WORDS = {
    'seated': r'\b(?:sitting|seated)\b', 'standing': r'\bstanding\b', 'kneeling': r'\bkneeling\b',
    'all_fours': r'\bon (?:all fours|hands and knees|forearms and knees)\b', 'squatting': r'\bsquat',
    'lying': r'\b(?:lying|reclining)\b',
}
COMPATIBLE_POSTURES = {
    'seated': {'seated'}, 'standing': {'standing', 'walking', 'running'}, 'kneeling': {'kneeling', 'all_fours'},
    'all_fours': {'all_fours'}, 'squatting': {'squatting'},
    'lying': {'lying', 'supine', 'prone', 'side_lying'},
}
BACK_WORDS = r'\b(?:from behind|back (?:to|toward|towards) the camera|seen from the back|view from behind)\b'
FRONT_WORDS = r'\b(?:facing the camera|front (?:of the body )?(?:to|toward|towards) the camera)\b'
CAMERA_GAZE = r'\b(?:looking (?:at|into) the (?:camera|lens)|eyes (?:on|at|directed at) the (?:camera|lens))\b'
CHILD_WORDS = r'\b(?:child|children|kids?|toddlers?|baby|babies)\b'
SINGLE_PERSON = r'\bthe (?:adult |fictional |young |nude )*(?:character|person|model|subject|woman|man)\b'
# Colors and materials belong to the setting; in a pose they pull the reference photo's room into the image.
SCENE_DETAILS = (r'\b(?:red|blue|green|yellow|orange|purple|pink|brown|black|white|gray|grey|beige|navy|teal|turquoise|'
                 r'golden|silver|velvet|leather|wooden|linen|cotton|silk|satin|upholstered|tufted|plush|marble|wicker|'
                 r'striped|checkered|floral|patterned)\b')
FIXED_HEAD =r'\bhead (?:in line with the spine|aligned with the (?:spine|body)|straight)\b'
# The camera is chosen in Framing and Camera, and an edit keeps the photo's: a pose that moves it pulls against both.
CAMERA_WORDS = (r'\b(?:camera (?:at|from|is|placed|positioned|angle)|(?:low|high)[- ]angle|bird.?s[- ]eye|'
                r'worm.?s[- ]eye|close[- ]up|wide shot|shot from)\b')
# The Studio asks every face for two matching eyes looking the same way; an eye trick makes the model fight it.
EYE_TRICKS = (r'\b(?:cross(?:ing|es)? (?:the |their |both )?eyes|cross[- ]eyed|eyes crossed|'
              r'roll(?:ing|s)? (?:the |their )?eyes|rolled eyes|wink(?:ing|s)?)\b')


@dataclass(frozen=True)
class Finding:
    code: str
    level: str          # 'conflict' (text contradicts metadata or itself) or 'ambiguity' or 'style'
    message: str


def audit_item(item: Item) -> list[Finding]:
    text = item.prompt
    low = text.lower()
    found: list[Finding] = []

    def add(code, level, message):
        found.append(Finding(code, level, message))

    body = item.category in ('pose', 'action')
    if body and re.search(rf'\bone {LIMBS}\b', low) and re.search(rf'\b(?:the )?other {LIMBS}?', low):
        add('ambiguous_limbs', 'ambiguity', 'Conta membros com "one … the other": use right/left para o modelo não '
            'desenhar um membro a mais.')
    if body and re.search(rf'\bboth {LIMBS}', low) and re.search(rf'\bone {LIMBS}', low):
        add('both_and_one', 'ambiguity', 'Usa "both" e "one" para os mesmos membros: o modelo pode somar e desenhar três.')
    if re.search(r'\byour?\b', low):
        add('second_person', 'style', 'Texto em segunda pessoa ("you/your"): descreva o corpo de forma neutra.')
    if body and re.search(r'\b(?:her|his|she|he)\b', low):
        add('gendered_pose', 'style', 'A pose usa "her/his": isso puxa o gênero da pessoa, que é escolhido no campo Pessoa.')
    if re.search(r'\([^()]*:\s*\d+(?:\.\d+)?\)', text) or re.search(r'\b(?:masterpiece|best quality|ultra high res)\b', low):
        add('sd_syntax', 'style', 'Sintaxe de Stable Diffusion (pesos ou tags de qualidade): o Qwen lê como texto solto.')
    inline = item.category not in ('style', 'lighting', 'camera')     # those may open with a proper name (Rembrandt)
    if item.edit_prompt is None and text[:1].isupper() and inline:
        add('capitalized', 'style', 'Começa com maiúscula, mas entra no meio de uma frase do prompt.')
    if body and len(text) < 40:
        add('too_vague', 'ambiguity', 'Descrição curta demais para uma pose: diga onde ficam tronco, braços, pernas e cabeça.')
    scene = sorted(set(re.findall(SCENE_DETAILS, low))) if body else []
    if scene:
        add('scene_details', 'style', 'O texto da pose cita cor ou material (' + ', '.join(scene) + '): isso briga '
            'com o Cenário escolhido. Descreva só o corpo e o contato, com superfícies genéricas.')

    wording = ' '.join(t for t in (item.prompt, item.edit_prompt) if t).lower()
    if body and re.search(CAMERA_WORDS, wording):
        add('camera_words', 'conflict', 'O texto da pose escolhe o ângulo da câmera: isso briga com Enquadramento e '
            'Câmera e, na edição, com a ordem de manter a câmera da foto. Descreva só o corpo.')
    if body and re.search(EYE_TRICKS, wording):
        add('eye_trick', 'conflict', 'O texto pede olhos vesgos, revirados ou uma piscada, mas o Studio pede dois olhos '
            'iguais olhando para o mesmo lado: o modelo tende a errar o olho. Use outra careta.')

    req = item.requirements
    if body and req.support_any_of:
        named = {s for s, pattern in SURFACE_WORDS.items() if re.search(pattern, low)}
        if req.posture in ('seated', 'standing', 'walking', 'running'):
            named.discard('floor')              # feet on the floor are part of the scene, not a second support
        outside = named - set(req.support_any_of)
        if outside:
            add('surface_not_declared', 'conflict', 'O texto cita ' + ', '.join(sorted(outside)) + ', que não está nos '
                'apoios aceitos: o cenário pode escolher outra superfície.')
        elif named and len(set(req.support_any_of)) > len(named):
            add('surface_narrower', 'ambiguity', 'O texto cita ' + ', '.join(sorted(named)) + ', mas os apoios aceitos '
                'são mais amplos: o Studio pode pedir outra superfície.')
    if body and req.posture not in (None, 'any'):
        for word, pattern in POSTURE_WORDS.items():
            if re.search(pattern, low) and req.posture not in COMPATIBLE_POSTURES[word]:
                add('posture_words', 'conflict', f'O texto descreve "{word}", mas a postura declarada é {req.posture}.')
                break
    if req.orientation == 'front' and re.search(BACK_WORDS, low):
        add('orientation_words', 'conflict', 'O texto mostra o corpo de costas, mas a orientação declarada é de frente.')
    if req.orientation == 'back' and re.search(FRONT_WORDS, low) and not re.search(r'(?:butt|hips|buttocks)[^,.]*facing', low):
        add('orientation_words', 'conflict', 'O texto vira o corpo para a câmera, mas a orientação declarada é de costas.')
    if req.gaze not in (None, 'any', 'camera') and re.search(CAMERA_GAZE, low):
        add('gaze_words', 'conflict', f'O texto olha para a câmera, mas o olhar declarado é {req.gaze}.')
    if req.gaze == 'camera' and re.search(r'\b(?:eyes closed|looking (?:down|away))\b', low):
        add('gaze_words', 'conflict', 'O texto desvia o olhar, mas o olhar declarado é para a câmera.')
    if re.search(FIXED_HEAD, low) and (req.orientation in ('back', 'side') or req.gaze == 'back'):
        add('fixed_head', 'conflict', 'O texto fixa a cabeça alinhada, mas a orientação ou o olhar pedem que ela gire.')
    if item.category in ('pose', 'action') and req.participants == 1 and re.search(r'\b(?:each other|two adults|partner)\b', low):
        add('people_words', 'conflict', 'O texto fala de duas pessoas, mas a opção declara uma.')
    if item.category == 'wardrobe' and re.search(SINGLE_PERSON, wording):
        add('single_person', 'ambiguity', 'A roupa fala de uma pessoa só ("the character", "the person"): com "Todas as '
            'pessoas", o modelo tende a vestir só uma. Use um texto neutro, sem sujeito, ou no plural.')
    if re.search(CHILD_WORDS, low) and item.adult:
        add('adult_with_children', 'conflict', 'O texto fala de crianças numa opção adulta.')
    elif body and re.search(CHILD_WORDS, low) and not req.children:
        add('children_not_declared', 'conflict', 'O texto fala de crianças, mas a opção não declara que a cena inclui '
            'crianças: o compilador pediria proporções de adulto para todos.')
    return found


def contradictions_in_prompt(text: str) -> list[str]:
    """Pairs of sentences in a compiled prompt that pull the same body part two ways."""
    low = text.lower()
    found = []
    if re.search(FIXED_HEAD, low) and re.search(r'head turns (?:to look back over the shoulder|toward the camera)', low):
        found.append('A pose fixa a cabeça alinhada e outra frase manda girá-la para a câmera.')
    if re.search(r'\bseen from behind\b', low) and re.search(r'\bfront of the body faces the camera\b', low):
        found.append('O corpo aparece de costas e de frente ao mesmo tempo.')
    surfaces = set(re.findall(r'supported by (a bed|the floor|a seat|a table|a wall)', low))
    if len(surfaces) > 1:
        found.append('O corpo é apoiado em superfícies diferentes: ' + ', '.join(sorted(surfaces)) + '.')
    return found
