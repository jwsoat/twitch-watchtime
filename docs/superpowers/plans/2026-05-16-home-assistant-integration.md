# Phase 3 Home Assistant Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HACS-installable Home Assistant custom integration described in `docs/superpowers/specs/2026-05-16-home-assistant-integration-design.md` — talks to the twitch-watchtime FastAPI backend, exposes 6 entities per Twitch account.

**Architecture:** New separate git repo (`twitch-watchtime-ha`) on disk at `C:\Users\Jwsoat\Documents\Claude\twitch-watchtime-ha`. HACS-compatible layout. The integration is a thin wrapper around the existing FastAPI: a single `DataUpdateCoordinator` polls 5 endpoints in parallel, sensor + binary_sensor platforms read from coordinator state. Two-step async config flow validates connection then offers an account dropdown sourced from `/stats/users`.

**Tech Stack:** Python 3.12+ / Home Assistant Core ≥ 2024.10 / `aiohttp` (via HA's shared client) / `pytest-homeassistant-custom-component` for tests / HACS for distribution.

## File Structure

**Created in new repo `twitch-watchtime-ha/`:**

- `README.md` — install + usage docs.
- `LICENSE` — MIT.
- `.gitignore` — Python/HA standard.
- `hacs.json` — HACS distribution manifest.
- `requirements_test.txt` — pytest stack for the dev box.
- `tests/__init__.py` — empty marker.
- `tests/conftest.py` — HA pytest fixtures.
- `tests/test_api.py` — unit tests for the HTTP client (no HA imports).
- `tests/test_coordinator.py` — coordinator merges responses correctly.
- `tests/test_config_flow.py` — config flow happy path + auth/connection errors.
- `custom_components/twitch_watchtime/__init__.py` — `async_setup_entry` + `async_unload_entry`.
- `custom_components/twitch_watchtime/manifest.json` — HA integration manifest.
- `custom_components/twitch_watchtime/const.py` — `DOMAIN`, platform list, config keys, defaults.
- `custom_components/twitch_watchtime/api.py` — `TwitchWatchtimeClient` HTTP wrapper.
- `custom_components/twitch_watchtime/coordinator.py` — `TwitchWatchtimeCoordinator` `DataUpdateCoordinator` subclass.
- `custom_components/twitch_watchtime/config_flow.py` — `TwitchWatchtimeConfigFlow` + `TwitchWatchtimeOptionsFlow`.
- `custom_components/twitch_watchtime/sensor.py` — 5 sensor entity classes + platform setup.
- `custom_components/twitch_watchtime/binary_sensor.py` — 1 binary sensor + platform setup.
- `custom_components/twitch_watchtime/strings.json` — UI strings (config flow labels + errors).
- `custom_components/twitch_watchtime/translations/en.json` — English copy of strings.

**Boundary intent:**

- `api.py` is the only module that talks HTTP. Everything else accepts a `TwitchWatchtimeClient` or `TwitchWatchtimeCoordinator`.
- `coordinator.py` is the only module that knows the merged-data shape. Sensors are dumb readers.
- `config_flow.py` doesn't import `coordinator.py` or `sensor.py` — it only uses `api.py` for validation.

---

## Task 1: Create repo + LICENSE + .gitignore

**Files:**
- Create: `C:\Users\Jwsoat\Documents\Claude\twitch-watchtime-ha\.gitignore`
- Create: `C:\Users\Jwsoat\Documents\Claude\twitch-watchtime-ha\LICENSE`

- [ ] **Step 1: Initialize a new git repo at a sibling path to twitch-watchtime**

Run in PowerShell:

```powershell
cd C:\Users\Jwsoat\Documents\Claude
New-Item -ItemType Directory -Path twitch-watchtime-ha
cd twitch-watchtime-ha
git init -b main
```

Expected: `Initialized empty Git repository in C:/Users/Jwsoat/Documents/Claude/twitch-watchtime-ha/.git/`.

- [ ] **Step 2: Create `.gitignore`**

Write `.gitignore`:

```
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Virtualenv
.venv/
venv/
env/
ENV/

# pytest / coverage
.pytest_cache/
.coverage
.coverage.*
htmlcov/
.tox/

# Editors
.vscode/
.idea/
*.swp
*~

# OS
.DS_Store
Thumbs.db

# HA
config/
```

- [ ] **Step 3: Create MIT `LICENSE`**

Write `LICENSE`:

```
MIT License

Copyright (c) 2026 jwsoat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Commit**

```powershell
git add .gitignore LICENSE
git commit -m "chore: repo scaffolding + MIT license"
```

Do NOT push yet — the GitHub repo gets created in Task 12.

---

## Task 2: HACS manifest, HA manifest, and `const.py`

**Files:**
- Create: `hacs.json`
- Create: `custom_components/twitch_watchtime/__init__.py` (empty placeholder for now — real content in Task 7)
- Create: `custom_components/twitch_watchtime/manifest.json`
- Create: `custom_components/twitch_watchtime/const.py`

- [ ] **Step 1: Create the package directory structure**

```powershell
cd C:\Users\Jwsoat\Documents\Claude\twitch-watchtime-ha
New-Item -ItemType Directory -Path custom_components\twitch_watchtime\translations -Force | Out-Null
```

- [ ] **Step 2: Write `hacs.json` at repo root**

```json
{
  "name": "Twitch Watchtime",
  "content_in_root": false,
  "render_readme": true,
  "homeassistant": "2024.10.0"
}
```

- [ ] **Step 3: Write `custom_components/twitch_watchtime/manifest.json`**

```json
{
  "domain": "twitch_watchtime",
  "name": "Twitch Watchtime",
  "codeowners": ["@jwsoat"],
  "config_flow": true,
  "dependencies": [],
  "documentation": "https://github.com/jwsoat/twitch-watchtime-ha",
  "iot_class": "local_polling",
  "integration_type": "service",
  "issue_tracker": "https://github.com/jwsoat/twitch-watchtime-ha/issues",
  "requirements": [],
  "version": "0.1.0"
}
```

- [ ] **Step 4: Write empty `custom_components/twitch_watchtime/__init__.py`**

Empty file (real content goes in Task 7):

```python
```

- [ ] **Step 5: Write `custom_components/twitch_watchtime/const.py`**

```python
"""Constants for the twitch_watchtime integration."""
from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "twitch_watchtime"

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.BINARY_SENSOR]

