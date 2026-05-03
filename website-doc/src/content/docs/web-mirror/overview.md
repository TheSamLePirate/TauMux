---
title: Overview
description: What the web mirror is, who it's for, and how it works.
sidebar:
  order: 1
---

The web mirror is a Bun-served HTTP + WebSocket endpoint that streams the full τ-mux UI to anything on the LAN. Terminal text, sideband panels, metadata chips, and notifications all flow over a single WebSocket.

This is a feature overview — see [Web mirror feature](/features/web-mirror/) for the user-facing summary, and [protocol v2](/web-mirror/protocol-v2/) for wire-format details.

## What it does

- Renders the same xterm.js view as the native app.
- Mirrors workspaces, sidebar, sideband panels, notifications.
- Round-trips stdin (typing in the browser → PTY).
- Exposes port chips that open `http://<host>:<port>` from the **viewer**'s machine.
- Resumes seamlessly across disconnects via a 2 MB ring buffer per session.

## Who it's for

- Phone / iPad as a glanceable monitor while you're away from the desk.
- Pair-programming over a LAN without screen sharing.
- Touch-screen terminals.
- Lightweight remote access without SSH (when the LAN is trusted).

## How to enable

In the τ-mux app:

- **Settings → Network → Auto-start Web Mirror** to turn it on at launch.
- **Settings → Network → Token** to require auth (recommended for any non-loopback bind).
- Note the URL — `http://<your-laptop-ip>:3000` by default.

Or by env (forces auto-start regardless of the setting):

```bash
HYPERTERM_WEB_PORT=3000 bun start
```

## Performance notes

- Stdout coalesced at 16 ms granularity.
- Metadata changes deduped server-side — only deltas go on the wire.
- Resume uses `@xterm/headless` + `SerializeAddon` for a single-frame catch-up snapshot.

## Updates and the service worker

The mirror ships as an installable PWA backed by a service worker. When a new τ-mux build is deployed and a previous SW is still controlling an open page:

- The new SW stays in the `waiting` state — it does **not** auto-activate mid-session.
- The page renders a small banner: **"A new version is available."** with **Reload** and **Later** buttons.
- **Reload** posts `{type: "SKIP_WAITING"}` to the waiting SW; the SW activates; `controllerchange` fires and the page reloads onto the new bundle.
- **Later** dismisses the banner without affecting the running session — the new bundle waits until you reload manually or open a new tab.
- Old caches are deleted in the new SW's `activate` handler — i.e. **only after** you accept the update — so a tab still on the old version doesn't suddenly white-screen on a fresh asset request.

First-install path (no previous SW) is unchanged: the very first SW skips waiting automatically so the app comes up immediately.

## Source files

- `src/bun/web/server.ts` — `Bun.serve`, envelopes, resume, auth.
- `src/bun/web/connection.ts` — per-session ring buffer + seq tracking.
- `src/bun/web/state-store.ts` — server-side cache.
- `src/web-client/` — client bundle.

## Read more

- [Auth and hardening](/web-mirror/auth-and-hardening/)
- [Protocol v2](/web-mirror/protocol-v2/)
- [Web mirror feature page](/features/web-mirror/)
