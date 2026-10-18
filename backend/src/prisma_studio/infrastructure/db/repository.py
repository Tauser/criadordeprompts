"""Runs, tasks, events and the user's library. Every state change is validated and logged."""
from __future__ import annotations

import logging

from .database import Database, dumps, loads, new_id, now

TERMINAL = {'completed', 'failed', 'cancelled', 'lost'}
RUN_TRANSITIONS = {
    'created': {'preparing'},
    'preparing': {'refining', 'generating'},
    'refining': {'review', 'generating'},
    'review': {'generating'},
    'generating': {'verifying', 'completed', 'uncertain'},
    'verifying': {'completed'},
    'uncertain': {'generating', 'lost'},
}
TASK_TRANSITIONS = {
    'created': {'submitting'},
    'submitting': {'queued', 'uncertain', 'failed', 'created'},   # created: the request provably never left
    'queued': {'running', 'completed', 'failed', 'cancelled', 'lost'},
    'running': {'completed', 'failed', 'cancelled', 'lost'},
    'uncertain': {'queued', 'lost', 'created'},                     # created: resubmission the user confirmed
}


class InvalidTransition(ValueError):
    pass


class MissingFile(KeyError):
    """A run referenced a file the Studio no longer has."""


def _allowed(table: dict, current: str, target: str) -> bool:
    if current == target:
        return True
    if current in TERMINAL:
        return False
    if target in ('failed', 'cancelled', 'lost'):
        return True
    return target in table.get(current, set())


