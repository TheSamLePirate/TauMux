---
title: Sharebin
description: Drop a file or paste text, get a short URL served from the local web mirror. For sharing screenshots, logs, or one-off snippets across machines.
sidebar:
  order: 8
---

Sharebin is a tiny pastebin-style mailbox served from τ-mux's web mirror. It lets you drop a file (image, log, code snippet) into a sidebar slot and immediately get a short URL like `http://<your-ip>:3000/share/abc123` that anyone on the LAN (or anyone with a valid auth token) can fetch.

## What you'd use it for

- "Hey, what's that error on your screen?" — `ht share screenshot.png`, paste the URL.
- Forwarding a build log to a teammate without bouncing it through Slack.
- Sharing the output of a long command between two τ-mux instances on the same network.

## How it works

- Files live under `~/Library/Application Support/hyperterm-canvas/sharebin/` keyed by random short ids.
- The web mirror serves `/share/<id>` for each entry, applying the same auth checks as the rest of the mirror.
- A sidebar panel lists current entries with size / created-at / one-click delete.
- Entries are not auto-expired — clean them up explicitly (UI button or `ht share clear`).

## Adding entries

- **Drag-and-drop** a file onto the sharebin sidebar panel.
- **Paste text** with `⌘V` while the panel is focused — text becomes a `.txt` entry.
- From a script: write a file under the sharebin dir and post a metadata row through the standard channel (planned).

## Hardening

Same protections as the rest of the [web mirror](/web-mirror/auth-and-hardening/):

- Token auth applies — `Authorization: Bearer <token>` or `?t=<token>` on the URL.
- Origin / size / rate-limit checks apply to GET as well.
- Sharebin entries are read-only over HTTP. The web mirror cannot upload — entries can only be created from the host.

## Source files

- `src/bun/sharebin.ts` — entry registry, metadata, file lookup.
- `src/bun/web/server.ts` — `/share/:id` route.
- `src/views/terminal/sidebar.ts` — sharebin sidebar panel.

## Read more

- [Web mirror overview](/web-mirror/overview/)
- [Auth and hardening](/web-mirror/auth-and-hardening/)
