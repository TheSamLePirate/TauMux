---
title: Claude Code
description: ht-bridge — Claude Code shell-hooks that surface "active" pills and post completion notifications.
sidebar:
  order: 1
---

`claude-integration/ht-bridge/` is a small set of shell hooks that mirror Claude Code's session state into τ-mux:

- An **active pill** in the sidebar while Claude is working.
- A **persistent ticker** showing what Claude is doing.
- A **completion notification** when the turn finishes (optionally forwarded to Telegram).

## Install

```bash
cd claude-integration
./install.sh         # symlinks ht-bridge into ~/.claude/scripts/
```

Then add the hook blocks from `claude-integration/settings.snippet.jsonc` into your `~/.claude/settings.json` (the snippet shows the exact `UserPromptSubmit` / `Stop` / `Notification` event hooks).

## What gets shown

| Claude event | What ht-bridge does |
|---|---|
| `UserPromptSubmit` | `ht set-status claude "working"` with the accent color. Starts the ticker. |
| `Notification` (e.g. tool use) | `ht set-status claude "<short summary>"` — updates the pill in place. |
| `Stop` | `ht clear-status claude` + `ht notify --title "Claude" --body "Done"`. |

If τ-mux isn't running or `ht` isn't on PATH, the hooks gracefully no-op — Claude Code continues unaffected.

## Telegram forwarding

When **Settings → Telegram → Forward notifications** is enabled in τ-mux, the completion notification also goes to your configured chat. Useful for "Claude finished while I was away" pings.

## Customizing

The hook scripts are short shell — edit `claude-integration/ht-bridge/*.sh` to:

- Change the pill color / icon.
- Add a sound on completion (`ht notify --sound finish`).
- Suppress notifications for fast turns (e.g. only fire if turn > 10 s).

## Source

- `claude-integration/ht-bridge/` — the hook scripts.
- `claude-integration/install.sh` — symlink installer.
- `claude-integration/settings.snippet.jsonc` — drop-in hook config.

## Read more

- [Pi extensions](/integrations/pi/)
- [Notification channels](/integrations/notification-channels/)
- [Telegram bridge](/features/telegram-bridge/)
