"""SQLite persistence with versioned migrations. One connection per thread."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS = [
    """
    CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        request_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        compiled_json TEXT,
        prompt TEXT,
        effective_prompt TEXT,
        refined_prompt TEXT,
        settings_json TEXT NOT NULL,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        best_task_id TEXT,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        kind TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        seed INTEGER,
        comfy_prompt_id TEXT,
        graph_json TEXT,
        result_json TEXT,
        timings_json TEXT,
        error TEXT,
        submitted_at REAL,
        started_at REAL,
        ended_at REAL,
        created_at REAL NOT NULL
    );
    CREATE INDEX tasks_run ON tasks(run_id, position);
    CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        at REAL NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL
    );
    CREATE INDEX events_run ON events(run_id, id);
    CREATE TABLE files (
        hash TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        size INTEGER NOT NULL,
        created_at REAL NOT NULL
    );
    CREATE TABLE library (
        id TEXT PRIMARY KEY,
        item_json TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta(key, value) VALUES ('library_revision', '0');
    """,
    # 2: one task per (run, kind, position). Untouched duplicates left by an interrupted batch are dropped first.
    """
    DELETE FROM tasks WHERE status='created' AND rowid NOT IN (
        SELECT MIN(rowid) FROM tasks GROUP BY run_id, kind, position);
    CREATE UNIQUE INDEX IF NOT EXISTS tasks_slot ON tasks(run_id, kind, position);
    """,
    # 3: "Pedidos salvos" — reusable request choices without photos (see application/presets.py).
    """
    CREATE TABLE presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        request_json TEXT NOT NULL,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    );
    """,
]


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.local = threading.local()
        self.write_lock = threading.RLock()
        self.migrate()

    def connection(self) -> sqlite3.Connection:
        connection = getattr(self.local, 'connection', None)
        if connection is None:
            connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('PRAGMA foreign_keys=ON')
            connection.execute('PRAGMA synchronous=NORMAL')
            self.local.connection = connection
        return connection

    @contextmanager
    def transaction(self):
        with self.write_lock:
            connection = self.connection()
            connection.execute('BEGIN IMMEDIATE')
            try:
                yield connection
                connection.execute('COMMIT')
            except BaseException:
                connection.execute('ROLLBACK')
                raise

    def migrate(self) -> None:
        connection = self.connection()
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        for index in range(version, len(MIGRATIONS)):
            try:
                with self.transaction() as tx:
                    for statement in [s.strip() for s in MIGRATIONS[index].split(';') if s.strip()]:
                        tx.execute(statement)
                    tx.execute(f'PRAGMA user_version = {index + 1}')
            except sqlite3.IntegrityError:
                if index == 0:
                    raise
                # Old data still breaks the new constraint; the code enforces it anyway, so carry on
                # without the index rather than refuse to open the user's history.
                with self.transaction() as tx:
                    tx.execute(f'PRAGMA user_version = {index + 1}')

    def query(self, sql: str, params=()) -> list[sqlite3.Row]:
        return self.connection().execute(sql, params).fetchall()

    def one(self, sql: str, params=()) -> sqlite3.Row | None:
        return self.connection().execute(sql, params).fetchone()


def new_id() -> str:
    return uuid.uuid4().hex


def now() -> float:
    return time.time()


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), default=list)


def loads(value):
    return None if value is None else json.loads(value)
