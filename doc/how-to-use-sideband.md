# How to Use the Sideband Protocol

A hands-on guide to rendering images, SVG, HTML, and interactive canvases
on top of a τ-mux terminal using `scripts/hyperterm.py` (Python)
or `scripts/hyperterm.ts` (Bun / TypeScript). Demo scripts under `scripts/`
show every feature end-to-end.

> **If you want the raw wire format**, read [`doc/system-sideband-protocol.md`](./system-sideband-protocol.md).
> This doc is for scripts that just want to show something.

---

## 0. One-minute example

Inside any τ-mux terminal pane, from this repo root:

```bash
python3 scripts/demo_interactive.py
```

You should see a button float above the terminal. Clicking it updates a
counter inside the panel and streams events back on fd 5. Press Ctrl-C to
clear and exit.

If you see `"Not running inside τ-mux."`, the current shell
isn't a τ-mux pane — make sure you're in the app, not an external
terminal.

---

## 1. What sideband is and isn't

Sideband is a three-fd side channel in the PTY that lets scripts render
structured content (images, SVG, HTML, canvases, arbitrary custom types)
on top of the terminal without going through escape sequences, and lets
the user interact with that content (click, drag, resize, close) without
corrupting the terminal buffer.

Three channels, allocated when the pane spawns:

| fd  | env var               | name     | direction      | encoding | who writes / reads |
| --- | --------------------- | -------- | -------------- | -------- | ------------------ |
| 3   | `HYPERTERM_META_FD`   | `meta`   | script → app   | JSONL    | script writes panel descriptors |
| 4   | `HYPERTERM_DATA_FD`   | `data`   | script → app   | binary   | script writes the raw bytes (PNG, SVG, HTML) |
| 5   | `HYPERTERM_EVENT_FD`  | `events` | app → script   | JSONL    | script reads user interactions |

All three are allocated by the PTY manager at spawn time
(`src/bun/pty-manager.ts:124–141`) and exported through `HYPERTERM_CHANNELS`
so scripts can discover extra channels declared on the bun side.

