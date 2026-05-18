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

The M11–M17 plan (0.2.85 → 0.3.0) brought the web mirror to **feature parity with the native sidebar**. The M18 series (0.3.1–0.3.3) chased the multi-pane terminal sizing tail down to zero drift.

| Surface | Behavior in the mirror |
|---|---|
| Terminal text | Full xterm.js rendering with the same theme. Stdin (typing) round-trips. Per-pane `fit()` matches each xterm to its own container — multi-pane layouts size correctly (M18). |
| Pane chips | Same DOM as native (`.surface-bar`, `.surface-chip*`) — shared `renderSurfaceChips` (M16). Cwd / fg command / git / port chips, with click-to-open on the mirror device. |
| Theme + settings broadcast | New `settingsSnapshot` and `htKeysSeen` envelopes (M11) push theme preset, ANSI palette, font, density, `paneGap`, status-bar key order, notification-overlay flags. Theme changes apply without reload. Sensitive fields (auth token, telegram bot token, allowed ids) are dropped server-side. |
| Bottom status bar | Same 26 px data-driven bar as native (M12) — three zones (identity / meters / focus). |
| Sidebar workspace cards | Rich cards matching native: colored stripe, dot + name + pane-count badge, focused command + port chips (+N overflow past 3), CPU + RAM sparkline, pinned-CWD chip row, collapsible pane list, OSC 9;4 progress (M13). Per-workspace CWD pinning via the `selectWorkspaceCwd` envelope. |
| Manifest cards | `package.json` and `Cargo.toml` cards (M14) — same shared `renderManifestCard`. Cargo auto-derives `build`/`run`/`test`/`check`/`clippy`/`fmt`. Script-run clicks fire a Web Notification in v1; real surface spawning is deferred to v1.1. |
| Floating notifications | Per-surface card stack anchored top-right in each pane container (M15) — same DOM + auto-dismiss + hover-pause + +N overflow pill as native. Driven by `notificationOverlayEnabled` / `notificationOverlayMs` from the settings broadcast. |
| Plan panel | A fourth persistent sidebar zone above notifications (M17). Plans, steps, edits, auto-continue audit — all routed through `plansSnapshot` + `autoContinueAudit` envelopes. Audit strip hides when `autoContinueEngine` is off. |
| Logs zone | Polished rows: coloured level badge + `HH:MM:SS` timestamp + source label + body. Click any row to copy `[HH:MM:SS] [source] [level] message`. Header shows `Logs (count) (showing 10)`. |
| Sideband panels | All four content types render. Drag/resize routes back to the host. |
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
