---
title: notification.*
description: create, list, clear, dismiss.
sidebar:
  order: 7
---

System notifications — optionally forwarded to Telegram (see [Telegram bridge](/features/telegram-bridge/)).

| Method | Params | Result |
|---|---|---|
| `notification.create` | `{ surfaceId?: string, title: string, body?: string, level?: "info"\|"success"\|"warn"\|"error", sound?: string }` | `{ id }` |
| `notification.list` | `{ surfaceId?: string }` | `{ notifications: Array<{ id, title, body, level, createdAt, surfaceId }> }` |
| `notification.clear` | `{ surfaceId?: string }` | `{ cleared: number }` |
| `notification.dismiss` | `{ id: string }` | `{ ok: true }` |

`sound: "finish"` plays the bundled `audio/finish.mp3`.

## CLI equivalents

| Method | CLI |
|---|---|
| `notification.create` | `ht notify --title "<t>" --body "<b>" --level <level> --sound finish` |
| `notification.list` | `ht list-notifications` |
| `notification.clear` | `ht clear-notifications` |
| `notification.dismiss` | (no direct CLI — use `clear-notifications` for bulk) |