**It is not:**
- A drawing API (you supply finished bytes; the app renders them).
- An escape-sequence protocol (doesn't share an ABI with xterm).
- A sandboxed medium — HTML from fd 4 runs in the webview's DOM.
  Trusted scripts only.

---

## 2. Using the Python library — `scripts/hyperterm.py`

```python
from hyperterm import ht

if not ht.available:
    print("not in τ-mux")
    sys.exit(0)

# Show a floating SVG panel
panel_id = ht.show_svg(
    '<svg width="200" height="80" xmlns="http://www.w3.org/2000/svg">'
    '  <rect width="200" height="80" rx="12" fill="#1e293b"/>'
    '  <text x="100" y="50" text-anchor="middle"'
    '        fill="#e2e8f0" font-family="sans-serif" font-size="20">'
    '    Hello'
    '  </text>'
    '</svg>',
    x=100, y=100, width=200, height=80,
    interactive=True,
)

# React to clicks
ht.on_click(panel_id, lambda e: print(f"clicked at {e['x']},{e['y']}"))
ht.on_close(panel_id, lambda: print("closed"))

# Block until events stop (user closed the panel or Ctrl-C)
ht.run_event_loop()
```

Full API surface (all defined in `scripts/hyperterm.py`):

**Content helpers**
- `ht.show_image(path, ...)` — PNG/JPEG/GIF/WebP; `format` auto-detected from extension.
- `ht.show_svg(svg, ...)` — SVG string.
- `ht.show_html(html, ...)` — HTML fragment.
- `ht.show_canvas(png_bytes, ...)` / `ht.show_canvas_file(path, ...)` —
  PNG decoded into an HTML canvas (allows efficient live re-rendering).

**Updates**
- `ht.update(panel_id, **fields)` — patch any panel attribute. Pass
  `data=bytes` or `data=str` to replace content.
- `ht.move(panel_id, x, y)`, `ht.resize(panel_id, w, h)`,
  `ht.set_opacity(...)`, `ht.set_z_index(...)`, `ht.set_interactive(...)`.
- `ht.clear(panel_id)` — remove.
- `ht.flush(channel_name="data")` — abort a stuck binary read and resync.

**Events** (called for every reading strategy below)
- `ht.on_event(cb)` — raw events (pointer, wheel, drag, resize, close, error, terminal-resize).
- `ht.on_click(id, cb)`, `ht.on_mouse_{down,up,move,enter,leave}(id, cb)`.
- `ht.on_wheel(id, cb)`.
- `ht.on_drag(id, cb)` — `dragend` only (the app tracks live drag itself).
- `ht.on_panel_resize(id, cb)`, `ht.on_close(id, cb)`.
- `ht.on_terminal_resize(cb)` — fires on pane size changes.
- `ht.on_error(cb)` — protocol errors; see §7.

**Event loops**
- `ht.run_event_loop()` — blocking until fd 5 closes.
- `ht.poll_events()` — non-blocking (uses `select`); call in your own loop.
- `ht.read_event()` / `ht.events()` — manual iteration.

**Low-level**
- `ht.send_meta(dict)`, `ht.send_data(bytes)`, `ht.get_channel_fd(name)`.

---

## 3. Using the TypeScript library — `scripts/hyperterm.ts`

```ts
import { TauMux } from "./hyperterm";

const ht = new TauMux();
if (!ht.available) {
  console.log("not in τ-mux");
  process.exit(0);
}

const id = ht.showHtml(
  `<div style="padding:16px;background:#1e293b;color:#e2e8f0;font-family:sans-serif;">
     <h3 style="margin:0 0 8px;">Hello</h3>
     <button id="go" style="padding:6px 12px;">Click me</button>
   </div>`,
  { x: 100, y: 100, width: 220, height: 120, interactive: true },
);

ht.onClick(id, (e) => console.log("click", e.x, e.y));
await ht.waitForClose(id);
```

The TypeScript surface mirrors Python 1:1 — same panel types, same
options, same events — with camelCase names and `Uint8Array` for binary
payloads. Every demo script under `scripts/demo_*.ts` imports this lib.

Option bag for every `show*`:

```ts
interface PanelOptions {
  x?: number;  y?: number;            // float / overlay / fixed only
  width?: number | "auto";            // "auto" lets the image/SVG decide
  height?: number | "auto";
  position?: "float" | "inline" | "overlay" | "fixed";
  anchor?: "cursor" | { row: number }; // inline only
  draggable?: boolean;  resizable?: boolean;
  interactive?: boolean;              // forward pointer/wheel events to fd 5
  zIndex?: number;  opacity?: number; borderRadius?: number;
  dataChannel?: string;               // for multi-channel streams
  timeout?: number;                   // ms — parent aborts binary read
  format?: "png" | "jpeg" | "webp" | "gif"; // image only
}
```

---

## 4. Positioning cheat sheet

| `position` | Anchored to         | Drag? | Reflows on xterm scroll? | Good for |
| ---------- | ------------------- | ----- | ------------------------ | -------- |
| `inline`   | a specific row      | no    | yes                      | Plots attached to command output |
| `float`    | pixel coords in pane | yes   | no                       | Movable tools, palettes |
| `overlay`  | pixel coords         | yes   | no                       | Modals, popups |
| `fixed`    | pixel coords (viewport) | no  | no                       | HUDs, status lights |

`inline` + `anchor: "cursor"` is the default for output-attached panels
— the app resolves the current cursor row at creation time and the panel
follows that row as the user scrolls.

Positioning is applied in the webview at `src/views/terminal/panel.ts:185–203`;
inline scroll tracking lives in `src/views/terminal/panel-manager.ts:149–162`.

---

## 5. Content types

| `type`      | Source                                  | Notes |
| ----------- | --------------------------------------- | ----- |
| `image`     | PNG / JPEG / GIF / WebP bytes on fd 4   | `format` hints MIME. |
| `svg`       | SVG XML on fd 4 **or** inline `data:""` | For small SVGs, inline is lower-latency. |
| `html`      | HTML fragment on fd 4 **or** inline     | Runs in the webview's DOM — no sandbox. |
| `canvas2d`  | PNG bytes on fd 4                       | Decoded via `createImageBitmap`; efficient for live rendering. |
| custom      | Any `type` string                       | Dispatched to a registered renderer; see §9. |

Plus three **protocol ops** (not renderers):

- `"update"` — patch an existing panel. Any subset of fields is accepted.
- `"clear"` — remove the panel immediately.
- `"flush"` — abort any in-flight read on `dataChannel` (default `"data"`).
  Use when you've sent a partial frame and want to resync.

Dispatch happens in `src/bun/sideband-parser.ts:147–254` on the bun side
and in the renderer registry on the webview side
(`src/views/terminal/content-renderers.ts`, `src/web-client/panel-renderers.ts`).

---

## 6. Events — reacting to the user

Set `interactive: true` on a panel to forward mouse / wheel events to fd 5.
Drag, resize, and close events fire regardless of `interactive` (they're
user actions on the panel's chrome, not its content).

Event shapes sent on fd 5:

```json
{"id":"plot1","event":"click","x":42,"y":17,"button":0,"buttons":1}
{"id":"plot1","event":"wheel","x":42,"y":17,"deltaX":0,"deltaY":-90}
{"id":"plot1","event":"dragend","x":300,"y":200}
{"id":"plot1","event":"resize","width":480,"height":320}
{"id":"plot1","event":"close"}
{"id":"__terminal__","event":"resize","cols":120,"rows":40,"pxWidth":1200,"pxHeight":800}
{"id":"__system__","event":"error","code":"data-timeout","message":"…","ref":"plot1"}
```

The `__terminal__` pseudo-panel fires every time the pane resizes —
useful to re-render a canvas at the new pixel dimensions.

Event dispatch is in `src/bun/event-writer.ts:12–24` (bun → fd 5) and
consumed by the Python / TS helpers above.

---

## 7. Errors

Malformed meta, oversized payloads, or stuck binary reads surface as
`__system__` error events on fd 5. Your script should subscribe via
`ht.on_error` (Python) or `ht.onError` (TS) and log or recover.

| `code`             | Meaning                                   |
| ------------------ | ----------------------------------------- |
| `meta-parse`       | Meta fd received non-JSON or malformed line. |
| `meta-validate`    | Meta missing a required field (e.g. `id`). |
| `data-channel`     | Meta referenced a channel that wasn't declared. |
| `data-queue-full`  | Too many unconsumed binary reads on a channel (cap 64). |
| `data-incomplete`  | Child closed fd 4 before writing `byteLength` bytes. |
| `data-timeout`     | Binary read exceeded `timeout` (default 5s); panel is discarded. |
| `data-read`        | Other read-time I/O error. |
| `meta-init` / `meta-stream` | Meta-channel setup or read failure (rare). |

`data-timeout` additionally fires `onDataFailed` on the bun side — the
just-created panel is removed from the webview. See
`src/bun/sideband-parser.ts:103–224` and
`src/bun/session-manager.ts:218–243` for the full pathway.

Flush to recover:

```python
ht.flush("data")   # abort pending binary read, discard buffered bytes
```

---

## 8. Multiple data channels

You can declare extra named `binary` channels if your script has two
parallel binary streams (e.g. a live video feed plus a sidecar audio
channel). Channels are declared on the bun side by extending
`extraChannels` in `PtySpawnOptions` (`src/bun/pty-manager.ts:16–25`),
then exported to the script via `HYPERTERM_CHANNELS`:

```python
fd = ht.get_channel_fd("audio")   # None if not declared
```

Each channel has an independent FIFO queue (per-channel serialisation,
cross-channel parallelism). Per-channel cap: 64 pending reads
(`src/bun/sideband-parser.ts:6`).

---

## 9. Custom content types

Scripts can invent new `type` names. The app dispatches them to whichever
renderer is registered; add one on the terminal or web-mirror side:

```ts
// src/views/terminal/content-renderers.ts — webview registry
registerRenderer("my-widget", {
  icon: "sparkles",
  cssClass: "my-widget",
  mount: (el, data, meta) => { /* render */ },
  update: (el, data, meta) => { /* re-render */ },
  destroy: (el) => { /* cleanup */ },
});
```

```ts
// src/web-client/panel-renderers.ts — web-mirror registry
registry.register("my-widget", (contentEl, data, meta, isBinary) => {
  /* render contentEl with data */
});
```

If no renderer exists for a `type`, the panel creation is skipped and an
error event is emitted.

---

## 10. Demo scripts — pick one and read it

All live under `scripts/`. Each opens with a header comment explaining
what it demonstrates.

### Python (`hyperterm.py`)

| Script | Demonstrates |
| ------ | ------------ |
| [`demo_image.py`](../scripts/demo_image.py) | Simplest case — open an image file; drag / resize; wait for close. |
| [`demo_interactive.py`](../scripts/demo_interactive.py) | HTML panel with a button + click counter; shows `interactive: true` + `on_click`. |
| [`demo_chart.py`](../scripts/demo_chart.py) | Animated SVG bar chart — uses `ht.update(id, data=svg)` to stream frames. |
| [`demo_dashboard.py`](../scripts/demo_dashboard.py) | Multi-panel dashboard (CPU, memory, clock) with independent update loops. |
| [`demo_canvas_mandelbrot.py`](../scripts/demo_canvas_mandelbrot.py) | CPU-rendered Mandelbrot pushed as a `canvas2d` PNG. |
| [`demo_canvas_heatmap.py`](../scripts/demo_canvas_heatmap.py) | Streaming 2D heat map on a canvas. |

### Bun / TypeScript (`hyperterm.ts`)

| Script | Demonstrates |
| ------ | ------------ |
| [`demo_draw.ts`](../scripts/demo_draw.ts) | Drawing app — toolbar + canvas, full event loop via `onClick` / `onWheel`. |
| [`demo_colorpick.ts`](../scripts/demo_colorpick.ts) | Color picker widget, interactive HTML. |
| [`demo_qrcode.ts`](../scripts/demo_qrcode.ts) | QR code generator written to canvas. |
| [`demo_clock.ts`](../scripts/demo_clock.ts) | Animated clock — setInterval-style update on a canvas. |
| [`demo_3d.ts`](../scripts/demo_3d.ts) | Rotating 3D scene — canvas, `onTerminalResize` repositions. |
| [`demo_gallery.ts`](../scripts/demo_gallery.ts) | Image-gallery carousel with navigation buttons. |
| [`demo_webcam.ts`](../scripts/demo_webcam.ts) | Live camera feed streamed as `canvas2d`. |
| [`demo_gitdiff.ts`](../scripts/demo_gitdiff.ts) | Syntax-highlighted git diff in an HTML panel. |
| [`demo_gitgraph.ts`](../scripts/demo_gitgraph.ts) | Commit graph as SVG. |
| [`demo_json.ts`](../scripts/demo_json.ts) | Browsable JSON tree. |
| [`demo_files.ts`](../scripts/demo_files.ts) | File browser with thumbnails. |
| [`demo_mdpreview.ts`](../scripts/demo_mdpreview.ts) | Markdown preview, re-rendered on stdin. |
| [`demo_procs.ts`](../scripts/demo_procs.ts) | Live process tree. |
| [`demo_sysmon.ts`](../scripts/demo_sysmon.ts) | System monitor — CPU / memory / disk panels. |
| [`demo_canvas_particles.ts`](../scripts/demo_canvas_particles.ts) | Procedural tornado scene with rotating debris, rain, lightning, and mouse-triggered gusts. |
| [`demo_canvas_life.ts`](../scripts/demo_canvas_life.ts) | Conway's Game of Life. |

Run any of them from a τ-mux pane:

```bash
python3 scripts/demo_image.py path/to/image.png
bun scripts/demo_draw.ts
```

---

## 11. Where the code lives

Useful anchor files for when the docs fall out of sync with reality.

**Protocol types** (shared webview + bun + web mirror)
- [`src/shared/types.ts`](../src/shared/types.ts) — `ChannelDescriptor`,
  `SidebandMetaMessage`, `SidebandContentMessage`, `SidebandFlushMessage`,
  `PanelEvent` union (§149–298).

**Bun side (PTY spawn + parser)**
- [`src/bun/pty-manager.ts`](../src/bun/pty-manager.ts) — fd allocation,
  `HYPERTERM_CHANNELS` env bag (lines 16–25 for options, 124–141 for spawn).
- [`src/bun/sideband-parser.ts`](../src/bun/sideband-parser.ts) — JSONL
  meta parsing, binary read queue, channel flush, error dispatch.
- [`src/bun/event-writer.ts`](../src/bun/event-writer.ts) — writes JSONL
  events to fd 5.
- [`src/bun/session-manager.ts`](../src/bun/session-manager.ts) — wires
  parser + event-writer to PTY and exposes `onSidebandMeta` / `onSidebandData`
  (lines 183–246).
- [`src/bun/panel-registry.ts`](../src/bun/panel-registry.ts) — bun-side
  mirror of live panels; drives the `panel.list` RPC (`ht panels`).

**Webview side (real rendering)**
- [`src/views/terminal/panel-manager.ts`](../src/views/terminal/panel-manager.ts) —
  per-surface panel map, inline-anchor resolution, scroll tracking.
- [`src/views/terminal/panel.ts`](../src/views/terminal/panel.ts) — a
  single panel's DOM + drag / resize / event forwarding.
- [`src/views/terminal/content-renderers.ts`](../src/views/terminal/content-renderers.ts) —
  built-in renderers (image, svg, html, canvas2d) + register hook for
  custom types.

**Web-mirror side (browser client)**
- [`src/web-client/protocol-dispatcher.ts`](../src/web-client/protocol-dispatcher.ts) —
  turns `sidebandMeta` WebSocket messages into store actions.
- [`src/web-client/panel-renderers.ts`](../src/web-client/panel-renderers.ts) —
  parallel renderer registry for the web client.
- [`src/web-client/panel-interaction.ts`](../src/web-client/panel-interaction.ts) —
  mouse / drag / resize forwarding back to the server over WebSocket.

**Libraries used by scripts**
- [`scripts/hyperterm.py`](../scripts/hyperterm.py) — Python helper.
- [`scripts/hyperterm.ts`](../scripts/hyperterm.ts) — Bun / TypeScript helper.

**Tests worth reading for worked examples**
- [`tests/sideband-parser.test.ts`](../tests/sideband-parser.test.ts) —
  parser happy paths + every error code.
- [`tests/parser-fuzz.test.ts`](../tests/parser-fuzz.test.ts) — fuzz
  coverage for malformed inputs.
- [`tests-e2e-native/specs/sideband.spec.ts`](../tests-e2e-native/specs/sideband.spec.ts) —
  end-to-end assertions against the `panel.list` RPC after running
  `scripts/test_sideband.sh`.

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `"Not running inside τ-mux."` on startup | `HYPERTERM_META_FD` not set | Run the script inside a τ-mux pane (not a plain terminal). |
| Panel never appears, no error event | `byteLength` doesn't match bytes written to fd 4 | Count your bytes — the parser waits for exactly `byteLength` or times out. |
| Panel appears for a second then vanishes | Content renderer threw | Check the app's console; the renderer's throw is surfaced as an internal error. |
| `ht panels` lists the panel but nothing draws | Custom `type` with no renderer | Register a renderer (see §9) or use a built-in type. |
| Events fire for one panel, not another | `interactive: true` not set | Interactive events gate on that flag; drag/resize/close still fire without it. |
| `data-timeout` on every frame | Binary write is slower than the default 5s timeout | Set `timeout: 30000` (or whatever) in the meta. |
| Panel sticks around after script exits | Script didn't call `ht.clear(id)` | The app keeps orphaned panels alive by design — explicit cleanup required. |
| User drag leaves the panel offscreen | Drag clamp isn't applied until `dragend` | On `dragend`, you can re-send a meta with clamped `x` / `y` to snap it back. |

---

## 13. Inspecting sideband state from a shell

The `ht` CLI exposes `panel.list` so you can audit what's live:

```bash
ht panels                  # active panels on the focused surface
ht panels --json | jq '.'
ht panels --surface surface:3
```

Each descriptor carries `id`, `type`, `position`, `width`, `height`,
`createdAt`, `updatedAt`. See [`doc/SKILLS.md`](./SKILLS.md#part-6--sideband-canvas-panels)
for the CLI surface.

---

**Further reading:**
- [`doc/system-sideband-protocol.md`](./system-sideband-protocol.md) — full
  protocol reference (wire format, invariants, rationale).
- [`doc/system-canvas-panels.md`](./system-canvas-panels.md) — how the
  webview lays out the canvas overlay relative to xterm.
