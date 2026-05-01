---
title: Telegram
description: ht telegram — status, chats, read, send.
sidebar:
  order: 9
---

`ht telegram` expose le pont Telegram aux scripts et aux agents. Nécessite un token de bot configuré (voir [Pont Telegram](/fr/features/telegram-bridge/)).

## status

```bash
ht telegram status
# bot: my-tau-bot (@mytaubot)  state: polling  last error: -
# allowed: dm-only  approved chats: 3  pending: 0
```

Infos du bot, état du polling, dernière erreur, politique d'accès, comptes de la liste d'autorisations. `--json` pour la forme structurée complète.

## chats

```bash
ht telegram chats
# id          name              kind     last       preview
# -10012345…  τ-mux dev         group    14:22      "build green"
# 987654321   Olivier           private  13:45      "ack"

ht telegram chats --json
```

Liste les chats connus avec un aperçu du dernier message. Utilisez ceci pour trouver les ids de chat pour `send` / `read`.

## read

```bash
ht telegram read --chat 987654321 --limit 20
ht telegram read --chat -1001234567890 --limit 50 --json
```

Les N derniers messages du journal SQLite pour un chat. Chaque message a un timestamp, un expéditeur, un texte et un message-id.

## send

```bash
ht telegram send --chat 987654321 "hello from a shell"
ht telegram send --chat -1001234567890 "build done" --silent
```

| Option | Rôle |
|---|---|
| `--chat <id>` | Id du chat cible (requis). |
| `--silent` | Livraison « silencieuse » Telegram (pas de notification push). |
| `--reply-to <message-id>` | Répond à un message spécifique. |

## Pour aller plus loin

- [Pont Telegram](/fr/features/telegram-bridge/)
- [Méthodes JSON-RPC telegram](/fr/api/telegram/)
