# Phase 2 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 dashboard described in `docs/superpowers/specs/2026-05-16-dashboard-design.md` — a responsive `/` dashboard and ambient `/tv` view served from the existing FastAPI container, with new per-Twitch-user account scoping.

**Architecture:** Existing FastAPI + SQLite container gains a `twitch_user` column (idempotent migration), four new stats endpoints, an optional `?user=` filter on all existing stats endpoints, and a `static/` directory served by FastAPI containing two vanilla-JS HTML pages. The extension's content script is extended to detect the logged-in Twitch user from `localStorage["twilight.user"]` and tag heartbeats with it.

**Tech Stack:** Python 3.12 / FastAPI 0.115 / SQLite (sqlite3 stdlib). Frontend: vanilla HTML/CSS/JS, Chart.js 4 from CDN, Inter + JetBrains Mono from Google Fonts. Tests: pytest 8 + httpx via FastAPI's TestClient.

## File Structure

**Created:**
- `api/pytest.ini` — pytest config (testpaths, pythonpath).
- `api/requirements-dev.txt` — pytest + httpx for backend tests.
- `api/tests/__init__.py` — empty marker.
- `api/tests/conftest.py` — env setup, TestClient fixture, DB cleanup fixture, `insert_heartbeat` helper.
- `api/tests/test_migration.py` — DB migration idempotency.
- `api/tests/test_heartbeat_twitch_user.py` — heartbeat ingest tagging.
- `api/tests/test_user_filter.py` — `?user=` filter on existing endpoints.
- `api/tests/test_new_endpoints.py` — `/stats/now`, `/stats/users`, `/stats/categories`, `/stats/recent`.
- `api/tests/test_static_routes.py` — `/` and `/tv` smoke tests.
- `api/static/index.html` — main dashboard page.
- `api/static/tv.html` — ambient TV view.
- `api/static/styles.css` — shared design tokens, components.
- `api/static/app.js` — main dashboard logic.
- `api/static/tv.js` — TV view logic.

**Modified:**
- `api/main.py` — migration, `user` filter, new endpoints, static mount, `/`+`/tv` routes, `Heartbeat` model gains `twitch_user`.
- `api/Dockerfile` — copy `static/` directory into image.
- `extension/content.js` — detect Twitch login from `localStorage`, include in heartbeat payload.
- `README.md` — Phase 2 deployment notes.

---

## Task 1: Set up pytest infrastructure

**Files:**
- Create: `api/requirements-dev.txt`
- Create: `api/pytest.ini`
- Create: `api/tests/__init__.py`
- Create: `api/tests/conftest.py`

- [ ] **Step 1: Create dev requirements**

Write `api/requirements-dev.txt`:

```
-r requirements.txt
pytest==8.3.3
httpx==0.27.2
```

- [ ] **Step 2: Create pytest config**

Write `api/pytest.ini`:

```ini
[pytest]
testpaths = tests
pythonpath = .
```

- [ ] **Step 3: Create empty `tests/__init__.py`**

Write `api/tests/__init__.py`:

```python
```

- [ ] **Step 4: Create conftest.py**

Write `api/tests/conftest.py`:

```python
"""
Shared test fixtures. Env vars MUST be set before importing `main`, since
main.py reads them at module level and calls init_db() at import time.
"""
import os
import sqlite3
import tempfile

_fd, _DB_PATH = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["API_KEY"] = "test-key-12345"
os.environ["DB_PATH"] = _DB_PATH

import pytest
from fastapi.testclient import TestClient

TEST_API_KEY = "test-key-12345"
DB_PATH = _DB_PATH


@pytest.fixture(scope="session")
def app():
    from main import app as fastapi_app
    return fastapi_app


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-API-Key": TEST_API_KEY}


@pytest.fixture(autouse=True)
def _clean_heartbeats(app):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("DELETE FROM heartbeats")
        conn.commit()
    finally:
        conn.close()
    yield


@pytest.fixture
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 5: Install dev deps and confirm pytest discovers no tests**

Run:

```bash
cd api
pip install -r requirements-dev.txt
pytest --collect-only
```

Expected: `no tests ran` (or `collected 0 items`). Confirms config is valid.

- [ ] **Step 6: Commit**

```bash
git add api/requirements-dev.txt api/pytest.ini api/tests/__init__.py api/tests/conftest.py
git commit -m "test: scaffold pytest infrastructure for api"
```

---

## Task 2: DB migration — add `twitch_user` column (TDD)

**Files:**
- Test: `api/tests/test_migration.py`
- Modify: `api/main.py:36-53` (factor `init_db` to call a separate `migrate_db`)

- [ ] **Step 1: Write the failing test**

Write `api/tests/test_migration.py`:

```python
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
```

- [ ] **Step 2: Run test, confirm failure**

Run:

```bash
cd api
pytest tests/test_migration.py -v
```

Expected: ImportError or AttributeError — `migrate_db` does not exist in `main`.

- [ ] **Step 3: Refactor `init_db` to call `migrate_db`**

In `api/main.py`, replace the existing `init_db` function (lines 36-53) with:

```python
def migrate_db(conn):
    """Idempotent column additions and other schema migrations."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(heartbeats)")}
    if "twitch_user" not in cols:
        conn.execute("ALTER TABLE heartbeats ADD COLUMN twitch_user TEXT")


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS heartbeats (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          INTEGER NOT NULL,
                channel     TEXT    NOT NULL,
                category    TEXT,
                title       TEXT,
                state       TEXT    NOT NULL CHECK(state IN ('active','passive','audio_only')),
                tab_visible INTEGER NOT NULL CHECK(tab_visible IN (0,1)),
                client_id   TEXT    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_heartbeats_ts
                ON heartbeats(ts);
            CREATE INDEX IF NOT EXISTS idx_heartbeats_channel_ts
                ON heartbeats(channel, ts);
        """)
        migrate_db(conn)
        conn.commit()
```

- [ ] **Step 4: Run tests, confirm pass**

Run:

```bash
cd api
pytest tests/test_migration.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_migration.py
git commit -m "feat(api): add twitch_user column migration"
```

---

## Task 3: Heartbeat model accepts `twitch_user` (TDD)

**Files:**
- Test: `api/tests/test_heartbeat_twitch_user.py`
- Modify: `api/main.py` `Heartbeat` model and both INSERT statements
- Modify: `api/tests/conftest.py` (add `insert_heartbeat` helper now that the column exists)

- [ ] **Step 1: Write failing tests**

Write `api/tests/test_heartbeat_twitch_user.py`:

```python
"""
Heartbeats may carry an optional twitch_user. POSTing without the field
must still succeed (back-compat). With the field, it must round-trip to DB.
"""
import sqlite3
import time
from tests.conftest import DB_PATH


def _last_row():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM heartbeats ORDER BY id DESC LIMIT 1").fetchone()
    finally:
        conn.close()


def _payload(**overrides):
    base = {
        "ts": int(time.time()),
        "channel": "alice",
        "category": "Just Chatting",
        "title": "stream title",
        "state": "active",
        "tab_visible": True,
        "client_id": "test-client",
    }
    base.update(overrides)
    return base


def test_heartbeat_without_twitch_user_stores_null(client, auth_headers):
    res = client.post("/heartbeat", json=_payload(), headers=auth_headers)
    assert res.status_code == 200
    row = _last_row()
    assert row["twitch_user"] is None


def test_heartbeat_with_twitch_user_stores_value(client, auth_headers):
    res = client.post("/heartbeat", json=_payload(twitch_user="jwsoat"), headers=auth_headers)
    assert res.status_code == 200
    row = _last_row()
    assert row["twitch_user"] == "jwsoat"