class RunRepository:
    def __init__(self, db: Database):
        self.db = db

    # runs -----------------------------------------------------------------
    def create(self, request_id: str, mode: str, request: dict, files: dict, settings: dict, *, prompt: str,
               effective_prompt: str | None = None, compiled: dict | None = None) -> tuple[dict, bool]:
        """Insert a complete run (request, files, settings and prompt) in one transaction."""
        if not prompt:
            raise ValueError('Um pedido precisa de prompt.')
        with self.db.transaction() as tx:
            existing = tx.execute('SELECT id FROM runs WHERE request_id=?', (request_id,)).fetchone()
            if existing:
                return self.get(existing['id']), False
            for file_hash in _hashes(files):
                if tx.execute('SELECT 1 FROM files WHERE hash=?', (file_hash,)).fetchone() is None:
                    raise MissingFile(file_hash)
            run_id, at = new_id(), now()
            tx.execute('INSERT INTO runs(id, request_id, status, mode, request_json, files_json, settings_json, '
                       'prompt, effective_prompt, compiled_json, created_at, updated_at) '
                       'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                       (run_id, request_id, 'created', mode, dumps(request), dumps(files), dumps(settings),
                        prompt, effective_prompt or prompt, dumps(compiled) if compiled is not None else None, at, at))
            tx.execute('INSERT INTO events(run_id, at, type, data_json) VALUES (?,?,?,?)',
                       (run_id, at, 'status', dumps({'status': 'created'})))
        return self.get(run_id), True

    def get(self, run_id: str) -> dict | None:
        row = self.db.one('SELECT * FROM runs WHERE id=?', (run_id,))
        return _run(row) if row else None

    def by_request(self, request_id: str) -> dict | None:
        row = self.db.one('SELECT * FROM runs WHERE request_id=?', (request_id,))
        return _run(row) if row else None

    def list(self, limit: int = 30) -> list[dict]:
        return [_run(r) for r in self.db.query('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?', (limit,))]

    def open_runs(self) -> list[dict]:
        marks = ','.join('?' * len(TERMINAL))
        return [_run(r) for r in self.db.query(f'SELECT * FROM runs WHERE status NOT IN ({marks}) '
                                               'ORDER BY created_at', tuple(TERMINAL))]

    def update(self, run_id: str, **fields) -> dict:
        if not fields:
            return self.get(run_id)
        encoded = {k: dumps(v) if k.endswith('_json') else v for k, v in fields.items()}
        with self.db.transaction() as tx:
            sets = ', '.join(f'{k}=?' for k in encoded)
            tx.execute(f'UPDATE runs SET {sets}, updated_at=? WHERE id=?', (*encoded.values(), now(), run_id))
        return self.get(run_id)

    def transition(self, run_id: str, status: str, **fields) -> dict:
        with self.db.transaction() as tx:
            row = tx.execute('SELECT status FROM runs WHERE id=?', (run_id,)).fetchone()
            if row is None:
                raise KeyError(run_id)
            if not _allowed(RUN_TRANSITIONS, row['status'], status):
                raise InvalidTransition(f'{row["status"]} → {status}')
            encoded = {k: dumps(v) if k.endswith('_json') else v for k, v in fields.items()}
            sets = ''.join(f', {k}=?' for k in encoded)
            tx.execute(f'UPDATE runs SET status=?{sets}, updated_at=? WHERE id=?',
                       (status, *encoded.values(), now(), run_id))
            if row['status'] != status:
                tx.execute('INSERT INTO events(run_id, at, type, data_json) VALUES (?,?,?,?)',
                           (run_id, now(), 'status', dumps({'status': status, 'from': row['status'],
                                                            **({'error': fields['error']} if fields.get('error') else {})})))
        return self.get(run_id)

    def event(self, run_id: str, type_: str, data: dict) -> None:
        with self.db.transaction() as tx:
            tx.execute('INSERT INTO events(run_id, at, type, data_json) VALUES (?,?,?,?)',
                       (run_id, now(), type_, dumps(data)))

    def events(self, run_id: str, after: int = 0) -> list[dict]:
        rows = self.db.query('SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id', (run_id, after))
        return [{'id': r['id'], 'at': r['at'], 'type': r['type'], **loads(r['data_json'])} for r in rows]

    def delete(self, run_id: str, connection=None) -> list[str]:
        """Remove a finished run with its tasks and events; returns the file hashes it referenced."""
        if connection is None:
            with self.db.transaction() as tx:
                return self.delete(run_id, tx)
        tx = connection
        row = tx.execute('SELECT status, files_json, settings_json FROM runs WHERE id=?', (run_id,)).fetchone()
        if row is None:
            raise KeyError(run_id)
        if row['status'] not in TERMINAL:
            raise InvalidTransition('Pare o pedido antes de apagá-lo.')
        hashes = set(_hashes(loads(row['files_json'])))
        for task in tx.execute('SELECT result_json FROM tasks WHERE run_id=?', (run_id,)).fetchall():
            hashes |= set((loads(task['result_json']) or {}).get('files', []))
        tx.execute('DELETE FROM events WHERE run_id=?', (run_id,))
        tx.execute('DELETE FROM tasks WHERE run_id=?', (run_id,))
        tx.execute('DELETE FROM runs WHERE id=?', (run_id,))
        return sorted(hashes)

    def referenced_files(self, connection=None) -> set[str]:
        connection = connection or self.db.connection()
        hashes: set[str] = set()
        for row in connection.execute('SELECT files_json FROM runs').fetchall():
            hashes |= set(_hashes(loads(row['files_json'])))
        for row in connection.execute('SELECT result_json FROM tasks WHERE result_json IS NOT NULL').fetchall():
            hashes |= set((loads(row['result_json']) or {}).get('files', []))
        return hashes

    def delete_with_files(self, run_id: str, keep: set[str], remove) -> int:
        return self.delete_many_with_files([run_id], keep, remove)

    def delete_many_with_files(self, run_ids: list[str], keep: set[str], remove) -> int:
        """Commit the history deletion before removing unreferenced bytes.

        Disk deletion cannot be rolled back by SQLite. A failure must leave an orphan file, never restore
        a history entry whose images were already deleted. Hold the write lock through cleanup so new
        runs and uploads cannot claim a candidate in between the reference check and its removal.
        """
        removed = 0
        with self.db.write_lock:
            with self.db.transaction() as tx:
                hashes = set()
                for run_id in dict.fromkeys(run_ids):
                    hashes.update(self.delete(run_id, tx))
                candidates = hashes - self.referenced_files(tx) - set(keep)
            for file_hash in sorted(candidates):
                try:
                    remove(file_hash)
                except OSError:
                    logging.getLogger(__name__).warning('Arquivo órfão mantido após falha na limpeza: %s', file_hash,
                                                        exc_info=True)
                    continue
                self.forget_file(file_hash)
                removed += 1
        return removed

    def forget_file(self, file_hash: str) -> None:
        with self.db.transaction() as tx:
            tx.execute('DELETE FROM files WHERE hash=?', (file_hash,))

    # tasks ----------------------------------------------------------------
    def add_task(self, run_id: str, kind: str, position: int = 0, seed: int | None = None) -> dict:
        """Idempotent: a second call for the same (run, kind, position) returns the existing task."""
        return self.add_tasks(run_id, kind, [(position, seed)])[0]

    def add_tasks(self, run_id: str, kind: str, slots: list[tuple[int, int | None]]) -> list[dict]:
        """Create every missing (position, seed) of a batch in one transaction; existing ones are kept."""
        ids = []
        with self.db.transaction() as tx:
            for position, seed in slots:
                row = tx.execute('SELECT id FROM tasks WHERE run_id=? AND kind=? AND position=?',
                                 (run_id, kind, position)).fetchone()
                if row is None:
                    task_id = new_id()
                    tx.execute('INSERT INTO tasks(id, run_id, kind, position, status, seed, created_at) '
                               'VALUES (?,?,?,?,?,?,?)', (task_id, run_id, kind, position, 'created', seed, now()))
                    ids.append(task_id)
                else:
                    ids.append(row['id'])
        return [self.task(task_id) for task_id in ids]

    def task(self, task_id: str) -> dict | None:
        row = self.db.one('SELECT * FROM tasks WHERE id=?', (task_id,))
        return _task(row) if row else None

    def tasks(self, run_id: str, kind: str | None = None) -> list[dict]:
        if kind:
            rows = self.db.query('SELECT * FROM tasks WHERE run_id=? AND kind=? ORDER BY position, created_at',
                                 (run_id, kind))
        else:
            rows = self.db.query('SELECT * FROM tasks WHERE run_id=? ORDER BY created_at, position', (run_id,))
        return [_task(r) for r in rows]

    def task_transition(self, task_id: str, status: str, **fields) -> dict:
        with self.db.transaction() as tx:
            row = tx.execute('SELECT status, run_id FROM tasks WHERE id=?', (task_id,)).fetchone()
            if row is None:
                raise KeyError(task_id)
            if not _allowed(TASK_TRANSITIONS, row['status'], status):
                raise InvalidTransition(f'tarefa {row["status"]} → {status}')
            encoded = {k: dumps(v) if k.endswith('_json') else v for k, v in fields.items()}
            sets = ''.join(f', {k}=?' for k in encoded)
            tx.execute(f'UPDATE tasks SET status=?{sets} WHERE id=?', (status, *encoded.values(), task_id))
            if row['status'] != status:
                tx.execute('INSERT INTO events(run_id, at, type, data_json) VALUES (?,?,?,?)',
                           (row['run_id'], now(), 'task', dumps({'task': task_id, 'status': status})))
        return self.task(task_id)

    # files ----------------------------------------------------------------
    def record_file(self, stored) -> None:
        with self.db.transaction() as tx:
            tx.execute('INSERT OR IGNORE INTO files(hash, mime, width, height, size, created_at) VALUES (?,?,?,?,?,?)',
                       (stored.hash, stored.mime, stored.width, stored.height, stored.size, now()))

    def file(self, file_hash: str) -> dict | None:
        row = self.db.one('SELECT * FROM files WHERE hash=?', (file_hash,))
        return dict(row) if row else None


