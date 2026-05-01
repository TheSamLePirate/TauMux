---
title: Pont Telegram
description: Service de bot Telegram en long-poll, panneau de chat de première classe, transfert de notifications optionnel. Journal SQLite avec dédup.
sidebar:
  order: 7
---

τ-mux peut se connecter à un bot Telegram pour de la messagerie bidirectionnelle — un panneau de chat de première classe dans l'UI et le transfert optionnel des notifications système vers une conversation choisie.

## Ce qu'il fait

- **Panneau de chat de première classe.** Un type de surface aux côtés de terminal / browser / agent. Sélecteur, pastille de statut, composeur.
- **Service de bot en long-poll.** Un service en arrière-plan dans le processus principal Bun qui interroge `getUpdates` et déduplique les messages.
- **Journal SQLite.** Chaque message reçu et envoyé est persisté dans `~/Library/Application Support/hyperterm-canvas/telegram.db`.
- **Transfert de notifications.** Lorsque activé, les notifications système et les appels `ht notify` sont transférés vers une conversation configurée.
- **Accès CLI.** `ht telegram {status|chats|read|send}` pour les scripts et les agents.

## Configuration

1. Parlez à [@BotFather](https://t.me/BotFather) sur Telegram pour créer un bot. Sauvegardez le jeton.
2. Ouvrez **Settings → Telegram** dans τ-mux.
3. Collez le jeton. Le panneau de paramètres le vérifie (`getMe`) et le stocke.
4. (Optionnel) Configurez le transfert de notifications : choisissez une conversation comme cible par défaut.
5. Ouvrez un panneau Telegram (`⌘⇧P → "Telegram"`), choisissez une conversation depuis le sélecteur, commencez à discuter.

## Politique d'accès

Vous pouvez verrouiller le bot en configurant une liste blanche :

- **Open** — toute personne qui envoie un message au bot est autorisée.
- **Allowlist (DM only)** — seuls des utilisateurs Telegram spécifiques peuvent envoyer un DM au bot.
- **Allowlist (DM + groups)** — idem plus une liste de conversations de groupe approuvées.

Approuvez une nouvelle conversation depuis l'intérieur de τ-mux quand une demande d'appairage arrive.

## CLI

```bash
ht telegram status                            # bot info, polling state, last error
ht telegram chats                             # list known chats with last message preview
ht telegram read --chat <chat-id> --limit 20  # last N messages
ht telegram send --chat <chat-id> "hello"     # send a text message
```

Référence complète : [`ht telegram`](/fr/cli/telegram/).

## Transfert de notifications

Lorsque activé dans les paramètres, chaque notification créée via `ht notify` (ou par des intégrations comme le `ht-bridge` de Claude Code) est aussi envoyée comme message Telegram à la conversation configurée. Utile pour des pings « build done » ou « tests failed » quand vous êtes loin du bureau.

## Routage ask-user

Lorsque **Settings → Telegram → Route ht ask to Telegram** est activé, chaque question [ask-user](/fr/features/ask-user/) en file d'attente est aussi envoyée vers les conversations autorisées avec des boutons adaptés au type (`Yes` / `No`, un bouton par choix, `force_reply` pour le texte libre, ack → run en deux étapes pour `confirm-command`). À la résolution, le message d'origine est **édité sur place** avec un titre barré et un pied de page comme `✓ answered: yes` — l'historique de la conversation se lit comme un journal d'audit propre de chaque invite et de sa réponse.

## Fichiers source

- `src/bun/telegram-service.ts` — service de bot en long-poll.
- `src/bun/telegram-db.ts` — persistance SQLite.
- `src/bun/telegram-forwarder.ts` — pont notification → telegram.
- `src/bun/rpc-handlers/telegram.ts` — gestionnaires RPC.
- `src/views/terminal/telegram-pane.ts` — UI du panneau de chat.

## Pour aller plus loin

- [CLI `ht telegram`](/fr/cli/telegram/)
- [Méthodes API Telegram](/fr/api/telegram/)
- [Settings: Telegram](/fr/configuration/settings/)
