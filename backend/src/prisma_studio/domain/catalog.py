"""Library items are data. Behaviour comes from category and metadata, never from names."""
from __future__ import annotations

import unicodedata

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .vocabulary import Category, Framing, Gaze, Orientation, Period, Place, Posture, Support

ITEM_ID = r'^[a-z0-9][a-z0-9._-]{2,79}$'


class Requirements(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    participants: int | None = Field(default=None, ge=1, le=10)
    posture: Posture | None = None
    gaze: Gaze | None = None
    orientation: Orientation | None = None
    support_any_of: tuple[Support, ...] | None = None
    minimum_framing: Framing | None = None
    children: bool | None = None              # the scene includes children: proportions follow each person's age


class Provides(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    supports: tuple[Support, ...] | None = None
    framing: Framing | None = None            # framing items: the visible area; cameras: the usual crop of the lens
    view: Orientation | None = None           # cameras: which side of the body the camera sees
    period: Period | None = None              # lighting and settings
    place: Place | None = None                # lighting and settings


class Item(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    id: str = Field(pattern=ITEM_ID)
    category: Category
    label: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=2000, description='English text sent to the model')
    edit_prompt: str | None = Field(default=None, min_length=1, max_length=2000,
                                   description='Optional complete edit instruction; generation still uses prompt')
    adult: bool = False
    enabled: bool = True
    requirements: Requirements = Requirements()
    provides: Provides = Provides()

    @model_validator(mode='before')
    @classmethod
    def _without_portuguese_copy(cls, data):
        """Options saved before the Portuguese copy was dropped still load; the old text is discarded."""
        if isinstance(data, dict) and 'prompt_pt' in data:
            data = {k: v for k, v in data.items() if k != 'prompt_pt'}
        return data

    @field_validator('edit_prompt')
    @classmethod
    def _edit_instruction(cls, value):
        if value is not None and not value.strip():
            raise ValueError('A instrução de edição não pode ficar vazia.')
        return value.strip() if value is not None else None

    @model_validator(mode='after')
    def _adult_without_children(self):
        if self.adult and self.requirements.children:
            raise ValueError('Uma opção adulta não pode incluir crianças.')
        return self


class Library(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: int = 1
    revision: int = Field(default=0, ge=0)
    items: list[Item] = []

    def index(self) -> dict[str, Item]:
        return {item.id: item for item in self.items}


def normalized_label(label: str) -> str:
    plain = ''.join(c for c in unicodedata.normalize('NFKD', label) if not unicodedata.combining(c))
    return ' '.join(plain.casefold().split())


def merge(defaults: Library, user: Library) -> Library:
    """User items override defaults with the same id; a category change is rejected."""
    items = {item.id: item for item in defaults.items}
    for item in user.items:
        if item.id in items and items[item.id].category != item.category:
            raise ValueError(f'A personalização de {item.id} não pode mudar a categoria.')
        items[item.id] = item
    merged = Library(revision=user.revision, items=list(items.values()))
    seen: set[tuple[str, str]] = set()
    for item in merged.items:
        key = (item.category, normalized_label(item.label))
        if key in seen:
            raise ValueError(f'Nome repetido na categoria {item.category}: {item.label}')
        seen.add(key)
    return merged


def available(library: Library, content_mode: str, category: str | None = None) -> list[Item]:
    return [item for item in library.items if item.enabled and (content_mode == 'adult' or not item.adult)
            and (category is None or item.category == category)]
