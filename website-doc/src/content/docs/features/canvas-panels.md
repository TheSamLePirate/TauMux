---
title: Canvas panels
description: Floating SVG, HTML, image, and canvas2d overlays driven by extra file descriptors. Independent DOM elements — draggable, resizable, interactive.
sidebar:
  order: 5
---

Canvas panels are floating overlays rendered above the terminal text layer. Scripts running inside the terminal define them through the [sideband protocol](/sideband/overview/) — each panel is an independent DOM element with its own position, size, and content.

## What you can render

| Type | Renderer |
|------|----------|
| `image` | `<img>` from a blob URL (PNG, JPEG, WebP, GIF) |
| `svg` | SVG string as `innerHTML` |
| `html` | HTML string as `innerHTML` (interactive widgets, forms, charts) |
| `canvas2d` | A `<canvas>` element with bytes drawn via `drawImage` |

Custom types register through `registerRenderer()` in `content-renderers.ts`.

## Position modes

| Position | Behavior |
|----------|----------|
| `float` | Viewport-fixed. Stays in place when the terminal scrolls. Default. |
| `inline` | Scrolls with the terminal text. Anchored to the line where it was created. |
| `fixed` | No chrome (no header / close / drag handle) — raw overlay rendered as-is. |

## Interaction

- **Drag** — click-and-drag the panel header (default for `float`).
- **Resize** — drag the bottom-right corner (default for `float`).
- **Mouse forward** — set `interactive: true` and the panel forwards click / move events to fd 5 so the script can react.
- **Keyboard** — panels never receive keyboard input. Keystrokes always go to xterm.js → stdin.

## Lifecycle

```
1. Script writes to fd 3:                          { "id": "x", "type": "svg", … }
2. (If byteLength > 0) script writes raw bytes to fd 4
3. τ-mux creates a panel, renders into a DOM element
4. Script writes update / clear ops to fd 3 to mutate / remove
5. (If interactive) τ-mux writes events to fd 5
```

The panel is destroyed when:

- The script writes `{"id":"x","type":"clear"}` to fd 3.
- The user clicks the close button (panels with chrome).
- The shell exits — all panels for the surface are wiped.

## Performance

Each panel is its own DOM element with CSS transforms. There is no shared canvas. Stacking is purely z-index. Drag and resize use pointer events, not animation frames — the browser can optimize the compositor layer.

## Source files

- `src/views/terminal/panel-manager.ts` — panel lifecycle, fd 3 dispatch.
- `src/views/terminal/panel.ts` — single panel: drag, resize, render.
- `src/views/terminal/content-renderers.ts` — extensible renderer registry.
- `src/bun/sideband-parser.ts` — multi-channel JSONL + binary reader.
- `src/bun/event-writer.ts` — fd 5 JSONL event writer.

## Read more

- [Sideband overview](/sideband/overview/)
- [Metadata (fd 3)](/sideband/metadata-fd3/) — full panel option reference.
- [Binary data (fd 4)](/sideband/data-fd4/)
- [Events (fd 5)](/sideband/events-fd5/)
- [Demos](/sideband/demos/)
