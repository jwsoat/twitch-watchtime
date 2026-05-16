# Phase 3 — Home Assistant Integration

Custom integration that exposes the twitch-watchtime backend as Home Assistant sensors. Modelled on the Tautulli integration (Plex monitoring), since the shape of the problem is nearly identical: poll a self-hosted REST API and expose useful state as entities.

## Goals

- A HACS-installable custom integration that talks to the FastAPI backend on the Proxmox box.
- One config entry per Twitch account being tracked, so multi-account setups get distinct entities and can drive per-account automations.
- Standard HA patterns: `DataUpdateCoordinator`, async config flow, device per entry, `state_class` set correctly so long-term statistics work.
- Zero new credentials beyond the API key already in use by the extension and dashboard.

## Non-goals (this phase)

- Twitch OAuth-based auth (the API key is the gate; OAuth lives in a later phase if at all).
- Service calls or button entities (no "mark as away" or similar — not useful yet).
- Replicating the dashboard inside HA (the existing web dashboard is the better surface for that).
- Anonymous-only entity tracking — anonymous data is reachable via the "All accounts" option.

## Repo & distribution

**Repo name:** `twitch-watchtime-ha` (independent of `twitch-watchtime`, which holds the backend + extension + dashboard).

**Layout (HACS-compatible):**

```
twitch-watchtime-ha/
├── README.md
├── hacs.json
├── LICENSE
└── custom_components/
    └── twitch_watchtime/
        ├── __init__.py
        ├── manifest.json
        ├── config_flow.py
        ├── const.py
        ├── coordinator.py
        ├── api.py
        ├── sensor.py
        ├── binary_sensor.py
        ├── strings.json
        └── translations/
            └── en.json
```

**Install path (for the README):** HA → HACS → 3-dot menu → Custom repositories → paste `https://github.com/jwsoat/twitch-watchtime-ha` → Integration. Then HACS → Add → "Twitch Watchtime" → Install → restart HA → Settings → Devices & Services → Add Integration → "Twitch Watchtime".

## Config flow

### Step 1 — Connection

Fields:

- `Host URL` — e.g. `http://192.168.1.100:8765`. Validated with a `GET /health` (public, no auth) so a bad host surfaces before a bad key.
- `API Key` — sent as `X-API-Key`. Validated with a `GET /stats/users` so a wrong key surfaces here instead of in the next step.

Errors surfaced:

- `cannot_connect` — connection refused / DNS failure / non-200 on `/health`.
- `invalid_auth` — 401 or 403 on `/stats/users`.
- `unknown` — anything else, with the exception logged.

### Step 2 — Account picker

Dropdown built from the `/stats/users` response plus one pseudo-option:

- `All accounts` — entity prefix `all_accounts`, omits `?user=` in API calls so heartbeats across every Twitch user (including those with NULL `twitch_user`) are pooled.
- Each real Twitch login, formatted as `<login> — N entries — last active 5m ago` for context.
- `Other (type a login)` — reveals a text field so an account that hasn't logged heartbeats yet can be pre-added.

### Entry metadata

- **Title:** the chosen login (or `All accounts`).
- **`unique_id`:** `<host>:<chosen_user>`. Prevents adding the same combo twice while still allowing multiple accounts against the same host.

### Options flow (after install)

