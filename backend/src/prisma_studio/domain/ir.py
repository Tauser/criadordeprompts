"""Typed intermediate representation between the request and the model-specific text."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Header:
    mode: str
    image_count: int
    people: int = 1                       # everyone in the result: with two or more, roles must be named
    present: int = 0                      # in an edit, the people already in the photo
    sexes: tuple = ()                     # 'female', 'male' or None for each of the people, in order
    id: str = 'header'


@dataclass(frozen=True)
class Sexes:
    """Who is a woman and who is a man, said once before anyone is described; the sexes are in the header."""
    id: str = 'sexes'


@dataclass(frozen=True)
class Operation:
    category: str
    text: str
    participants: int | None = None      # declared by the catalog item; None when unknown
    is_instruction: bool = False         # a full edit instruction supplied explicitly by catalog metadata
    roles: tuple[str, ...] = ()          # the role of the first, second... person, as the English text names it

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
class WardrobeScope:
    target: str
    total: int
    id: str = 'scope.wardrobe'


@dataclass(frozen=True)
class Character:
    slot: int
    ordinal: int                          # 2 for the second person, 3 for the third...
    description: str = ''
    added: bool = False                   # edit: this person is not in the photo yet and must be added
    position: str | None = None           # left, right, behind or front; None: beside the others

    @property
    def id(self) -> str:
        return f'character.{self.ordinal}'


@dataclass(frozen=True)
class Others:
    """Generation: the people after the cast whom nothing describes; each must look unlike the first person."""
    first: int                            # ordinal of the first such person
    total: int
    id: str = 'others'


@dataclass(frozen=True)
class Keep:
    aspects: tuple[str, ...]
    everything_else: bool
    allow_action_movement: bool
    people_added: bool = False            # the identity aspects belong to the first person only
    widen: bool = False                   # added people need room: the crop may grow instead of being kept
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
    spoken: bool = True                   # False: kept for the rules and the checks, never written in the prompt

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


Block = (Header | Sexes | Operation | WardrobeScope | Transfer | Character | Others | Keep | Participants | MinimumFraming
         | Guidance | Details | Manual)