# Config entry keys
CONF_HOST = "host"
CONF_API_KEY = "api_key"
CONF_USER = "user"  # Twitch login, "all_accounts" sentinel, or a custom-typed login

# Special value used in CONF_USER when the entry should pool all accounts.
USER_ALL = "all_accounts"

# Options flow keys
OPT_SCAN_INTERVAL = "scan_interval"
OPT_IDLE_TIMEOUT = "idle_timeout"

# Defaults
DEFAULT_SCAN_INTERVAL = 60  # seconds
DEFAULT_IDLE_TIMEOUT = 120  # seconds — matches the API's /stats/now window
MIN_SCAN_INTERVAL = 15
MAX_SCAN_INTERVAL = 600

# Manufacturer/model strings shown in HA device info
MANUFACTURER = "Twitch Watchtime"
MODEL = "Self-hosted"
```

- [ ] **Step 6: Commit**

```powershell
git add hacs.json custom_components
git commit -m "feat: HACS + HA manifests and const.py"
```

---

## Task 3: Test infrastructure

**Files:**
- Create: `requirements_test.txt`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Write `requirements_test.txt`**

```
pytest==8.3.3
pytest-asyncio==0.24.0
pytest-homeassistant-custom-component==0.13.180
aioresponses==0.7.7
```

Note: `pytest-homeassistant-custom-component` brings Home Assistant Core in as a transitive dependency, so it requires Python 3.12 or 3.13 (HA does not yet support 3.14). If your default Python is 3.14 (as set up for the backend), create a Python 3.12 venv for this repo:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements_test.txt
```

If Python 3.12 isn't installed, get it from `https://www.python.org/downloads/release/python-3127/` or via `winget install Python.Python.3.12`. Tests can also be skipped — the integration is testable manually inside a real HA instance.

- [ ] **Step 2: Write empty `tests/__init__.py`**

```python
```

- [ ] **Step 3: Write `tests/conftest.py`**

```python
"""Shared pytest fixtures for the twitch_watchtime integration."""
from __future__ import annotations

from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
from aioresponses import aioresponses
from homeassistant.core import HomeAssistant

from custom_components.twitch_watchtime.const import (
    CONF_API_KEY,
    CONF_HOST,
    CONF_USER,
    DOMAIN,
)

TEST_HOST = "http://watchtime.test:8765"
TEST_API_KEY = "test-key"
TEST_USER = "jwsoat"


@pytest.fixture
def enable_custom_integrations(enable_custom_integrations):
    """Enable loading custom integrations in HA's test harness."""
    yield enable_custom_integrations


@pytest.fixture
def mock_backend() -> AsyncGenerator[aioresponses, None]:
    """Intercept aiohttp calls to the backend."""
    with aioresponses() as m:
        yield m


@pytest.fixture
def config_entry_data() -> dict:
    """Default config entry data."""
    return {
        CONF_HOST: TEST_HOST,
        CONF_API_KEY: TEST_API_KEY,
        CONF_USER: TEST_USER,
    }
```

- [ ] **Step 4: Verify pytest collects nothing yet**

```powershell
pytest --collect-only
```

Expected: `collected 0 items` (or `no tests collected`) with exit code 5. Confirms the harness imports.

If you see `ModuleNotFoundError: No module named 'custom_components'`, run pytest from the repo root, or add `pyproject.toml` with `pythonpath = ["."]` (see next step).

- [ ] **Step 5: Write `pyproject.toml` for pytest config**

Write `pyproject.toml` at the repo root:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
asyncio_mode = "auto"
```

Re-run `pytest --collect-only` and confirm `0 items` again (or a small number if test files already exist).

- [ ] **Step 6: Commit**

```powershell
git add requirements_test.txt tests pyproject.toml
git commit -m "test: scaffold pytest + HA test harness"
```

---

## Task 4: API client (`api.py`) — TDD

**Files:**
- Test: `tests/test_api.py`
- Create: `custom_components/twitch_watchtime/api.py`

The API client wraps the FastAPI backend. It is the only module that talks HTTP. Tests use `aioresponses` to mock — no HA imports needed in `api.py` (it accepts a session as a parameter).

- [ ] **Step 1: Write the failing tests**

Write `tests/test_api.py`:

```python
"""Tests for TwitchWatchtimeClient."""
from __future__ import annotations

import aiohttp
import pytest
from aioresponses import aioresponses

from custom_components.twitch_watchtime.api import (
    TwitchWatchtimeAuthError,
    TwitchWatchtimeClient,
    TwitchWatchtimeConnectionError,
)


HOST = "http://watchtime.test:8765"
KEY = "secret"


async def _make_client() -> tuple[TwitchWatchtimeClient, aiohttp.ClientSession]:
    session = aiohttp.ClientSession()
    return TwitchWatchtimeClient(host=HOST, api_key=KEY, session=session), session


async def test_health_returns_true_on_200() -> None:
    client, session = await _make_client()
    try:
        with aioresponses() as m:
            m.get(f"{HOST}/health", payload={"ok": True, "interval": 60})
            assert await client.async_check_health() is True
    finally:
        await session.close()


async def test_health_raises_connection_error_on_network_failure() -> None:
    client, session = await _make_client()
    try:
        with aioresponses() as m:
            m.get(f"{HOST}/health", exception=aiohttp.ClientConnectorError(None, OSError()))
            with pytest.raises(TwitchWatchtimeConnectionError):
                await client.async_check_health()
    finally:
        await session.close()


