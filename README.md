# pi-onlyne

Pi extension for using Onlyne as a workspace-local messaging bridge.

## What it does

- Watches an existing Onlyne workspace.
- Starts Onlyne for the current workspace when requested.
- Subscribes to inbound channel events without polling.
- Lets the agent reply, send, or broadcast messages through tools.
- Keeps config in the project, not in global home state.

## Install

```bash
pi install npm:pi-onlyne
```

For a one-off run:

```bash
pi -e npm:pi-onlyne
```

## Requirements

- `onlyne` available on `PATH`, or set `ONLYNE_BIN`.
- A workspace with `.onlyne/` already initialized.

## Commands

```text
/onlyne status
/onlyne watch on
/onlyne watch off
/onlyne config auto-start
```

## Agent tools

```text
onlyne_reply({ text })
onlyne_send({ channelId, conversationId, text, rawText? })
onlyne_broadcast({ targets, text, rawText? })
onlyne_mark_no_reply({ reason })
```

Messages default to Markdown. Set `rawText: true` only when the text must be sent literally.

## Config

Project-local config lives at `.pi/onlyne.json`. Defaults are safe: watch is manual, inbound messages auto-handle once watch is on, and outbound reply fallback is guarded.

See `SPEC.md` for behavior details.
