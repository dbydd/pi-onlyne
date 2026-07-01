# pi-onlyne

**Give pi agents a real IM inbox/outbox through [Onlyne](https://github.com/dbydd/onlyne).**

`pi-onlyne` is the Pi extension for Onlyne. It adds tools and commands to pi so an agent can receive messages from IM channels and send replies without pretending that a chat platform is a terminal, a browser tab, or a custom workflow engine.

## What is Onlyne?

[Onlyne](https://github.com/dbydd/onlyne) is a small workspace-local IM channel daemon. It runs in your project directory, keeps its config/state under `.onlyne/`, and brokers local agent calls to real messaging adapters such as Telegram, Feishu/Lark, QQ Bot, and WeChat.

Onlyne is deliberately narrow:

- local workspace daemon, not a global cloud service
- channel broker, not an agent runtime
- Unix socket / stdio friendly, not a web dashboard
- local history and event stream, not a heavy message platform

## What does this extension do?

`pi-onlyne` connects pi to an existing Onlyne workspace and exposes Onlyne as native pi tools.

Onlyne channels are singleton-routed: each enabled channel has one `bind_conversation_id` set in config or by sending `/handshake` from the desired conversation, so pi tools take `channelId` only.

With this extension, a pi agent can:

- watch an Onlyne workspace for inbound IM messages
- surface inbound messages into the current pi session
- reply to the current inbound message
- send a message to a channel's configured conversation
- broadcast the same message to multiple conversations
- inject a local loopback activation so background scripts can wake the session
- share Onlyne's FIFO consume cursor so `.onlyne/channels/<channel>/out` does not re-read messages already surfaced to pi
- mark an inbound message as intentionally not replied

Messages are Markdown by default, matching normal agent output. Use `rawText: true` only when the message must be sent literally. Onlyne can also expose FIFO IO under `.onlyne/channels/<channel>/in|out`; pi-onlyne stays on the socket/event API and advances the shared consume cursor after delivering inbound follow-ups.

## Install

```bash
pi install npm:pi-onlyne
```

For a one-off run without installing:

```bash
pi -e npm:pi-onlyne
```

You also need the `onlyne` CLI installed and an initialized workspace:

```bash
onlyne init
# Optional: refresh the workspace-local agent skill
onlyne export-skill
```

If `onlyne` is not on `PATH`, set:

```bash
export ONLYNE_BIN=/path/to/onlyne
```

## Typical workflow

1. Initialize/configure Onlyne in your project.
2. Install this Pi extension.
3. Start watching from pi:

```text
/onlyne watch on
```

When a normal user message arrives through Onlyne, pi receives it as a follow-up message. Onlyne control messages such as `/handshake` are consumed silently. The agent can then call `onlyne_reply`, or deliberately call `onlyne_mark_no_reply`.

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
onlyne_send({ channelId, text, rawText? })
onlyne_broadcast({ targets, text, rawText? })
onlyne_loopback({ text, rawText? })
onlyne_mark_no_reply({ reason? })
```

### Send one message

```ts
onlyne_send({
  channelId: "telegram",
  text: "# Build report\n\nAll checks passed."
})
```

### Send literal text

```ts
onlyne_send({
  channelId: "telegram",
  text: "# not a heading",
  rawText: true
})
```

### Broadcast

```ts
onlyne_broadcast({
  targets: [
    { channelId: "telegram" },
    { channelId: "feishu" }
  ],
  text: "# Release shipped\n\nVersion 0.3.1 is live."
})
```

### Loopback wake-up

From any local script, inject an inbound message into the current Onlyne daemon:

```bash
onlyne client '{"id":"wake","op":"loopback","text":"background job finished","raw_text":true}'
# or, with FIFO IO enabled by the daemon:
printf 'background job finished\n' > .onlyne/channels/loopback/in
```

Pi treats channel `loopback` as wake-up-only: it sends a follow-up to the session, but does not expect `onlyne_reply`.

## Local state

This extension stores its own pi-side config at:

```text
.pi/onlyne.json
```

Onlyne itself stores workspace state under:

```text
.onlyne/
```

That keeps each project isolated: different workspaces can run different Onlyne daemons, channels, histories, and policies.

## Links

- Onlyne main repository: https://github.com/dbydd/onlyne
- pi-onlyne package: https://www.npmjs.com/package/pi-onlyne