async def test_get_users_returns_list() -> None:
    client, session = await _make_client()
    try:
        with aioresponses() as m:
            m.get(
                f"{HOST}/stats/users",
                payload={"users": [
                    {"user": "jwsoat", "last_ts": 1700000000, "count": 42},
                    {"user": "anonymous", "last_ts": 1699999000, "count": 5},
                ]},
            )
            users = await client.async_get_users()
            assert users == [
                {"user": "jwsoat", "last_ts": 1700000000, "count": 42},
                {"user": "anonymous", "last_ts": 1699999000, "count": 5},
            ]
    finally:
        await session.close()


async def test_get_users_raises_auth_error_on_401() -> None:
    client, session = await _make_client()
    try:
        with aioresponses() as m:
            m.get(f"{HOST}/stats/users", status=401, payload={"detail": "bad api key"})
            with pytest.raises(TwitchWatchtimeAuthError):
                await client.async_get_users()
    finally:
        await session.close()


async def test_fetch_snapshot_merges_five_endpoints() -> None:
    client, session = await _make_client()
    try:
        with aioresponses() as m:
            m.get(f"{HOST}/stats/total?window=today", payload={"window": "today", "seconds": 1800})
            m.get(f"{HOST}/stats/total?window=week", payload={"window": "week", "seconds": 7200})
            m.get(f"{HOST}/stats/total?window=all", payload={"window": "all", "seconds": 360000})
            m.get(f"{HOST}/stats/top_channel?window=today", payload={"channel": "cinna", "seconds": 1200})
            m.get(f"{HOST}/stats/now", payload={
                "ts": 1700000000, "channel": "cinna", "category": "Just Chatting",
                "title": "stream title", "twitch_user": None,
            })
            snap = await client.async_fetch_snapshot(user=None)
            assert snap == {
                "today_seconds": 1800,
                "week_seconds": 7200,
                "all_seconds": 360000,
                "top_channel": "cinna",
                "top_channel_seconds": 1200,
                "now": {
                    "ts": 1700000000, "channel": "cinna", "category": "Just Chatting",
                    "title": "stream title", "twitch_user": None,
                },
            }
    finally:
        await session.close()


async def test_fetch_snapshot_passes_user_param_when_set() -> None:
    client, session = await _make_client()
    try:
        with aioresponses() as m:
            m.get(f"{HOST}/stats/total?window=today&user=jwsoat", payload={"window": "today", "seconds": 60})
            m.get(f"{HOST}/stats/total?window=week&user=jwsoat", payload={"window": "week", "seconds": 60})
            m.get(f"{HOST}/stats/total?window=all&user=jwsoat", payload={"window": "all", "seconds": 60})
            m.get(f"{HOST}/stats/top_channel?window=today&user=jwsoat", payload={"channel": None, "seconds": 0})
            m.get(f"{HOST}/stats/now?user=jwsoat", payload={"now": None})
            snap = await client.async_fetch_snapshot(user="jwsoat")
            assert snap["today_seconds"] == 60
            assert snap["top_channel"] is None
            assert snap["now"] is None
    finally:
        await session.close()


async def test_fetch_snapshot_normalizes_stats_now_null_shape() -> None:
    """/stats/now returns {now: null} when idle — the client should normalize to a single None."""
    client, session = await _make_client()
    try:
        with aioresponses() as m:
            m.get(f"{HOST}/stats/total?window=today", payload={"window": "today", "seconds": 0})
            m.get(f"{HOST}/stats/total?window=week", payload={"window": "week", "seconds": 0})
            m.get(f"{HOST}/stats/total?window=all", payload={"window": "all", "seconds": 0})
            m.get(f"{HOST}/stats/top_channel?window=today", payload={"channel": None, "seconds": 0})
            m.get(f"{HOST}/stats/now", payload={"now": None})
            snap = await client.async_fetch_snapshot(user=None)
            assert snap["now"] is None
    finally:
        await session.close()