def test_heartbeats_batch_with_twitch_user(client, auth_headers):
    batch = {"heartbeats": [
        _payload(channel="alice", twitch_user="user_a"),
        _payload(channel="bob", twitch_user="user_b"),
        _payload(channel="carol"),
    ]}
    res = client.post("/heartbeats", json=batch, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["stored"] == 3

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT channel, twitch_user FROM heartbeats ORDER BY id").fetchall()
    finally:
        conn.close()
    assert [(r["channel"], r["twitch_user"]) for r in rows] == [
        ("alice", "user_a"), ("bob", "user_b"), ("carol", None),
    ]
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd api
pytest tests/test_heartbeat_twitch_user.py -v
```

Expected: FAIL — Pydantic rejects unknown field `twitch_user`, or DB INSERT fails with `OperationalError`.

- [ ] **Step 3: Update Heartbeat model and INSERTs**

In `api/main.py`, replace the `Heartbeat` class (lines 79-86) with:

```python
class Heartbeat(BaseModel):
    ts: int = Field(..., description="Unix seconds, UTC")
    channel: str = Field(..., min_length=1, max_length=64)
    category: Optional[str] = Field(default=None, max_length=128)
    title: Optional[str] = Field(default=None, max_length=512)
    state: str = Field(..., pattern="^(active|passive|audio_only)$")
    tab_visible: bool
    client_id: str = Field(..., min_length=1, max_length=64)
    twitch_user: Optional[str] = Field(default=None, max_length=64)
```

Replace the `heartbeat` endpoint (lines 100-110) with:

```python
@app.post("/heartbeat", dependencies=[Depends(require_api_key)])
def heartbeat(hb: Heartbeat):
    with db() as conn:
        conn.execute(
            "INSERT INTO heartbeats "
            "(ts, channel, category, title, state, tab_visible, client_id, twitch_user) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (hb.ts, hb.channel.lower(), hb.category, hb.title,
             hb.state, int(hb.tab_visible), hb.client_id, hb.twitch_user),
        )
    return {"ok": True}
