---
title: Binary data (fd 4)
description: How fd 4 carries raw bytes referenced from fd 3 metadata, with named channels for streams.
sidebar:
  order: 3
---

fd 4 carries raw binary payloads that fd 3 metadata rows reference via `byteLength`. There is no framing on fd 4 itself — the metadata side tells the parser exactly how many bytes to read.

## Reading order

If fd 3 emits these in this order:

```jsonl
{"id":"a","type":"image","format":"png","byteLength":4096}
{"id":"b","type":"image","format":"jpeg","byteLength":12000}
```

…the parser reads exactly 4 096 bytes off fd 4, associates them with `id: "a"`, then reads 12 000 bytes for `id: "b"`. Both streams are sequenced.

## Named data channels

Most use cases stick with the default channel (`fd 4`, alias `"data"`). For more elaborate workflows you can declare additional named channels in `HYPERTERM_CHANNELS` and reference them from metadata:

```jsonl
{"id":"raw-vid","type":"canvas2d","dataChannel":"video","byteLength":65536}
```

The default channel is `"data"` (fd 4). Custom channels are not exposed by the default client libraries — they're for advanced integrations that want to multiplex separate data streams (e.g. video frames vs control payloads).

## Backpressure

Writes are blocking. If τ-mux is busy rendering, the script's next write to fd 4 will block until the read pipe drains. This is intentional — non-blocking I/O would risk silent frame loss.

## Memory

Each panel's binary payload becomes an `ArrayBuffer` in the renderer. For images, the buffer is wrapped in a blob URL and assigned to an `<img>` element — when the panel is cleared, the URL is revoked and the buffer is released.

## Limits

There is no hard cap, but practical limits:

- **Per-panel payload** — up to a few MiB is fine. Multi-hundred-MiB images will exhaust webview memory.
- **Burst rate** — backpressure protects you, but emitting frames faster than the renderer can consume just means your script blocks waiting for the renderer.

## Read more

- [Metadata (fd 3)](/sideband/metadata-fd3/)
- [Sideband overview](/sideband/overview/)