```

- [ ] **Step 2: Run tests, confirm failure**

```powershell
pytest tests/test_api.py -v
```

Expected: `ImportError: cannot import name 'TwitchWatchtimeClient' from 'custom_components.twitch_watchtime.api'` (or similar — the module doesn't exist yet).

- [ ] **Step 3: Implement `api.py`**

Write `custom_components/twitch_watchtime/api.py`:

```python
"""HTTP client for the twitch-watchtime FastAPI backend.

The only module in this integration that talks to the network. Accepts an
aiohttp ClientSession so it's testable with aioresponses and reusable with
HA's shared session in production.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)


class TwitchWatchtimeError(Exception):
    """Base error for the client."""


class TwitchWatchtimeConnectionError(TwitchWatchtimeError):
    """Connection refused, DNS failure, timeout, etc."""


class TwitchWatchtimeAuthError(TwitchWatchtimeError):
    """Backend rejected the API key (401/403)."""


class TwitchWatchtimeClient:
    """Thin async client around the watchtime backend."""

    def __init__(
        self,
        *,
        host: str,
        api_key: str,
        session: aiohttp.ClientSession,
    ) -> None:
        self._host = host.rstrip("/")
        self._headers = {"X-API-Key": api_key}
        self._session = session

    async def _get(self, path: str, params: dict[str, str] | None = None, *, auth: bool = True) -> Any:
        url = f"{self._host}{path}"
        headers = self._headers if auth else {}
        try:
            async with self._session.get(url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as res:
                if res.status in (401, 403):
                    raise TwitchWatchtimeAuthError(f"{res.status} on {path}")
                res.raise_for_status()
                return await res.json()
        except (aiohttp.ClientConnectorError, aiohttp.ClientConnectionError, asyncio.TimeoutError) as err:
            raise TwitchWatchtimeConnectionError(str(err)) from err
        except aiohttp.ClientResponseError as err:
            # Re-raise as connection error so callers can decide HA's UpdateFailed vs ConfigEntryAuthFailed
            raise TwitchWatchtimeConnectionError(f"HTTP {err.status}") from err

    async def async_check_health(self) -> bool:
        """Hit /health (no auth)."""
        data = await self._get("/health", auth=False)
        return bool(data.get("ok"))

    async def async_get_users(self) -> list[dict[str, Any]]:
        """Return the list of distinct twitch_user values (powers the picker)."""
        data = await self._get("/stats/users")
        return list(data.get("users", []))

    async def async_fetch_snapshot(self, *, user: str | None) -> dict[str, Any]:
        """Run the five tick calls in parallel and merge into a coordinator-shaped dict.

        Passing user=None pools all accounts; any other value is sent as ?user=<value>.
        """
        params_user = {"user": user} if user else None
        params_today = {"window": "today", **(params_user or {})}
        params_week = {"window": "week", **(params_user or {})}
        params_all = {"window": "all", **(params_user or {})}

        today, top, week, all_time, now = await asyncio.gather(
            self._get("/stats/total", params=params_today),
            self._get("/stats/top_channel", params=params_today),
            self._get("/stats/total", params=params_week),
            self._get("/stats/total", params=params_all),
            self._get("/stats/now", params=params_user),
        )

        # /stats/now returns either {"now": None} or {"ts": ..., "channel": ..., ...}
        now_value: dict[str, Any] | None
        if isinstance(now, dict) and "now" in now and now["now"] is None:
            now_value = None
        else:
            now_value = now

        return {
            "today_seconds": int(today.get("seconds", 0)),
            "week_seconds": int(week.get("seconds", 0)),
            "all_seconds": int(all_time.get("seconds", 0)),
            "top_channel": top.get("channel"),
            "top_channel_seconds": int(top.get("seconds", 0)),
            "now": now_value,
        }
```

- [ ] **Step 4: Run tests, confirm pass**

```powershell
pytest tests/test_api.py -v
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```powershell
git add custom_components/twitch_watchtime/api.py tests/test_api.py
git commit -m "feat: TwitchWatchtimeClient with health/users/snapshot calls"
```

---

## Task 5: Coordinator (`coordinator.py`) — TDD

**Files:**
- Test: `tests/test_coordinator.py`
- Create: `custom_components/twitch_watchtime/coordinator.py`

- [ ] **Step 1: Write the failing tests**

Write `tests/test_coordinator.py`:

```python
"""Tests for TwitchWatchtimeCoordinator."""
from __future__ import annotations

from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import UpdateFailed

from custom_components.twitch_watchtime.api import (
    TwitchWatchtimeAuthError,
    TwitchWatchtimeConnectionError,
)
from custom_components.twitch_watchtime.coordinator import TwitchWatchtimeCoordinator


SNAPSHOT = {
    "today_seconds": 1800,
    "week_seconds": 7200,
    "all_seconds": 360000,
    "top_channel": "cinna",
    "top_channel_seconds": 1200,
    "now": {
        "ts": 1700000000,
        "channel": "cinna",
        "category": "Just Chatting",
        "title": "test stream",
        "twitch_user": "jwsoat",
    },
}


def _mock_client(snapshot=None, raises=None):
    client = AsyncMock()
    if raises is not None:
        client.async_fetch_snapshot.side_effect = raises
    else:
        client.async_fetch_snapshot.return_value = snapshot or SNAPSHOT
    return client


async def test_coordinator_returns_snapshot_on_success(hass: HomeAssistant) -> None:
    client = _mock_client()
    coord = TwitchWatchtimeCoordinator(
        hass, client=client, user="jwsoat", scan_interval=timedelta(seconds=60)
    )
    data = await coord._async_update_data()
    assert data == SNAPSHOT
    client.async_fetch_snapshot.assert_awaited_once_with(user="jwsoat")


async def test_coordinator_passes_none_for_all_accounts(hass: HomeAssistant) -> None:
    client = _mock_client()
    coord = TwitchWatchtimeCoordinator(
        hass, client=client, user=None, scan_interval=timedelta(seconds=60)
    )
    await coord._async_update_data()
    client.async_fetch_snapshot.assert_awaited_once_with(user=None)


async def test_coordinator_raises_auth_failed_on_401(hass: HomeAssistant) -> None:
    client = _mock_client(raises=TwitchWatchtimeAuthError("401"))
    coord = TwitchWatchtimeCoordinator(
        hass, client=client, user="jwsoat", scan_interval=timedelta(seconds=60)
    )
    with pytest.raises(ConfigEntryAuthFailed):
        await coord._async_update_data()


async def test_coordinator_raises_update_failed_on_connection_error(hass: HomeAssistant) -> None:
    client = _mock_client(raises=TwitchWatchtimeConnectionError("timeout"))
    coord = TwitchWatchtimeCoordinator(
        hass, client=client, user="jwsoat", scan_interval=timedelta(seconds=60)
    )
    with pytest.raises(UpdateFailed):
        await coord._async_update_data()
```

- [ ] **Step 2: Run tests, confirm failure**

```powershell
pytest tests/test_coordinator.py -v
```

Expected: `ImportError: cannot import name 'TwitchWatchtimeCoordinator'`.

- [ ] **Step 3: Implement `coordinator.py`**

Write `custom_components/twitch_watchtime/coordinator.py`:

```python
"""DataUpdateCoordinator for the twitch_watchtime integration."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import (
    TwitchWatchtimeAuthError,
    TwitchWatchtimeClient,
    TwitchWatchtimeConnectionError,
)
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class TwitchWatchtimeCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Polls the backend and exposes the merged snapshot to entities."""

    def __init__(
        self,
        hass: HomeAssistant,
        *,
        client: TwitchWatchtimeClient,
        user: str | None,
        scan_interval: timedelta,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{user or 'all_accounts'}",
            update_interval=scan_interval,
        )
        self._client = client
        self._user = user

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await self._client.async_fetch_snapshot(user=self._user)
        except TwitchWatchtimeAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except TwitchWatchtimeConnectionError as err:
            raise UpdateFailed(str(err)) from err
```

- [ ] **Step 4: Run tests, confirm pass**

```powershell
pytest tests/test_coordinator.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```powershell
git add custom_components/twitch_watchtime/coordinator.py tests/test_coordinator.py
git commit -m "feat: TwitchWatchtimeCoordinator (DataUpdateCoordinator)"
```

---

## Task 6: Config flow (`config_flow.py`) — TDD

**Files:**
- Test: `tests/test_config_flow.py`
- Create: `custom_components/twitch_watchtime/config_flow.py`

- [ ] **Step 1: Write the failing tests**

Write `tests/test_config_flow.py`:

```python
"""Tests for the twitch_watchtime config flow."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.twitch_watchtime.const import (
    CONF_API_KEY,
    CONF_HOST,
    CONF_USER,
    DOMAIN,
    USER_ALL,
)


