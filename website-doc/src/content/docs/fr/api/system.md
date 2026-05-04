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
→ { "result": { "version": "0.2.82", "build": "…" } }
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

## Méthodes RPC sans verbe CLI

Quelques méthodes RPC ne sont **délibérément pas** câblées dans le CLI `ht`. Elles restent visibles via `ht capabilities --json` et utilisables depuis n'importe quel client RPC personnalisé, mais l'API CLI les omet volontairement — soit parce que leur cas d'usage est purement programmatique (helpers d'audit / nettoyage consommés par la webview elle-même), soit parce que leurs entrées sont difficiles à exprimer en ligne de commande.

| Méthode | Pourquoi pas de CLI ? | À utiliser depuis |
|---|---|---|
| `surface.kill_pid` | L'équivalent côté shell est `ht kill PORT`, qui résout le pid depuis un port en écoute. Tuer un pid arbitraire observé est trop facile à mésuser depuis un pipeline shell ; la méthode rejette aussi les pids qui ne sont pas tracés par un arbre de surface vivant, ainsi que les signaux hors `{SIGTERM, SIGINT, SIGKILL, SIGHUP, SIGQUIT}`. | L'overlay Process Manager (⌘⌥P) et tout script RPC personnalisé qui a déjà le pid en main. |
| `surface.rename` | Les surfaces ne portent pas de nom visible utilisateur aujourd'hui — seulement le chip `pane.label`. La méthode existe pour qu'une future UI de labeling se câble proprement sans bump de schéma. | Outillage interne webview. |
| `notification.dismiss` | L'équivalent CLI serait `ht dismiss <id>`, rarement utile interactivement (l'utilisateur clique simplement sur le X). La webview l'appelle au swipe / clic X. | UI overlay des notifications ; tests d'intégration. |
| `browser.stop_find` | S'apparie avec `browser.find` (`ht browser find-in-page`) ; la moitié « annuler » est exclusivement une préoccupation UI (personne ne tape `ht browser stop-find`). | Overlays type DevTools dans la webview. |
