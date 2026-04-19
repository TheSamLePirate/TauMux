# τ-mux: Floating Panels & Rich Graphics Guide

The defining feature of τ-mux is its ability to render rich graphical elements directly over the terminal text grid. This is handled by the **Panel System** inside the Webview.

Unlike traditional terminal graphics (like Sixel or Kitty image protocol) which try to hack images into the rigid character grid, τ-mux renders real DOM elements (`<img>`, `<svg>`, `<canvas>`) that float independently.

This guide explains how these panels behave visually and how to interact with them.

---

## 1. Panel Positioning Modes

When a script asks the terminal to draw a panel, it specifies a `position` mode. This fundamentally changes how the panel behaves on screen.

### `position: "float"` (The Default)
Floating panels act like traditional desktop windows.
- They are positioned using absolute screen coordinates (`x` and `y` in pixels) relative to the top-left of the specific terminal pane.
- If the terminal text scrolls rapidly, the floating panel stays exactly where it is.
- **Draggable:** By default, floating panels have a tiny grab-handle at the top. You can click and drag them around the terminal pane.
- **Resizable:** By default, floating panels have a drag-handle in the bottom right corner allowing you to stretch them.

### `position: "inline"`
Inline panels act like they are printed into the terminal history.
- When created, the panel takes note of the terminal's cursor position (e.g., "Row 45").
- The UI mathematically locks the panel's vertical position to that specific row.
- As new text is printed and the terminal scrolls down, the inline panel **scrolls up** along with the text it was anchored to.
- *Note: Inline panels cannot be dragged vertically, as they are locked to their row.*

### `position: "fixed"`
Fixed panels are raw visual overlays with zero chrome.
- Positioned using absolute screen coordinates (`x` and `y` in pixels) relative to the top-left of the terminal pane — just like `float`.
- **No title bar, no drag handle, no resize handle, no close button.** The panel renders only the content itself.
- Not draggable and not resizable — the panel stays exactly where it was placed.
- Ideal for HUD-style overlays (clocks, status indicators, watermarks) that should appear as part of the terminal environment rather than as separate windows.
- If `interactive: true` is set, mouse events are still forwarded to FD 5.
- To remove a fixed panel, the script must send a `clear` message — there is no close button for the user to click.

---

## 2. Rendering Types

The `type` field in sideband metadata is an open string. The panel system uses a **content renderer registry** to dispatch rendering. Four renderers are built-in, and custom renderers can be registered at runtime (see `content-renderers.ts`).

### Built-in Renderers

#### 1. Images (`"type": "image"`)
- Renders `png`, `jpeg`, `webp`, or `gif` formats.
- The UI takes the raw bytes, creates an isolated `Blob URL`, and mounts it in a standard HTML `<img>` tag.
- Images automatically scale to fit the width/height of the panel while maintaining their aspect ratio (`object-fit: contain`).

#### 2. SVG (`"type": "svg"`)
- Expects a raw XML/SVG string.
- Injected directly into the DOM.
- Perfect for rendering crisp, scalable charts (e.g., via Matplotlib or D3.js) without pixelation.

#### 3. HTML (`"type": "html"`)
- Expects a raw HTML string.
- Injected directly into the DOM.
- Allows you to build full graphical interfaces (buttons, sliders, forms) inside the terminal.

#### 4. Canvas2D (`"type": "canvas2d"`)
- Expects raw image bytes (usually PNG).
- Instead of using an `<img>` tag, the UI decodes the image via `createImageBitmap` and paints it onto an HTML5 `<canvas>` element using `ctx.drawImage()`.
- Useful for high-performance visual updates where manipulating DOM nodes is too slow.

### Custom Renderers

Any string is a valid `type`. To add support for a new type, register a `ContentRenderer` in the webview via `registerRenderer(type, renderer)`. The renderer provides `mount()`, `update()`, and optional `destroy()` methods. Unknown types with no registered renderer are silently ignored.

---

## 3. Interactivity & Events

Panels are not just static images; they can be fully interactive. If a script creates a panel with `"interactive": true`, the UI begins listening to your mouse movements.

### What happens when you interact?
When you hover, click, or scroll over an interactive panel, the Webview captures the DOM event, calculates your mouse's exact `x` and `y` coordinates *relative to the top-left corner of the panel*, and fires a JSON message back through the Sideband Event Channel (FD 5) to the script that created the panel.

### Supported Interactions
- **Clicking:** `mousedown`, `mouseup`, `click`. The script knows which mouse button you used.
- **Hovering:** `mouseenter`, `mouseleave`.
- **Scrolling:** `wheel`. If you scroll your mouse wheel while hovering over a panel, the script receives the `deltaX` and `deltaY` values (useful for zooming into maps or charts).
- **Moving:** `mousemove`. Mouse movement is automatically throttled to ~60 frames per second to prevent overloading the terminal backend with thousands of coordinate messages.

---

## 4. Closing Panels

If you are done with a panel, you can close it manually.

Every draggable panel has a small `×` in the top right corner of its drag handle.
Clicking this `×`:
1. Instantly removes the panel from your screen.
2. Sends a `close` event back to the script, allowing the script to safely exit or clean up its memory.

*(Note: Scripts can also programmatically clear panels at any time using the protocol's `clear` command).*

---

## 5. Security and Limitations

- **HTML/SVG Injection Risk:** When a script uses type `html` or `svg`, the UI injects that string directly into the DOM using `.innerHTML`. There is no sanitization applied. A malicious script could use this to execute arbitrary JavaScript (`<script>`) within the context of the Electrobun Webview. **Only run trusted scripts in τ-mux.**
- **Inline Panel Disappearance:** `xterm.js` only keeps a finite amount of lines in its scrollback history (default 10,000). If you print 10,001 lines, Line 1 is permanently deleted from memory. If you had an `inline` panel anchored to Line 1, the math calculating its position will fail, and the panel may suddenly disappear or misalign.
- **Overlapping Z-Index:** By default, new panels spawn on top of older panels. If you have many floating panels, they can cover your text. You can drag them out of the way, but currently, clicking a panel does not automatically bring it to the absolute front unless the script explicitly updates its `zIndex`.