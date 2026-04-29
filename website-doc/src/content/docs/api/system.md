---
title: system.*
description: ping, version, identify, capabilities, tree.
sidebar:
  order: 2
---

System-level introspection methods.

## system.ping

```json
{ "method": "system.ping", "params": {} }
→ { "result": "PONG" }
```

## system.version

```json
{ "method": "system.version", "params": {} }
→ { "result": { "version": "0.2.77", "build": "…" } }
```

## system.identify

Returns the focused surface and its metadata.

```json
{ "method": "system.identify", "params": {} }
→ {
  "result": {
    "workspaceId": "ws:0",
    "surfaceId": "surface:1",
    "metadata": { "pid": 11234, "fg": "bun run dev", "cwd": "/Users/me/code/foo", … }
  }
}
```

## system.capabilities

Lists every method the running τ-mux exposes.

```json
{ "method": "system.capabilities", "params": {} }
→ {
  "result": {
    "methods": [
      { "name": "system.ping", "params": [] },
      { "name": "surface.split", "params": [{ "name": "direction", "type": "string", "required": true }, …] },
      …
    ]
  }
}
```

Useful for agent integrations that adapt to whatever version is attached.

## system.tree

Workspaces / panes / surfaces in one tree.

```json
{ "method": "system.tree", "params": {} }
→ {
  "result": {
    "workspaces": [
      {
        "id": "ws:0",
        "label": "build",
        "panes": [
          {
            "kind": "split",
            "direction": "right",
            "children": [
              { "kind": "leaf", "surface": { "id": "surface:1", "type": "terminal", … } },
              { "kind": "leaf", "surface": { "id": "surface:2", "type": "terminal", … } }
            ]
          }
        ]
      }
    ]
  }
}
```

## CLI equivalents

| Method | CLI |
|---|---|
| `system.ping` | `ht ping` |
| `system.version` | `ht version` |
| `system.identify` | `ht identify` |
| `system.capabilities` | `ht capabilities --json` |
| `system.tree` | `ht tree` |
