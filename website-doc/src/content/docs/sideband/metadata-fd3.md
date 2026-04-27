---
title: Metadata (fd 3)
description: Panel definitions, updates, clears — JSONL on fd 3.
sidebar:
  order: 2
---

The metadata channel is JSONL on fd 3. One JSON object per line — each defines a panel, mutates an existing one, or clears it.

## Content types

| Type | Renderer |
|------|----------|
| `image` | `<img>` from a blob URL (PNG, JPEG, WebP, GIF). Requires `byteLength` + bytes on fd 4. |
| `svg` | SVG string as `innerHTML`. The SVG can come either inline in `data` (UTF-8 string) or via `byteLength` on fd 4. |
| `html` | HTML string as `innerHTML`. Same data delivery as `svg`. |
| `canvas2d` | A `<canvas>` rendered via `drawImage`. Requires `byteLength` + bytes on fd 4 (raster image). |
| `update` | Mutate fields on an existing panel id. |
| `clear` | Remove a panel by id. |

Custom content types register through `registerRenderer()` in `src/views/terminal/content-renderers.ts`.

## Panel options

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique panel identifier (per surface). |
| `type` | string | Any content type or `update` / `clear`. |
| `position` | enum | `float` (viewport-fixed, default), `inline` (scrolls with terminal), `fixed` (no chrome). |
| `x`, `y` | number | Position in pixels (origin: top-left of pane). |
| `width`, `height` | number \| `"auto"` | Dimensions. |
| `draggable` | boolean | Allow drag (default: true for `float`, false otherwise). |
| `resizable` | boolean | Allow resize (default: true for `float`, false otherwise). |
| `interactive` | boolean | Forward mouse events to fd 5. |
| `byteLength` | number | Size of binary payload on the data channel. |
| `dataChannel` | string | Named data channel (default: `"data"` = fd 4). |
| `data` | string | Inline UTF-8 payload (alternative to `byteLength`, for text content). |
| `format` | string | For `image`: `png` / `jpeg` / `webp` / `gif`. |
| `opacity` | number | 0.0–1.0. |
| `zIndex` | number | Stacking order. |

## Examples

### Image panel

```jsonl
{"id":"photo","type":"image","format":"png","x":100,"y":50,"width":400,"height":300,"byteLength":24576}
```

Followed by 24 576 raw PNG bytes on fd 4.

### SVG inline

```jsonl
{"id":"chart","type":"svg","x":50,"y":50,"width":400,"height":300,"data":"<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='blue'/></svg>"}
```

### Interactive HTML widget

```jsonl
{"id":"btn","type":"html","x":20,"y":20,"width":200,"height":80,"interactive":true,"data":"<button onclick='alert(1)'>Click</button>"}
```

### Update an existing panel

```jsonl
{"id":"photo","type":"update","x":200,"y":150}
```

Only the fields you pass are changed. Cannot change `type` — clear and recreate instead.

### Clear

```jsonl
{"id":"photo","type":"clear"}
```

Removes the panel and frees its DOM element. Its events are no longer delivered.

## Best practices

- **Use `id`s you can map back to script-side state.** They're echoed on every event.
- **Prefer `inline` over `float` for one-shot output** — they scroll naturally with the terminal text.
- **Set `byteLength`-vs-`data` consciously.** `data` is fine for tiny payloads; for anything > 64 KiB use `byteLength` to skip JSON-string escaping.
- **Don't stream raw frames at 60 fps** — for canvas-style animation, use `update` to send small mutations rather than re-emitting the full payload.

## Source

- `src/views/terminal/panel-manager.ts` — fd 3 dispatch.
- `src/bun/sideband-parser.ts` — JSONL + binary reader.
- `src/shared/types.ts` — panel option types.

## Read more

- [Sideband overview](/sideband/overview/)
- [Binary data (fd 4)](/sideband/data-fd4/)
- [Events (fd 5)](/sideband/events-fd5/)