- `Scan interval` — seconds, default 60, allowed range 15–600.
- `Idle timeout` — seconds, default 120 (matches the API's `/stats/now` freshness window).

## Coordinator

One `DataUpdateCoordinator` per config entry. Each tick polls the backend in parallel:

| Endpoint | Why |
|---|---|
| `GET /stats/total?window=today` | `today_seconds` |
| `GET /stats/top_channel?window=today` | `top_channel`, `top_channel_seconds` |
| `GET /stats/total?window=week` | `week_seconds` |
| `GET /stats/total?window=all` | `all_seconds` |
| `GET /stats/now` | `now` (object with `channel`, `category`, `title`, `ts`, or `None`) |

All five calls are issued in a single `asyncio.gather`. If the entry is scoped to a specific user, `?user=<login>` is appended to every call. If scoped to `All accounts`, no user param is added.

The coordinator returns a merged dict:

```python
{
    "today_seconds": int,
    "week_seconds": int,
    "all_seconds": int,
    "top_channel": str | None,
    "top_channel_seconds": int,
    "now": {"channel", "category", "title", "ts", "twitch_user"} | None,
}
```

**Failure handling:**

- HTTP 401/403 → raise `ConfigEntryAuthFailed`, which prompts HA to re-run the config flow ("auth re-authentication"). Sensors go unavailable until fixed.
- Timeout / 5xx / unknown error → raise `UpdateFailed`, log the cause. Sensors keep their previous values for one tick; after multiple consecutive failures HA marks them unavailable.

## Entities

Each config entry produces one HA **device** and six entities. The Twitch login (or `all_accounts`) becomes the device name, which HA composes into the entity_id prefix.

**Device info:**

- Name: chosen login (e.g. `jwsoat`) or `All accounts`.
- Manufacturer: `Twitch Watchtime`.
- Model: `Self-hosted`.
- Configuration URL: the host (so the device page links straight to the dashboard).

**Entities:**

| Entity ID | State | Class / unit | Attributes |
|---|---|---|---|
| `sensor.<prefix>_watchtime_today` | seconds today | `duration` / `s`, `state_class: total_increasing` | `formatted` (`"3h 42m"`), `top_channel`, `top_channel_seconds` |
| `sensor.<prefix>_watchtime_week` | seconds this week | `duration` / `s`, `state_class: total_increasing` | `formatted` |
| `sensor.<prefix>_watchtime_all` | seconds all-time | `duration` / `s`, `state_class: total_increasing` | `formatted` |
| `sensor.<prefix>_watchtime_now_watching` | channel name or `"idle"` | — | `category`, `title`, `started_at` (ts of latest heartbeat), `twitch_user` |
| `sensor.<prefix>_watchtime_top_channel` | top channel today (string or `"none"`) | — | `seconds`, `formatted` |
| `binary_sensor.<prefix>_watchtime_active` | `on` if `/stats/now` returned a hit | `device_class: running` | `channel`, `category`, `title` |

**Unique IDs:** `<config_entry_id>_<sensor_key>` — survives renaming the entry title.

**State class:** the three duration sensors use `total_increasing` so HA's long-term statistics (the Energy-style daily graph) work. The two string sensors and the binary sensor don't need a state class.

## Manifest

HA's `manifest.json`:

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

`hacs.json`:

```json
{
  "name": "Twitch Watchtime",
  "content_in_root": false,
  "render_readme": true,
  "homeassistant": "2024.10.0"
}
```

**HTTP client:** HA's shared `aiohttp_client` (no extra `requirements`).

**HA version target:** `>= 2024.10` (covers the recent entity-naming and config-flow APIs).

## Testing

Two focused unit tests using `pytest-homeassistant-custom-component`:

1. **Config flow happy path** — mock the backend to return success on `/health` and a list of users on `/stats/users`, drive the flow through both steps, assert a config entry is created with the right `unique_id` and `data`.
2. **Coordinator merge** — mock the five endpoint responses with `aioresponses`, run one coordinator update, assert the merged dict has all expected keys with the expected values.

Full sensor entity wiring tests are skipped — manual smoke testing in a real HA instance is faster for a single-user personal tool. We can add them later if a refactor needs the safety net.

## README contents

- Short pitch (what it is, screenshot of one sensor card).
- Install steps (custom HACS repo URL + the in-HA add flow).
- Config flow screenshots.
- Entity table.
- Example automation: "turn the office light purple when watching."
- Troubleshooting (re-auth on key change, restarting HA to pick up updates).

## Out of scope

- Twitch OAuth — Phase 2.5 backend work first.
- Service calls / buttons / number entities.
- Recreating the dashboard inside HA.
- Anonymous-only entity tracking (use `All accounts` instead — it includes anonymous data).
