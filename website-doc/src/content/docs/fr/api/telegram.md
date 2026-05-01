---
title: telegram.*
description: list_chats, read, send, status, settings.
sidebar:
  order: 9
---

Méthodes du pont Telegram. Nécessite un jeton de bot configuré — voir [Pont Telegram](/fr/features/telegram-bridge/).

| Méthode | Params | Résultat |
|---|---|---|
| `telegram.status` | `{}` | `{ bot: { username, firstName }, polling: boolean, lastError?: string, accessPolicy: "open"\|"dm-only"\|"allowlist", approvedChats: number, pendingPairings: number }` |
| `telegram.list_chats` | `{}` | `{ chats: Array<{ id, kind: "private"\|"group", title, lastMessageAt, lastMessagePreview }> }` |
| `telegram.read` | `{ chatId: string\|number, limit?: number, beforeMessageId?: number }` | `{ messages: Array<{ id, ts, fromId, fromName, text, replyToId? }> }` |
| `telegram.send` | `{ chatId: string\|number, text: string, silent?: boolean, replyToId?: number }` | `{ messageId }` |
| `telegram.settings` | `{}` | sous-arbre complet des paramètres Telegram (jeton occulté) |

## Équivalents CLI

| Méthode | CLI |
|---|---|
| `telegram.status` | `ht telegram status` |
| `telegram.list_chats` | `ht telegram chats` |
| `telegram.read` | `ht telegram read --chat <id> --limit N` |
| `telegram.send` | `ht telegram send --chat <id> "<text>"` |
| `telegram.settings` | (panneau de paramètres uniquement) |
