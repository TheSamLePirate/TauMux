---
title: surface.*
description: list, split, close, focus, send_text, send_key, read_text, metadata, wait_ready, open_port, kill_port, kill_pid, screenshot.
sidebar:
  order: 4
---

Surface-level operations. A surface is the content inside a pane (terminal, browser, agent, telegram).

## Lifecycle

| Method | Params | Result |
|---|---|---|
| `surface.list` | `{}` | `{ surfaces: [{ id, type, workspaceId, cwd, label, … }] }` |
| `surface.split` | `{ surfaceId?: string, direction: "left"\|"right"\|"up"\|"down", cwd?: string, shell?: string, ratio?: number }` | `{ id }` |
| `surface.close` | `{ surfaceId?: string }` | `{ ok: true }` |
| `surface.focus` | `{ surfaceId: string }` | `{ ok: true }` |

## I/O

| Method | Params | Result |
|---|---|---|
| `surface.send_text` | `{ surfaceId?: string, text: string }` | `{ bytes: number }` |
| `surface.send_key` | `{ surfaceId?: string, key: string }` | `{ ok: true }` |
| `surface.read_text` | `{ surfaceId?: string, lines?: number, scrollback?: boolean }` | `{ text: string }` |
| `surface.screenshot` | `{ surfaceId?: string }` | `{ pngBase64: string }` |

`key` accepts the same symbolic forms as `ht send-key` — `enter`, `tab`, `escape`, `arrow-up`, `ctrl+c`, etc.

## Metadata + ports

| Method | Params | Result |
|---|---|---|
| `surface.metadata` | `{ surfaceId?: string, follow?: boolean }` | `SurfaceMetadata` (or stream of changes if `follow: true`) |
| `surface.wait_ready` | `{ surfaceId?: string, timeout_ms?: number }` | `SurfaceMetadata \| null` |
| `surface.open_port` | `{ surfaceId?: string, port?: number }` | `{ url, opened: true }` |
| `surface.kill_port` | `{ surfaceId?: string, port: number, signal?: string }` | `{ pid, signal }` |
| `surface.kill_pid` | `{ pid: number, signal?: string }` | `{ pid, signal }` |

`signal` defaults to `SIGTERM`. `surface.metadata` with `follow: true` emits one frame on each change — same payload format as the unfollowed call.

### `surface.wait_ready` — block until metadata is observable

The metadata poller runs at 1 Hz, so a script that spawns a surface and immediately queries `surface.metadata` can win the race and get `null`. `surface.wait_ready` is the explicit synchronization point: it returns the fresh `SurfaceMetadata` snapshot the moment it lands, or `null` if `timeout_ms` (default `2000`, clamped to `30_000`) elapses first.

Use it from automation that needs to block on a freshly-spawned pane before sending input:

```jsonc
// 1. spawn a new pane
{ "id": "1", "method": "surface.split", "params": { "direction": "right" } }
// → { "result": { "id": "surface:7" } }

// 2. wait for it to be observable
{ "id": "2", "method": "surface.wait_ready", "params": { "surface_id": "surface:7", "timeout_ms": 5000 } }
// → { "result": { "surfaceId": "surface:7", "pid": 12345, "fg": null, … } }   ← ready
// → { "result": null }                                                          ← timeout
```

### `surface.open_port` / `surface.kill_port` — startup-race retries

These two methods **no longer throw `no metadata yet — try again in a second`** on the first-tick race. Internally they now poll the metadata cache for up to 2 s before failing with a clearer message: `surface metadata unavailable after 2000ms — pane may have crashed`. Naive scripts no longer need a retry loop wrapped around the call. If you DO want explicit synchronization (e.g. parallel orchestration), use `surface.wait_ready` first.

`SurfaceMetadata` shape:

```ts
{
  surfaceId: string,
  pid: number,
  foregroundPid: number | null,
  cwd: string | null,
  fg: string | null,                // foreground command argv
  tree: ProcessNode[],
  ports: Array<{ port: number, proto: "tcp", addr: string, pid: number }>,
  git: {
    branch: string, head: string, upstream: string | null,
    ahead: number, behind: number,
    staged: number, unstaged: number, untracked: number, conflicts: number,
    insertions: number, deletions: number,
  } | null,
  cpuPct: number,
  rssKb: number,
}
```

## CLI equivalents

| Method | CLI |
|---|---|
| `surface.list` | `ht list-surfaces` |
| `surface.split` | `ht new-split <direction>` |
| `surface.close` | `ht close-surface` |
| `surface.focus` | `ht focus-surface --surface <id>` |
| `surface.send_text` | `ht send "<text>"` |
| `surface.send_key` | `ht send-key <key>` |
| `surface.read_text` | `ht read-screen --lines N` |
| `surface.screenshot` | `ht screenshot --out <path>` |
| `surface.metadata` | `ht metadata --json` |
| `surface.wait_ready` | `ht wait-ready [--timeout-ms N]` |
| `surface.open_port` | `ht open <port>` |
| `surface.kill_port` | `ht kill <port>` |
| `surface.kill_pid` | (RPC-only — see [system page](/api/system/#rpc-only-methods-no-cli-verb)) |
