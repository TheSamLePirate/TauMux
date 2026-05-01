---
title: sidebar.*
description: set_status, clear_status, set_progress, clear_progress, log.
sidebar:
  order: 5
---

Pastilles de statut, barres de progression et entrées de journal — exposées dans la barre latérale de τ-mux.

| Méthode | Params | Résultat |
|---|---|---|
| `sidebar.set_status` | `{ surfaceId?: string, key: string, label: string, color?: string, icon?: string }` | `{ ok: true }` |
| `sidebar.clear_status` | `{ surfaceId?: string, key: string }` | `{ ok: true }` |
| `sidebar.set_progress` | `{ surfaceId?: string, value: number, label?: string }` | `{ ok: true }` |
| `sidebar.clear_progress` | `{ surfaceId?: string }` | `{ ok: true }` |
| `sidebar.log` | `{ surfaceId?: string, level?: "info"\|"success"\|"warn"\|"error", source?: string, message: string }` | `{ ok: true }` |

`value` pour `set_progress` est compris entre `0.0` et `1.0`. Les pastilles de statut sont indexées par `key` — appeler `set_status` avec la même clé met à jour la pastille existante en place.

## Équivalents CLI

| Méthode | CLI |
|---|---|
| `sidebar.set_status` | `ht set-status <key> "<label>" --color <hex> --icon <name>` |
| `sidebar.clear_status` | `ht clear-status <key>` |
| `sidebar.set_progress` | `ht set-progress <0.0-1.0> --label "<label>"` |
| `sidebar.clear_progress` | `ht clear-progress` |
| `sidebar.log` | `ht log --level <level> --source <source> "<message>"` |
