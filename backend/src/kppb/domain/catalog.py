"""Library items are data. Behaviour comes from category and metadata, never from names."""
from __future__ import annotations

import unicodedata

from pydantic import BaseModel, ConfigDict, Field

from .vocabulary import Category, Framing, Gaze, Posture, Support

ITEM_ID = r'^[a-z0-9][a-z0-9._-]{2,79}$'


class Requirements(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    participants: int | None = Field(default=None, ge=1, le=10)
    posture: Posture | None = None
    gaze: Gaze | None = None
    support_any_of: tuple[Support, ...] | None = None
    minimum_framing: Framing | None = None


class Provides(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    supports: tuple[Support, ...] | None = None
    framing: Framing | None = None


class Item(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    id: str = Field(pattern=ITEM_ID)
    category: Category
    label: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=2000, description='English text sent to the model')
    prompt_pt: str | None = Field(default=None, max_length=2000)
    adult: bool = False
    enabled: bool = True
    requirements: Requirements = Requirements()
    provides: Provides = Provides()


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
