---
title: Terminal
description: xterm.js with Bun-native PTYs, full mouse support, find-in-buffer, font controls, and sidebar status pills.
sidebar:
  order: 1
---

The terminal layer in τ-mux is xterm.js 5.3 attached to a `Bun.spawn` PTY. It behaves like a real terminal — colors, line editing, mouse reporting, alt-screen TUIs all work.

## What you get

- **Color & font rendering.** Configurable family / size / line height; JetBrains Mono Nerd Font ships bundled.
- **Mouse support.** Click, drag, scroll. Mouse reporting forwards to TUIs that ask for it.
- **Find in buffer.** `⌘F` opens a search bar with regex toggle, case-sensitive toggle, and next/previous navigation.
- **Scrollback.** Default 10 000 lines, configurable in settings.
- **Copy / paste.** `⌘C` / `⌘V`. Selection auto-copies if you set `Settings → Appearance → Copy on select`.
- **Font size live.** `⌘=` / `⌘-` / `⌘0` to bump, shrink, or reset.
- **Themes.** 10 presets (Catppuccin, Tokyo Night, Dracula, Nord, Rosé Pine, Gruvbox, Solarized, Synthwave '84, Everforest, Obsidian) plus per-color overrides.
- **Effects.** Optional WebGL bloom layer; toggle in **Settings → Effects**. Off by default.

## Things the terminal does NOT do

- It does not interpret OSC sequences for image inlining (sixel, kitty graphics protocol). Use the [sideband protocol](/sideband/overview/) instead.
- It does not have shell integration. There is no zsh/bash/fish hook — process metadata comes from the OS, not the shell.
- It does not multiplex shells over a single PTY. Each pane has its own PTY.

## Status pills and progress bars

Anything inside the terminal can post live status into the sidebar without printing to stdout, via the `ht` CLI:

```bash
ht set-status build "Building" --color "#7aa2f7" --icon hammer
ht set-progress 0.42 --label "Tests"
ht log --level success --source build "All tests green"
ht clear-status build
```

The pills show on the workspace card in the sidebar. They survive pane focus changes and are cleared on workspace close. See [Sidebar & status](/cli/sidebar-and-status/).

## Per-pane chips

The pane header shows live chips:

| Chip | What |
|---|---|
| **Foreground command** | Full argv of the foreground process. Click to focus. |
| **cwd** | Current working directory (truncated to home / git root). |
| **Port chips** | One per listening TCP port. Click to open `http://localhost:<port>`. |

All chips are driven by the [live process metadata pipeline](/features/live-process-metadata/), not shell hooks.

## Source files

- `src/views/terminal/surface-manager.ts` — terminal instances, chip rendering.
- `src/views/terminal/terminal-search.ts` — `⌘F` search bar.
- `src/views/terminal/terminal-effects.ts` — WebGL bloom.
- `src/bun/pty-manager.ts` — single PTY: spawn, stdin/stdout, sideband fds.

## Read more

- [PTY model](/concepts/pty-model/)
- [Live process metadata](/features/live-process-metadata/)
- [Sidebar & status CLI](/cli/sidebar-and-status/)
- [Settings: Appearance / Theme / Effects](/configuration/settings/)
