---
title: surface.*
description: list, split, close, focus, send_text, send_key, read_text, metadata, open_port, kill_port, kill_pid, screenshot.
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
| `surface.open_port` | `{ surfaceId?: string, port?: number }` | `{ url, opened: true }` |
| `surface.kill_port` | `{ surfaceId?: string, port: number, signal?: string }` | `{ pid, signal }` |
| `surface.kill_pid` | `{ pid: number, signal?: string }` | `{ pid, signal }` |

`signal` defaults to `SIGTERM`. `surface.metadata` with `follow: true` emits one frame on each change — same payload format as the unfollowed call.

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
| `surface.open_port` | `ht open <port>` |
| `surface.kill_port` | `ht kill <port>` |
| `surface.kill_pid` | `ht kill --pid <pid>` |
