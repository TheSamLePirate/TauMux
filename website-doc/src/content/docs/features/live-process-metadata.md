---
title: Live process metadata
description: A 1 Hz observer that watches every descendant of every shell — cwd, ports, CPU, RSS, git state.
sidebar:
  order: 4
---

A single `SurfaceMetadataPoller` runs in the Bun process and continuously observes every descendant of every shell. Its output drives the pane header chips, the sidebar, the Process Manager, the web mirror, and the `ht` CLI from one source of truth.

## What gets observed

Per surface, every tick:

- **`pid`** — the shell process id.
- **`foregroundPid`** — the tty's foreground process group leader.
- **`cwd`** — current working directory of the foreground process.
- **Descendant tree** — every child / grandchild / … with full argv, CPU%, RSS KB.
- **Listening TCP ports** — deduped by `(pid, port, address)`.
- **Git state** — when `cwd` is inside a git work tree: `branch`, `head`, `upstream`, `ahead` / `behind`, `staged` / `unstaged` / `untracked` / `conflicts` file counts, `insertions` / `deletions` line counts.

## How

Per tick (1 Hz when the window is focused, ~3 Hz when hidden):

- **One** `ps -axo pid,ppid,pgid,stat,%cpu,rss,args -ww` call.
- **One** combined `lsof -iTCP -sTCP:LISTEN` across the union of all tree pids.
- **One** combined `lsof -d cwd` across foreground pids.
- Git calls are TTL-cached per cwd (3 s) so idle panes don't spam git.

Snapshots are diffed against the previous tick. `onMetadata(surfaceId, metadata)` only fires on real change. Emissions fan out to the Electrobun RPC, the WebSocket web mirror, and the `ht` CLI cache.

## Robustness

- The poller runs `ps` / `lsof` as the user — only their own processes are visible.
- Subprocess output is parsed locale-robustly: `LC_ALL=C, LANG=C` is set so decimal separators stay `.`.
- Zombie processes (`Z` in STAT) are excluded from the tree.
- Dead surfaces are drained: when `SessionManager.onSurfaceClosed` fires, the cache is purged on the next tick.
- All subprocess runners return empty maps on failure — the poller never crashes the main process.

## Where it surfaces

| Consumer | What it shows |
|---|---|
| Pane header chips | foreground command, cwd, port chips |
| Sidebar | per-workspace package.json card with running scripts, fg command, ports |
| Process Manager (`⌘⌥P`) | every process across workspaces with kill buttons |
| `ht` CLI | `ht metadata`, `ht ps`, `ht ports`, `ht git`, `ht cwd`, `ht open`, `ht kill` |
| Web mirror | same chips and sidebar, mirrored over WebSocket |
| Pane Info (`⌘I`) | full detail view for the focused pane |

## CLI access

```bash
ht metadata                          # JSON summary: pid / fg / cwd / git / counts
ht cwd                               # print cwd
ht ps                                # process tree with * marker on fg
ht ports                             # PORT PROTO ADDR PID COMMAND
ht git                               # branch, upstream, ahead/behind, dirty, +/-
ht open 3000                         # open http://localhost:3000
ht open                              # resolves the unique listening port
ht kill 3000                         # SIGTERM the pid on :3000
ht kill 3000 --signal SIGKILL
```

Full reference: [`ht` process & ports](/cli/process-and-ports/).

## Source

- `src/bun/surface-metadata.ts` — poller + parsers + diff + emit.
- `src/shared/types.ts` — `SurfaceMetadata`, `ProcessNode` types.

## Read more

- [Process Manager](/features/process-manager/)
- [`ht` process & ports](/cli/process-and-ports/)
- [Architecture](/concepts/architecture/)
