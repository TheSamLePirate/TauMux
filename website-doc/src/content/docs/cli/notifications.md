---
title: Notifications
description: notify, list-notifications, clear-notifications.
sidebar:
  order: 6
---

Native notifications. Optionally forwarded to Telegram (see [Telegram bridge](/features/telegram-bridge/)).

## notify

```bash
ht notify --title "Build" --body "Done"
ht notify --title "Tests failed" --body "5 failures in src/" --level error
ht notify --title "Done" --body "Tests passed" --sound finish
```

Posts a system notification. The notification also appears in τ-mux's sidebar log.

| Flag | Purpose |
|---|---|
| `--title <s>` | Notification title (required). |
| `--body <s>` | Body text. |
| `--level <s>` | `info` (default), `success`, `warn`, `error`. |
| `--sound <s>` | `finish` plays the bundled `audio/finish.mp3`. Add custom files via the asset loader. |
| `--surface <id>` | Override which surface owns the notification (defaults to focused). |

## list-notifications

```bash
ht list-notifications
ht list-notifications --json
```

Lists active notifications (the ones still in the sidebar pile). Includes title, body, level, age, surface id.

## clear-notifications

```bash
ht clear-notifications
ht clear-notifications --surface surface:3
```

Clears all notifications (or the targeted surface's). The native banner closes automatically; this only affects the sidebar pile.

## With Telegram forwarding

When **Settings → Telegram → Forward notifications** is enabled, every `ht notify` call is also sent to the configured Telegram chat. Useful for "build done" pings while you're away from the desk.

## Read more

- [JSON-RPC notification methods](/api/notification/)
- [Telegram bridge](/features/telegram-bridge/)
- [`ht log`](/cli/sidebar-and-status/)
