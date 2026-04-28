---
title: ht — overview
description: How the `ht` CLI talks to τ-mux, env vars, --json, and --surface targeting.
sidebar:
  order: 1
---

`ht` is the τ-mux CLI. It talks to a running τ-mux instance through a Unix socket (`/tmp/hyperterm.sock`) using JSON-RPC.

## Install

In a production build, click **τ-mux → Install 'ht' Command in PATH** from the menu — it symlinks the bundled binary at `Contents/MacOS/ht` to `/usr/local/bin/ht`. See [Installation](/getting-started/installation/).

For development:

```bash
bun link              # exposes ./bin/ht as `ht`
```

For a standalone binary on another Mac:

```bash
bun run build:cli     # → ./build/ht-cli
```

## Verify

```bash
ht ping               # → PONG
ht version            # build version
ht identify           # focused surface + workspace
```

## Targeting

Most commands operate on a surface. The CLI resolves the target in this order:

1. `--surface <id>` flag (e.g. `--surface surface:3`)
2. `HT_SURFACE` env var (auto-set inside τ-mux panes)
3. The currently focused surface

So inside a τ-mux pane, `ht ps` "just works" — it reads from your own pane. Outside τ-mux, pass `--surface` explicitly.

Workspace-targeted commands accept `--workspace <id>` (e.g. `--workspace ws:2`).

## JSON output

Every command supports `--json` (or `-j`) to emit raw JSON:

```bash
ht metadata --json | jq .ports
ht ps --json | jq '.tree[0]'
```

Without `--json`, output is human-friendly text — tables for lists, summary lines for status calls.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `HT_SOCKET_PATH` | Override `/tmp/hyperterm.sock` |
| `HT_SURFACE` | Auto-set per spawned shell (CLI default for `--surface`; the server resolves the owning workspace from it for workspace-scoped commands) |
| `HT_WORKSPACE_ID` | Optional override for `--workspace`. **Not** auto-set — export it manually if you want a non-pane shell to default to a specific workspace. |
| `HYPERTERM_WEB_PORT` | Overrides `webMirrorPort` and force-starts the mirror |
| `HYPERTERM_DEBUG` | Enables debug logs in the Python / TS sideband clients |

## Discoverability

```bash
ht capabilities --json    # full method catalogue
ht --help                 # top-level command list
ht <command> --help       # per-command help
```

## Command groups

- [System](/cli/system/) — ping, version, identify, tree, capabilities
- [Workspaces](/cli/workspaces/) — list, new, select, close, rename, next, prev
- [Surfaces & I/O](/cli/surfaces-and-io/) — split, focus, close, send, send-key, read-screen, screenshot
- [Sidebar & status](/cli/sidebar-and-status/) — set-status, set-progress, log
- [Notifications](/cli/notifications/) — notify, list, clear
- [Process & ports](/cli/process-and-ports/) — metadata, ps, cwd, git, ports, open, kill
- [Browser](/cli/browser/) — 40+ commands for built-in browser automation
- [Telegram](/cli/telegram/) — status, chats, read, send
- [Ask-user](/cli/ask-user/) — yesno, choice, text, confirm-command (block on a structured question)
- [Plan](/cli/plan/) — set, update, complete, clear, list (publish multi-step agent plans)
- [Auto-continue](/cli/autocontinue/) — status, audit, set, fire, pause, resume (engine that auto-sends `Continue` on turn-end)

## tmux compat

```bash
ht capture-pane --lines 50    # alias for read-screen
```

The set is intentionally small — only the calls scripts most commonly assume. There is no plan for full tmux compatibility.
