# pi-onlyne SPEC

## Scope

Pi extension for Onlyne. Onlyne remains a workspace-local IM broker; this extension owns Pi session lifecycle, watch behavior, message injection, send tools, and a small config surface.

## v1 Decisions

- Watch is configurable; default manual.
- `/onlyne` provides argument completions for its supported subcommands.
- `watch on` connects only to the workspace-local `.onlyne/run/onlyne.sock`; if unavailable, it tells the user to start `onlyne --workspace <root> run`.
- pi-onlyne never owns or launches the daemon. Users handle launchd/systemd/background scripts outside the extension, per workspace.
- Inbound events come from Onlyne `subscribe_events`; no polling.
- Inbound mode is rule-based: `auto-handle`, `queue-only`, or `muted`.
- Outbound defaults to `guarded-explicit`: prefer tool reply, fallback to final text, else send configured error text.
- Send tools default to Markdown and may pass `raw_text: true` to Onlyne for literal text.
- Broadcast sends concurrently with per-target retry and per-target results.
- Loopback inbound messages wake Pi without creating a reply obligation.
- `/handshake` inbound messages are Onlyne control messages and must not be surfaced to Pi as agent work.
- After pi surfaces an inbound follow-up, it calls `mark_io_consumed` so Onlyne FIFO `out_cursor = "consume"` stays synchronized with pi notifications.
- FIFO IO itself remains owned by the Onlyne daemon; pi-onlyne does not open `.onlyne/channels/*/in|out` directly.

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
- `onlyne_send({ channelId, text, rawText? })`
- `onlyne_broadcast({ targets, text, rawText? })`
- `onlyne_loopback({ text, rawText? })`
- `onlyne_mark_no_reply({ reason? })`

## Deferred

- Attachments.
- Auth QR/secret editing TUI.
- Schedules.
- Target groups.
