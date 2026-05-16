# Phase 2 — Custom Dashboard

Design spec for a self-hosted, live-updating dashboard built on top of the Phase 1 heartbeat backend.

## Goals

- A responsive desktop+mobile dashboard at `/` that surfaces "right now" stats, trends over time, and all-time rankings — equal weight to each.
- A separate ambient/scoreboard view at `/tv` designed to be read from across a room: persistent scoreboard plus auto-rotating panels.
- Stats scopeable per Twitch account (the user has multiple) with foundations laid for full Twitch OAuth in a later phase.
- Single self-hosted container, no external infra beyond the existing FastAPI + SQLite on Proxmox.

## Non-goals (this phase)

- Twitch OAuth ("Sign in with Twitch"). The data model is prepared for it; the UI gate stays an API-key paste for now.
- Historical analytics features (watch streaks, hour-of-day heatmaps, channel comparisons). These can land later without schema change.
- Real-time push (SSE / WebSockets). Polling is sufficient given heartbeats only land every 60s.
- Mobile-first redesign. The dashboard is desktop-primary with mobile as a stack-friendly fallback.

## Architecture

- **Single container.** Phase 1's FastAPI service additionally serves static assets and two HTML pages:
  - `GET /` → `static/index.html` (main dashboard)
  - `GET /tv` → `static/tv.html` (ambient view)
  - `app.mount("/static", StaticFiles(directory="static"))` for CSS/JS.
