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

With this extension, a pi agent can:

- watch an Onlyne workspace for inbound IM messages
- surface inbound messages into the current pi session
- reply to the current inbound message
- send a message to a specific channel conversation
- broadcast the same message to multiple conversations
- mark an inbound message as intentionally not replied

Messages are Markdown by default, matching normal agent output. Use `rawText: true` only when the message must be sent literally.

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

When a message arrives through Onlyne, pi receives it as a follow-up message. The agent can then call `onlyne_reply`, or deliberately call `onlyne_mark_no_reply`.

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
onlyne_mark_no_reply({ reason? })
```

### Send one message

```ts
onlyne_send({
  channelId: "telegram",
  conversationId: "123456",
  text: "# Build report\n\nAll checks passed."
})
```

### Send literal text

```ts
onlyne_send({
  channelId: "telegram",
  conversationId: "123456",
  text: "# not a heading",
  rawText: true
})
```

### Broadcast

```ts
onlyne_broadcast({
  targets: [
    { channelId: "telegram", conversationId: "123456" },
    { channelId: "feishu", conversationId: "oc_xxx" }
  ],
  text: "# Release shipped\n\nVersion 0.2.3 is live."
})
```

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
