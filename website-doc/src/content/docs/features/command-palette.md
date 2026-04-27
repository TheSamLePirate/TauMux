---
title: Command palette
description: ⌘⇧P — fuzzy-search every action, including the same keyboard shortcuts and CLI commands.
sidebar:
  order: 9
---

`⌘⇧P` opens a fuzzy command palette listing every action — shortcuts, settings toggles, browser commands, workspace operations.

## Why it exists

The palette is the single source of truth for "what can τ-mux do right now". Keyboard shortcuts only get you so far when you can't remember the chord; the palette lets you spell the action name.

It's also the right place to add **commands without a shortcut** — instead of inventing a new chord, drop a `PaletteCommand` entry and let the user fuzzy-find it.

## How it's wired

Commands are declared in `src/views/terminal/index.ts` via `buildPaletteCommands()`. Each entry is:

```ts
{
  id: "browser.open-split",
  label: "Open browser in split",
  category: "Browser",
  icon: "browser",
  shortcut: "⌘⇧L",          // optional
  run: async () => { … },
}
```

Adding a command is a matter of appending to the array — no other registration needed.

## Entries cover

- Workspace actions — new, close, rename, switch.
- Pane actions — splits, focus neighbor, close.
- Browser actions — open URL, focus address bar, devtools.
- Settings toggles — bloom, web mirror, force dark mode, copy-on-select.
- Telegram actions — open chat, refresh.
- App actions — settings, install `ht` CLI, about.

## Source files

- `src/views/terminal/command-palette.ts` — overlay + fuzzy match.
- `src/views/terminal/index.ts` — `buildPaletteCommands()` entries.

## Read more

- [Keyboard shortcuts](/configuration/keyboard-shortcuts/)