```

Replace the `heartbeats_batch` endpoint (lines 113-127) with:

```python
@app.post("/heartbeats", dependencies=[Depends(require_api_key)])
def heartbeats_batch(batch: HeartbeatBatch):
    rows = [
        (hb.ts, hb.channel.lower(), hb.category, hb.title,
         hb.state, int(hb.tab_visible), hb.client_id, hb.twitch_user)
        for hb in batch.heartbeats
    ]
    with db() as conn:
        conn.executemany(
            "INSERT INTO heartbeats "
            "(ts, channel, category, title, state, tab_visible, client_id, twitch_user) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
    return {"ok": True, "stored": len(rows)}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd api
pytest tests/test_heartbeat_twitch_user.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Add insert_heartbeat helper to conftest**

Append to `api/tests/conftest.py`:

```python
def insert_heartbeat(
    db_conn, ts, channel, twitch_user=None, category=None,
    title=None, state="active", tab_visible=1, client_id="test-client",
):
    """Insert a heartbeat row directly. Caller must commit."""
    db_conn.execute(
        "INSERT INTO heartbeats "
        "(ts, channel, category, title, state, tab_visible, client_id, twitch_user) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (ts, channel.lower(), category, title, state, tab_visible, client_id, twitch_user),
    )
```

- [ ] **Step 6: Commit**

```bash
git add api/main.py api/tests/test_heartbeat_twitch_user.py api/tests/conftest.py
git commit -m "feat(api): heartbeats carry optional twitch_user field"
```

---

## Task 4: Add `?user=` filter to `/stats/today`, `/stats/week`, `/stats/all` (TDD)

**Files:**
- Test: `api/tests/test_user_filter.py`
- Modify: `api/main.py` — `_stats_since` helper, `stats_today`, `stats_week`, `stats_all`

- [ ] **Step 1: Write failing tests**

Write `api/tests/test_user_filter.py`:

```python
"""
?user= filter semantics across stats endpoints:
- omitted: all heartbeats pooled
- user=<login>: only heartbeats with twitch_user=<login>
- user=anonymous: only heartbeats with twitch_user IS NULL
"""
import time
from tests.conftest import insert_heartbeat


def _seed(db):
    now = int(time.time())
    # Two heartbeats today, different users
    insert_heartbeat(db, ts=now - 100, channel="alice", twitch_user="user_a")
    insert_heartbeat(db, ts=now - 200, channel="alice", twitch_user="user_a")
    insert_heartbeat(db, ts=now - 300, channel="bob", twitch_user="user_b")
    insert_heartbeat(db, ts=now - 400, channel="carol", twitch_user=None)
    db.commit()


def test_today_no_filter_returns_all_users(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/today", headers=auth_headers)
    channels = {c["channel"] for c in res.json()["channels"]}
    assert channels == {"alice", "bob", "carol"}


def test_today_user_filter_returns_only_that_user(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/today?user=user_a", headers=auth_headers)
    channels = [c["channel"] for c in res.json()["channels"]]
    assert channels == ["alice"]
    assert res.json()["channels"][0]["seconds"] == 120  # 2 heartbeats * 60


def test_today_user_anonymous_returns_only_null(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/today?user=anonymous", headers=auth_headers)
    channels = [c["channel"] for c in res.json()["channels"]]
    assert channels == ["carol"]


def test_week_user_filter(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/week?user=user_b", headers=auth_headers)
    channels = [c["channel"] for c in res.json()["channels"]]
    assert channels == ["bob"]


def test_all_user_filter(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/all?user=user_a", headers=auth_headers)
    channels = [c["channel"] for c in res.json()["channels"]]
    assert channels == ["alice"]
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd api
pytest tests/test_user_filter.py -v
```

Expected: FAIL — endpoints ignore the `user` param so filtered tests return too many channels.

- [ ] **Step 3: Add `_user_clause` helper and update endpoints**

In `api/main.py`, add a new helper above `_stats_since`:

```python
def _user_clause(user: Optional[str]):
    """
    Build a (sql_fragment, params) tuple for the twitch_user filter.
    - None -> ('', ()) means no filter.
    - 'anonymous' -> ('AND twitch_user IS NULL', ())
    - other -> ('AND twitch_user = ?', (value,))
    """
    if user is None:
        return "", ()
    if user == "anonymous":
        return "AND twitch_user IS NULL", ()
    return "AND twitch_user = ?", (user,)
```

Replace `_stats_since` (lines 219-235) with:

```python
def _stats_since(since: int, include_passive: bool, user: Optional[str] = None):
    state_filter = "" if include_passive else "AND state = 'active'"
    user_sql, user_params = _user_clause(user)
    with db() as conn:
        rows = conn.execute(f"""
            SELECT channel, COUNT(*) AS n
            FROM heartbeats
            WHERE ts >= ? {state_filter} {user_sql}
            GROUP BY channel
            ORDER BY n DESC
        """, (since, *user_params)).fetchall()
    return {
        "interval_seconds": HEARTBEAT_INTERVAL,
        "channels": [
            {"channel": r["channel"], "seconds": _seconds_from_count(r["n"])}
            for r in rows
        ],
    }
```

Update the three endpoints (lines 134-150) to forward the param:

```python
@app.get("/stats/today", dependencies=[Depends(require_api_key)])
def stats_today(include_passive: bool = True, user: Optional[str] = None):
    midnight = _local_midnight()
    return _stats_since(midnight, include_passive, user)


@app.get("/stats/week", dependencies=[Depends(require_api_key)])
def stats_week(include_passive: bool = True, user: Optional[str] = None):
    since = int(time.time()) - 7 * 86400
    return _stats_since(since, include_passive, user)


@app.get("/stats/all", dependencies=[Depends(require_api_key)])
def stats_all(include_passive: bool = True, user: Optional[str] = None):
    return _stats_since(0, include_passive, user)
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd api
pytest tests/test_user_filter.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_user_filter.py
git commit -m "feat(api): ?user= filter on today/week/all"
```

---

## Task 5: Add `?user=` filter to `/stats/daily` (TDD)

**Files:**
- Test: append to `api/tests/test_user_filter.py`
- Modify: `api/main.py` — `stats_daily`

- [ ] **Step 1: Append failing test**

Append to `api/tests/test_user_filter.py`:

```python
def test_daily_user_filter(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/daily?user=user_a&days=2", headers=auth_headers)
    data = res.json()
    total = sum(d["seconds"] for d in data["days"])
    assert total == 120  # only user_a's 2 heartbeats counted
```

- [ ] **Step 2: Run test, confirm failure**

```bash
cd api
pytest tests/test_user_filter.py::test_daily_user_filter -v
```

Expected: FAIL — daily endpoint counts all users.

- [ ] **Step 3: Update `/stats/daily`**

Replace `stats_daily` (lines 153-174) with:

```python
@app.get("/stats/daily", dependencies=[Depends(require_api_key)])
def stats_daily(days: int = 30, include_passive: bool = True, user: Optional[str] = None):
    """Watch time per day for the last N days."""
    since = int(time.time()) - days * 86400
    state_filter = "" if include_passive else "AND state = 'active'"
    user_sql, user_params = _user_clause(user)
    with db() as conn:
        rows = conn.execute(f"""
            SELECT
                date(ts, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS n
            FROM heartbeats
            WHERE ts >= ? {state_filter} {user_sql}
            GROUP BY day
            ORDER BY day ASC
        """, (since, *user_params)).fetchall()
    return {
        "interval_seconds": HEARTBEAT_INTERVAL,
        "days": [
            {"day": r["day"], "seconds": _seconds_from_count(r["n"])}
            for r in rows
        ],
    }
```

- [ ] **Step 4: Run test, confirm pass**

```bash
cd api
pytest tests/test_user_filter.py::test_daily_user_filter -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_user_filter.py
git commit -m "feat(api): ?user= filter on daily"
```

---

## Task 6: Add `?user=` filter to `/stats/top_channel` and `/stats/total` (TDD)

**Files:**
- Test: append to `api/tests/test_user_filter.py`
- Modify: `api/main.py` — `stats_top_channel`, `stats_total`

- [ ] **Step 1: Append failing tests**

Append to `api/tests/test_user_filter.py`:

```python
def test_top_channel_user_filter(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/top_channel?window=today&user=user_a", headers=auth_headers)
    assert res.json() == {"channel": "alice", "seconds": 120}


def test_total_user_filter(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/total?window=today&user=user_a", headers=auth_headers)
    assert res.json() == {"window": "today", "seconds": 120}


def test_total_user_anonymous(client, auth_headers, db):
    _seed(db)
    res = client.get("/stats/total?window=today&user=anonymous", headers=auth_headers)
    assert res.json()["seconds"] == 60  # carol's single heartbeat
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd api
pytest tests/test_user_filter.py -v -k "top_channel or total"
```

Expected: FAIL — endpoints ignore user param.

- [ ] **Step 3: Update endpoints**

In `api/main.py`, replace `stats_top_channel` (lines 177-197) with:

```python
@app.get("/stats/top_channel", dependencies=[Depends(require_api_key)])
def stats_top_channel(window: str = "today", user: Optional[str] = None):
    """Single channel name + seconds for the given window."""
    since = _window_since(window)
    user_sql, user_params = _user_clause(user)
    with db() as conn:
        row = conn.execute(f"""
            SELECT channel, COUNT(*) AS n
            FROM heartbeats
            WHERE ts >= ? {user_sql}
            GROUP BY channel
            ORDER BY n DESC
            LIMIT 1
        """, (since, *user_params)).fetchone()
    if not row:
        return {"channel": None, "seconds": 0}
    return {"channel": row["channel"], "seconds": _seconds_from_count(row["n"])}
```

Replace `stats_total` (lines 200-214) with:

```python
@app.get("/stats/total", dependencies=[Depends(require_api_key)])
def stats_total(window: str = "today", user: Optional[str] = None):
    """Total seconds in a window."""
    since = _window_since(window)
    user_sql, user_params = _user_clause(user)
    with db() as conn:
        row = conn.execute(f"""
            SELECT COUNT(*) AS n FROM heartbeats
            WHERE ts >= ? {user_sql}
        """, (since, *user_params)).fetchone()
    return {"window": window, "seconds": _seconds_from_count(row["n"])}
```

And add a shared `_window_since` helper near `_local_midnight` (this DRYs out the window-string lookup that was duplicated in the previous two endpoints):

```python
def _window_since(window: str) -> int:
    if window == "today":
        return _local_midnight()
    if window == "week":
        return int(time.time()) - 7 * 86400
    return 0  # 'all' or unknown
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd api
pytest tests/test_user_filter.py -v
```

Expected: all tests in file PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_user_filter.py
git commit -m "feat(api): ?user= filter on top_channel and total"
```

---

## Task 7: New endpoint `/stats/now` (TDD)

**Files:**
- Test: `api/tests/test_new_endpoints.py`
- Modify: `api/main.py` — add `stats_now` endpoint

- [ ] **Step 1: Write failing tests**

Write `api/tests/test_new_endpoints.py`:

```python
"""Tests for /stats/now, /stats/users, /stats/categories, /stats/recent."""
import time
from tests.conftest import insert_heartbeat


# ---------- /stats/now ----------

def test_now_returns_null_when_no_recent_heartbeat(client, auth_headers, db):
    insert_heartbeat(db, ts=int(time.time()) - 600, channel="alice")  # 10 min ago
    db.commit()
    res = client.get("/stats/now", headers=auth_headers)
    assert res.json() == {"now": None}


def test_now_returns_most_recent_within_120s(client, auth_headers, db):
    now = int(time.time())
    insert_heartbeat(db, ts=now - 30, channel="alice", category="cat", title="t", twitch_user="user_a")
    db.commit()
    res = client.get("/stats/now", headers=auth_headers)
    data = res.json()
    assert data["channel"] == "alice"
    assert data["category"] == "cat"
    assert data["title"] == "t"
    assert data["twitch_user"] == "user_a"
    assert data["ts"] == now - 30


def test_now_user_filter(client, auth_headers, db):
    now = int(time.time())
    insert_heartbeat(db, ts=now - 30, channel="alice", twitch_user="user_a")
    insert_heartbeat(db, ts=now - 20, channel="bob", twitch_user="user_b")  # more recent
    db.commit()
    res = client.get("/stats/now?user=user_a", headers=auth_headers)
    assert res.json()["channel"] == "alice"
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd api
pytest tests/test_new_endpoints.py -v -k now
```

Expected: 404 — endpoint doesn't exist.

- [ ] **Step 3: Add `/stats/now` endpoint**

In `api/main.py`, add below `stats_total`:

```python
@app.get("/stats/now", dependencies=[Depends(require_api_key)])
def stats_now(user: Optional[str] = None):
    """Most recent heartbeat in last 120s, or {'now': None}."""
    cutoff = int(time.time()) - 120
    user_sql, user_params = _user_clause(user)
    with db() as conn:
        row = conn.execute(f"""
            SELECT ts, channel, category, title, twitch_user
            FROM heartbeats
            WHERE ts >= ? {user_sql}
            ORDER BY ts DESC
            LIMIT 1
        """, (cutoff, *user_params)).fetchone()
    if not row:
        return {"now": None}
    return {
        "ts": row["ts"],
        "channel": row["channel"],
        "category": row["category"],
        "title": row["title"],
        "twitch_user": row["twitch_user"],
    }
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd api
pytest tests/test_new_endpoints.py -v -k now
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_new_endpoints.py
git commit -m "feat(api): GET /stats/now"
```

---

## Task 8: New endpoint `/stats/users` (TDD)

**Files:**
- Test: append to `api/tests/test_new_endpoints.py`
- Modify: `api/main.py` — add `stats_users`

- [ ] **Step 1: Append failing tests**

Append to `api/tests/test_new_endpoints.py`:

```python
# ---------- /stats/users ----------

def test_users_returns_empty_when_no_data(client, auth_headers):
    res = client.get("/stats/users", headers=auth_headers)
    assert res.json() == {"users": []}


def test_users_lists_distinct_users_with_metadata(client, auth_headers, db):
    now = int(time.time())
    insert_heartbeat(db, ts=now - 100, channel="x", twitch_user="user_a")
    insert_heartbeat(db, ts=now - 50, channel="x", twitch_user="user_a")
    insert_heartbeat(db, ts=now - 200, channel="x", twitch_user="user_b")
    insert_heartbeat(db, ts=now - 10, channel="x", twitch_user=None)
    db.commit()
    res = client.get("/stats/users", headers=auth_headers)
    users = {u["user"]: u for u in res.json()["users"]}
    assert set(users) == {"user_a", "user_b", "anonymous"}
    assert users["user_a"]["count"] == 2
    assert users["user_a"]["last_ts"] == now - 50
    assert users["user_b"]["count"] == 1
    assert users["anonymous"]["count"] == 1


def test_users_ordered_by_last_activity_desc(client, auth_headers, db):
    now = int(time.time())
    insert_heartbeat(db, ts=now - 300, channel="x", twitch_user="user_old")
    insert_heartbeat(db, ts=now - 10, channel="x", twitch_user="user_new")
    db.commit()
    res = client.get("/stats/users", headers=auth_headers)
    logins = [u["user"] for u in res.json()["users"]]
    assert logins == ["user_new", "user_old"]
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd api
pytest tests/test_new_endpoints.py -v -k users
```

Expected: 404.

- [ ] **Step 3: Add endpoint**

In `api/main.py`, add below `stats_now`:

```python
@app.get("/stats/users", dependencies=[Depends(require_api_key)])
def stats_users():
    """Distinct twitch_user values with last activity and heartbeat count.
    NULL is reported as 'anonymous'. Ordered by last_ts DESC."""
    with db() as conn:
        rows = conn.execute("""
            SELECT
                COALESCE(twitch_user, 'anonymous') AS user,
                MAX(ts) AS last_ts,
                COUNT(*) AS count
            FROM heartbeats
            GROUP BY twitch_user
            ORDER BY last_ts DESC
        """).fetchall()
    return {
        "users": [
            {"user": r["user"], "last_ts": r["last_ts"], "count": r["count"]}
            for r in rows
        ]
    }
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd api
pytest tests/test_new_endpoints.py -v -k users
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_new_endpoints.py
git commit -m "feat(api): GET /stats/users"
```

---

## Task 9: New endpoint `/stats/categories` (TDD)

**Files:**
- Test: append to `api/tests/test_new_endpoints.py`
- Modify: `api/main.py` — add `stats_categories`

- [ ] **Step 1: Append failing tests**

Append to `api/tests/test_new_endpoints.py`:

```python
# ---------- /stats/categories ----------

def test_categories_returns_top_5_by_seconds(client, auth_headers, db):
    now = int(time.time())
    # 3 heartbeats Just Chatting, 1 League, 1 Valorant
    for _ in range(3):
        insert_heartbeat(db, ts=now - 10, channel="x", category="Just Chatting")
    insert_heartbeat(db, ts=now - 20, channel="y", category="League of Legends")
    insert_heartbeat(db, ts=now - 30, channel="z", category="Valorant")
    db.commit()
    res = client.get("/stats/categories?window=today", headers=auth_headers)
    cats = res.json()["categories"]
    assert cats[0]["category"] == "Just Chatting"
    assert cats[0]["seconds"] == 180
    assert len(cats) == 3


def test_categories_ignores_null_category(client, auth_headers, db):
    insert_heartbeat(db, ts=int(time.time()) - 10, channel="x", category=None)
    db.commit()
    res = client.get("/stats/categories?window=today", headers=auth_headers)
    assert res.json()["categories"] == []


def test_categories_user_filter(client, auth_headers, db):
    now = int(time.time())
    insert_heartbeat(db, ts=now - 10, channel="x", category="A", twitch_user="user_a")
    insert_heartbeat(db, ts=now - 20, channel="x", category="B", twitch_user="user_b")
    db.commit()
    res = client.get("/stats/categories?window=today&user=user_a", headers=auth_headers)
    cats = [c["category"] for c in res.json()["categories"]]
    assert cats == ["A"]
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd api
pytest tests/test_new_endpoints.py -v -k categories
```

Expected: 404.

- [ ] **Step 3: Add endpoint**

In `api/main.py`, add below `stats_users`:

```python
@app.get("/stats/categories", dependencies=[Depends(require_api_key)])
def stats_categories(window: str = "today", user: Optional[str] = None):
    """Top 5 categories by seconds in window. Excludes NULL categories."""
    since = _window_since(window)
    user_sql, user_params = _user_clause(user)
    with db() as conn:
        rows = conn.execute(f"""
            SELECT category, COUNT(*) AS n
            FROM heartbeats
            WHERE ts >= ? AND category IS NOT NULL {user_sql}
            GROUP BY category
            ORDER BY n DESC
            LIMIT 5
        """, (since, *user_params)).fetchall()
    return {
        "categories": [
            {"category": r["category"], "seconds": _seconds_from_count(r["n"])}
            for r in rows
        ]
    }
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd api
pytest tests/test_new_endpoints.py -v -k categories
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_new_endpoints.py
git commit -m "feat(api): GET /stats/categories"
```

---

## Task 10: New endpoint `/stats/recent` (TDD)

**Files:**
- Test: append to `api/tests/test_new_endpoints.py`
- Modify: `api/main.py` — add `stats_recent`

- [ ] **Step 1: Append failing tests**

Append to `api/tests/test_new_endpoints.py`:

```python
# ---------- /stats/recent ----------

def test_recent_deduplicates_by_channel_keeping_latest_ts(client, auth_headers, db):
    now = int(time.time())
    # alice has two entries; latest at now-10
    insert_heartbeat(db, ts=now - 100, channel="alice")
    insert_heartbeat(db, ts=now - 10, channel="alice")
    insert_heartbeat(db, ts=now - 50, channel="bob")
    db.commit()
    res = client.get("/stats/recent", headers=auth_headers)
    chans = res.json()["recent"]
    assert len(chans) == 2
    assert chans[0]["channel"] == "alice"
    assert chans[0]["last_ts"] == now - 10
    assert chans[1]["channel"] == "bob"


def test_recent_respects_limit(client, auth_headers, db):
    now = int(time.time())
    for i, name in enumerate(["a", "b", "c", "d", "e", "f"]):
        insert_heartbeat(db, ts=now - i * 10, channel=name)
    db.commit()
    res = client.get("/stats/recent?limit=3", headers=auth_headers)
    assert len(res.json()["recent"]) == 3


def test_recent_user_filter(client, auth_headers, db):
    now = int(time.time())
    insert_heartbeat(db, ts=now - 10, channel="alice", twitch_user="user_a")
    insert_heartbeat(db, ts=now - 20, channel="bob", twitch_user="user_b")
    db.commit()
    res = client.get("/stats/recent?user=user_a", headers=auth_headers)
    chans = [r["channel"] for r in res.json()["recent"]]
    assert chans == ["alice"]
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd api
pytest tests/test_new_endpoints.py -v -k recent
```

Expected: 404.

- [ ] **Step 3: Add endpoint**

In `api/main.py`, add below `stats_categories`:

```python
@app.get("/stats/recent", dependencies=[Depends(require_api_key)])
def stats_recent(limit: int = 5, user: Optional[str] = None):
    """Last N distinct channels with their last-watched timestamp."""
    limit = max(1, min(limit, 50))
    user_sql, user_params = _user_clause(user)
    with db() as conn:
        rows = conn.execute(f"""
            SELECT channel, MAX(ts) AS last_ts
            FROM heartbeats
            WHERE 1=1 {user_sql}
            GROUP BY channel
            ORDER BY last_ts DESC
            LIMIT ?
        """, (*user_params, limit)).fetchall()
    return {
        "recent": [
            {"channel": r["channel"], "last_ts": r["last_ts"]}
            for r in rows
        ]
    }
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd api
pytest tests/test_new_endpoints.py -v
```

Expected: all PASS (now/users/categories/recent).

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_new_endpoints.py
git commit -m "feat(api): GET /stats/recent"
```

---

## Task 11: Static file serving + `/` and `/tv` routes

**Files:**
- Create: `api/static/.gitkeep`
- Test: `api/tests/test_static_routes.py`
- Modify: `api/main.py` — add `StaticFiles` mount, `/`, `/tv`
- Modify: `api/Dockerfile` — copy `static/`

- [ ] **Step 1: Create static directory placeholder**

Write `api/static/.gitkeep`:

```
```

(Empty file — keeps the directory tracked before HTML/CSS/JS exist.)

- [ ] **Step 2: Write failing tests**

Write `api/tests/test_static_routes.py`:

```python
"""Smoke tests for the new static-asset routes."""


def test_root_returns_index_html(client):
    res = client.get("/")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")
    assert "<!doctype html>" in res.text.lower() or "<html" in res.text.lower()


def test_tv_returns_html(client):
    res = client.get("/tv")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")


def test_static_assets_served(client):
    res = client.get("/static/styles.css")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/css")


def test_health_still_open(client):
    # / and /tv require routes; /health stays unauthenticated
    res = client.get("/health")
    assert res.status_code == 200
```

- [ ] **Step 3: Create placeholder static files so tests can pass**

Write `api/static/index.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Watchtime</title></head>
<body><div id="app">placeholder</div></body>
</html>
```

Write `api/static/tv.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Watchtime TV</title></head>
<body><div id="tv">placeholder</div></body>
</html>
```

Write `api/static/styles.css`:

```css
/* placeholder — replaced in Task 14 */
```

- [ ] **Step 4: Run tests, confirm failure**

```bash
cd api
pytest tests/test_static_routes.py -v
```

Expected: FAIL — routes don't exist; 404s.

- [ ] **Step 5: Add static mount and routes**

In `api/main.py`, add the import near the top:

```python
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
```

After `app = FastAPI(...)` and the CORS middleware setup, add:

```python
import pathlib
STATIC_DIR = pathlib.Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", include_in_schema=False)
def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/tv", include_in_schema=False)
def tv():
    return FileResponse(STATIC_DIR / "tv.html")
```

- [ ] **Step 6: Run tests, confirm pass**

```bash
cd api
pytest tests/test_static_routes.py -v
```

Expected: 4 PASS.

- [ ] **Step 7: Update Dockerfile to include static dir**

In `api/Dockerfile`, change line 8 from:

```dockerfile
COPY main.py .
```

to:

```dockerfile
COPY main.py .
COPY static/ ./static/
```

- [ ] **Step 8: Commit**

```bash
git add api/main.py api/Dockerfile api/static/ api/tests/test_static_routes.py
git commit -m "feat(api): mount /static and serve / and /tv html"
```

---

## Task 12: Extension — detect Twitch login and tag heartbeats

**Files:**
- Modify: `extension/content.js:80-89` (heartbeat payload construction)

- [ ] **Step 1: Add `getTwitchUser()` helper and include in payload**

In `extension/content.js`, add this helper near the other getters (after `getTitle`, around line 41):

```javascript
function getTwitchUser() {
  // Twitch stores the logged-in user as JSON in localStorage under
  // "twilight.user". When logged out or unparseable, return null —
  // heartbeats then bucket as "anonymous" server-side.
  try {
    const raw = localStorage.getItem("twilight.user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const login = parsed?.login;
    return typeof login === "string" && login.length > 0 ? login : null;
  } catch {
    return null;
  }
}
```

Replace the `heartbeat` object inside `tick()` (lines 80-87) with:

```javascript
  const heartbeat = {
    ts: Math.floor(Date.now() / 1000),
    channel,
    category: getCategory(),
    title: getTitle(),
    state,
    tab_visible: tabVisible,
    twitch_user: getTwitchUser(),
  };
```

- [ ] **Step 2: Manual smoke test (one-off)**

Reload the extension at `chrome://extensions`. Open Twitch in a browser where you're logged in. Open the page DevTools console and run:

```javascript
JSON.parse(localStorage.getItem("twilight.user"))?.login
```

Confirm it prints your Twitch login. Then check the service-worker console after ~60s — `chrome.storage.local.get("hb_queue", console.log)` should show queued heartbeats with the `twitch_user` field populated.

- [ ] **Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): tag heartbeats with logged-in twitch_user"
```

---

## Task 13: Frontend — shared styles.css with design tokens

**Files:**
- Modify: `api/static/styles.css` (replace placeholder)

- [ ] **Step 1: Write the complete stylesheet**

Replace `api/static/styles.css` entirely with:

```css
/* ---------- Design tokens ---------- */
:root {
  --bg: #0e0e10;
  --surface: #18181b;
  --surface-2: #1f1f23;
  --border: #2f2f35;
  --purple: #9146FF;
  --purple-hover: #772ce8;
  --hero-grad: linear-gradient(135deg, #9146FF, #5c16c5);
  --text: #efeff1;
  --muted: #adadb8;
  --live: #eb0400;
  --radius: 12px;
  --gap: 16px;
}

@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap");

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  min-height: 100vh;
}

