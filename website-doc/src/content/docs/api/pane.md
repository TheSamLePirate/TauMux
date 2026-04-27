---
title: pane.*
description: list — pane-tree introspection.
sidebar:
  order: 6
---

Lower-level pane-tree access. Most workflows use `system.tree` instead, which folds workspaces / panes / surfaces into one structure.

| Method | Params | Result |
|---|---|---|
| `pane.list` | `{ workspaceId?: string }` | `{ panes: PaneNode[] }` |

`PaneNode` is the binary-tree representation:

```ts
type PaneNode =
  | { kind: "leaf"; surfaceId: string; surfaceType: "terminal" | "browser" | "agent" | "telegram" }
  | { kind: "split"; direction: "horizontal" | "vertical"; ratio: number; children: [PaneNode, PaneNode] };
```

`workspaceId` defaults to the current workspace.

## When to use `pane.list` vs `system.tree`

- `system.tree` — most agent / scripting use cases. Gives you everything in one call.
- `pane.list` — when you specifically want the binary-tree structure for one workspace (layout-rendering scenarios).
