---
title: Sidebar & status
description: set-status, clear-status, set-progress, clear-progress, log.
sidebar:
  order: 5
---

Push live status into the τ-mux sidebar without printing to stdout. Designed for build scripts, watchers, agents, and any long-running task that wants to surface progress without polluting the terminal.

## set-status

```bash
ht set-status build "Building"
ht set-status build "ok" --color "#a6e3a1" --icon bolt
ht set-status tests "12/30 passed" --color "#7aa2f7"
```

Posts a status pill to the focused surface's workspace. Pills are keyed by the first arg (`build`, `tests`, …) — calling again with the same key updates in place.

| Flag | Purpose |
|---|---|
| `--color <hex>` | Pill background. Use the project's palette for consistency. |
| `--icon <name>` | Icon ID (subset of [Lucide](https://lucide.dev) — `bolt`, `hammer`, `check`, `x`, `loader`, …). |
| `--surface <id>` | Override target surface. |

## clear-status

```bash
ht clear-status build
```

Removes the keyed pill. Calling with a non-existent key is a no-op.

## set-progress / clear-progress

```bash
ht set-progress 0.42 --label "Tests"
ht clear-progress
```

A progress bar — only one per surface. Value is `0.0`–`1.0`. Use the labels for what's happening (`"Building"`, `"Linting"`, `"Tests 12/30"`).

## log

```bash
ht log "Tests passed"
ht log --level success --source build "All green"
ht log --level error --source eslint "5 issues"
```

Append a log entry to the sidebar's log section. Levels: `info` (default), `success`, `warn`, `error`. The `--source` field groups related entries. Logs persist for the lifetime of the workspace.

## Common patterns

### Build scripts

```bash
#!/bin/bash
ht set-status build "Building" --color "#7aa2f7" --icon hammer

if bun run build; then
  ht set-status build "OK" --color "#a6e3a1" --icon check
  ht log --level success --source build "Build green"
else
  ht set-status build "FAIL" --color "#f7768e" --icon x
  ht log --level error --source build "Build broke"
fi
```

### Watchers

```bash
fswatch ./src | while read change; do
  ht set-progress 0.0 --label "Tests"
  ht set-progress 0.5 --label "Tests (running)"
  bun test
  ht clear-progress
done
```

## Read more

- [JSON-RPC sidebar methods](/api/sidebar/)
- [`ht notify`](/cli/notifications/)
