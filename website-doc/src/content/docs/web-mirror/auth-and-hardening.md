---
title: Auth and hardening
description: Token comparison, origin enforcement, size caps, rate limits — what the mirror does to stay safer on a LAN.
sidebar:
  order: 2
---

The web mirror is designed for trusted networks. The hardening below narrows the surface but doesn't replace network controls — bind to `127.0.0.1` or set a token before exposing it to anything you don't fully control.

## Token auth

Set `webMirrorAuthToken` in **Settings → Network → Token**. Once set, every request must present it:

- Query string: `?t=<token>` — easiest for `<a href>` links.
- Header: `Authorization: Bearer <token>` — preferred for programmatic clients.

Comparison is **constant-time** via `timingSafeEqualStr`. The token can't be brute-forced one byte at a time by latency probing.

If the token is wrong:

- HTTP requests get `401 Unauthorized` with no body.
- WebSocket upgrades are rejected before the handshake completes.

## Origin enforcement

WebSocket upgrades are rejected when the `Origin` header is set and doesn't match `Host`. This prevents browsers on a different site from hijacking the connection over a forged WS request.

Native clients that omit `Origin` (e.g. `curl`, `ht`, custom WebSocket clients) still connect — only browser-originated requests carry `Origin`, and a browser can't fake it.

## Per-frame size caps

Every client → server frame is size-capped:

- 256 KiB per envelope (the JSON wrapper).
- 64 KiB per `stdin` payload (after envelope unpacking).

Oversized frames are dropped silently; the connection stays open.

## Rate limiting

A token bucket limits each connection to 256 frames per second. Excess frames are dropped silently. Generous enough that normal typing and resize bursts pass; tight enough that a misbehaving client can't flood the server.

## Resize clamping

`surfaceResizeRequest` envelopes are validated:

- `cols` clamped to `[10, 500]`.
- `rows` clamped to `[4, 500]`.
- Unparseable values are rejected entirely (no fallback default).

## Session IDs

Resume tokens are 128-bit hex from `crypto.getRandomValues`. No predictable structure — guessing a valid resume id is the same as brute-forcing 128 bits of entropy.

## Bind address

Default bind is `0.0.0.0` (all interfaces). Set `webMirrorBind` to `127.0.0.1` to make the mirror reachable only from the laptop itself — useful when you want the URL but don't want it on the LAN.

## Threat model — what's NOT covered

- **Network sniffing.** The wire is plain WebSocket, not TLS. Anyone on the LAN with packet capture sees stdout. Use a VPN or stick to loopback for sensitive workflows.
- **Privilege escalation inside τ-mux.** A logged-in mirror has full PTY access — same as sitting at the laptop. The token is the gate.
- **Browser exploits.** The mirror serves `innerHTML` from sideband HTML panels. If you render attacker-controlled HTML, you're exposed.

## Source

- `src/bun/web/server.ts` — auth, origin, rate-limit, size-cap logic.

## Read more

- [Web mirror overview](/web-mirror/overview/)
- [Protocol v2](/web-mirror/protocol-v2/)
- [Settings: Network](/configuration/settings/)
