---
title: sidebar.*
description: set_status, clear_status, set_progress, clear_progress, log.
sidebar:
  order: 5
---

Status pills, progress bars, and log entries — surfaced in the τ-mux sidebar.

| Method | Params | Result |
|---|---|---|
| `sidebar.set_status` | `{ surfaceId?: string, key: string, label: string, color?: string, icon?: string }` | `{ ok: true }` |
| `sidebar.clear_status` | `{ surfaceId?: string, key: string }` | `{ ok: true }` |
| `sidebar.set_progress` | `{ surfaceId?: string, value: number, label?: string }` | `{ ok: true }` |
| `sidebar.clear_progress` | `{ surfaceId?: string }` | `{ ok: true }` |
| `sidebar.log` | `{ surfaceId?: string, level?: "info"\|"success"\|"warn"\|"error", source?: string, message: string }` | `{ ok: true }` |

`value` for `set_progress` is `0.0`–`1.0`. Status pills are keyed by `key` — calling `set_status` with the same key updates the existing pill in place.

## CLI equivalents

| Method | CLI |
|---|---|
| `sidebar.set_status` | `ht set-status <key> "<label>" --color <hex> --icon <name>` |
| `sidebar.clear_status` | `ht clear-status <key>` |
| `sidebar.set_progress` | `ht set-progress <0.0-1.0> --label "<label>"` |
| `sidebar.clear_progress` | `ht clear-progress` |
| `sidebar.log` | `ht log --level <level> --source <source> "<message>"` |
