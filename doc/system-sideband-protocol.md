# HyperTerm Canvas: Sideband Protocol & Interactivity Guide

HyperTerm Canvas isn't just a terminal emulator; it's a hybrid environment where traditional text output (TTY) seamlessly blends with rich, floating, interactive graphical elements.

This is made possible by the **Sideband Protocol**, a unique channel of communication that lives alongside standard input (`stdin`), standard output (`stdout`), and standard error (`stderr`).

This guide will teach you how to write scripts that spawn rich UI elements, update them in real-time, and react to user clicks, drags, and scroll events.

---

## The Three Extra File Descriptors (FDs)

When a script is executed inside HyperTerm Canvas, it is granted access to three special file descriptors via environment variables:

1. **`HYPERTERM_META_FD` (default: `3`)**: **Metadata Channel**. Your script writes JSONL (JSON Lines) here. This instructs the terminal to create, update, or clear UI panels.
2. **`HYPERTERM_DATA_FD` (default: `4`)**: **Binary Data Channel**. Your script writes raw bytes (like PNG image data or raw HTML strings) here immediately after sending a metadata message that expects binary content.
3. **`HYPERTERM_EVENT_FD` (default: `5`)**: **Event Channel**. Your script reads JSONL from here. The terminal sends user interactions (mouse clicks, dragging, window resizes) over this pipe.

---

## 1. Creating and Displaying Content

To display a graphical element, you must tell the terminal *what* to display (metadata via FD 3) and provide the *content* (binary data via FD 4).

### Supported Content Types (`type`)

- **`image`**: Displays an image (PNG, JPEG, WebP, GIF).
- **`svg`**: Renders raw SVG strings.
- **`html`**: Renders raw HTML strings.
- **`canvas2d`**: Draws image data onto an HTML5 Canvas context.

### Positioning (`position`)

- **`float`**: The element floats over the terminal at an absolute screen coordinate (`x`, `y`). It stays fixed on the screen even when the terminal text scrolls.
- **`inline`**: The element is anchored to the specific line of text where it was created. If you print 50 lines of text and the terminal scrolls, the inline element scrolls up with the text.

### Example: Displaying a Floating SVG (Bash)

Here is a raw bash example demonstrating how to talk directly to the FDs:

```bash
#!/bin/bash
# 1. Define the SVG payload
SVG='<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>'
BYTE_LEN=$(echo -n "$SVG" | wc -c)

# 2. Write the JSON metadata to FD 3
echo '{"id":"my-red-circle","type":"svg","position":"float","x":50,"y":50,"width":100,"height":100,"byteLength":'$BYTE_LEN'}' >&3

# 3. Write the exact binary payload to FD 4
echo -n "$SVG" >&4
```

### Example: Displaying an Inline Image (Python)

It is highly recommended to use the provided client libraries (`scripts/demo_*.py` or `scripts/test_*.ts`) which wrap this protocol nicely.

```python
from hyperterm import ht

# ht.show_image automatically handles reading the file, sizing it, and managing FD3 & FD4
panel_id = ht.show_image(
    "assets/cat.png",
    position="inline",
    width=200, 
    height="auto"
)
print(f"I just drew a cat with panel ID {panel_id} right above this line!")
```

---

## 2. Updating and Clearing Panels

Because every panel has a unique `id`, you can manipulate it after it has been created.

### Updating a Panel

You can move, resize, change the opacity, or even replace the binary data of an existing panel. Send an `update` message.

**JSON Payload (`fd 3`):**
```json
{"id": "my-red-circle", "type": "update", "x": 300, "y": 150, "opacity": 0.5}
```

If you specify `byteLength` in an update payload, the terminal will wait for new data on FD 4 and replace the panel's content.

### Clearing a Panel

To delete a panel from the screen, send a `clear` message.

**JSON Payload (`fd 3`):**
```json
{"id": "my-red-circle", "type": "clear"}
```

---

## 3. Making Panels Interactive

The real magic happens when you make panels interactive. By setting `"interactive": true` in the metadata, HyperTerm Canvas will forward user events back to your script via **FD 5**.

