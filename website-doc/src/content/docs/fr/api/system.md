---
title: system.*
description: ping, version, identify, capabilities, tree.
sidebar:
  order: 2
---

Méthodes d'introspection au niveau système.

## system.ping

```json
{ "method": "system.ping", "params": {} }
→ { "result": "PONG" }
```

## system.version

```json
{ "method": "system.version", "params": {} }
→ { "result": { "version": "0.2.79", "build": "…" } }
```

## system.identify

Retourne la surface ayant le focus et ses métadonnées.

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

Liste toutes les méthodes exposées par l'instance τ-mux en cours d'exécution.

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

Utile pour les intégrations d'agent qui s'adaptent à la version à laquelle elles sont attachées.

## system.tree

Espaces de travail / panneaux / surfaces dans un seul arbre.

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

## Équivalents CLI

| Méthode | CLI |
|---|---|
| `system.ping` | `ht ping` |
| `system.version` | `ht version` |
| `system.identify` | `ht identify` |
| `system.capabilities` | `ht capabilities --json` |
| `system.tree` | `ht tree` |
