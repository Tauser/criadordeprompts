"""Rolling copies of the studio database. A failed backup is logged and never stops the Studio."""
from __future__ import annotations

import contextlib
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

KEEP = 14                  # newest copies kept; older ones are deleted after each backup
INTERVAL = 24 * 3600.0     # seconds between automatic backups
NAME = re.compile(r'studio-(\d{8}-\d{6})(?:-(\d+))?\.db')


def list_backups(backup_dir: Path) -> list[Path]:
    """Backup files from newest to oldest, judged by the timestamp in their name."""
    found = []
    for path in Path(backup_dir).glob('studio-*.db'):
        match = NAME.fullmatch(path.name)
        if match:
            found.append(((match.group(1), int(match.group(2) or 0)), path))
    return [path for _, path in sorted(found, reverse=True, key=lambda item: item[0])]


def backup_database(source: Path, backup_dir: Path, keep: int = KEEP) -> Path | None:
    """Copy the live database with the SQLite backup API, then prune. Returns None on any failure."""
    temp = None
    try:
        if not Path(source).is_file():
            raise FileNotFoundError(source)            # sqlite3.connect would otherwise create an empty file
        backup_dir = Path(backup_dir)
        backup_dir.mkdir(parents=True, exist_ok=True)
        target = _next_name(backup_dir)
        temp = backup_dir / f'.{target.name}.part'     # not matched by list_backups until it is complete
        source_db = sqlite3.connect(source, timeout=30)
        try:
            target_db = sqlite3.connect(temp)
            try:
                source_db.backup(target_db)
            finally:
                target_db.close()
        finally:
            source_db.close()
        os.replace(temp, target)
        temp = None
        prune(backup_dir, keep)
        logger.info('Cópia de segurança criada: %s', target)
        return target
    except Exception:
        logger.warning('Cópia de segurança do banco falhou', exc_info=True)
        return None
    finally:
        if temp is not None:
            with contextlib.suppress(OSError):
                temp.unlink()


def prune(backup_dir: Path, keep: int = KEEP) -> None:
    for path in list_backups(backup_dir)[keep:]:
        try:
            path.unlink()
        except OSError:
            logger.warning('Não foi possível apagar a cópia antiga %s', path, exc_info=True)


def _next_name(backup_dir: Path) -> Path:
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    path, number = backup_dir / f'studio-{stamp}.db', 1
    while path.exists():                               # two copies in the same second
        number += 1
        path = backup_dir / f'studio-{stamp}-{number}.db'
    return path


class BackupScheduler:
    """Keeps a copy no older than `interval`: one at startup if the newest is stale, then one per interval."""

    def __init__(self, source: Path, backup_dir: Path, interval: float = INTERVAL, keep: int = KEEP):
        self.source = Path(source)
        self.backup_dir = Path(backup_dir)
        self.interval = interval
        self.keep = keep
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name='prisma-backup', daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join()                        # let a copy in progress finish before the app exits

    def _loop(self) -> None:
        delay = self._delay()
        while not self._stop.wait(delay):
            backup_database(self.source, self.backup_dir, self.keep)
            delay = self.interval

    def _delay(self) -> float:
        try:
            newest = list_backups(self.backup_dir)
            age = time.time() - newest[0].stat().st_mtime if newest else None
        except OSError:
            age = None
        return 0.0 if age is None else max(0.0, self.interval - age)