.mono { font-family: "JetBrains Mono", ui-monospace, monospace; }

/* ---------- Layout ---------- */
.page { max-width: 1200px; margin: 0 auto; padding: 24px; }

.topbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px;
}
.topbar h1 { font-size: 18px; font-weight: 700; letter-spacing: 0.02em; }

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap);
}
@media (max-width: 768px) {
  .grid { grid-template-columns: 1fr; }
  .page { padding: 16px; }
}

/* ---------- Cards ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  transition: transform 0.15s, border-color 0.15s;
}
.card:hover { transform: translateY(-1px); border-color: #3a3a40; }
.card h2 {
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--muted);
  margin-bottom: 16px;
}

/* ---------- Hero ---------- */
.hero {
  grid-column: 1 / -1;
  background: var(--hero-grad);
  border: none;
  display: flex; align-items: center; justify-content: space-between;
  padding: 32px;
  position: relative;
}
.hero .today-value { font-size: 56px; font-weight: 700; line-height: 1; }
.hero .today-label { font-size: 12px; opacity: 0.85; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
.hero .top { text-align: right; }
.hero .top-channel { font-size: 24px; font-weight: 600; }
.hero .top-seconds { font-size: 14px; opacity: 0.85; }
.hero .live {
  position: absolute; top: 16px; right: 16px;
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
}
.hero .live .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--live); box-shadow: 0 0 8px var(--live);
  animation: pulse 1.5s infinite;
}
@keyframes pulse { 50% { opacity: 0.5; } }

