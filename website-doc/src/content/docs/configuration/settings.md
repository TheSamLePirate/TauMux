---
title: Settings reference
description: Every setting in `~/Library/Application Support/hyperterm-canvas/settings.json` — what it does and when it applies.
sidebar:
  order: 1
---

τ-mux persists settings to `~/Library/Application Support/hyperterm-canvas/settings.json`. The settings panel (`⌘,`) writes this file; you can also edit it by hand — `SettingsManager` watches the file and reloads on change.

Schema: `AppSettings` in `src/shared/settings.ts`. Defaults: `DEFAULT_SETTINGS`. Validation: `validateSettings` (per-field schemas in `settings.schema.ts`, so an out-of-range or wrong-typed value falls back to the default rather than breaking the app).

This page lists **every** field, with the default read from `DEFAULT_SETTINGS`.

## Terminal

| Field | Type | Default | Effect |
|---|---|---|---|
| `shellPath` | string | `""` | Shell binary. Empty = `$SHELL`. **New surfaces only** — existing shells keep running. |
| `scrollbackLines` | number | `10000` | Lines retained in the scrollback buffer per surface. |
| `fontFamily` | string | `'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Berkeley Mono', 'SF Mono', 'Menlo', monospace` | Terminal font stack. |
| `fontSize` | number | `13` | Terminal font size in px. |
| `lineHeight` | number | `1` | Line-height multiplier (0.8–2.0). |
| `cursorStyle` | `"block"` \| `"bar"` \| `"underline"` | `"block"` | Terminal cursor shape. |
| `cursorBlink` | boolean | `true` | Blink the terminal cursor. |
| `terminalRenderer` | `"dom"` \| `"webgl"` | `"dom"` | **Experimental** GPU renderer. Falls back to DOM automatically on unsupported hardware, init failure, or context loss — the settings panel shows a live "running on DOM — reason" hint when it has. It shipped enabled in v0.4.9 and rendered panes blank on some setups; a one-time migration in v0.4.12 reset a persisted `webgl` back to `dom`. Command palette: "Use WebGL/DOM Terminal Renderer". |
| `terminalOsc94Enabled` | boolean | `true` | Honour OSC 9;4 progress sequences (per-pane progress chip). |

## Appearance

| Field | Type | Default | Effect |
|---|---|---|---|
| `themePreset` | string | `"tau"` | Named theme preset. See [Themes](/configuration/themes/). |
| `chromeTheme` | `"system"` \| `"graphite-dark"` \| `"graphite-light"` \| `"high-contrast"` | `"system"` | App chrome theme, independent of the terminal palette. |
| `accentColor` | string | `"#6fe9ff"` | Primary accent (cyan — focus, selection, human identity). |
| `secondaryColor` | string | `"#ffc56b"` | Secondary accent (amber — agent identity). |
| `foregroundColor` | string | `"#d6e2e8"` | Default terminal foreground. |
| `bgBase` | string | `"0, 0, 0"` | Terminal background as an `r, g, b` triple, combined with `terminalBgOpacity`. |
| `terminalBgOpacity` | number | `1` | Terminal background opacity, 0–1. |
| `ansiColors` | object | 16-colour TAU palette | The full ANSI 16 (`black`…`brightWhite`). |
| `terminalBloom` | boolean | `false` | WebGL bloom layer over the terminal. |
| `bloomIntensity` | number | `0` | Bloom strength, 0–2. |
| `legacyBloomIntensity` | number | `0` | Snapshot of the pre-TAU bloom value, kept so the migration is reversible. |
| `bloomMigratedToTau` | boolean | `false` | Internal migration marker — do not set by hand. |
| `paneGap` | number | `2` | Gap between panes in px, 0–20. |
| `sidebarWidth` | number | `320` | Sidebar width in px, 200–600. |
| `layoutVariant` | `"bridge"` \| `"cockpit"` \| `"atlas"` | `"bridge"` | Chrome layout variant. |

## Sidebar & workspace cards

| Field | Type | Default | Effect |
|---|---|---|---|
| `workspaceCardDensity` | `"compact"` \| `"comfortable"` \| `"spacious"` | `"comfortable"` | Vertical density of workspace cards. |
| `workspaceCardShowMeta` | boolean | `true` | Show the meta row (cwd, branch). |
| `workspaceCardShowStats` | boolean | `true` | Show CPU / memory / pane stats. |
| `workspaceCardShowPanes` | boolean | `true` | Show the per-pane list. |
| `workspaceCardShowManifests` | boolean | `true` | Show the `package.json` / `Cargo.toml` card. |
| `workspaceCardShowFileExplorer` | boolean | `true` | Show the inline file explorer. |
| `workspaceFileExplorerShowHidden` | boolean | `false` | Include dotfiles in the file explorer. |
| `workspaceFileExplorerMaxEntries` | number | `200` | Cap on entries listed per directory. |
| `workspaceCardShowStatusPills` | boolean | `true` | Show `ht set-status` pills on the card. |
| `workspaceCardShowProgress` | boolean | `true` | Show the progress bar (`ht set-progress`, OSC 9;4). |
| `statusBarKeys` | string[] | `["workspace","panes","cpu","mem","procs","fg","cwd","branch","ht-all","ports","time"]` | Which segments the bottom status bar renders, in order. |
| `htStatusKeyOrder` | string[] | `[]` | Explicit ordering for `ht set-status` keys; unlisted keys follow. |
| `htStatusKeyHidden` | string[] | `[]` | `ht set-status` keys to hide. |

## Notifications

