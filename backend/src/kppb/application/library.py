"""Library use cases: defaults from the versioned catalog, personal items in the database."""
from __future__ import annotations

import json
from pathlib import Path

from ..domain.catalog import Item, Library, available, merge


class LibraryService:
    def __init__(self, defaults_path: Path, repository):
        self.defaults_path = Path(defaults_path)
        self.repository = repository
        self._defaults: Library | None = None

    def defaults(self) -> Library:
        if self._defaults is None:
            data = json.loads(self.defaults_path.read_text(encoding='utf-8'))
            self._defaults = Library.model_validate(data)
            merge(self._defaults, Library())        # validates unique names
        return self._defaults

    def user(self) -> Library:
        revision, items = self.repository.read()
        return Library(revision=revision, items=[Item.model_validate(i) for i in items])

    def snapshot(self) -> dict:
        defaults, user = self.defaults(), self.user()
        merged = merge(defaults, user)
        builtin = {i.id for i in defaults.items}
        overridden = {i.id for i in user.items}
        return {'revision': user.revision, 'items': [i.model_dump(mode='json') for i in merged.items],
                'origins': {i.id: ('custom' if i.id in overridden and i.id in builtin else
                                   'user' if i.id in overridden else 'builtin') for i in merged.items}}

    def library(self) -> Library:
        return merge(self.defaults(), self.user())

    def catalog(self, content_mode: str = 'standard', category: str | None = None) -> list[dict]:
        return [i.model_dump(mode='json') for i in available(self.library(), content_mode, category)]

    def save(self, revision: int, items: list[dict]) -> dict:
        user = Library(revision=revision, items=[Item.model_validate(i) for i in items])
        merge(self.defaults(), user)                 # rejects category changes and duplicate names
        self.repository.replace(revision, [i.model_dump(mode='json') for i in user.items])
        return self.snapshot()