/* ---------- Pills ---------- */
.pills {
  display: flex; gap: 6px;
  margin: 16px 0;
  grid-column: 1 / -1;
}
.pill {
  background: var(--surface); border: 1px solid var(--border);
  color: var(--muted); padding: 6px 14px; border-radius: 999px;
  font-size: 13px; cursor: pointer;
  transition: all 0.15s;
}
.pill:hover { color: var(--text); border-color: var(--purple); }
.pill.active { background: var(--purple); color: white; border-color: var(--purple); }

/* ---------- Ranked list ---------- */
.ranked { display: flex; flex-direction: column; gap: 10px; }
.ranked-row {
  display: grid; grid-template-columns: 24px 32px 1fr auto; gap: 12px;
  align-items: center;
}
.ranked-row .rank { color: var(--muted); font-weight: 600; }
.ranked-row .avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: grid; place-items: center;
  font-weight: 700; color: white; font-size: 13px;
}
.ranked-row .name { font-weight: 500; }
.ranked-row .value { font-weight: 600; font-variant-numeric: tabular-nums; }
.ranked-row .bar {
  grid-column: 3 / span 2;
  height: 3px; background: var(--surface-2); border-radius: 2px;
  margin-top: 4px; overflow: hidden;
}
.ranked-row .bar > span { display: block; height: 100%; background: var(--purple); }

/* ---------- Mini-stat cards ---------- */
.mini-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap); }
.mini { text-align: center; }
.mini .val { font-size: 24px; font-weight: 700; }
.mini .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
@media (max-width: 480px) { .mini-grid { grid-template-columns: 1fr; } }

/* ---------- Recently watched ---------- */
.recent-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.recent-row:last-child { border: none; }
.recent-row .when { color: var(--muted); font-size: 12px; }

/* ---------- Account picker ---------- */
.account-picker {
  background: var(--surface); border: 1px solid var(--border);
  color: var(--text); border-radius: 999px;
  padding: 6px 14px; font-size: 13px; cursor: pointer;
  font-family: inherit;
}

/* ---------- Auth gate ---------- */
.gate {
  display: grid; place-items: center;
  min-height: 100vh; padding: 24px;
}
.gate .card { max-width: 420px; width: 100%; }
.gate input {
  width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); border-radius: 6px;
  padding: 10px 12px; font-family: inherit; font-size: 13px;
  margin: 12px 0;
}
.gate input:focus { outline: none; border-color: var(--purple); }
.gate button {
  background: var(--purple); color: white; border: none;
  padding: 10px 20px; border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 14px; font-weight: 600;
}
.gate button:hover { background: var(--purple-hover); }
.gate .err { color: #ff6b6b; font-size: 12px; margin-top: 8px; }

/* ---------- Hidden ---------- */
.hidden { display: none !important; }

/* ---------- TV view ---------- */
body.tv { overflow: hidden; }
body.tv .tv-page {
  height: 100vh; padding: 48px; display: flex; flex-direction: column; gap: 32px;
}
body.tv .scoreboard {
  display: grid; grid-template-columns: 1fr auto 1fr; gap: 32px;
  align-items: center;
}
body.tv .scoreboard .today-big { font-size: 120px; font-weight: 700; line-height: 1; }
body.tv .scoreboard .top-today .lbl { font-size: 14px; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; }
body.tv .scoreboard .top-today .val { font-size: 36px; font-weight: 600; }
body.tv .scoreboard .now { text-align: right; font-size: 16px; }
body.tv .scoreboard .now.idle { color: var(--muted); }
body.tv .scoreboard .now .ch { font-size: 28px; font-weight: 600; }

body.tv .panel-frame {
  flex: 1; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 32px; overflow: hidden; position: relative;
}
body.tv .panel { position: absolute; inset: 32px; opacity: 0; transition: opacity 0.6s; }
body.tv .panel.active { opacity: 1; }
body.tv .panel h2 { font-size: 18px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 24px; }
body.tv .panel .ranked-row { font-size: 22px; }
body.tv .panel .ranked-row .avatar { width: 44px; height: 44px; font-size: 18px; }

body.tv .dots {
  display: flex; gap: 10px; justify-content: center;
}
body.tv .dots span {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--border);
  transition: background 0.3s;
}
body.tv .dots span.active { background: var(--purple); }
```

- [ ] **Step 2: Commit**

```bash
git add api/static/styles.css
git commit -m "feat(dashboard): shared design tokens and components in styles.css"
```

---

## Task 14: Frontend — dashboard HTML skeleton with auth gate

**Files:**
- Modify: `api/static/index.html` (replace placeholder)

- [ ] **Step 1: Replace index.html with the full skeleton**

Write `api/static/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Watchtime</title>
  <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
  <!-- Auth gate (shown first if no key in localStorage) -->
  <div id="gate" class="gate hidden">
    <div class="card">
      <h2>Watchtime</h2>
      <p style="color:var(--muted); margin-top:8px; font-size:13px;">
        Paste your API key to unlock the dashboard.
      </p>
      <input id="gate-input" type="password" placeholder="API key" autocomplete="off">
      <button id="gate-submit">Unlock</button>
      <div id="gate-err" class="err"></div>
    </div>
  </div>

  <!-- Main dashboard -->
  <div id="app" class="page hidden">
    <div class="topbar">
      <h1>Watchtime</h1>
      <select id="account-picker" class="account-picker"></select>
    </div>

    <!-- Hero -->
    <div class="card hero">
      <div>
        <div class="today-label">Today</div>
        <div class="today-value mono" id="today-value">0h 0m</div>
      </div>
      <div class="top">
        <div class="today-label">Top today</div>
        <div class="top-channel" id="top-channel">—</div>
        <div class="top-seconds mono" id="top-seconds">0m</div>
      </div>
      <div class="live hidden" id="live-indicator">
        <span class="dot"></span>
        <span>Now watching <span id="live-channel"></span></span>
      </div>
    </div>

    <!-- Time-range pills -->
    <div class="pills">
      <button class="pill active" data-window="today">Today</button>
      <button class="pill" data-window="week">Week</button>
      <button class="pill" data-window="all">All-time</button>
    </div>

    <!-- Two-column grid -->
    <div class="grid">
      <div class="card">
        <h2>Top channels</h2>
        <div id="top-channels" class="ranked"></div>
      </div>
      <div class="card">
        <h2>Daily — last 30 days</h2>
        <canvas id="daily-chart" height="220"></canvas>
      </div>
      <div class="card">
        <h2>Quick stats</h2>
        <div class="mini-grid">
          <div class="mini">
            <div class="val mono" id="qs-total">0h</div>
            <div class="lbl">Total all-time</div>
          </div>
          <div class="mini">
            <div class="val mono" id="qs-channels">0</div>
            <div class="lbl">Channels watched</div>
          </div>
          <div class="mini">
            <div class="val mono" id="qs-longest">0h</div>
            <div class="lbl">Longest day</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h2>Recently watched</h2>
        <div id="recent-list"></div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add api/static/index.html
