---
title: Telegram bridge
description: Long-poll Telegram bot service, first-class chat pane, optional notification forwarding. SQLite log with dedup.
sidebar:
  order: 7
---

τ-mux can connect to a Telegram bot for two-way messaging — a first-class chat pane in the UI and optional forwarding of system notifications to a chosen chat.

## What it does

- **First-class chat pane.** A surface kind alongside terminal / browser / agent. Picker, status pill, composer.
- **Long-poll bot service.** A background service in the Bun main process that polls `getUpdates` and dedups messages.
- **SQLite log.** Every received and sent message is persisted at `~/Library/Application Support/hyperterm-canvas/telegram.db`.
- **Notification forwarding.** When enabled, system notifications and `ht notify` calls are forwarded to a configured chat.
- **CLI access.** `ht telegram {status|chats|read|send}` for scripts and agents.

## Setup

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram to create a bot. Save the token.
2. Open **Settings → Telegram** in τ-mux.
3. Paste the token. The settings panel verifies it (`getMe`) and stores it.
4. (Optional) Configure notification forwarding: pick a chat as the default target.
5. Open a Telegram pane (`⌘⇧P → "Telegram"`), pick a chat from the picker, start chatting.

## Access policy

You can lock the bot down by configuring an allowlist:

- **Open** — anyone who messages the bot is allowed.
- **Allowlist (DM only)** — only specific Telegram users can DM the bot.
- **Allowlist (DM + groups)** — same plus a list of approved group chats.

Approve a new chat from inside τ-mux when a pairing request arrives.

## CLI

```bash
ht telegram status                            # bot info, polling state, last error
ht telegram chats                             # list known chats with last message preview
ht telegram read --chat <chat-id> --limit 20  # last N messages
ht telegram send --chat <chat-id> "hello"     # send a text message
```

Full reference: [`ht telegram`](/cli/telegram/).

## Notification forwarding

When enabled in settings, every notification created via `ht notify` (or by integrations like Claude Code's `ht-bridge`) is also sent as a Telegram message to the configured chat. Useful for "build done" or "tests failed" pings while you're away from the desk.

## Ask-user routing

When **Settings → Telegram → Route ht ask to Telegram** is on, every queued [ask-user](/features/ask-user/) question is also sent to allow-listed chats with kind-appropriate buttons (`Yes` / `No`, one button per choice, `force_reply` for free text, two-step ack → run for `confirm-command`). On resolution the original message is **edited in place** with a strike-through title and a footer like `✓ answered: yes` — the chat history reads as a clean audit log of every prompt and its answer.

## Source files

- `src/bun/telegram-service.ts` — long-poll bot service.
- `src/bun/telegram-db.ts` — SQLite persistence.
- `src/bun/telegram-forwarder.ts` — notification → telegram bridge.
- `src/bun/rpc-handlers/telegram.ts` — RPC handlers.
- `src/views/terminal/telegram-pane.ts` — chat pane UI.

## Read more

- [`ht telegram` CLI](/cli/telegram/)
- [Telegram API methods](/api/telegram/)
- [Settings: Telegram](/configuration/settings/)
