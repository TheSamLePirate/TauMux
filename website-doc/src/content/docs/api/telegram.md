---
title: telegram.*
description: list_chats, read, send, status, settings.
sidebar:
  order: 9
---

Telegram bridge methods. Requires a configured bot token — see [Telegram bridge](/features/telegram-bridge/).

| Method | Params | Result |
|---|---|---|
| `telegram.status` | `{}` | `{ bot: { username, firstName }, polling: boolean, lastError?: string, accessPolicy: "open"\|"dm-only"\|"allowlist", approvedChats: number, pendingPairings: number }` |
| `telegram.list_chats` | `{}` | `{ chats: Array<{ id, kind: "private"\|"group", title, lastMessageAt, lastMessagePreview }> }` |
| `telegram.read` | `{ chatId: string\|number, limit?: number, beforeMessageId?: number }` | `{ messages: Array<{ id, ts, fromId, fromName, text, replyToId? }> }` |
| `telegram.send` | `{ chatId: string\|number, text: string, silent?: boolean, replyToId?: number }` | `{ messageId }` |
| `telegram.settings` | `{}` | full Telegram settings sub-tree (token elided) |

## CLI equivalents

| Method | CLI |
|---|---|
| `telegram.status` | `ht telegram status` |
| `telegram.list_chats` | `ht telegram chats` |
| `telegram.read` | `ht telegram read --chat <id> --limit N` |
| `telegram.send` | `ht telegram send --chat <id> "<text>"` |
| `telegram.settings` | (settings panel only) |
