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

The bot only acts on messages from user ids in the allowlist (`telegramAllowedUserIds`, a comma-separated list of numeric Telegram user ids set in **Settings → Telegram**).

:::caution[Fail-closed by default (v0.3.161+)]
The allowlist now **defaults to empty and is fail-closed**: while it is empty, **every inbound message and button tap is rejected**. You must enter your own numeric Telegram user id(s) in **Settings → Telegram** before the bot will act on your messages or notification buttons. A one-time warning is logged while the list is empty.

This is deliberate. A channel that can type into — and SIGINT — your shells via notification buttons and [ask-user](/features/ask-user/) prompts must default to **deny**, not allow-anyone. Earlier versions shipped a hardcoded default user id and treated an empty allowlist as "accept from anyone" (fail-open); that is no longer the case.
:::

Once your id is in the allowlist, you can scope the bot further:

- **Allowlist (DM only)** — only the listed Telegram users can DM the bot.
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
