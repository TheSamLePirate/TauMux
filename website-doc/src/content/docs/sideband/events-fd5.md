---
title: Events (fd 5)
description: Drag, resize, click, system errors — JSONL on fd 5.
sidebar:
  order: 4
---

fd 5 is the back-channel: τ-mux writes JSONL events to your script. Use it to react to drag-end positions, resize commits, clicks on interactive panels, terminal resize events, and protocol errors.

## Reading

The script reads fd 5 line-by-line:

```python
import os
fd5 = os.fdopen(int(os.environ["HYPERTERM_CHANNELS"][...]), "r")  # use the client lib
for line in fd5:
    print("got:", line.strip())
```

Or with the Python client:

```python
from hyperterm import ht
for event in ht.events():
    print(event)
```

## Event shapes

Per-panel events carry the panel `id`:

```jsonl
{"id":"img1","event":"dragend","x":300,"y":400}
{"id":"img1","event":"resize","width":600,"height":400}
{"id":"widget","event":"click","x":42,"y":87,"button":"left"}
{"id":"img1","event":"close"}
```

Click coordinates are panel-local (relative to the panel's top-left). Drag coordinates are pane-local.

## Reserved virtual ids

| Id | Events |
|---|---|
| `__terminal__` | `resize` (cols/rows changed), `focus`, `blur` |
| `__system__` | `error` (with `code` and `message`) |

```jsonl
{"id":"__terminal__","event":"resize","cols":120,"rows":40}
{"id":"__terminal__","event":"focus"}
{"id":"__system__","event":"error","code":"meta-validate","message":"Missing id"}
```

## Error codes

| Code | Meaning |
|---|---|
| `meta-validate` | An fd 3 row failed validation (missing field, bad type). |
| `data-overflow` | An fd 4 read exceeded `byteLength` for the active panel. |
| `unknown-id` | An update / clear / event references a panel that doesn't exist. |
| `renderer-error` | The renderer for the panel's `type` failed. |

These don't terminate the channel — your script can choose to ignore them, log them, or use them to abort.

## Filtering

Most scripts only care about a subset. Filter by `id` and `event`:

```ts
ht.onEvent((e) => {
  if (e.id === "btn" && e.event === "click") {
    handleClick(e.x, e.y);
  }
});
```

Both client libraries provide `onEvent` (TypeScript) / `events()` (Python) generators that simplify this.

## Read more

- [Metadata (fd 3)](/sideband/metadata-fd3/)
- [Sideband overview](/sideband/overview/)
- [Python client](/sideband/python-client/)
- [TypeScript client](/sideband/typescript-client/)