| Field | Type | Default | Effect |
|---|---|---|---|
| `notificationSoundEnabled` | boolean | `true` | Play `finish.mp3` when a sidebar notification arrives. |
| `notificationSoundVolume` | number | `1` | Arrival-cue volume, 0–1. |
| `notificationOverlayEnabled` | boolean | `true` | Show the transient on-screen notification overlay. |
| `notificationOverlayMs` | number | `6000` | How long the overlay stays up, in ms. |

## Claude Code

See the [Claude Code integration](/integrations/claude-code/).

| Field | Type | Default | Effect |
|---|---|---|---|
| `claudeAutoApprove` | boolean | `false` | Auto-accept the permission prompt Claude Code shows in a **terminal** pane by sending Enter. Only fires for that terminal prompt — never the τ-mux approval modal, never the Claude Code pane — pauses itself after a burst, and logs every approval to the pane's sidebar log. Off by default: this grants unattended consent for commands the agent asks to run. |
| `claudeAutoApproveDelayMs` | number | `700` | Delay before the Enter keystroke, 0–10000 ms. The prompt is re-checked when the delay expires, so a prompt you answered yourself never receives a stray Enter. |

## Browser panes

| Field | Type | Default | Effect |
|---|---|---|---|
| `browserSearchEngine` | `"google"` \| `"duckduckgo"` \| `"bing"` \| `"kagi"` | `"google"` | Engine used when the address bar input isn't a URL. |
| `browserHomePage` | string | `""` | Page opened for a new browser surface. Empty = blank. |
| `browserForceDarkMode` | boolean | `false` | Ask pages to render in dark mode. |
| `browserInterceptTerminalLinks` | boolean | `false` | Open links clicked in a terminal in a browser pane instead of the system browser. |
| `browserPartitionMode` | `"shared"` \| `"per-surface"` | `"per-surface"` | Cookie/storage partitioning across browser panes. |

## Scripts

| Field | Type | Default | Effect |
|---|---|---|---|
| `packageRunner` | `"bun"` \| `"npm"` \| `"pnpm"` \| `"yarn"` | `"bun"` | Command used to run `package.json` scripts from the sidebar. |

## Web mirror & RPC

See [auth & hardening](/web-mirror/auth-and-hardening/).

| Field | Type | Default | Effect |
|---|---|---|---|
| `webMirrorPort` | number | `3000` | Mirror listen port, 1–65535. |
| `autoStartWebMirror` | boolean | `false` | Start the mirror at launch. |
| `webMirrorBind` | `"127.0.0.1"` \| `"0.0.0.0"` | `"0.0.0.0"` | Bind address. **`0.0.0.0` exposes the mirror to your whole LAN — set `webMirrorAuthToken` before enabling it there.** |
| `webMirrorAuthToken` | string | `""` | Shared token for mirror access. **Empty means authentication is off.** |
| `rpcSocketRequireToken` | boolean | `true` | Require the per-boot token for state-mutating `ht` socket calls. On by default since v0.4.12; every first-party client presents it automatically. |

## Telegram

See the [Telegram bridge](/features/telegram-bridge/).

| Field | Type | Default | Effect |
|---|---|---|---|
| `telegramEnabled` | boolean | `false` | Run the long-poll bot service. |
| `telegramBotToken` | string | `""` | BotFather token. |
| `telegramAllowedUserIds` | string | `""` | Comma-separated Telegram user ids allowed to talk to the bot. **Fail-closed: empty rejects everyone.** |
| `telegramNotificationsEnabled` | boolean | `false` | Forward sidebar notifications to Telegram. |
| `telegramNotificationButtonsEnabled` | boolean | `false` | Add inline action buttons to forwarded notifications. |
| `telegramAskUserEnabled` | boolean | `false` | Forward `ht ask` questions to Telegram (answer from your phone). |

## Auto-continue

Nested object — see [auto-continue](/features/auto-continue/).

| Field | Type | Default | Effect |
|---|---|---|---|
| `autoContinue.engine` | `"off"` \| … | `"off"` | Which decision engine runs. `off` disables the feature entirely. |
| `autoContinue.dryRun` | boolean | `true` | Decide and log, but never send the continue keystroke. |
| `autoContinue.cooldownMs` | number | `3000` | Minimum gap between continues. |
| `autoContinue.maxConsecutive` | number | `5` | Runaway guard — pauses after this many consecutive continues. |
| `autoContinue.modelProvider` | string | `"anthropic"` | Provider for the model-backed engine. |
| `autoContinue.modelName` | string | `"claude-haiku-4-5-20251001"` | Model used by the model-backed engine. |
| `autoContinue.modelApiKeyEnv` | string | `"ANTHROPIC_API_KEY"` | Env var read for that provider's key. |

## Audits

| Field | Type | Default | Effect |
|---|---|---|---|
| `auditsGitUserNameExpected` | string \| null | `null` | Expected `git config user.name`; the startup audit warns on drift. `null` disables the check. |

## When changes apply

Most fields apply live across all panes the moment they're saved. Exceptions:

- `shellPath` — new surfaces only.
- `webMirrorPort`, `webMirrorBind`, `webMirrorAuthToken` — restart a running mirror (they are honoured on auto-start at launch since v0.3.161).
- `autoStartWebMirror` — only at launch (toggle the mirror manually any time).
- `rpcSocketRequireToken` — applies to new `ht` socket connections immediately.
- `terminalRenderer` — applies to newly created panes.

## Editing the JSON

Safe to edit while τ-mux runs. The file is reloaded on change. Unknown fields are dropped on load with a logger warning, and invalid values fall back to their default.

```bash
$EDITOR ~/Library/Application\ Support/hyperterm-canvas/settings.json
```

## Read more

- [Themes](/configuration/themes/)
- [Environment variables](/configuration/env-vars/)
- [Keyboard shortcuts](/configuration/keyboard-shortcuts/)
