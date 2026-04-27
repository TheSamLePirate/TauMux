---
title: Workspaces & panes
description: How workspaces, splits, and surfaces relate — and what "surface" actually means.
sidebar:
  order: 2
---

τ-mux organizes work into **workspaces** containing a binary-tree of **panes**. Each pane hosts a **surface** — currently one of: a terminal, a browser, an agent panel, or a Telegram chat.

## The hierarchy

```
Workspace
  └── PaneTree (binary tree of splits)
        └── PaneLeaf
              └── Surface (terminal | browser | agent | telegram)
```

- **Workspace** — independent layout. Switch with `⌘⇧]` / `⌘⇧[` or jump directly with `⌘1…9`.
- **Pane tree** — a binary tree. Every internal node is a horizontal or vertical split with a draggable divider; every leaf is a single surface.
- **Surface** — the actual content. A surface has a stable id (`surface:N`) referenced by every CLI command and RPC call.

## Why "surface"?

A pane is the visual rectangle. The surface is the content inside it. Most of the time the distinction doesn't matter — but when you drag a terminal into another pane, the surface moves while the pane stays. The CLI and RPC speak in surface ids because they care about content, not geometry.

## Splits

| Action | Shortcut | CLI |
|---|---|---|
| Split right | `⌘D` | `ht new-split right` |
| Split down | `⌘⇧D` | `ht new-split down` |
| Split left / up | (drag-and-drop) | `ht new-split left` / `up` |
| Close pane | `⌘W` | `ht close-surface` |
| Focus neighbor | `⌘⌥←↑→↓` | `ht focus-surface --surface surface:N` |

Splits commit on dragging a pane onto a drop zone, or on `ht new-split <direction>`. The default split ratio is 50%; resize by dragging the divider.

## Drag-and-drop

Drag a pane header into another pane to:

- swap two panes
- merge two panes (close the source)
- create a new split in any of four edge zones

The drop overlay shows the target zone before you release. See `src/views/terminal/pane-drag.ts` for the state machine.

## Workspaces are independent

Each workspace has its own:

- Pane tree
- Sidebar status pills
- Process Manager view (the global view aggregates across workspaces)
- Workspace color (a left-border accent)

Closing a workspace (`⌘⇧W`) also kills every shell inside it. The metadata poller drains the dead surfaces on the next tick.

## Persistence

Workspace and pane layout is saved to `~/Library/Application Support/hyperterm-canvas/settings.json`. On restart, terminal surfaces re-spawn shells with the saved cwd and shellPath; non-PTY surfaces (browser, agent, telegram) re-mount with their saved state.

## Read more

- [Architecture](/concepts/architecture/)
- [PTY model](/concepts/pty-model/)
- [Settings](/configuration/settings/)
