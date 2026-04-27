---
title: Settings
description: Where settings live, when they apply live vs. need a restart, and the settings.json file shape.
sidebar:
  order: 10
---

All settings persist to `~/Library/Application Support/hyperterm-canvas/settings.json`. Open the in-app panel with `⌘,`. Most changes apply live — no restart needed.

## Sections

| Section | What it covers |
|---|---|
| **General** | `shellPath` (empty = `$SHELL`), `scrollbackLines`. |
| **Appearance** | font family/size, line height, cursor style, cursor blink. |
| **Theme** | 10 presets + per-color overrides, background opacity, accent / secondary / foreground colors, full 16-color ANSI palette. |
| **Effects** | terminal bloom toggle + intensity. |
| **Network** | web mirror port + auto-start + bind address + optional auth token. |
| **Browser** | search engine, home page, force dark mode, terminal link interception. |
| **Telegram** | bot token + access policy + chats + notification forwarding. |
| **Advanced** | pane gap (px between splits), sidebar width. |

Full per-field reference: [Configuration → Settings](/configuration/settings/).

## When changes apply

| Setting | Behavior |
|---|---|
| `shellPath` | Applies to **new** surfaces only — existing shells keep running. |
| `webMirrorPort`, `webMirrorBind`, `webMirrorAuthToken` | Restart a running mirror on change. |
| `autoStartWebMirror` | Only matters at launch. The mirror can still be toggled any time after. |
| Theme / appearance / effects | Apply live across all panes. |
| Telegram bot token | Re-validates immediately; long-poll service restarts on success. |

## Editing the JSON directly

You can edit `settings.json` while τ-mux runs — the `SettingsManager` watches the file and reloads on change. Useful for scripted setups (`bun scripts/...` setups) or for syncing config across machines.

Schema is enforced by `validateSettings` in `src/shared/settings.ts`. Unknown fields are dropped on load with a logger warning.

## Source files

- `src/shared/settings.ts` — `AppSettings` schema, `DEFAULT_SETTINGS`, `validateSettings`, theme presets.
- `src/bun/settings-manager.ts` — load/save with debounced persist.
- `src/views/terminal/settings-panel.ts` — full UI.

## Read more

- [Settings reference](/configuration/settings/)
- [Themes](/configuration/themes/)
- [Environment variables](/configuration/env-vars/)
