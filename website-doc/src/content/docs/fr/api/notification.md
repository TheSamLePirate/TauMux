---
title: notification.*
description: create, list, clear, dismiss.
sidebar:
  order: 7
---

Notifications système — éventuellement transférées vers Telegram (voir [Pont Telegram](/fr/features/telegram-bridge/)).

| Méthode | Params | Résultat |
|---|---|---|
| `notification.create` | `{ surfaceId?: string, title: string, body?: string, level?: "info"\|"success"\|"warn"\|"error", sound?: string }` | `{ id }` |
| `notification.list` | `{ surfaceId?: string }` | `{ notifications: Array<{ id, title, body, level, createdAt, surfaceId }> }` |
| `notification.clear` | `{ surfaceId?: string }` | `{ cleared: number }` |
| `notification.dismiss` | `{ id: string }` | `{ ok: true }` |

`sound: "finish"` joue le fichier `audio/finish.mp3` fourni avec l'application.

## Équivalents CLI

| Méthode | CLI |
|---|---|
| `notification.create` | `ht notify --title "<t>" --body "<b>" --level <level> --sound finish` |
| `notification.list` | `ht list-notifications` |
| `notification.clear` | `ht clear-notifications` |
| `notification.dismiss` | (aucune CLI directe — utilisez `clear-notifications` pour le traitement en lot) |
