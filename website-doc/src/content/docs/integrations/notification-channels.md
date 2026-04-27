---
title: Notification channels
description: How `ht notify`, sidebar log entries, and Telegram forwarding stack on top of each other.
sidebar:
  order: 3
---

τ-mux has three notification surfaces and one forwarding hop. Here's how they relate.

## The three surfaces

1. **System notifications** — `ht notify --title … --body …` triggers a native macOS notification banner. The user sees it even if τ-mux isn't focused.
2. **Sidebar pile** — every notification is also logged to the sidebar so you can see history without leaving the app.
3. **Sidebar log entries** — `ht log "…"` posts an entry to the workspace log. Same surface as notifications but lighter — no native banner, no Telegram forwarding.

## The Telegram hop

When **Settings → Telegram → Forward notifications** is enabled, every `notification.create` call (including `ht notify`) is also forwarded to the configured Telegram chat.

```
ht notify ──┬─→ macOS notification banner
            ├─→ τ-mux sidebar pile
            └─→ Telegram chat (if forwarding on)
```

`ht log` does NOT trigger Telegram forwarding — it's intentionally local-only.

## When to use what

| Scenario | Use |
|---|---|
| "Tests broke, drop everything" | `ht notify --level error --title "Tests" --body "5 failed"` — banner + Telegram forwards. |
| "Build progress update" | `ht set-progress 0.5 --label "Compiling"` + `ht set-status build "Compiling"` — silent, sidebar-only. |
| "Quick log entry" | `ht log --level success --source build "compiled"` — no banner, no Telegram, just sidebar. |
| "Heavy lifting done while away" | `ht notify --title "Done" --body "deploy succeeded" --sound finish` — banner + sound + Telegram. |

## Suppressing during focus

There's no built-in "do not disturb" toggle yet. Workarounds:

- Set `ht notify --silent` (planned) to skip the banner but keep the sidebar entry.
- Use `ht log` instead of `ht notify` for non-critical updates.
- Disable Telegram forwarding in settings while pairing or screen-sharing.

## Read more

- [`ht notify`](/cli/notifications/)
- [`ht log` / `ht set-status` / `ht set-progress`](/cli/sidebar-and-status/)
- [Telegram bridge](/features/telegram-bridge/)
