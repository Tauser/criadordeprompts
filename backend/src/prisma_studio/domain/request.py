"""Versioned request contract: the single source of truth for a generation."""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .vocabulary import Category, Confirmation, Framing, Intent, Support

REF_ID = r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'


class _Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)


class CatalogValue(_Strict):
    kind: Literal['catalog'] = 'catalog'
    item_id: str = Field(min_length=1, max_length=80)


class TextValue(_Strict):
    kind: Literal['text'] = 'text'
    text: str = Field(min_length=1, max_length=4000)

    @model_validator(mode='after')
    def _not_blank(self):
        if not self.text.strip():
            raise ValueError('O texto não pode ficar vazio.')
        return self


Value = Annotated[Union[CatalogValue, TextValue], Field(discriminator='kind')]


class Attribute(_Strict):
    intent: Intent
    value: Value | None = None
    reference_id: str | None = Field(default=None, pattern=REF_ID)

    @model_validator(mode='after')
    def _shape(self):
        if self.intent == 'set' and self.value is None:
            raise ValueError('"set" exige um valor.')
        if self.intent == 'transfer' and self.reference_id is None:
            raise ValueError('"transfer" exige uma referência.')
        if self.intent != 'set' and self.value is not None:
            raise ValueError('Somente "set" aceita valor.')
        if self.intent != 'transfer' and self.reference_id is not None:
            raise ValueError('Somente "transfer" aceita referência.')
        return self


class Reference(_Strict):
    id: str = Field(pattern=REF_ID)
    label: str = Field(min_length=1, max_length=120)


class Character(_Strict):
    """Another person in the scene whose appearance comes from a reference image."""
    reference_id: str = Field(pattern=REF_ID)
    description: str = Field(default='', max_length=500)
    position: Literal['left', 'right', 'behind', 'front'] | None = None   # where in the picture; None: beside


class Swap(_Strict):
    """Edit: the one person in the photo becomes the person of a reference photo. 'body': the whole person with their
    clothing takes the photo's pose and place; 'head': only the head and hair, on the photo's body."""
    reference_id: str = Field(pattern=REF_ID)
    mode: Literal['body', 'head'] = 'body'


class Participants(_Strict):
    requested: int | None = Field(default=None, ge=1, le=10)
    existing: int | None = Field(default=None, ge=0, le=10)


class SceneContext(_Strict):
    supports: tuple[Support, ...] | None = None
    allow_new_supports: bool = False
    allow_reframing: bool = True
    original_framing: Framing | None = None


class LoraChoice(_Strict):
    """A LoRA installed in ComfyUI (name as ComfyUI lists it) applied to the image model."""
    name: str = Field(min_length=1, max_length=200, pattern=r'^[^<>:"|?*]+\.safetensors$')
    strength: float = Field(default=0.8, ge=-2, le=2)

    @model_validator(mode='after')
    def _no_parent(self):
        if '..' in self.name:
            raise ValueError('Nome de LoRA inválido.')
        return self


class EngineSettings(_Strict):
    steps: int | None = Field(default=None, ge=1, le=100)
    cfg: float | None = Field(default=None, ge=1, le=20)
    sampler: str | None = Field(default=None, max_length=64)
    scheduler: str | None = Field(default=None, max_length=64)
    denoise: float | None = Field(default=None, ge=0.01, le=1)
    negative_prompt: str = Field(default='', max_length=4000)
    loras: tuple[LoraChoice, ...] = Field(default=(), max_length=3)


class Output(_Strict):
    profile: Literal['qwen21', 'turbo'] = 'qwen21'
    resolution: Literal[0, 1024, 1536, 2048] = 1024
    aspect: Literal['3:4', '2:3', '1:1', '16:9', '9:16', '4:3', '3:2'] = '3:4'
    width: int | None = Field(default=None, ge=256, le=2048, multiple_of=32)
    height: int | None = Field(default=None, ge=256, le=2048, multiple_of=32)
    seed: int | None = Field(default=None, ge=0, le=2**53 - 1)
    variations: int = Field(default=1, ge=1, le=4)
    verify: bool = False
    refine: bool = False
    face_detail: bool | None = None          # None = automatic: on with two or more people
    upscale: Literal[1.5, 2.0] | None = None  # Ampliar no fim: SeedVR2 redraws each picture this much larger

    @model_validator(mode='after')
    def _size(self):
        if (self.width is None) != (self.height is None):
            raise ValueError('Informe largura e altura juntas.')
        return self


Protection = Literal['anatomy', 'faces', 'clothing', 'action_detail']


class Request(_Strict):
    @model_validator(mode='before')
    @classmethod
    def _without_removed_fields(cls, data):
        # Drafts kept in a browser outlive removed features: "Trocar pessoas" sent `swaps`, and a phone still holding
        # such a draft got "Pedido: valor não permitido" on every edit.
        if isinstance(data, dict) and 'swaps' in data:
            data = {k: v for k, v in data.items() if k != 'swaps'}
        return data

    schema_version: Literal[1] = 1
    mode: Literal['generate', 'edit']
    content_mode: Literal['standard', 'adult'] = 'standard'
    prompt_mode: Literal['structured', 'manual'] = 'structured'
    manual_prompt: str | None = Field(default=None, max_length=12000)
    attributes: dict[Category, Attribute] = {}
    wardrobe_scope: Literal['primary', 'all'] = 'primary'
    references: tuple[Reference, ...] = Field(default=(), max_length=10)
    target_id: str | None = Field(default=None, pattern=REF_ID)
    mask: bool = False
    characters: tuple[Character, ...] = Field(default=(), max_length=3)
    swap: Swap | None = None
    participants: Participants = Participants()
    context: SceneContext = SceneContext()
    details: str = Field(default='', max_length=4000)
    # Safeguards the Studio writes on its own that the person switched off in the prompt preview.
    protections_off: frozenset[Protection] = frozenset()
    confirmations: frozenset[Confirmation] = frozenset()
    output: Output = Output()
    engine: EngineSettings = EngineSettings()

    @model_validator(mode='after')
    def _shape(self):
        if self.prompt_mode == 'manual' and not (self.manual_prompt or '').strip():
            raise ValueError('O modo manual exige um prompt.')
        if self.prompt_mode == 'structured' and self.manual_prompt is not None:
            raise ValueError('O prompt manual só existe no modo manual.')
        if self.mode == 'generate' and (self.target_id is not None or self.mask):
            raise ValueError('A geração não usa foto alvo nem máscara.')
        return self

    def attribute(self, category: str) -> Attribute:
        return self.attributes.get(category, Attribute(intent='free'))  # type: ignore[arg-type]
