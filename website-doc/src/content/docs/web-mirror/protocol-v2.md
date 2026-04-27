---
title: Protocol v2
description: Envelopes, sequence numbers, resume, ring buffer — the wire format between the web mirror server and client.
sidebar:
  order: 3
---

The web mirror speaks **protocol v2** envelopes. Every frame in either direction is a JSON object with a `type` and a `seq` (server → client only).

## Connect

Open a WebSocket to `/ws` on the mirror's host. Optionally append `?t=<token>` for auth, and `?resume=<id>&seq=<n>` to replay buffered output from a previous session.

```
ws://<host>:3000/ws?t=<token>&resume=<id>&seq=<n>
```

## First frame: hello

The server's first frame describes the session:

```json
{
  "type": "hello",
  "sessionId": "f4a2…",
  "seq": 0,
  "version": 2,
  "settings": { "theme": "obsidian", "paneGap": 4, … },
  "snapshot": {
    "workspaces": [ … ],
    "panels": [ … ],
    "sidebar": { … }
  }
}
```

The client stores `sessionId` for resume, sets up xterm with the snapshot, and starts processing subsequent frames.

## Server → client frames

| `type` | When | Payload |
|---|---|---|
| `hello` | First frame after upgrade. | session id, settings, snapshot |
| `surfaceStdout` | PTY output. | `surfaceId`, `bytes` (base64) |
| `surfaceMetadata` | A surface's metadata changed. | `surfaceId`, full `SurfaceMetadata` |
| `panelCreate` / `panelUpdate` / `panelClear` | Sideband panel lifecycle. | panel options or id |
| `sidebarUpdate` | Status pill / progress / log change. | partial sidebar state |
| `notificationCreate` / `notificationDismiss` | Notifications. | notification record / id |
| `pong` | Reply to a client `ping`. | server time |

Each carries a `seq` — a per-session sequence number incremented on every frame.

## Client → server frames

| `type` | Purpose | Payload |
|---|---|---|
| `surfaceStdin` | Typing into a terminal. | `surfaceId`, `bytes` (base64), capped at 64 KiB |
| `surfaceResizeRequest` | xterm reports new dims. | `surfaceId`, `cols` (10–500), `rows` (4–500) |
| `surfaceFocus` | UI focus follows. | `surfaceId` |
| `panelInteract` | Click / drag / resize on an interactive panel. | panel id, event |
| `ping` | Liveness check. | `nonce` |
| `cancel` | Cancel a streaming method (e.g. metadata follow). | `id` |

Frames are bounded at 256 KiB per envelope and rate-limited at 256/sec per connection.

## Resume

To resume after a disconnect, reconnect with `?resume=<sessionId>&seq=<lastSeqYouSaw>`:

- The server checks its ring buffer (2 MB per session) for everything since `seq`.
- If found: the server replays missed frames in order, then resumes live streaming.
- If missing or expired: the server emits a fresh `hello` and the client re-snapshots.

## Stdout coalescing

PTY output is coalesced at 16 ms granularity. Many small writes within a single frame interval are flushed as one `surfaceStdout` envelope. Keeps frame rate at ≤ 60 Hz without losing perceptual responsiveness.

## Snapshot replay

For resume scenarios where the ring buffer is too small (e.g. minutes of disconnect), the server uses `@xterm/headless` + `SerializeAddon` to compute a single-frame "current state" snapshot of the terminal — colors, cursor position, alt-screen — and ships that instead of streaming the full historical byte stream.

## Source

- `src/bun/web/server.ts` — envelope dispatch.
- `src/bun/web/connection.ts` — `SessionBuffer` (ring buffer, seq, backpressure).
- `src/web-client/transport.ts` — client-side envelope handling.
- `src/web-client/protocol-dispatcher.ts` — server-message → store-action dispatch.

## Read more

- [Web mirror overview](/web-mirror/overview/)
- [Auth and hardening](/web-mirror/auth-and-hardening/)
