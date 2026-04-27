---
title: workspace.*
description: list, current, create, select, close, rename, next, previous.
sidebar:
  order: 3
---

Workspace lifecycle. A workspace is an independent layout of panes — see [Workspaces & panes](/concepts/workspaces-and-panes/).

| Method | Params | Result |
|---|---|---|
| `workspace.list` | `{}` | `{ workspaces: [{ id, label, color, … }] }` |
| `workspace.current` | `{}` | `{ id, label }` |
| `workspace.create` | `{ name?: string, cwd?: string }` | `{ id }` |
| `workspace.select` | `{ workspaceId: string }` | `{ ok: true }` |
| `workspace.close` | `{ workspaceId: string }` | `{ ok: true }` |
| `workspace.rename` | `{ workspaceId?: string, name: string }` | `{ ok: true }` |
| `workspace.next` | `{}` | `{ id }` |
| `workspace.previous` | `{}` | `{ id }` |

`workspaceId` defaults to the current workspace where omitted (`rename`).

## Examples

```json
{ "id": "1", "method": "workspace.list", "params": {} }
→ { "id": "1", "result": { "workspaces": [
    { "id": "ws:0", "label": "build", "color": "#7aa2f7" },
    { "id": "ws:1", "label": "docs",  "color": "#a6e3a1" }
] } }

{ "id": "2", "method": "workspace.create", "params": { "name": "scratch", "cwd": "/Users/me/code" } }
→ { "id": "2", "result": { "id": "ws:2" } }
```

## CLI equivalents

| Method | CLI |
|---|---|
| `workspace.list` | `ht list-workspaces` |
| `workspace.current` | `ht current-workspace` |
| `workspace.create` | `ht new-workspace --name <name> --cwd <path>` |
| `workspace.select` | `ht select-workspace --workspace ws:N` |
| `workspace.close` | `ht close-workspace --workspace ws:N` |
| `workspace.rename` | `ht rename-workspace "<name>"` |
| `workspace.next` | `ht next-workspace` |
| `workspace.previous` | `ht previous-workspace` |
