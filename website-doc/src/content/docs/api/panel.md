---
title: panel.*
description: list — read the canvas panels open in a surface.
---

Read-only view of the [canvas panels](/features/canvas-panels/) a surface has
open. Panels are created by the [sideband protocol](/sideband/overview/), not
by RPC; this method exposes the bun-side mirror of that state.

| Method | Params | Result |
|---|---|---|
| `panel.list` | `{ surface_id? }` | `Panel[]` — empty array when the surface has none |

`surface_id` defaults to the focused surface (or `HT_SURFACE` from the CLI).

See [`ht list-panels`](/cli/surfaces-and-io/).
