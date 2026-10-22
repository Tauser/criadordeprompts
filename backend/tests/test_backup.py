import sqlite3
import time

from prisma_studio.infrastructure.db.backup import BackupScheduler, backup_database, list_backups
from prisma_studio.infrastructure.db.database import Database


def make_source(tmp_path):
    db = Database(tmp_path / 'data' / 'studio.db')
    with db.transaction() as tx:
        tx.execute('INSERT INTO library(id, item_json, updated_at) VALUES (?, ?, ?)', ('item.a', '{"a":1}', 1.0))
        tx.execute('INSERT INTO library(id, item_json, updated_at) VALUES (?, ?, ?)', ('item.b', '{"b":2}', 2.0))
    return db


def dump(path):
    with sqlite3.connect(path) as connection:
        tables = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        rows = {table: connection.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall() for table in tables}
    return tables, rows


def wait_for(condition, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


def test_backup_copies_tables_and_rows(tmp_path):
    source = make_source(tmp_path).path
    backup_dir = tmp_path / 'data' / 'backups'

    copy = backup_database(source, backup_dir)

    assert copy is not None and copy.parent == backup_dir
    assert copy.name.startswith('studio-') and copy.suffix == '.db'
    assert dump(copy) == dump(source)
    assert ('item.a', '{"a":1}', 1.0) in dump(copy)[1]['library']


def test_retention_keeps_only_newest_backups(tmp_path):
    source = make_source(tmp_path).path
    backup_dir = tmp_path / 'backups'
    backup_dir.mkdir()
    for day in range(1, 17):
        (backup_dir / f'studio-202601{day:02d}-120000.db').write_bytes(b'old')
    (backup_dir / 'notes.txt').write_text('keep me')

    copy = backup_database(source, backup_dir, keep=14)

    kept = list_backups(backup_dir)
    assert len(kept) == 14
    assert kept[0] == copy
    assert [path.name for path in kept[1:]] == [f'studio-202601{day:02d}-120000.db' for day in range(16, 3, -1)]
    assert (backup_dir / 'notes.txt').exists()


def test_recent_backup_is_not_repeated_at_startup(tmp_path):
    source = make_source(tmp_path).path
    backup_dir = tmp_path / 'backups'
    backup_dir.mkdir()
    recent = backup_dir / 'studio-20260101-000000.db'
    recent.write_bytes(b'recent')
    scheduler = BackupScheduler(source, backup_dir, interval=3600)

    scheduler.start()
    scheduler.stop()

    assert list_backups(backup_dir) == [recent]


def test_missing_backup_is_made_at_startup_and_then_periodically(tmp_path):
    source = make_source(tmp_path).path
    backup_dir = tmp_path / 'backups'
    scheduler = BackupScheduler(source, backup_dir, interval=0.1)

    scheduler.start()
    try:
        assert wait_for(lambda: len(list_backups(backup_dir)) >= 2)
    finally:
        scheduler.stop()


def test_unwritable_folder_is_swallowed(tmp_path):
    source = make_source(tmp_path).path
    blocker = tmp_path / 'backups'
    blocker.write_text('a file, so the folder cannot be created')

    assert backup_database(source, blocker) is None

    scheduler = BackupScheduler(source, blocker, interval=0.1)
    scheduler.start()
    scheduler.stop()
    assert blocker.read_text() == 'a file, so the folder cannot be created'


def test_missing_source_is_swallowed_and_creates_nothing(tmp_path):
    backup_dir = tmp_path / 'backups'

    assert backup_database(tmp_path / 'absent.db', backup_dir) is None
    assert not (tmp_path / 'absent.db').exists()
    assert list_backups(backup_dir) == []
