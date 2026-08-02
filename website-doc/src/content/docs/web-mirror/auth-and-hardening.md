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

:::note[Fixed in v0.3.161 — token applies on auto-start]
Previously the configured token (and bind address) were honored **only** when you toggled the mirror on manually in Settings. When the mirror auto-started at app launch — or when its port changed — it silently fell back to binding `0.0.0.0` with **no auth**, ignoring your configured token / loopback bind. This is fixed: a configured token and a `127.0.0.1` bind now take effect on auto-start too.
:::

### `?t=…` is scrubbed from the URL after first auth

When the page loads from a `?t=<token>` link, the browser captures the token at module-load time and then **removes it from `window.location` via `history.replaceState`** as soon as the first WebSocket open succeeds. Reconnects keep authenticating because the token survives in module scope — only the URL gets cleaned. Net effect: the token can't leak via screenshare, the back/forward stack, copy-paste of the URL, or `Referer` headers from outbound links.

If the initial connection fails (401, network error), the URL is intentionally left intact so the failure stays debuggable — you still see the token you supplied in the address bar and can copy/edit it.

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

As of **v0.3.161** this bind address is honored on auto-start as well — not just when toggling the mirror on manually (see the note under [Token auth](#token-auth)).

## RPC socket token

The `ht` CLI talks to the app over a Unix socket. The socket file is created with mode `0600`, so only the same OS user can open it. That's the baseline boundary.

A second layer landed in **v0.3.163** and is **on by default since v0.4.12**: **Settings → Network → "Require RPC socket token"**. The socket requires a per-boot token for **state-mutating** commands — typing into panes, killing processes, creating splits, installing extensions, and the like. **Read-only diagnostics** stay open even without the token, so a token mismatch can still be diagnosed:

- `ht version`
- `ht identify`
- `ht doctor`
- tree / read-screen and other inspection commands

The bundled `ht`, the pi / Claude bridges, and the extension SDK read and present the token automatically — nothing to configure on those paths, which is why the default could flip without breaking first-party workflows. **Older external `ht` installs lose mutating commands until updated** (their read-only diagnostics keep working); turn the setting off only for a third-party client that speaks the socket protocol directly and has not been taught to send `__token`.

The token is written to a file named `socket.token` (mode `0600`) beside the socket. Set the env var `HT_RPC_TOKEN_PATH` to override that path.

**Threat model — be explicit:** this is *defense-in-depth* against an opportunistic same-user process that speaks JSON-RPC to a well-known socket path. It is **not** a hard security boundary — any same-user process can also read the `0600` token file. It raises the bar; it doesn't seal it.

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