- **Polling.** Main dashboard polls API endpoints every 10s. TV scoreboard polls every 30s; the TV panel rotator runs independently on a 15s timer.
- **Auth gate.** First visit to `/` shows a "Paste API key" screen. Key persists in `localStorage` and is sent as `X-API-Key` on every fetch (mirrors the extension's options page UX).
- **Account scoping.** Every stats endpoint accepts an optional `?user=<twitch_login>` query param. The dashboard shows an account-picker dropdown sourced from `/stats/users`; default selection is the account with the most recent heartbeat. "All accounts" is also available.
- **Future-proofed for OAuth.** The `twitch_user` column is the foundation. Layering "Sign in with Twitch" later means adding an OAuth flow, deriving `user` from session instead of a dropdown, and gating stats by `WHERE twitch_user = <session_user>`. No data migration required at that time.

## Visual design

Twitch-inspired surfaces, Stats.fm-influenced layout language.

**Palette**

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#0e0e10` | Page background |
| `--surface` | `#18181b` | Cards |
| `--surface-2` | `#1f1f23` | Elevated surfaces / hovers |
| `--border` | `#2f2f35` | Card borders |
| `--purple` | `#9146FF` | Primary accent |
| `--purple-hover` | `#772ce8` | Hover state |
| `--hero-grad` | `linear-gradient(135deg, #9146FF, #5c16c5)` | Hero card background |
| `--text` | `#efeff1` | Primary text |
| `--muted` | `#adadb8` | Secondary text |
| `--live` | `#eb0400` | Live indicator dot |

**Typography**

- Body: `Inter` (Google Fonts), the closest free analog to Twitch's proprietary Roobert.
- Numbers / durations: `JetBrains Mono` (Google Fonts) — used for stat callouts, hour counts, and timestamps.

**Layout language**

- 12px rounded card corners.
- Gradient purple hero card.
- Time-range pill tabs (Today / Week / All-time) — Stats.fm style.
- Ranked lists with numbered rank, a colored initial (placeholder for Twitch profile pic in a later iteration), and a thin horizontal bar showing relative share within the list.
- Subtle hover lift on cards (1–2px translate, slightly brighter border).

## Main dashboard layout (`/`)

**Top bar**

- Wordmark "Watchtime" on the left.
- Account picker dropdown on the right: `Viewing: <login> ▾`. Options come from `/stats/users` plus "All accounts."

**Hero card (full-width, gradient purple)**

- Left: today's total watch time as a huge mono number (e.g. `3h 42m`).
- Right: "Top today" — channel name + hours watched today.
- If `/stats/now` returns a hit (heartbeat in last 120s): small `● Now watching <channel>` indicator in the corner.

**Time-range pills** below the hero: `Today` / `Week` / `All-time`. Selection updates the data in the two-column grid below; daily chart and quick stats stay independent.

**Two-column grid (collapses to single column on mobile)**

| Left | Right |
|---|---|
| **Top channels** — ranked list of 1–10 channels for the selected window. Row layout: `#N • <initial-avatar> <channelname> ───── <hours>` with the dash being a thin share bar. | **Daily chart** — Chart.js bar chart, last 30 days, seconds-per-day. Always shows 30 days regardless of pill selection. |
| **Quick stats** — three mini cards: total hours all-time, distinct channels watched all-time, longest day (most hours in a single calendar day). | **Recently watched** — last 5 distinct channels (dedup by channel name, keep latest `ts`) with their last-watched timestamp. |

**Mobile order:** hero → pills → top channels → daily chart → quick stats → recently watched.

## TV / ambient view (`/tv`)

- Full-screen, no scrollbars, no chrome. Cursor auto-hides after a few seconds of idle.
- Account: defaults to the most-recently-active account; overridable via `/tv?user=<login>`.

**Persistent header strip ("the scoreboard," always visible)**

- Huge `TODAY` stat (mono, ~120pt).
- Adjacent: `TOP TODAY` — channel + hours.
- Right side: live `● NOW WATCHING <channel>` if active in last 120s; otherwise muted `IDLE`.

**Rotating panel below, ~15s per panel, soft fade transition**

1. **Top channels this week** — top 5, large, ranked, hours.
2. **Daily chart** — last 14 days, larger axis labels.
3. **All-time leaderboard** — top 10 channels, ranked.
4. **Category breakdown** — top 5 categories by hours this week.

A row of 4 dot indicators at the bottom shows the active panel (Stats.fm-style).

Polling: scoreboard fetches every 30s; panel rotation is on an independent 15s timer.

## Backend / API changes

### DB migration

Idempotent at startup, alongside the existing `CREATE TABLE IF NOT EXISTS`:

```sql
ALTER TABLE heartbeats ADD COLUMN twitch_user TEXT;
```

Wrapped in a check so it only runs when the column is missing. Old rows stay `NULL` and bucket as "anonymous" in queries.

### Existing endpoints — new optional `user` filter

All of these gain `?user=<login>`:

- `GET /stats/today`
- `GET /stats/week`
- `GET /stats/all`
- `GET /stats/daily`
- `GET /stats/top_channel`
- `GET /stats/total`

Semantics:

- Omit `user` → all accounts pooled.
- `user=<login>` → `WHERE twitch_user = <login>`.
- `user=anonymous` → `WHERE twitch_user IS NULL`.

### New endpoints

| Method & Path | Returns |
|---|---|
| `GET /stats/now?user=<login>` | Most recent heartbeat in last 120s as `{channel, category, title, ts, twitch_user}`, or `{now: null}` if none. |
| `GET /stats/users` | Distinct Twitch logins with last-activity timestamp and total heartbeat count: `[{user, last_ts, count}, …]`. Powers the account dropdown. `null` is reported as `"anonymous"`. |
| `GET /stats/categories?window=&user=` | Top 5 categories by seconds for window (`today`/`week`/`all`). |
| `GET /stats/recent?user=&limit=5` | Last N distinct channels with their last-watched timestamp. |

All new endpoints require `X-API-Key`.

### Static file serving

```
api/
├── main.py
├── requirements.txt
├── Dockerfile
└── static/
    ├── index.html
    ├── tv.html
    ├── app.js
    ├── tv.js
    └── styles.css
```

FastAPI:

```python
app.mount("/static", StaticFiles(directory="static"))

@app.get("/")
def root():
    return FileResponse("static/index.html")

@app.get("/tv")
def tv():
    return FileResponse("static/tv.html")
```

Chart.js is pulled from CDN inside the HTML (`https://cdn.jsdelivr.net/npm/chart.js`) — no build step, no vendoring.

## Extension changes

`content.js`:

```js
function getTwitchUser() {
  try {
    const raw = localStorage.getItem("twilight.user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.login ?? null;
  } catch {
    return null;
  }
}
```

The returned login is included in each heartbeat payload as `twitch_user`. When the user is logged out (or the read fails), the field is `null`.

`api/main.py` `Heartbeat` Pydantic model gains:

```python
twitch_user: Optional[str] = Field(default=None, max_length=64)
```

INSERT statements add the column.

## Auth model

- API key remains the single source of truth for the dashboard and the extension.
- Dashboard gate: `localStorage.getItem("apiKey")` — if missing, show paste screen. On success, store. Logout button clears the key.
- Same key gates `/`, `/tv`, and all `/stats/*` endpoints. `/health` remains open.

## Future extension — Twitch OAuth (Phase 2.5 or later)

When ready to layer in real auth:

1. Register a Twitch dev app, store `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` in `.env`.
2. Add `/auth/twitch/login` (redirects to Twitch) and `/auth/twitch/callback` (exchanges code, sets HTTP-only session cookie).
3. Replace the API-key gate with a `Sign in with Twitch` button.
4. Stats endpoints derive `user` from the session, ignoring/forbidding the `?user=` param for cross-account viewing (or restrict it to "yourself").
5. The account dropdown disappears (or becomes admin-only).

No DB migration required at that time — `twitch_user` is already the join key.

## Out of scope

- Streaming categories per channel breakdown beyond the TV panel.
- Goal-setting / notifications / "you watched too much today" features.
- Multi-tenant: this is a single-user-multi-account tool. No `account_owner` column.
- Export / CSV download.

## Testing

- Backend: unit tests against an in-memory SQLite confirm `?user=` filtering, the new endpoints' shapes, and that the migration is idempotent across startups.
- Frontend: manual visual QA on desktop (Chrome) and mobile-sized viewport. TV view smoke-tested on a 1080p display.
