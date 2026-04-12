# hyperterm.ts — TypeScript/Bun Client Library

TypeScript client library for the HyperTerm Canvas sideband protocol. Display images, SVG graphics, HTML widgets, and interactive panels as floating overlays inside the terminal.

All methods are **safe no-ops** when not running inside HyperTerm Canvas.

## Requirements

- [Bun](https://bun.sh) runtime
- No external dependencies

## Quick Start

```typescript
import { ht } from "./hyperterm";

// Display an SVG panel
const panel = ht.showSvg('<svg>...</svg>', { x: 100, y: 50 });

// Display an image file
const img = await ht.showImage('photo.png', { draggable: true });

// Display interactive HTML
const widget = ht.showHtml('<div>Hello</div>', { interactive: true });

// Update a panel (move, resize, or replace content)
ht.update(panel, { x: 200, y: 200 });
ht.update(panel, { data: '<svg>new content</svg>' });

// Remove a panel
ht.clear(panel);

// Listen for events (drag, resize, click, close)
ht.onEvent((event) => console.log(event));
```

## API Reference

### `ht.available`

`boolean` — `true` when running inside HyperTerm Canvas (fd 3 and fd 4 are open).

### `ht.debug`

`boolean` — `true` when `HYPERTERM_DEBUG=1` is set. Enables error logging to stderr.

### `ht.protocolVersion`

`number` — Protocol version from `HYPERTERM_PROTOCOL_VERSION` (default: `1`).

### `ht.channelMap`

`ChannelMap | null` — Parsed channel map from `HYPERTERM_CHANNELS` env var, or `null` if not available.

### `ht.showSvg(svg, opts?)`

Display an SVG string as a floating panel. Returns the panel ID (`string`).

```typescript
const id = ht.showSvg('<svg>...</svg>', {
  x: 100,
  y: 50,
  width: 400,
  height: 300,
});
```

### `ht.showHtml(html, opts?)`

Display an HTML string as a floating panel. Returns the panel ID (`string`).

```typescript
const id = ht.showHtml('<div>Hello</div>', {
  interactive: true,
  width: 340,
  height: 240,
});
```

### `ht.showImage(path, opts?)`

Display an image file (PNG, JPEG, WebP, GIF) as a floating panel. Returns a `Promise<string>` (panel ID).

```typescript
const id = await ht.showImage('photo.png', {
  x: 100,
  y: 80,
  draggable: true,
});
```

The image format is detected from the file extension.

### `ht.update(id, fields)`

Update an existing panel's properties or content.

```typescript
// Move
ht.update(id, { x: 200, y: 300 });

// Replace content with string (auto-encoded to UTF-8)
ht.update(id, { data: '<svg>new content</svg>' });

// Replace content with binary
ht.update(id, { data: new Uint8Array([...]) });

// Change opacity
ht.update(id, { opacity: 0.5 });
```

### `ht.clear(id)`

Remove a panel from the terminal.

### `ht.sendMeta(meta)`

Send raw metadata JSON to the meta channel. Use for custom content types.

```typescript
ht.sendMeta({ id: "md1", type: "markdown", position: "float", byteLength: data.byteLength });
```

### `ht.sendData(data, channelName?)`

Send raw binary data to a data channel. Defaults to the `"data"` channel (fd 4).

### `ht.getChannelFd(name)`

Get the file descriptor for a named channel from the channel map. Returns `number | null`.

### `ht.onEvent(callback)`

Listen for events asynchronously. Returns `Promise<void>` that resolves when the event fd closes.

```typescript
await ht.onEvent((event) => {
  if (event.event === 'click') {
    console.log(`Clicked at ${event.x}, ${event.y}`);
  } else if (event.event === 'close') {
    process.exit(0);
  }
});
```

### `ht.onError(callback)`

Listen only for system error events from the terminal. The callback receives `(code, message, ref?)`.

```typescript
await ht.onError((code, message, ref) => {
  console.error(`Protocol error [${code}]: ${message}`, ref);
});
```

## PanelOptions

All `show*` methods accept a `PanelOptions` object:

```typescript
interface PanelOptions {
  x?: number;                           // X position (px), default: 100
  y?: number;                           // Y position (px), default: 100
  width?: number | "auto";              // Panel width, default: 400 (or "auto" for images)
  height?: number | "auto";             // Panel height, default: 300 (or "auto" for images)
  position?: "float" | "inline" | "overlay" | "fixed"; // Default: "float"
  anchor?: "cursor" | { row: number };  // For inline panels
  draggable?: boolean;                  // Default: true
  resizable?: boolean;                  // Default: true
  interactive?: boolean;                // Forward mouse events, default: false
  zIndex?: number;                      // Stacking order
  opacity?: number;                     // 0.0 - 1.0
  borderRadius?: number;               // Border radius in px
  dataChannel?: string;                 // Named data channel (default: "data")
}
```

## HyperTermEvent

Events received via `onEvent`:

```typescript
interface HyperTermEvent {
  id: string;        // Panel ID (or "__system__" for protocol events)
  event: string;     // "dragend", "resize", "click", "close", "error"
  x?: number;        // Position or click coordinates
  y?: number;
  width?: number;    // New dimensions (resize)
  height?: number;
  button?: number;   // Mouse button (click)
  code?: string;     // Error code (system events)
  message?: string;  // Error message (system events)
  ref?: string;      // Reference panel ID (system events)
}
```

| Event | Fields | Description |
|-------|--------|-------------|
| `dragend` | `x`, `y` | Panel was dragged to new position |
| `resize` | `width`, `height` | Panel was resized |
| `click` | `x`, `y`, `button` | Mouse click (interactive panels only) |
| `close` | | Panel was closed by the user |
| `error` | `code`, `message`, `ref` | Protocol error (id=`__system__`) |

## How It Works

HyperTerm Canvas spawns scripts with sideband channels (extensible via `HYPERTERM_CHANNELS`). Default channels:

- **fd 3** (`HYPERTERM_META_FD`) — metadata channel (script -> terminal, JSONL)
- **fd 4** (`HYPERTERM_DATA_FD`) — binary data channel (script -> terminal, raw bytes)
- **fd 5** (`HYPERTERM_EVENT_FD`) — event channel (terminal -> script, JSONL)

The library writes panel metadata as JSON lines to fd 3 via `Bun.write()`, binary content to fd 4, and reads events from fd 5 via `Bun.file().stream()`. The `byteLength` field in the metadata tells the terminal how many bytes to read from the data channel. The `dataChannel` field can route binary data to named channels beyond the default.

The library first checks `HYPERTERM_CHANNELS` for the structured channel map, falling back to the legacy individual env vars.

## Singleton vs Class

The module exports both a singleton and the class:

```typescript
// Singleton (recommended)
import { ht } from "./hyperterm";

// Class (for custom instances or testing)
import { HyperTerm } from "./hyperterm";
const myHt = new HyperTerm();
```

## Examples

See the demo scripts in this directory:

- `test_cpu.ts` — Real-time CPU graph (10 FPS, uses raw protocol for maximum performance)
- `test_inline.ts` — Inline panel that scrolls with terminal content