class LibraryRepository:
    def __init__(self, db: Database):
        self.db = db

    def read(self) -> tuple[int, list[dict]]:
        revision = int(self.db.one("SELECT value FROM meta WHERE key='library_revision'")['value'])
        items = [loads(r['item_json']) for r in self.db.query('SELECT item_json FROM library ORDER BY id')]
        return revision, items

    def replace(self, expected_revision: int, items: list[dict]) -> int:
        with self.db.transaction() as tx:
            revision = int(tx.execute("SELECT value FROM meta WHERE key='library_revision'").fetchone()['value'])
            if revision != expected_revision:
                raise InvalidTransition('A biblioteca mudou em outra tela. Atualize antes de salvar.')
            tx.execute('DELETE FROM library')
            for item in items:
                tx.execute('INSERT INTO library(id, item_json, updated_at) VALUES (?,?,?)',
                           (item['id'], dumps(item), now()))
            tx.execute("UPDATE meta SET value=? WHERE key='library_revision'", (str(revision + 1),))
        return revision + 1


def _hashes(files: dict | None) -> list[str]:
    if not files:
        return []
    return [h for h in [*(files.get('references') or {}).values(), files.get('mask')] if h]


def _run(row) -> dict:
    data = dict(row)
    for key in [k for k in data if k.endswith('_json')]:
        data[key[:-5]] = loads(data.pop(key))
    data['cancel_requested'] = bool(data['cancel_requested'])
    return data


def _task(row) -> dict:
    data = dict(row)
    for key in [k for k in data if k.endswith('_json')]:
        data[key[:-5]] = loads(data.pop(key))
    return data
