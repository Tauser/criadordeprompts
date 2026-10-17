"""Typed intermediate representation between the request and the model-specific text."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Header:
    mode: str
    image_count: int
    id: str = 'header'


@dataclass(frozen=True)
class Operation:
    category: str
    text: str

    @property
    def id(self) -> str:
        return f'op.{self.category}'


@dataclass(frozen=True)
class Transfer:
    slot: int
    aspects: tuple[str, ...]

    @property
    def id(self) -> str:
        return f'transfer.{self.slot}'


@dataclass(frozen=True)
class Keep:
    aspects: tuple[str, ...]
    everything_else: bool
    allow_action_movement: bool
    id: str = 'keep'


@dataclass(frozen=True)
class Participants:
    total: int
    edit: bool
    id: str = 'participants'


@dataclass(frozen=True)
class MinimumFraming:
    framing: str
    id: str = 'framing'


@dataclass(frozen=True)
class Guidance:
    key: str
    value: str

    @property
    def id(self) -> str:
        return f'guide.{self.key}'


@dataclass(frozen=True)
class Details:
    text: str
    id: str = 'details'


@dataclass(frozen=True)
class Manual:
    text: str
    id: str = 'manual'


Block = Header | Operation | Transfer | Keep | Participants | MinimumFraming | Guidance | Details | Manual
