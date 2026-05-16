# Privacy Policy — Twitch Watch Time Logger

**Last updated: May 16, 2026**

## What this extension does

Twitch Watch Time Logger tracks which Twitch channels you watch and for how long, then sends that data to a backend API you configure yourself. It does not communicate with any servers operated by the extension author.

## Data collected

While you are on twitch.tv, the extension periodically records:

| Field | Description |
|---|---|
| Channel name | The streamer's username, read from the page URL |
| Stream category | The game/category shown on the stream page |
| Stream title | The current stream title |
| Viewing state | `active`, `passive`, or `audio_only` |
| Twitch username | Your logged-in Twitch account name, auto-detected from the page |
| Timestamp | Unix timestamp of each heartbeat |
| Client ID | A random UUID generated locally to identify your device |

## Where your data goes

All data is sent exclusively to the **API URL you provide** in the extension's settings. This is your own self-hosted server. The extension author never receives, stores, or has access to your data.

## Local storage

The extension stores the following in `chrome.storage.local` on your device:

- Your configured API URL and API key
- Your Twitch username (fallback)
- A locally-generated device client ID
- A temporary queue of unsent heartbeats (capped at 5,000 entries)

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save settings and the local heartbeat queue |
| `alarms` | Flush the heartbeat queue every 30 seconds |
| `twitch.tv` host access | Read channel, category, title, and login state from Twitch pages |

## Data sharing

No data is shared with any third party. The extension has no analytics, telemetry, or external dependencies.

## Contact

For questions, contact info@jwsoat.com.
