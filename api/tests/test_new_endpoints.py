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