git commit -m "feat(dashboard): index.html skeleton with auth gate and cards"
```

---

## Task 15: Frontend — auth gate + API helper + account picker

**Files:**
- Create: `api/static/app.js`

- [ ] **Step 1: Write the initial app.js with auth and account picker**

Write `api/static/app.js`:

```javascript
// ---------- Constants ----------
const POLL_MS = 10_000;
const STORAGE_KEY = "watchtime_api_key";
const ACCOUNT_KEY = "watchtime_account";

// ---------- State ----------
const state = {
  apiKey: localStorage.getItem(STORAGE_KEY) || null,
  user: null,         // selected account login, or null = all accounts
  window: "today",    // 'today' | 'week' | 'all'
  pollTimer: null,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

// ---------- API helper ----------
async function api(path) {
  const res = await fetch(path, { headers: { "X-API-Key": state.apiKey } });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(STORAGE_KEY);
    state.apiKey = null;
    showGate("Invalid API key.");
    throw new Error("auth");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function userParam() {
  return state.user ? `?user=${encodeURIComponent(state.user)}` : "";
}

function withUser(url) {
  if (!state.user) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}user=${encodeURIComponent(state.user)}`;
}

// ---------- Auth gate ----------
function showGate(errMsg = "") {
  $("gate").classList.remove("hidden");
  $("app").classList.add("hidden");
  $("gate-err").textContent = errMsg;
  $("gate-input").value = "";
  $("gate-input").focus();
}

function hideGate() {
  $("gate").classList.add("hidden");
  $("app").classList.remove("hidden");
}

$("gate-submit").addEventListener("click", async () => {
  const key = $("gate-input").value.trim();
  if (!key) return;
  state.apiKey = key;
  try {
    await api("/stats/users");
    localStorage.setItem(STORAGE_KEY, key);
    hideGate();
    boot();
  } catch (e) {
    // showGate already invoked by api() on 401/403
  }
});

$("gate-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("gate-submit").click();
});

// ---------- Account picker ----------
async function loadAccountPicker() {
  const { users } = await api("/stats/users");
  const select = $("account-picker");
  select.innerHTML = "";

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All accounts";
  select.appendChild(all);

  for (const u of users) {
    const opt = document.createElement("option");
    opt.value = u.user;
    opt.textContent = `Viewing: ${u.user}`;
    select.appendChild(opt);
  }

  const saved = localStorage.getItem(ACCOUNT_KEY);
  const defaultUser = saved !== null
    ? saved
    : (users.length > 0 ? users[0].user : "");
  select.value = defaultUser;
  state.user = defaultUser || null;
}

$("account-picker").addEventListener("change", (e) => {
  state.user = e.target.value || null;
  localStorage.setItem(ACCOUNT_KEY, state.user ?? "");
  refresh();
});

// ---------- Boot ----------
async function boot() {
  await loadAccountPicker();
  await refresh();
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refresh, POLL_MS);
}

// ---------- Refresh (filled in by later tasks) ----------
async function refresh() {
  // Implemented incrementally in Tasks 16-19.
}

// ---------- Init ----------
if (state.apiKey) {
  hideGate();
  boot();
} else {
  showGate();
}
```

- [ ] **Step 2: Visual smoke check**

Start the API locally (or via Docker), open `http://localhost:8765/`. Expected:
- Gate appears on first visit.
- Paste your API key → gate disappears, dashboard cards visible (empty values), account picker populated.
- Reload page → gate stays hidden, account picker preserved.
- In DevTools, set `localStorage.clear()` and reload → gate appears.

- [ ] **Step 3: Commit**

```bash
git add api/static/app.js
git commit -m "feat(dashboard): auth gate, account picker, polling skeleton"
```

---

## Task 16: Frontend — hero card with today + now-watching

**Files:**
- Modify: `api/static/app.js` (extend `refresh`)

- [ ] **Step 1: Add formatters and hero update**

Append to `api/static/app.js`:

```javascript
// ---------- Formatters ----------
function fmtDuration(seconds) {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function fmtRelative(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---------- Hero ----------
async function updateHero() {
  const [todayTotal, topToday, now] = await Promise.all([
    api(withUser("/stats/total?window=today")),
    api(withUser("/stats/top_channel?window=today")),
    api(withUser("/stats/now")),
  ]);
  $("today-value").textContent = fmtDuration(todayTotal.seconds);
  $("top-channel").textContent = topToday.channel || "—";
  $("top-seconds").textContent = fmtDuration(topToday.seconds);

  if (now && now.channel) {
    $("live-indicator").classList.remove("hidden");
    $("live-channel").textContent = now.channel;
  } else {
    $("live-indicator").classList.add("hidden");
  }
}
```

Update `refresh()`:

```javascript
async function refresh() {
  try {
    await updateHero();
  } catch (e) {
    console.warn("refresh failed", e);
  }
}
```

- [ ] **Step 2: Visual smoke check**

Reload the dashboard. Expected:
- Today's value populates within ~1 sec.
- Top channel shows correct name if you've watched anything today.
- Live `● Now watching` indicator appears if a heartbeat landed in the last 2 min, else hidden.

- [ ] **Step 3: Commit**

```bash
git add api/static/app.js
git commit -m "feat(dashboard): hero card with today/top/now-watching"
```

---

## Task 17: Frontend — time-range pills + top channels card

**Files:**
- Modify: `api/static/app.js`

- [ ] **Step 1: Add pills and top-channels rendering**

Append to `api/static/app.js`:

```javascript
// ---------- Pills ----------
document.querySelectorAll(".pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    state.window = pill.dataset.window;
    updateTopChannels();
  });
});

// ---------- Top channels ----------
const AVATAR_COLORS = ["#9146FF", "#00f5d4", "#ff6b6b", "#feca57", "#5f27cd", "#48dbfb", "#1dd1a1", "#f368e0"];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

async function updateTopChannels() {
  const data = await api(withUser(`/stats/${state.window}`));
  const channels = data.channels.slice(0, 10);
  const max = channels[0]?.seconds || 1;
  const root = $("top-channels");
  root.innerHTML = "";
  channels.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "ranked-row";
    row.innerHTML = `
      <div class="rank mono">#${i + 1}</div>
      <div class="avatar" style="background:${avatarColor(c.channel)}">${c.channel[0].toUpperCase()}</div>
      <div class="name">${c.channel}</div>
      <div class="value mono">${fmtDuration(c.seconds)}</div>
      <div class="bar"><span style="width:${(c.seconds / max * 100).toFixed(1)}%"></span></div>
    `;
    root.appendChild(row);
  });
  if (channels.length === 0) {
    root.innerHTML = '<div style="color:var(--muted)">No data yet.</div>';
  }
}
```

Update `refresh()`:

```javascript
async function refresh() {
  try {
    await Promise.all([
      updateHero(),
      updateTopChannels(),
    ]);
  } catch (e) {
    console.warn("refresh failed", e);
  }
}
```

- [ ] **Step 2: Visual smoke check**

Reload the dashboard. Expected:
- Pills clickable; clicking swaps data in the Top channels card.
- Ranked list shows channel name, hours, bar showing relative share.
- Selecting different account from the dropdown re-renders correctly.

- [ ] **Step 3: Commit**

```bash
git add api/static/app.js
git commit -m "feat(dashboard): time-range pills + top channels ranked list"
```

---

## Task 18: Frontend — daily chart with Chart.js

**Files:**
- Modify: `api/static/app.js`

- [ ] **Step 1: Add daily chart logic**

Append to `api/static/app.js`:

```javascript
// ---------- Daily chart ----------
let dailyChart = null;

async function updateDailyChart() {
  const data = await api(withUser("/stats/daily?days=30"));
  const labels = data.days.map(d => d.day.slice(5));  // MM-DD
  const values = data.days.map(d => d.seconds / 3600);  // hours

  const ctx = $("daily-chart").getContext("2d");
  if (dailyChart) {
    dailyChart.data.labels = labels;
    dailyChart.data.datasets[0].data = values;
    dailyChart.update();
    return;
  }
  dailyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: "#9146FF",
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#adadb8", maxRotation: 0 }, grid: { display: false } },
        y: {
          ticks: { color: "#adadb8", callback: (v) => v + "h" },
          grid: { color: "#2f2f35" },
          beginAtZero: true,
        },
      },
    },
  });
}
```

Update `refresh()`:

```javascript
async function refresh() {
  try {
    await Promise.all([
      updateHero(),
      updateTopChannels(),
      updateDailyChart(),
    ]);
  } catch (e) {
    console.warn("refresh failed", e);
  }
}
```

- [ ] **Step 2: Visual smoke check**

Reload. Expected:
- Daily chart card renders a purple bar chart with the last 30 days.
- Y-axis labelled in hours, X-axis as MM-DD.
- Chart updates when account picker changes (without flicker).

- [ ] **Step 3: Commit**

```bash
git add api/static/app.js
git commit -m "feat(dashboard): daily 30-day bar chart"
```

---

## Task 19: Frontend — quick stats + recently watched

**Files:**
- Modify: `api/static/app.js`

- [ ] **Step 1: Add quick stats and recent rendering**

Append to `api/static/app.js`:

```javascript
// ---------- Quick stats ----------
async function updateQuickStats() {
  const [totalAll, allChannels, daily] = await Promise.all([
    api(withUser("/stats/total?window=all")),
    api(withUser("/stats/all")),
    api(withUser("/stats/daily?days=365")),
  ]);
  $("qs-total").textContent = fmtDuration(totalAll.seconds);
  $("qs-channels").textContent = allChannels.channels.length.toString();
  const longestDay = daily.days.reduce(
    (max, d) => (d.seconds > max ? d.seconds : max), 0
  );
  $("qs-longest").textContent = fmtDuration(longestDay);
}

// ---------- Recently watched ----------
async function updateRecent() {
  const { recent } = await api(withUser("/stats/recent?limit=5"));
  const root = $("recent-list");
  root.innerHTML = "";
  if (recent.length === 0) {
    root.innerHTML = '<div style="color:var(--muted)">Nothing watched yet.</div>';
    return;
  }
  recent.forEach((r) => {
    const row = document.createElement("div");
    row.className = "recent-row";
    row.innerHTML = `
      <div>${r.channel}</div>
      <div class="when">${fmtRelative(r.last_ts)}</div>
    `;
    root.appendChild(row);
  });
}
```

Update `refresh()` (final version):

```javascript
async function refresh() {
  try {
    await Promise.all([
      updateHero(),
      updateTopChannels(),
      updateDailyChart(),
      updateQuickStats(),
      updateRecent(),
    ]);
  } catch (e) {
    console.warn("refresh failed", e);
  }
}
```

- [ ] **Step 2: Visual smoke check**

Reload. Expected:
- Three mini stats populate: Total all-time, Channels watched, Longest day.
- Recently watched shows 5 most-recent distinct channels with "5m ago" / "2h ago" style timestamps.
- After ~10s, all values refresh silently (no flicker).

- [ ] **Step 3: Commit**

```bash
git add api/static/app.js
git commit -m "feat(dashboard): quick stats + recently watched cards"
```

---

## Task 20: Frontend — TV view HTML + scoreboard JS

**Files:**
- Modify: `api/static/tv.html` (replace placeholder)
- Create: `api/static/tv.js`

- [ ] **Step 1: Write tv.html**

Write `api/static/tv.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Watchtime — TV</title>
  <link rel="stylesheet" href="/static/styles.css">
</head>
<body class="tv">
  <div id="gate" class="gate hidden">
    <div class="card">
      <h2>Watchtime TV</h2>
      <input id="gate-input" type="password" placeholder="API key" autocomplete="off">
      <button id="gate-submit">Unlock</button>
      <div id="gate-err" class="err"></div>
    </div>
  </div>

  <div id="tv-page" class="tv-page hidden">
    <div class="scoreboard">
      <div>
        <div class="today-label" style="font-size:14px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;">Today</div>
        <div class="today-big mono" id="tv-today">0h 0m</div>
      </div>
      <div class="top-today">
        <div class="lbl">Top today</div>
        <div class="val" id="tv-top">—</div>
      </div>
      <div class="now idle" id="tv-now">
        <div class="lbl" style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">Status</div>
        <div class="ch" id="tv-now-text">IDLE</div>
      </div>
    </div>

    <div class="panel-frame">
      <div class="panel" data-idx="0">
        <h2>Top channels this week</h2>
        <div id="tv-week-channels" class="ranked"></div>
      </div>
      <div class="panel" data-idx="1">
        <h2>Daily — last 14 days</h2>
        <canvas id="tv-daily" height="320"></canvas>
      </div>
      <div class="panel" data-idx="2">
        <h2>All-time leaderboard</h2>
        <div id="tv-all-channels" class="ranked"></div>
      </div>
      <div class="panel" data-idx="3">
        <h2>Top categories this week</h2>
        <div id="tv-categories" class="ranked"></div>
      </div>
    </div>

    <div class="dots">
      <span></span><span></span><span></span><span></span>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="/static/tv.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write tv.js — gate + scoreboard polling**

Write `api/static/tv.js`:

```javascript
const STORAGE_KEY = "watchtime_api_key";
const SCOREBOARD_MS = 30_000;
const PANEL_MS = 15_000;

const state = {
  apiKey: localStorage.getItem(STORAGE_KEY) || null,
  user: new URLSearchParams(location.search).get("user") || null,
  panelIdx: 0,
};

const $ = (id) => document.getElementById(id);

async function api(path) {
  const url = state.user
    ? `${path}${path.includes("?") ? "&" : "?"}user=${encodeURIComponent(state.user)}`
    : path;
  const res = await fetch(url, { headers: { "X-API-Key": state.apiKey } });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(STORAGE_KEY);
    state.apiKey = null;
    showGate();
    throw new Error("auth");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function showGate() {
  $("gate").classList.remove("hidden");
  $("tv-page").classList.add("hidden");
  $("gate-input").focus();
}
function hideGate() {
  $("gate").classList.add("hidden");
  $("tv-page").classList.remove("hidden");
}

$("gate-submit").addEventListener("click", async () => {
  const key = $("gate-input").value.trim();
  if (!key) return;
  state.apiKey = key;
  try {
    await api("/stats/total?window=today");
    localStorage.setItem(STORAGE_KEY, key);
    hideGate();
    boot();
  } catch { /* showGate already shown */ }
});
$("gate-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("gate-submit").click();
});

function fmtDuration(seconds) {
  if (!seconds) return "0h 0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ---------- Default user selection ----------
async function pickDefaultUser() {
  if (state.user) return;  // explicit ?user=
  try {
    const { users } = await api("/stats/users");
    if (users.length > 0) state.user = users[0].user;
  } catch { /* ignore */ }
}

// ---------- Scoreboard ----------
async function updateScoreboard() {
  const [today, top, now] = await Promise.all([
    api("/stats/total?window=today"),
    api("/stats/top_channel?window=today"),
    api("/stats/now"),
  ]);
  $("tv-today").textContent = fmtDuration(today.seconds);
  $("tv-top").textContent = top.channel ? `${top.channel} — ${fmtDuration(top.seconds)}` : "—";
  if (now && now.channel) {
    $("tv-now").classList.remove("idle");
    $("tv-now-text").innerHTML = `<span style="color:var(--live)">●</span> ${now.channel}`;
  } else {
    $("tv-now").classList.add("idle");
    $("tv-now-text").textContent = "IDLE";
  }
}

async function boot() {
  await pickDefaultUser();
  await updateScoreboard();
  setInterval(updateScoreboard, SCOREBOARD_MS);
  startPanels();
}

if (state.apiKey) {
  hideGate();
  boot();
} else {
  showGate();
}
```

The `startPanels()` function is defined in Task 21.

- [ ] **Step 3: Stub `startPanels` so the page boots without errors**

Append to `api/static/tv.js` for now:

```javascript
function startPanels() {
  // Implemented in Task 21
}
```

- [ ] **Step 4: Visual smoke check**

Open `http://localhost:8765/tv`. Expected:
- Gate appears; pasting key reveals the TV layout.
- Scoreboard header shows today's time, top channel, and IDLE / live indicator.
- Refreshes every ~30s.
- All four panel frames visible but blank (will be filled in Task 21).

- [ ] **Step 5: Commit**

```bash
git add api/static/tv.html api/static/tv.js
git commit -m "feat(tv): scoreboard with today/top/now status"
```

---

## Task 21: Frontend — TV rotating panels + categories

**Files:**
- Modify: `api/static/tv.js` (replace `startPanels` stub with full implementation)

- [ ] **Step 1: Implement panel data loaders and rotator**

In `api/static/tv.js`, replace the `startPanels` stub at the bottom with:

```javascript
// ---------- Panels ----------
let tvDailyChart = null;

const AVATAR_COLORS = ["#9146FF", "#00f5d4", "#ff6b6b", "#feca57", "#5f27cd", "#48dbfb", "#1dd1a1", "#f368e0"];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function renderRankedList(rootId, items, valueFn, labelFn) {
  const root = $(rootId);
  root.innerHTML = "";
  const max = items[0] ? valueFn(items[0]) : 1;
  items.forEach((it, i) => {
    const seconds = valueFn(it);
    const label = labelFn(it);
    const row = document.createElement("div");
    row.className = "ranked-row";
    row.innerHTML = `
      <div class="rank mono">#${i + 1}</div>
      <div class="avatar" style="background:${avatarColor(label)}">${label[0].toUpperCase()}</div>
      <div class="name">${label}</div>
      <div class="value mono">${fmtDuration(seconds)}</div>
      <div class="bar"><span style="width:${(seconds / max * 100).toFixed(1)}%"></span></div>
    `;
    root.appendChild(row);
  });
  if (items.length === 0) {
    root.innerHTML = '<div style="color:var(--muted);font-size:24px;">No data yet.</div>';
  }
}

async function loadPanel0() {
  const data = await api("/stats/week");
  renderRankedList(
    "tv-week-channels",
    data.channels.slice(0, 5),
    (c) => c.seconds,
    (c) => c.channel,
  );
}

async function loadPanel1() {
  const data = await api("/stats/daily?days=14");
  const labels = data.days.map(d => d.day.slice(5));
  const values = data.days.map(d => d.seconds / 3600);
  const ctx = $("tv-daily").getContext("2d");
  if (tvDailyChart) {
    tvDailyChart.data.labels = labels;
    tvDailyChart.data.datasets[0].data = values;
    tvDailyChart.update();
    return;
  }
  tvDailyChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: "#9146FF", borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#efeff1", font: { size: 16 }, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: "#efeff1", font: { size: 16 }, callback: (v) => v + "h" }, grid: { color: "#2f2f35" }, beginAtZero: true },
      },
    },
  });
}

async function loadPanel2() {
  const data = await api("/stats/all");
  renderRankedList(
    "tv-all-channels",
    data.channels.slice(0, 10),
    (c) => c.seconds,
    (c) => c.channel,
  );
}

async function loadPanel3() {
  const data = await api("/stats/categories?window=week");
  renderRankedList(
    "tv-categories",
    data.categories.slice(0, 5),
    (c) => c.seconds,
    (c) => c.category,
  );
}

const PANEL_LOADERS = [loadPanel0, loadPanel1, loadPanel2, loadPanel3];

function showPanel(idx) {
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", parseInt(p.dataset.idx) === idx);
  });
  document.querySelectorAll(".dots span").forEach((d, i) => {
    d.classList.toggle("active", i === idx);
  });
  PANEL_LOADERS[idx]().catch((e) => console.warn(`panel ${idx} failed`, e));
}

function startPanels() {
  showPanel(0);
  setInterval(() => {
    state.panelIdx = (state.panelIdx + 1) % 4;
    showPanel(state.panelIdx);
  }, PANEL_MS);
}
```

- [ ] **Step 2: Visual smoke check**

Open `/tv`. Expected:
- Panel 1 (top channels this week) appears.
- Every ~15s, fades to next panel: daily chart → all-time leaderboard → categories → back to week.
- Dot indicators at bottom track which panel is active.
- Scoreboard header keeps refreshing independently.

- [ ] **Step 3: Add cursor auto-hide**

Append to `api/static/tv.js`:

```javascript
// ---------- Cursor auto-hide ----------
let cursorTimer = null;
function showCursor() {
  document.body.style.cursor = "auto";
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => { document.body.style.cursor = "none"; }, 3000);
}
document.addEventListener("mousemove", showCursor);
showCursor();
```

- [ ] **Step 4: Commit**

```bash
git add api/static/tv.js
git commit -m "feat(tv): rotating panels + cursor auto-hide"
```

---

## Task 22: Update README with Phase 2 deployment notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "What's next" section**

In `README.md`, replace the `## What's next` block (lines 96-100) with:

```markdown
## Dashboard (Phase 2)

Once heartbeats are flowing, the dashboard is available at:

- `http://192.168.1.100:8765/` — main dashboard (paste your API key on first visit)
- `http://192.168.1.100:8765/tv` — ambient scoreboard / rotating panels (point a spare display at this URL)

The dashboard is per-Twitch-account. The account picker in the top-right defaults to whichever account has the most recent activity. To pre-select an account on the TV view: `?user=<login>`.

## What's next

- Phase 3: REST sensors in Home Assistant pointed at `/stats/*` (see `docs/superpowers/specs/2026-05-16-dashboard-design.md`).
```

- [ ] **Step 2: Run all tests one final time**

```bash
cd api
pytest -v
```

Expected: all tests across `test_migration.py`, `test_heartbeat_twitch_user.py`, `test_user_filter.py`, `test_new_endpoints.py`, `test_static_routes.py` PASS.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: dashboard URLs and Phase 3 pointer in README"
git push
```

- [ ] **Step 4: Deploy to Proxmox**

On the Proxmox box:

```bash
cd ~/twitch-watchtime
git pull
docker compose down && docker compose up -d --build
curl http://localhost:8765/health
```

Open `http://192.168.1.100:8765/` from your browser; the auth gate should appear.

---

## Self-Review

- **Spec coverage:** Migration ✓ (Task 2), Heartbeat model ✓ (Task 3), `?user=` filter on six existing endpoints ✓ (Tasks 4-6), four new endpoints ✓ (Tasks 7-10), static serving ✓ (Task 11), extension change ✓ (Task 12), styles ✓ (Task 13), main dashboard sections (hero, pills, top channels, daily chart, quick stats, recently watched) ✓ (Tasks 14-19), TV view (scoreboard + rotating panels + cursor hide) ✓ (Tasks 20-21), README + deploy ✓ (Task 22).
- **Placeholder scan:** No TBDs, no "implement later" — every step shows the code or command.
- **Type consistency:** `_user_clause`, `_window_since`, `withUser`/`userParam`, `fmtDuration`, `avatarColor` are defined where first used and reused with identical signatures throughout.
- **Ambiguity check:** "Anonymous" handling clear (`user=anonymous` → `IS NULL`). The dashboard's account default is documented as "first user from `/stats/users`" which is itself ordered by `last_ts DESC` (Task 8), so "most-recently-active" is well-defined.
