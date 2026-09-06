# pi-onlyne SPEC

## Scope

Pi extension for Onlyne. Onlyne remains a workspace-local IM broker; this extension owns Pi session lifecycle, watch behavior, message injection, send tools, and a small config surface.

## v1 Decisions

- Watch is configurable; default manual.
- `/onlyne` provides argument completions for its supported subcommands, including daemon lifecycle commands.
- `watch on` connects to the workspace-local `.onlyne/run/onlyne.sock`; if unavailable, it starts a Pi-owned workspace daemon.
- `/onlyne daemon start|stop|restart` is the preferred lifecycle surface. Agents must not use ad-hoc `nohup onlyne run`, `pkill -f 'onlyne run'`, or global launchd/systemd jobs when pi-onlyne owns the daemon.
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

## Swarm mode (v2)

- Switch: `/onlyne swarm on|off|status`. On/off persists to the workspace
  `.onlyne/config.toml` `[swarm] enabled` flag and restarts watch. Status line
  and `session_start` banner report `swarm` vs `ready`.
- When swarm is on, generic in/out auto-handling is disabled: the scheduler owns
  input/output. Only loopback messages carrying a `---swarm` body header enter
  the session, via the `followUp` task queue.
- Session model: one session carries exactly one task (atomic slot). A new
  header claims the slot; headers with matching `reply_to`/`task_id` arrive as
  followUp callbacks for the suspended parent; headers for other tasks while
  busy are ignored with an `[onlyne-internal]` notice.
- Startup handshake: swarm watch sends the `swarm_ready` op
  (`{workspace, terminal_handle}`) so the scheduler can match a pending task.
  `ONLYNE_SWARM_TASK` env and `ORCA_TERMINAL_HANDLE`/`ONLYNE_TERMINAL_HANDLE`
  provide fallback correlation.
- Tools: `onlyne_swarm_reply({text, rawText?})` writes the out message carrying
  the task header (the scheduler's success signal) and ends the task slot.
  `onlyne_mark_no_reply` additionally clears the swarm slot.
- Body protocol lives in `src/swarm.ts` (`parseSwarmHeader`,
  `renderSwarmHeader`, `readSwarmEnabled`); covered by `test/swarm.test.mjs`.
