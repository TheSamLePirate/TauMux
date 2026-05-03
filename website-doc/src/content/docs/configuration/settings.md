---
title: Settings reference
description: Every setting in `~/Library/Application Support/hyperterm-canvas/settings.json` — what it does and when it applies.
sidebar:
  order: 1
---

τ-mux persists settings to `~/Library/Application Support/hyperterm-canvas/settings.json`. The settings panel (`⌘,`) writes this file; you can also edit it by hand — `SettingsManager` watches the file and reloads on change.

Schema: `AppSettings` in `src/shared/settings.ts`. Defaults: `DEFAULT_SETTINGS`. Validation: `validateSettings`.

## General

| Field | Type | Default | Effect |
|---|---|---|---|
| `shellPath` | string | `""` (= `$SHELL`) | Path to the shell binary. **Applies to new surfaces only** — existing shells keep running. |
| `scrollbackLines` | number | `10000` | Lines retained in the scrollback buffer per surface. |

## Appearance

| Field | Type | Default | Effect |
|---|---|---|---|
| `fontFamily` | string | `"JetBrains Mono"` | Terminal font. Falls back to the next available if not installed. |
| `fontSize` | number | `13` | Font size in px. |
| `lineHeight` | number | `1.2` | Line height multiplier. |
| `cursorStyle` | enum | `"block"` | `block`, `underline`, `bar`. |
| `cursorBlink` | boolean | `true` | Whether the cursor blinks. |
| `copyOnSelect` | boolean | `false` | Auto-copy selection. |

## Theme

| Field | Type | Default | Effect |
|---|---|---|---|
| `themePreset` | enum | `"obsidian"` | One of 10 presets. See [Themes](/configuration/themes/). |
| `themeOverrides` | object | `{}` | Per-color overrides; merge into the chosen preset. |
| `backgroundOpacity` | number | `1.0` | 0.0–1.0; the underlying app window has solid black behind. |
| `accentColor`, `secondaryColor`, `foregroundColor` | string | (preset) | Quick overrides for the most-used colors. |
| `ansiPalette` | object | (preset) | Full 16-color ANSI palette. |

## Effects

| Field | Type | Default | Effect |
|---|---|---|---|
| `bloomEnabled` | boolean | `false` | WebGL bloom layer over the terminal. |
| `bloomIntensity` | number | `0.5` | 0.0–1.0. Higher = brighter glow. |
| `legacyBloomIntensity` | number | (snapshot) | Captured automatically when migrating from the older bloom slider. Powers the **Restore previous bloom (X.XX)** button in Settings → Effects, which only appears if you were migrated AND haven't yet picked a non-zero `bloomIntensity` since. One click sets `bloomIntensity` to the snapshotted value and dismisses the button. |

## Network (Web Mirror)

| Field | Type | Default | Effect |
|---|---|---|---|
| `autoStartWebMirror` | boolean | `false` | Whether the mirror starts at app launch. |
| `webMirrorPort` | number | `3000` | TCP port. **Restarts** a running mirror on change. |
| `webMirrorBind` | string | `"0.0.0.0"` | Bind address. Set `"127.0.0.1"` to keep local-only. **Restarts** on change. |
| `webMirrorAuthToken` | string | `""` | Shared secret. Empty = no auth. **Restarts** on change. |

## Browser

| Field | Type | Default | Effect |
|---|---|---|---|
| `searchEngine` | enum | `"google"` | `google`, `duckduckgo`, `bing`, `kagi`. |
| `homePage` | string | `"about:blank"` | URL to open in new browser panes. |
| `forceDarkMode` | boolean | `false` | Inject CSS to force dark mode on pages. |
| `interceptTerminalLinks` | boolean | `false` | When true, clicking a `http(s)://` link in any terminal opens it in a τ-mux browser pane instead of the system default browser. |

## Telegram

| Field | Type | Default | Effect |
|---|---|---|---|
| `botToken` | string | `""` | Token from BotFather. |
| `accessPolicy` | enum | `"open"` | `open`, `dm-only`, `allowlist`. |
| `allowedChats` | string[] | `[]` | Chat ids permitted under `allowlist`. |
| `forwardNotifications` | boolean | `false` | Forward `ht notify` to Telegram. |
| `forwardChatId` | string | `""` | Target chat for forwarded notifications. |

## Advanced

| Field | Type | Default | Effect |
|---|---|---|---|
| `paneGap` | number | `4` | Pixels between split panes. |
| `sidebarWidth` | number | `260` | Sidebar width in px. |
| `notificationSoundEnabled` | boolean | `true` | Play sound on `ht notify --sound`. |
| `notificationSoundVolume` | number | `0.5` | 0.0–1.0. |

## When changes apply

Most fields apply live across all panes the moment they're saved. Exceptions:

- `shellPath` — new surfaces only.
- `webMirrorPort`, `webMirrorBind`, `webMirrorAuthToken` — restart a running mirror.
- `autoStartWebMirror` — only at launch (toggle the mirror manually any time).

## Editing the JSON

Safe to edit while τ-mux runs. The file is reloaded on change. Unknown fields are dropped on load with a logger warning.

```bash
$EDITOR ~/Library/Application\ Support/hyperterm-canvas/settings.json
```

## Read more

- [Themes](/configuration/themes/)
- [Environment variables](/configuration/env-vars/)
- [Keyboard shortcuts](/configuration/keyboard-shortcuts/)
