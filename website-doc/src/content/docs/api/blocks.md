---
title: blocks.*
description: Command blocks from OSC 133 shell integration — what ran, what it returned, how long it took.
sidebar:
  order: 5
---

Command **blocks** are what OSC 133 shell integration gives you that the metadata poller cannot: boundaries. The poller sees processes exist and stop existing; only the shell knows that a command started here, ended there, and returned `2`.

These methods are therefore **conditional on the optional integration** being installed — see [`ht shell-integration`](/cli/surfaces-and-io/#shell-integration). Every response carries `integration_detected` so a caller can tell "no commands yet" apart from "this shell isn't reporting". Without it, the list is simply always empty.

τ-mux's zero-config baseline is unaffected: cwd, foreground command, ports, CPU and memory keep working in any shell whether or not you install this.

## Methods

| Method | Params | Result |
|---|---|---|
| `blocks.last` | `{ surface_id?: string, output?: boolean }` | `{ integration_detected, block }` |
| `blocks.list` | `{ surface_id?: string, limit?: number, output?: boolean }` | `{ integration_detected, blocks: [] }` |
| `blocks.current` | `{ surface_id?: string, output?: boolean }` | `{ integration_detected, block }` |

`surface_id` defaults to the focused surface.

`output` controls whether captured stdout/stderr is attached. It defaults to **true** for `blocks.last` (the "did that succeed, and what did it print" question is one question) and **false** for `blocks.list` and `blocks.current` — a 50-block list with output attached is a megabyte-scale response nobody asked for.

## Block shape

```json
{
  "id": 12,
  "command": "bun test",
  "exit_code": 1,
  "started_at": 1754650000000,
  "ended_at": 1754650004200,
  "duration_ms": 4200,
  "running": false,
  "output": "…",
  "output_truncated": false
}
```

`exit_code` is `null` while a command is running, and also when the shell reported that a command finished without saying how — that is not the same as `0` and is not reported as it.

`blocks.current` returns the block that is executing right now, or `null`. This is distinct from `surface.metadata`'s foreground command: this is the shell's own account of what it launched, not an inference from the process tree.

## Limits

Blocks are capped at 50 per surface. Captured output is capped at 16 KB per block and 64 KB per surface in total, with the oldest output dropped first — metadata (command, exit code, timing) survives, since that is what most callers want. `output_truncated` tells you when either cap bit.

A terminal that has been open for a week must not be holding a week of build logs.