### Supported Events
When the user interacts with your panel, you will receive JSON lines on FD 5 resembling:

- **Mouse Move / Clicks (`mousedown`, `mouseup`, `click`, `mouseenter`, `mouseleave`, `mousemove`):**
  ```json
  {"id":"my-button","event":"click","x":12,"y":45,"button":0,"buttons":1}
  ```
- **Scrolling over the panel (`wheel`):**
  ```json
  {"id":"my-map","event":"wheel","x":100,"y":100,"deltaX":0,"deltaY":53,"buttons":0}
  ```
- **Dragging the panel (`dragend`):** *(Panels with `position: "float"` are draggable by default)*
  ```json
  {"id":"my-widget","event":"dragend","x":400,"y":200}
  ```
- **Resizing the panel (`resize`):**
  ```json
  {"id":"my-widget","event":"resize","width":600,"height":400}
  ```
- **User clicked the 'X' to close (`close`):**
  ```json
  {"id":"my-widget","event":"close"}
  ```

### Example: Interactive HTML Button (TypeScript)

```typescript
import { ht } from "./hyperterm";

// 1. Create a button using raw HTML
const buttonHtml = `<button style="padding: 10px; background: blue; color: white;">Click Me!</button>`;

const btnId = ht.showHtml(buttonHtml, {
  position: "float",
  x: 100,
  y: 100,
  interactive: true // CRITICAL: Enables event forwarding
});

console.log("Waiting for clicks...");

// 2. Listen to FD 5 for events
ht.onEvent((event) => {
  if (event.id === btnId && event.event === "click") {
    console.log(`Button was clicked at local coordinates X: ${event.x}, Y: ${event.y}!`);
    
    // Move the button somewhere else randomly!
    ht.update(btnId, {
      x: Math.floor(Math.random() * 500),
      y: Math.floor(Math.random() * 500)
    });
  }
  
  if (event.id === btnId && event.event === "close") {
    console.log("User closed the button widget.");
    process.exit(0);
  }
});
```

---

## 4. Full API Reference (Sideband Metadata)

When writing to `HYPERTERM_META_FD`, the JSON object supports the following properties:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | **Yes** | Unique identifier for the panel. |
| `type` | `enum` | **Yes** | `image`, `svg`, `html`, `canvas2d`, `update`, `clear`. |
| `position` | `enum` | No | `float` (default) or `inline`. |
| `x` | `number` | No | X coordinate (pixels) for floating panels. |
| `y` | `number` | No | Y coordinate (pixels) for floating panels. |
| `width` | `number` \| `"auto"` | No | Width in pixels. |
| `height`| `number` \| `"auto"` | No | Height in pixels. |
| `draggable` | `boolean` | No | Show top drag handle (Default: `true` for float). |
| `resizable` | `boolean` | No | Show bottom-right resize handle (Default: `true` for float). |
| `interactive` | `boolean` | No | Forward mouse/wheel events to FD 5. |
| `opacity` | `number` | No | Opacity from `0.0` to `1.0`. |
| `zIndex` | `number` | No | CSS z-index stacking order. |
| `borderRadius`| `number` | No | CSS border-radius in pixels. |
| `byteLength` | `number` | **Yes** | Number of bytes the terminal MUST read from FD 4 immediately after processing this message. |

---

## Security & Limitations

- **XSS Warning:** HTML and SVG content sent via FD 4 is rendered directly into the DOM (`innerHTML`) without sanitization. Only run trusted scripts inside HyperTerm Canvas.
- **Protocol Synchronization:** The terminal reads `byteLength` bytes exactly. If your script declares `byteLength: 500` but only writes 400 bytes to FD 4, the terminal's parser will hang indefinitely waiting for the remaining 100 bytes, breaking subsequent panel rendering for that specific pane.
- **Scrollback Truncation:** `inline` panels are anchored to a specific row in the terminal buffer. If your terminal generates massive amounts of text output and exceeds the scrollback limit (10,000 lines), old text is discarded. This may cause `inline` panels anchored to older lines to disappear or misalign.
