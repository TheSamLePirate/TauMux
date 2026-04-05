# Panel / Canvas System

The Panel System is responsible for dynamically rendering structured UI components (SVG, Images, HTML, Canvas2D) over the traditional text grid. It receives instructions encoded in JSON from the Sideband Protocol and translates them into floating DOM elements.

## Core Components

- **`PanelManager`** (`src/views/terminal/panel-manager.ts`): Scoped to a specific `SurfaceView` (and thus, a specific PTY process). It tracks all active panels (`this.panels`) and buffers pending binary data (`this.pendingData`) to ensure race conditions between metadata arriving (fd3) and binary data arriving (fd4) don't break rendering.
- **`Panel`** (`src/views/terminal/panel.ts`): Represents a single visual overlay. It translates the `SidebandMetaMessage` into CSS styles (`left`, `top`, `width`, `height`, `zIndex`, `opacity`). It handles:
  - Dragging via a top title bar handle.
  - Resizing via a bottom-right handle.
  - Positioning: `float` (absolute screen coords) or `inline` (locked to a specific row in the xterm.js buffer).
  - Interactivity: Setting up mouse listeners to pipe events (click, drag, wheel) back through the `EventWriter` (fd5).

## Data Type Rendering Strategy

- **Images (`image`):** Converts the binary `Uint8Array` to a `Blob`, creates an Object URL (`URL.createObjectURL`), and attaches it to an `<img>` tag.
- **SVG / HTML (`svg`, `html`):** Uses a `TextDecoder` to convert the binary payload back into a string and directly injects it via `innerHTML`.
- **Canvas (`canvas2d`):** Reads an image blob via `createImageBitmap` and draws it onto a real HTML5 `<canvas>` element using `ctx.drawImage()`.

## Critiques & Limitations

- **XSS Vulnerability (Trusted Scripts Only):** For `html` and `svg` types, the binary data is dumped directly into `.innerHTML` without sanitization (e.g., using DOMPurify). While the README states "Scripts are trusted", this is a significant security flaw if the terminal displays output from curl or malicious external sources.
- **Race Condition in `canvas2d` Rendering:** The `canvas2d` implementation uses `createImageBitmap(blob).then(...)` asynchronously. If multiple rapid updates hit the same panel before the previous Promise resolves, older bitmaps could overwrite newer ones depending on I/O latency, leading to flickering or outdated frames.
- **`inline` Positioning Math:** The logic for `inline` panels (`updateInlinePosition` in `PanelManager`) anchors a panel to an absolute terminal row using `buf.baseY + buf.cursorY`. However, `xterm.js` handles line wrapping and buffer truncation dynamically. If the scrollback buffer exceeds its maximum length and lines are trimmed from the top, `baseY` changes, which could misalign or visually break anchored `inline` panels.
- **Event Flooding on `mousemove`:** While `Panel.ts` implements a basic 16ms throttle (~60 FPS) for mouse moves, it still sends a massive amount of JSON serialization overhead across the Unix Socket -> Bun -> `fd5` pipeline when a user scrubs the mouse over an interactive canvas.
- **Memory Leaks on Override:** In `PanelManager.handleData`, if binary data arrives for an ID but the panel is updated rapidly, `URL.revokeObjectURL` is correctly called in `Panel.setContent`. However, if `pendingData` accumulates unused buffers due to a missing/malformed meta message, it never gets garbage collected until the terminal session ends.