HOST = "http://watchtime.test:8765"
KEY = "secret"


async def _drive_step1(hass: HomeAssistant, mock_backend) -> dict:
    """Drive step 1 of the config flow with a healthy backend."""
    mock_backend.get(f"{HOST}/health", payload={"ok": True, "interval": 60})
    mock_backend.get(
        f"{HOST}/stats/users",
        payload={"users": [{"user": "jwsoat", "last_ts": 1700000000, "count": 42}]},
    )
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"
    return await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: HOST, CONF_API_KEY: KEY}
    )


async def test_full_happy_path_creates_entry(hass: HomeAssistant, mock_backend, enable_custom_integrations) -> None:
    step2 = await _drive_step1(hass, mock_backend)
    assert step2["type"] == FlowResultType.FORM
    assert step2["step_id"] == "account"

    result = await hass.config_entries.flow.async_configure(
        step2["flow_id"], {CONF_USER: "jwsoat"}
    )
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["title"] == "jwsoat"
    assert result["data"] == {CONF_HOST: HOST, CONF_API_KEY: KEY, CONF_USER: "jwsoat"}


async def test_all_accounts_creates_entry_with_sentinel(hass: HomeAssistant, mock_backend, enable_custom_integrations) -> None:
    step2 = await _drive_step1(hass, mock_backend)
    result = await hass.config_entries.flow.async_configure(
        step2["flow_id"], {CONF_USER: USER_ALL}
    )
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["title"] == "All accounts"
    assert result["data"][CONF_USER] == USER_ALL


async def test_cannot_connect_on_health_failure(hass: HomeAssistant, mock_backend, enable_custom_integrations) -> None:
    import aiohttp
    mock_backend.get(f"{HOST}/health", exception=aiohttp.ClientConnectorError(None, OSError()))
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: HOST, CONF_API_KEY: KEY}
    )
    assert result["type"] == FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}


async def test_invalid_auth_on_401(hass: HomeAssistant, mock_backend, enable_custom_integrations) -> None:
    mock_backend.get(f"{HOST}/health", payload={"ok": True, "interval": 60})
    mock_backend.get(f"{HOST}/stats/users", status=401, payload={"detail": "bad api key"})
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: HOST, CONF_API_KEY: "wrong"}
    )
    assert result["type"] == FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}


async def test_duplicate_unique_id_aborts(hass: HomeAssistant, mock_backend, enable_custom_integrations) -> None:
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    existing = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_HOST: HOST, CONF_API_KEY: KEY, CONF_USER: "jwsoat"},
        unique_id=f"{HOST}:jwsoat",
    )
    existing.add_to_hass(hass)

    step2 = await _drive_step1(hass, mock_backend)
    result = await hass.config_entries.flow.async_configure(
        step2["flow_id"], {CONF_USER: "jwsoat"}
    )
    assert result["type"] == FlowResultType.ABORT
    assert result["reason"] == "already_configured"
