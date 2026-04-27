---
title: Overview
description: The fd 3/4/5 sideband protocol — framing, channel map, validation, backpressure.
sidebar:
  order: 1
---

τ-mux opens three extra file descriptors for every shell. Scripts running inside the terminal use them to render structured content (images, SVG, HTML, interactive widgets) into floating canvases — without disturbing the terminal text stream.

## Channel map

The channel map is published in `HYPERTERM_CHANNELS` as JSON, so scripts can adapt if it ever changes. Defaults:

| fd | Direction | Purpose | Format |
|----|-----------|---------|--------|
| **3** | script → terminal | Metadata: panel definitions, updates, clears | JSONL |
| **4** | script → terminal | Binary data referenced from fd 3 | raw bytes, length-prefixed |
| **5** | terminal → script | Events: clicks, drags, resizes, system errors | JSONL |

A script's first read should be:

```bash
echo "$HYPERTERM_CHANNELS"
# {"meta":3,"data":4,"events":5}
```

The client libraries do this automatically.

## Detection

Whether a script is running inside τ-mux:

```bash
[ -n "$HYPERTERM_PROTOCOL_VERSION" ] && echo "inside τ-mux"
```

`HYPERTERM_PROTOCOL_VERSION=1` is set on every shell spawned in a terminal surface. The Python and TypeScript clients detect this and **silently no-op outside τ-mux** — the same script runs in a regular terminal without erroring.

## Framing

### fd 3 — metadata (JSONL)

One JSON object per line. Examples:

```jsonl
{"id":"img1","type":"image","format":"png","x":100,"y":100,"byteLength":4096}
{"id":"chart","type":"svg","position":"float","width":400,"height":300,"byteLength":2048}
{"id":"widget","type":"html","interactive":true,"byteLength":512}
{"id":"img1","type":"update","x":200,"y":200}
{"id":"img1","type":"clear"}
```

Required fields: `id`, `type`. The `id` ties this metadata row to (a) any binary payload on fd 4, (b) future updates / clears, (c) events on fd 5.

### fd 4 — binary data

When a metadata row has `byteLength: N`, exactly N raw bytes follow on fd 4 — no framing, no length prefix beyond the metadata-side `byteLength`. The reader copies N bytes off fd 4 and associates them with the panel id.

If multiple panels are created in quick succession, their fd 4 payloads are read in metadata-emission order.

### fd 5 — events (JSONL)

```jsonl
{"id":"img1","event":"dragend","x":300,"y":400}
{"id":"img1","event":"resize","width":600,"height":400}
{"id":"widget","event":"click","x":42,"y":87}
{"id":"img1","event":"close"}
{"id":"__terminal__","event":"resize","cols":120,"rows":40}
{"id":"__system__","event":"error","code":"meta-validate","message":"Missing id"}
```

`__terminal__` and `__system__` are reserved virtual ids — terminal-level events and protocol errors.

## Validation

τ-mux validates every fd 3 row before creating a panel:

- `id` must be a non-empty string.
- `type` must be a known content type or op (`update`, `clear`).
- `byteLength` must be a non-negative integer.
- `position`, `width`, `height`, `x`, `y` must be numbers / known enums.

Invalid rows produce a `__system__` error event on fd 5 — they don't crash the parser, and don't tear down the channel.

## Backpressure

Both directions are backpressured at the OS level. If the script writes to fd 3 / 4 faster than τ-mux drains, the script blocks on its next `write`. The client libraries use blocking writes intentionally — non-blocking `O_NONBLOCK` would silently drop frames.

## Read more

- [Metadata (fd 3)](/sideband/metadata-fd3/) — full panel option reference
- [Binary data (fd 4)](/sideband/data-fd4/)
- [Events (fd 5)](/sideband/events-fd5/)
- [Python client](/sideband/python-client/)
- [TypeScript client](/sideband/typescript-client/)
- [Demos](/sideband/demos/)
