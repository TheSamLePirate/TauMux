---
title: Sideband overview
description: How fd 3, fd 4, and fd 5 let scripts render canvases and receive events without disturbing the terminal text stream.
sidebar:
  order: 4
---

Beyond stdin/stdout/stderr, τ-mux opens **three extra file descriptors** for every shell. Scripts running inside the terminal can use them to render structured content (images, SVG, HTML, interactive widgets) into floating canvases — without disturbing the regular terminal output stream.

## The three channels

| fd | Direction | Purpose | Format |
|----|-----------|---------|--------|
| **3** | script → terminal | Metadata: panel definitions, updates, clears | JSONL (one JSON object per line) |
| **4** | script → terminal | Binary data referenced from fd 3 (PNG bytes, etc.) | raw bytes, length-prefixed via `byteLength` |
| **5** | terminal → script | Events: clicks, drags, resizes, system errors | JSONL |

The channel layout is published in the `HYPERTERM_CHANNELS` env var as JSON, so scripts can adapt if the layout ever changes.

## Why fds and not OSC sequences?

OSC sequences (the iTerm2 way) are simple but tightly bound to the terminal text stream — they steal escape codes, are length-limited in many shells, and break if anything else is reading stdout (e.g. `tee`, pipes). Sideband fds:

- Don't compete with stdout.
- Have native binary support (no base64 round-trip).
- Have a back-channel (fd 5) for the terminal to talk to the script.
- Survive pipes — only the original child sees the fds; piped commands don't.

The trade-off is platform support: only programs running directly inside τ-mux can use the channels. Anything launched via SSH or inside Docker doesn't see them — and the client libraries no-op gracefully in that case.

## Quick taste

Python:

```python
from hyperterm import ht

ht.show_image('photo.png', x=100, y=50, draggable=True)
ht.show_html('<button onclick="alert(1)">Click me</button>', interactive=True)

for event in ht.events():
    print("got:", event)
```

TypeScript:

```ts
import { ht } from "./hyperterm";

const id = ht.showSvg('<svg width="200" height="200">…</svg>', { x: 100, y: 50 });
ht.update(id, { x: 200 });
ht.onEvent((e) => console.log(e));
```

Both libraries are safe no-ops when not running inside τ-mux — detection is a simple `HYPERTERM_PROTOCOL_VERSION` env check.

## Read more

- [Sideband protocol overview](/sideband/overview/) — full framing spec.
- [Metadata (fd 3)](/sideband/metadata-fd3/) — panel definitions, options, ops.
- [Binary data (fd 4)](/sideband/data-fd4/) — byteLength framing, named channels.
- [Events (fd 5)](/sideband/events-fd5/) — drag, resize, click, system errors.
- [Python client](/sideband/python-client/) and [TypeScript client](/sideband/typescript-client/).
