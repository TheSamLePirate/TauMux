---
title: Web mirror
description: The full native UI streamed over WebSocket. Token auth, origin checks, resume-on-reconnect.
sidebar:
  order: 6
---

The web mirror is an optional Bun HTTP + WebSocket server that streams the entire τ-mux UI to anything on the LAN. Terminal output, sideband panels, metadata chips, and notifications all flow over a single WebSocket.

## Quick start

1. **Settings → Network → Auto-start Web Mirror**.
2. Note the URL — defaults to `http://<your-laptop-ip>:3000`.
3. Open it from any device on the LAN (phone, iPad, another laptop).

Or start it on every launch by setting `HYPERTERM_WEB_PORT` in your shell env — see [Environment variables](/configuration/env-vars/).

## What's mirrored

| Surface | Behavior in the mirror |
|---|---|
| Terminal text | Full xterm.js rendering with the same theme. Stdin (typing) round-trips. |
| Pane chips | Live cwd / fg command / port chips. Click a port chip to open it on the mirror device. |
| Sidebar | Workspaces, status pills, log entries. |
| Sideband panels | All four content types render. Drag/resize routes back to the host. |
| Notifications | Mirrored. |
| Process Manager | Read-only in the mirror (no kill button — yet). |

## Auth and hardening

The mirror is designed for trusted networks but the surface is deliberately narrowed:

- **Token auth.** Set `webMirrorAuthToken` to require `?t=<token>` (or `Authorization: Bearer <token>`) on every request. Comparison is **constant-time** via `timingSafeEqualStr` so the token can't be brute-forced one byte at a time by latency probing.
- **Origin enforcement.** WebSocket upgrades are rejected when the `Origin` header is set and doesn't match `Host`. Browsers on a different site can't hijack the connection. Native clients that omit `Origin` (e.g. `curl`, `ht`) still connect.
- **Per-frame size cap.** 256 KiB per envelope, 64 KiB per `stdin` payload.
- **Per-connection rate limit.** 256 frames/sec via a token bucket — oversized or too-fast frames are dropped silently.
- **Resize clamping.** `surfaceResizeRequest` clamps cols to `[10, 500]` and rows to `[4, 500]`. Unparseable values are rejected entirely rather than forwarded.
- **Random session IDs.** 128-bit hex from `crypto.getRandomValues` — no predictable structure for resume-id guessing.

## Resume on reconnect

Each session has a 2 MB ring buffer of stdout. On reconnect (with `?resume=<id>&seq=<n>`), the server replays everything since `seq` so xterm renders exactly the right state. If the resume id is unknown the server falls back to a fresh `hello` envelope.

Terminal-state-correct replay uses `@xterm/headless` + `SerializeAddon` server-side, so reconnecting clients catch up via a single serialized snapshot rather than streaming hours of historical bytes.

## Performance

- Stdout is coalesced at 16 ms granularity (one frame per browser repaint).
- Metadata changes are deduped — the server only sends what changed.
- The wire format is **protocol v2 envelopes** — see [Web mirror protocol v2](/web-mirror/protocol-v2/).

## Settings

| Setting | Default | Effect |
|---|---|---|
| `webMirrorPort` | `3000` | Port to listen on. Restarts a running mirror on change. |
| `webMirrorBind` | `0.0.0.0` | Bind address. Set to `127.0.0.1` to keep it local-only. |
| `webMirrorAuthToken` | `""` (off) | If set, every request must present the token. |
| `autoStartWebMirror` | `false` | Whether the mirror starts at app launch. |

`HYPERTERM_WEB_PORT` env var overrides `webMirrorPort` and forces auto-start regardless of the setting.

## Source files

- `src/bun/web/server.ts` — `Bun.serve`, envelope protocol, resume, auth.
- `src/bun/web/connection.ts` — per-session ring buffer, seq tracking, backpressure.
- `src/bun/web/state-store.ts` — server-side cache of metadata / panels / sidebar.
- `src/web-client/` — the client bundle (transport, store, views).

## Read more

- [Auth and hardening](/web-mirror/auth-and-hardening/)
- [Protocol v2](/web-mirror/protocol-v2/)
- [Settings: Network](/configuration/settings/)