```

- [ ] **Step 2: Run tests, confirm failure**

```powershell
pytest tests/test_config_flow.py -v
```

Expected: ImportError / `Invalid handler specified` — the flow doesn't exist.

- [ ] **Step 3: Implement `config_flow.py`**

Write `custom_components/twitch_watchtime/config_flow.py`:

```python
"""Config flow for twitch_watchtime."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import homeassistant.helpers.config_validation as cv

from .api import (
    TwitchWatchtimeAuthError,
    TwitchWatchtimeClient,
    TwitchWatchtimeConnectionError,
)
from .const import (
    CONF_API_KEY,
    CONF_HOST,
    CONF_USER,
    DEFAULT_IDLE_TIMEOUT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    MAX_SCAN_INTERVAL,
    MIN_SCAN_INTERVAL,
    OPT_IDLE_TIMEOUT,
    OPT_SCAN_INTERVAL,
    USER_ALL,
)

_LOGGER = logging.getLogger(__name__)

STEP_USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): cv.string,
        vol.Required(CONF_API_KEY): cv.string,
    }
)


class TwitchWatchtimeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Two-step setup: validate host+key, then pick a user."""

    VERSION = 1

    def __init__(self) -> None:
        self._host: str | None = None
        self._api_key: str | None = None
        self._users: list[dict[str, Any]] = []

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].rstrip("/")
            api_key = user_input[CONF_API_KEY]
            session = async_get_clientsession(self.hass)
            client = TwitchWatchtimeClient(host=host, api_key=api_key, session=session)
            try:
                await client.async_check_health()
                self._users = await client.async_get_users()
            except TwitchWatchtimeAuthError:
                errors["base"] = "invalid_auth"
            except TwitchWatchtimeConnectionError:
                errors["base"] = "cannot_connect"
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Unexpected error validating watchtime backend")
                errors["base"] = "unknown"
            else:
                self._host = host
                self._api_key = api_key
                return await self.async_step_account()

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_SCHEMA,
            errors=errors,
        )

    async def async_step_account(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            assert self._host is not None
            assert self._api_key is not None
            chosen = user_input[CONF_USER]
            unique = f"{self._host}:{chosen}"
            await self.async_set_unique_id(unique)
            self._abort_if_unique_id_configured()
            title = "All accounts" if chosen == USER_ALL else chosen
            return self.async_create_entry(
                title=title,
                data={CONF_HOST: self._host, CONF_API_KEY: self._api_key, CONF_USER: chosen},
            )

        # Build the dropdown: All accounts + each known user
        options: dict[str, str] = {USER_ALL: "All accounts"}
        for u in self._users:
            label = (
                f"{u['user']} — {u['count']} entries"
                if u.get("count") is not None
                else u["user"]
            )
            options[u["user"]] = label

        return self.async_show_form(
            step_id="account",
            data_schema=vol.Schema({vol.Required(CONF_USER): vol.In(options)}),
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> TwitchWatchtimeOptionsFlow:
        return TwitchWatchtimeOptionsFlow(config_entry)


class TwitchWatchtimeOptionsFlow(config_entries.OptionsFlow):
    """Lets the user tweak scan interval and idle timeout after install."""

    def __init__(self, entry: config_entries.ConfigEntry) -> None:
        self.entry = entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        opts = self.entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    OPT_SCAN_INTERVAL,
                    default=opts.get(OPT_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                ): vol.All(int, vol.Range(min=MIN_SCAN_INTERVAL, max=MAX_SCAN_INTERVAL)),
                vol.Required(
                    OPT_IDLE_TIMEOUT,
                    default=opts.get(OPT_IDLE_TIMEOUT, DEFAULT_IDLE_TIMEOUT),
                ): vol.All(int, vol.Range(min=30, max=600)),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
```

- [ ] **Step 4: Run tests, confirm pass**

```powershell
pytest tests/test_config_flow.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```powershell
git add custom_components/twitch_watchtime/config_flow.py tests/test_config_flow.py
git commit -m "feat: two-step config flow + options flow"
```

---

## Task 7: Integration entry point (`__init__.py`)

**Files:**
- Modify: `custom_components/twitch_watchtime/__init__.py`

Wires the coordinator to the config entry, forwards to the sensor + binary_sensor platforms, and handles unload + options-change reload.

- [ ] **Step 1: Replace the empty `__init__.py`**

Write `custom_components/twitch_watchtime/__init__.py`:

```python
"""The twitch_watchtime integration."""
from __future__ import annotations

from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TwitchWatchtimeClient
from .const import (
    CONF_API_KEY,
    CONF_HOST,
    CONF_USER,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    OPT_SCAN_INTERVAL,
    PLATFORMS,
    USER_ALL,
)
from .coordinator import TwitchWatchtimeCoordinator


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up a config entry: create client + coordinator, forward to platforms."""
    host = entry.data[CONF_HOST]
    api_key = entry.data[CONF_API_KEY]
    user = entry.data[CONF_USER]
    user_param: str | None = None if user == USER_ALL else user

    scan_interval = entry.options.get(OPT_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)

    session = async_get_clientsession(hass)
    client = TwitchWatchtimeClient(host=host, api_key=api_key, session=session)
    coordinator = TwitchWatchtimeCoordinator(
        hass,
        client=client,
        user=user_param,
        scan_interval=timedelta(seconds=scan_interval),
    )
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unloaded


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options change so the new scan interval takes effect."""
    await hass.config_entries.async_reload(entry.entry_id)
```

- [ ] **Step 2: Smoke-check by running the full test suite**

```powershell
pytest -v
```

Expected: all 16 tests still pass (api: 7, coordinator: 4, config_flow: 5).

- [ ] **Step 3: Commit**

```powershell
git add custom_components/twitch_watchtime/__init__.py
git commit -m "feat: integration entry point and platform forwarding"
```

---

## Task 8: Sensor platform (`sensor.py`)

**Files:**
- Create: `custom_components/twitch_watchtime/sensor.py`

Five sensors per config entry: three duration sensors (today/week/all) with `state_class: total_increasing`, plus `now_watching` (string) and `top_channel` (string).

- [ ] **Step 1: Write `sensor.py`**

```python
"""Sensor platform for twitch_watchtime."""
from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    CONF_HOST,
    CONF_USER,
    DOMAIN,
    MANUFACTURER,
    MODEL,
    USER_ALL,
)
from .coordinator import TwitchWatchtimeCoordinator


def _fmt_duration(seconds: int) -> str:
    if not seconds:
        return "0m"
    hours, rem = divmod(int(seconds), 3600)
    minutes = rem // 60
    if hours == 0:
        return f"{minutes}m"
    return f"{hours}h {minutes}m"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: TwitchWatchtimeCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            WatchtimeDurationSensor(coordinator, entry, "today", "Watchtime today"),
            WatchtimeDurationSensor(coordinator, entry, "week", "Watchtime week"),
            WatchtimeDurationSensor(coordinator, entry, "all", "Watchtime all"),
            WatchtimeNowWatchingSensor(coordinator, entry),
            WatchtimeTopChannelSensor(coordinator, entry),
        ]
    )


def _device_info(entry: ConfigEntry) -> DeviceInfo:
    user = entry.data[CONF_USER]
    name = "All accounts" if user == USER_ALL else user
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=name,
        manufacturer=MANUFACTURER,
        model=MODEL,
        configuration_url=entry.data[CONF_HOST],
    )


class _BaseWatchtimeEntity(CoordinatorEntity[TwitchWatchtimeCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: TwitchWatchtimeCoordinator, entry: ConfigEntry, key: str, name: str) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_name = name
        self._attr_device_info = _device_info(entry)


class WatchtimeDurationSensor(_BaseWatchtimeEntity, SensorEntity):
    """today / week / all duration sensors."""

    _attr_device_class = SensorDeviceClass.DURATION
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS

    def __init__(
        self,
        coordinator: TwitchWatchtimeCoordinator,
        entry: ConfigEntry,
        window: str,
        name: str,
    ) -> None:
        super().__init__(coordinator, entry, window, name)
        self._window = window

    @property
    def native_value(self) -> int:
        return int(self.coordinator.data.get(f"{self._window}_seconds", 0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data
        attrs: dict[str, Any] = {"formatted": _fmt_duration(self.native_value)}
        if self._window == "today":
            attrs["top_channel"] = data.get("top_channel")
            attrs["top_channel_seconds"] = data.get("top_channel_seconds", 0)
        return attrs


class WatchtimeNowWatchingSensor(_BaseWatchtimeEntity, SensorEntity):
    """Current channel name or 'idle'."""

    _attr_icon = "mdi:television-play"

    def __init__(self, coordinator: TwitchWatchtimeCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "now_watching", "Watchtime now watching")

    @property
    def native_value(self) -> str:
        now = self.coordinator.data.get("now")
        if not now:
            return "idle"
        return now.get("channel") or "idle"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        now = self.coordinator.data.get("now") or {}
        return {
            "category": now.get("category"),
            "title": now.get("title"),
            "started_at": now.get("ts"),
            "twitch_user": now.get("twitch_user"),
        }


class WatchtimeTopChannelSensor(_BaseWatchtimeEntity, SensorEntity):
    """Top channel today (string)."""

    _attr_icon = "mdi:crown"

    def __init__(self, coordinator: TwitchWatchtimeCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "top_channel", "Watchtime top channel")

    @property
    def native_value(self) -> str:
        return self.coordinator.data.get("top_channel") or "none"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        seconds = int(self.coordinator.data.get("top_channel_seconds", 0))
        return {"seconds": seconds, "formatted": _fmt_duration(seconds)}
```

- [ ] **Step 2: Verify no syntax errors and tests still pass**

```powershell
pytest -v
```

Expected: 16 PASS (sensor.py isn't directly tested but pytest collection imports it).

- [ ] **Step 3: Commit**

```powershell
git add custom_components/twitch_watchtime/sensor.py
git commit -m "feat: sensor platform with 5 entities (today/week/all/now/top)"
```

---

## Task 9: Binary sensor platform (`binary_sensor.py`)

**Files:**
- Create: `custom_components/twitch_watchtime/binary_sensor.py`

- [ ] **Step 1: Write `binary_sensor.py`**

```python
"""Binary sensor platform for twitch_watchtime."""
from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import TwitchWatchtimeCoordinator
from .sensor import _device_info  # reuse the helper


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: TwitchWatchtimeCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([WatchtimeActiveBinarySensor(coordinator, entry)])


class WatchtimeActiveBinarySensor(
    CoordinatorEntity[TwitchWatchtimeCoordinator], BinarySensorEntity
):
    _attr_has_entity_name = True
    _attr_name = "Watchtime active"
    _attr_device_class = BinarySensorDeviceClass.RUNNING
    _attr_icon = "mdi:circle-medium"

    def __init__(self, coordinator: TwitchWatchtimeCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_active"
        self._attr_device_info = _device_info(entry)

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.get("now") is not None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        now = self.coordinator.data.get("now") or {}
        return {
            "channel": now.get("channel"),
            "category": now.get("category"),
            "title": now.get("title"),
        }
```

- [ ] **Step 2: Verify**

```powershell
pytest -v
```

Expected: 16 PASS.

- [ ] **Step 3: Commit**

```powershell
git add custom_components/twitch_watchtime/binary_sensor.py
git commit -m "feat: binary_sensor.<prefix>_watchtime_active"
```

---

## Task 10: UI strings + translations

**Files:**
- Create: `custom_components/twitch_watchtime/strings.json`
- Create: `custom_components/twitch_watchtime/translations/en.json`

- [ ] **Step 1: Write `strings.json`**

```json
{
  "config": {
    "step": {
      "user": {
        "title": "Connect to your watchtime backend",
        "description": "Paste the URL of your FastAPI backend and the API key.",
        "data": {
          "host": "Host URL",
          "api_key": "API key"
        }
      },
      "account": {
        "title": "Choose an account to track",
        "description": "Pick the Twitch login this entry should follow, or 'All accounts' to pool everything.",
        "data": {
          "user": "Account"
        }
      }
    },
    "error": {
      "cannot_connect": "Couldn't reach the backend.",
      "invalid_auth": "API key was rejected.",
      "unknown": "Unexpected error — check Home Assistant logs."
    },
    "abort": {
      "already_configured": "This account is already configured on this host."
    }
  },
  "options": {
    "step": {
      "init": {
        "title": "Options",
        "data": {
          "scan_interval": "Scan interval (seconds)",
          "idle_timeout": "Idle timeout (seconds)"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Copy to `translations/en.json`** (identical content)

```json
{
  "config": {
    "step": {
      "user": {
        "title": "Connect to your watchtime backend",
        "description": "Paste the URL of your FastAPI backend and the API key.",
        "data": {
          "host": "Host URL",
          "api_key": "API key"
        }
      },
      "account": {
        "title": "Choose an account to track",
        "description": "Pick the Twitch login this entry should follow, or 'All accounts' to pool everything.",
        "data": {
          "user": "Account"
        }
      }
    },
    "error": {
      "cannot_connect": "Couldn't reach the backend.",
      "invalid_auth": "API key was rejected.",
      "unknown": "Unexpected error — check Home Assistant logs."
    },
    "abort": {
      "already_configured": "This account is already configured on this host."
    }
  },
  "options": {
    "step": {
      "init": {
        "title": "Options",
        "data": {
          "scan_interval": "Scan interval (seconds)",
          "idle_timeout": "Idle timeout (seconds)"
        }
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```powershell
git add custom_components/twitch_watchtime/strings.json custom_components/twitch_watchtime/translations
git commit -m "feat: UI strings and en translations"
```

---

## Task 11: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Twitch Watchtime — Home Assistant Integration

Home Assistant custom integration for the self-hosted
[twitch-watchtime](https://github.com/jwsoat/twitch-watchtime) backend. Tracks
Twitch watch time per account and exposes it as Home Assistant sensors you can
graph, automate, and put on a dashboard.

## What you get (per Twitch account)

| Entity | What |
|---|---|
| `sensor.<prefix>_watchtime_today` | seconds watched today (state class `total_increasing`) |
| `sensor.<prefix>_watchtime_week` | seconds watched in the last 7 days |
| `sensor.<prefix>_watchtime_all` | total seconds watched all-time |
| `sensor.<prefix>_watchtime_now_watching` | current channel name, or `idle` |
| `sensor.<prefix>_watchtime_top_channel` | the channel with the most watch time today |
| `binary_sensor.<prefix>_watchtime_active` | `on` whenever the backend saw a heartbeat in the last 2 minutes |

`<prefix>` is the Twitch login (or `all_accounts` if the entry is set to pool everything).

## Requirements

- Home Assistant Core 2024.10 or newer.
- A running [twitch-watchtime](https://github.com/jwsoat/twitch-watchtime) backend (FastAPI on Proxmox or similar) reachable from your HA host.
- The API key you've configured for that backend.

## Install via HACS (custom repository)

1. In Home Assistant, open **HACS**.
2. Click the 3-dot menu (top-right) → **Custom repositories**.
3. Paste `https://github.com/jwsoat/twitch-watchtime-ha`, category **Integration**, click **Add**.
4. Back in HACS, search for **Twitch Watchtime**, click it → **Download**.
5. Restart Home Assistant.

## Add the integration

1. **Settings → Devices & Services → Add Integration**.
2. Search **Twitch Watchtime**.
3. **Step 1** — paste your backend URL (e.g. `http://192.168.1.100:8765`) and your API key. The integration calls `/health` and `/stats/users` to verify both.
4. **Step 2** — pick an account from the dropdown. Choose `All accounts` to pool everyone (including legacy anonymous heartbeats), or a specific Twitch login.
5. Done. Add the integration again for each Twitch account you want to track separately.

After install, click the entry's **Configure** button to tweak:
- **Scan interval** (default `60`s, range `15`–`600`).
- **Idle timeout** (default `120`s, matching the backend's `/stats/now` window).

## Example automation

Turn the office light purple when you start watching:

```yaml
automation:
  - alias: "Office light purple when watching Twitch"
    trigger:
      - platform: state
        entity_id: binary_sensor.jwsoat_watchtime_active
        to: "on"
    action:
      - service: light.turn_on
        target:
          entity_id: light.office
        data:
          rgb_color: [145, 70, 255]
          brightness_pct: 80
```

## Troubleshooting

- **"Cannot connect"** at install — the backend's `/health` endpoint isn't reachable. Confirm the URL and that your HA host can hit it on the network.
- **"Invalid auth"** — the API key was rejected. Use the same key you put in the dashboard and the Chrome extension.
- **Entities show as `unavailable`** — usually a transient network blip; HA will recover on the next poll. Check **Settings → System → Logs** for `twitch_watchtime` entries.
- **Updates not appearing** — restart Home Assistant after HACS updates the integration.

## License

MIT.
```

- [ ] **Step 2: Commit**

```powershell
git add README.md
git commit -m "docs: README with install instructions and entity table"
```

---

## Task 12: Create the GitHub repo and push

This is the only task that touches a remote. Run interactively; do not delegate to a subagent that might create the wrong repo.

- [ ] **Step 1: Confirm `gh` is authenticated**

```powershell
gh auth status
```

Expected: signed in as your GitHub user. If not, run `gh auth login`.

- [ ] **Step 2: Create the GitHub repo (public, so HACS can clone it)**

```powershell
cd C:\Users\Jwsoat\Documents\Claude\twitch-watchtime-ha
gh repo create twitch-watchtime-ha --public --source=. --remote=origin --description "Home Assistant custom integration for the twitch-watchtime backend"
```

Expected: `https://github.com/<your-user>/twitch-watchtime-ha` printed, `origin` configured.

- [ ] **Step 3: Push the main branch**

```powershell
git push -u origin main
```

Expected: all commits pushed, remote tracking set up.

- [ ] **Step 4: Tag the initial release so HACS picks it up cleanly**

```powershell
git tag v0.1.0
git push origin v0.1.0
```

HACS uses tags as release versions. Without one, it shows "no releases".

- [ ] **Step 5: Manual smoke test in HA**

1. In Home Assistant, **HACS → 3-dot menu → Custom repositories → Add** `https://github.com/<your-user>/twitch-watchtime-ha` (Integration).
2. **HACS → Add → Twitch Watchtime → Download**, then restart HA.
3. **Settings → Devices & Services → Add Integration → Twitch Watchtime**.
4. Step 1: enter `http://192.168.1.100:8765` and your API key.
5. Step 2: pick your Twitch login from the dropdown.
6. Verify: 6 entities appear on the new device (`sensor.<login>_watchtime_today`, etc.).
7. Watch a Twitch stream for ~2 minutes and confirm `binary_sensor.<login>_watchtime_active` flips to `on` and `sensor.<login>_watchtime_now_watching` shows the channel.

If anything misbehaves, **Settings → System → Logs** filtered to `twitch_watchtime` is the first stop.

---

## Self-Review

- **Spec coverage:** Repo layout ✓ (Task 1 + 2 + structure), `hacs.json` + `manifest.json` ✓ (Task 2), config flow with both steps + error states + duplicate guard ✓ (Task 6), options flow ✓ (Task 6), coordinator polling 5 endpoints in parallel with `?user=` ✓ (Tasks 4 + 5), 6 entities per entry with the right device_class/state_class ✓ (Tasks 8 + 9), pytest-homeassistant-custom-component tests for config flow + coordinator ✓ (Tasks 5 + 6), API client also tested ✓ (Task 4), strings + translations ✓ (Task 10), README with install + entity table + automation example ✓ (Task 11).
- **Placeholder scan:** No TBDs, no "implement later" — every step shows code or commands.
- **Type consistency:** `TwitchWatchtimeClient`, `TwitchWatchtimeCoordinator`, `TwitchWatchtimeConfigFlow`, `TwitchWatchtimeOptionsFlow`, `WatchtimeDurationSensor`, `WatchtimeNowWatchingSensor`, `WatchtimeTopChannelSensor`, `WatchtimeActiveBinarySensor` — names match across tasks. `CONF_HOST`, `CONF_API_KEY`, `CONF_USER`, `USER_ALL`, `DOMAIN` are defined in Task 2's `const.py` and reused everywhere. The merged-snapshot dict shape (`today_seconds`, `week_seconds`, `all_seconds`, `top_channel`, `top_channel_seconds`, `now`) is consistent between `api.py` tests (Task 4), the coordinator (Task 5), and both entity platforms (Tasks 8 + 9).
- **Ambiguity:** `USER_ALL` sentinel is the boundary between the config layer (where it's a stored value `"all_accounts"`) and the coordinator (where it becomes `user=None`). The conversion happens once, in `__init__.py:async_setup_entry`.
