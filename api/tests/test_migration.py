"""
The migration must add the twitch_user column when missing and be a no-op
when it already exists.
"""
import sqlite3
import tempfile
import os
import pytest


@pytest.fixture
def fresh_db_no_twitch_user():
    """A DB with the pre-Phase-2 schema (no twitch_user column)."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE heartbeats (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          INTEGER NOT NULL,
            channel     TEXT    NOT NULL,
            category    TEXT,
            title       TEXT,
            state       TEXT    NOT NULL,
            tab_visible INTEGER NOT NULL,
            client_id   TEXT    NOT NULL
        )
    """)
    conn.commit()
    yield conn
    conn.close()
    os.unlink(path)


def _columns(conn):
    return {row[1] for row in conn.execute("PRAGMA table_info(heartbeats)")}


def test_migration_adds_twitch_user_when_missing(fresh_db_no_twitch_user):
    from main import migrate_db
    assert "twitch_user" not in _columns(fresh_db_no_twitch_user)
    migrate_db(fresh_db_no_twitch_user)
    assert "twitch_user" in _columns(fresh_db_no_twitch_user)


def test_migration_is_idempotent(fresh_db_no_twitch_user):
    from main import migrate_db
    migrate_db(fresh_db_no_twitch_user)
    cols_after_first = _columns(fresh_db_no_twitch_user)
    migrate_db(fresh_db_no_twitch_user)  # second run
    cols_after_second = _columns(fresh_db_no_twitch_user)
    assert cols_after_first == cols_after_second
