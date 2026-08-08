---
title: Keyboard shortcuts
description: Every shortcut — defined as data in src/views/terminal/keyboard-shortcuts.ts.
sidebar:
  order: 4
---

Keyboard shortcuts are declared as a `Binding<KeyCtx>[]` array in `src/views/terminal/keyboard-shortcuts.ts`. Each entry has an `id`, `description`, `category`, and a `keyMatch(...)` matcher.

## Workspace + pane

| Shortcut | Action |
|---|---|
| `⌘N` | New workspace |
| `⌘D` | Split right |
| `⌘⇧D` | Split down |
| `⌘W` | Close focused pane |
| `⌘⇧W` | Close workspace |
| `⌘B` | Toggle sidebar |
| `⌘⌥←↑→↓` | Focus neighboring pane |
| `⌃⌘]` / `⌃⌘[` | Next / previous workspace |
| `⌘1`…`⌘9` | Jump to workspace N |

## Overlays

| Shortcut | Action |
|---|---|
| `⌘,` | Settings |
| `⌘⇧P` | Command palette |
| `⌘⌥P` | Process Manager |
| `⌘I` | Pane Info — full detail view for the focused pane |
| `Esc` | Close active overlay (settings, process manager, command palette) |

## Terminal

| Shortcut | Action |
|---|---|
| `⌘F` | Find in terminal |
| `⌘C` / `⌘V` | Copy / paste |
| `⌘=` / `⌘-` / `⌘0` | Font size bigger / smaller / reset |

## Layout

| Shortcut | Action |
|---|---|
| `⌘\` | Collapse the left column — sidebar in Bridge, icon rail in Cockpit, graph in Atlas (which folds to a 44 px workspace rail) |
| `⌘G` | **Atlas only** — open the full-window topology: every workspace expanded down to processes, ports and mirrored agent tasks. `Esc` closes it |

See [Layout variants](/features/layout-variants/).

## Browser

These fire only when a browser pane is focused.

| Shortcut | Action |
|---|---|
| `⌘⇧L` | Open browser in split |
| `⌘L` | Focus browser address bar |
| `⌘[` / `⌘]` | Browser back / forward |
| `⌘R` | Reload browser page |
| `⌥⌘I` | Toggle browser DevTools |
| `⌘F` | Find in page |

## Customizing

There's no GUI shortcut editor yet. To add or change a binding:

1. Edit `src/views/terminal/keyboard-shortcuts.ts`.
2. Append a `Binding<KeyCtx>` entry to `KEYBOARD_BINDINGS` (or `HIGH_PRIORITY_BINDINGS` for shortcuts that must fire even when the palette is visible).
3. Use `keyMatch({ key, meta?, shift?, ctrl?, alt? })` for the matcher.
4. Rebuild.

The `id` / `description` / `category` fields are used by the command palette so users can fuzzy-find every action.

## Read more

- [Command palette](/features/command-palette/)
- [Source: `src/views/terminal/keyboard-shortcuts.ts`](https://github.com/TheSamLePirate/TauMux/blob/main/src/views/terminal/keyboard-shortcuts.ts)
