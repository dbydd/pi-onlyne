# pi-onlyne SPEC

## Scope

Pi extension for Onlyne. Onlyne remains a workspace-local IM broker; this extension owns Pi session lifecycle, watch behavior, message injection, send tools, and a small config surface.

## v1 Decisions

- Watch is configurable; default manual.
- `watch on` first connects to existing `.onlyne/run/onlyne.sock`; if unavailable, spawns `onlyne --workspace <root> run`.
- Extension-owned daemon is killed on `watch off`, `session_shutdown`, or process signal.
- Inbound events come from Onlyne `subscribe_events`; no polling.
- Inbound mode is rule-based: `auto-handle`, `queue-only`, or `muted`.
- Outbound defaults to `guarded-explicit`: prefer tool reply, fallback to final text, else send configured error text.
- v1 sends plain text only.
- Broadcast sends concurrently with per-target retry and per-target results.

## Config

Stored in project `.pi/onlyne.json`:

```json
{
  "watch": { "autoStart": false },
  "inbound": { "defaultMode": "auto-handle", "rules": [] },
  "outbound": {
    "defaultReplyMode": "guarded-explicit",
    "guardedExplicit": { "reminders": 2, "noOutputFallbackText": "Onlyne/Pi error: no valid reply was produced." },
    "retry": { "attempts": 2, "concurrency": 8 }
  }
}
```

## Tools

- `onlyne_reply({ text })`
- `onlyne_send({ channelId, conversationId, text })`
- `onlyne_broadcast({ targets, text })`
- `onlyne_mark_no_reply({ reason? })`

## Deferred

- Rich text and attachments.
- Auth QR/secret editing TUI.
- Schedules.
- Target groups.
