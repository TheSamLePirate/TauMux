---
title: Telegram
description: ht telegram — status, chats, read, send.
sidebar:
  order: 9
---

`ht telegram` exposes the Telegram bridge to scripts and agents. Requires a configured bot token (see [Telegram bridge](/features/telegram-bridge/)).

## status

```bash
ht telegram status
# bot: my-tau-bot (@mytaubot)  state: polling  last error: -
# allowed: dm-only  approved chats: 3  pending: 0
```

Bot info, polling state, last error, access policy, allowlist counts. `--json` for the full structured form.

## chats

```bash
ht telegram chats
# id          name              kind     last       preview
# -10012345…  τ-mux dev         group    14:22      "build green"
# 987654321   Olivier           private  13:45      "ack"

ht telegram chats --json
```

Lists known chats with last message preview. Use this to find chat ids for `send` / `read`.

## read

```bash
ht telegram read --chat 987654321 --limit 20
ht telegram read --chat -1001234567890 --limit 50 --json
```

Last N messages from the SQLite log for a chat. Each message has timestamp, sender, text, and message-id.

## send

```bash
ht telegram send --chat 987654321 "hello from a shell"
ht telegram send --chat -1001234567890 "build done" --silent
```

| Flag | Purpose |
|---|---|
| `--chat <id>` | Target chat id (required). |
| `--silent` | Telegram "silent" delivery (no push notification). |
| `--reply-to <message-id>` | Reply to a specific message. |

## Read more

- [Telegram bridge](/features/telegram-bridge/)
- [JSON-RPC telegram methods](/api/telegram/)
