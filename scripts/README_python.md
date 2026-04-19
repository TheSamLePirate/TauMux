# hyperterm.py — Python Client Library

Python client library for the τ-mux sideband protocol. Display images, SVG graphics, HTML widgets, and interactive panels as floating overlays inside the terminal.

All methods are **safe no-ops** when not running inside τ-mux.

## Requirements

- Python 3.8+
- No external dependencies (stdlib only)

## Quick Start

```python
from hyperterm import ht

# Display an SVG panel
panel = ht.show_svg('<svg>...</svg>', x=100, y=50)

# Display an image file
img = ht.show_image('photo.png', draggable=True)

# Display interactive HTML
widget = ht.show_html('<div>Hello</div>', interactive=True)

# Update a panel (move, resize, or replace content)
ht.update(panel, x=200, y=200)
ht.update(panel, data='<svg>new content</svg>')

# Remove a panel
ht.clear(panel)

# Listen for events (drag, resize, click, close)
for event in ht.events():
    print(event)
```

## API Reference

### `ht.available`

`bool` — `True` when running inside τ-mux (fd 3 and fd 4 are open).

### `ht.debug`

`bool` — `True` when `HYPERTERM_DEBUG=1` is set. Enables error logging to stderr.

### `ht.protocol_version`

`int` — Protocol version from `HYPERTERM_PROTOCOL_VERSION` (default: `1`).

### `ht.channel_map`

`dict | None` — Parsed channel map from `HYPERTERM_CHANNELS` env var, or `None` if not available.

### `ht.show_svg(svg, ...)`

Display an SVG string as a floating panel.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `svg` | `str` | *required* | SVG markup |
| `x` | `int` | `100` | X position (px) |
| `y` | `int` | `100` | Y position (px) |
| `width` | `int` | `400` | Panel width (px) |
| `height` | `int` | `300` | Panel height (px) |
| `position` | `str` | `"float"` | `"float"`, `"inline"`, `"overlay"`, or `"fixed"` |
| `**kwargs` | | | Any additional panel options (see below) |

Returns the panel ID (`str`).

### `ht.show_html(html, ...)`

Display an HTML string as a floating panel.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `html` | `str` | *required* | HTML markup |
| `x` | `int` | `100` | X position (px) |
| `y` | `int` | `100` | Y position (px) |
| `width` | `int` | `400` | Panel width (px) |
| `height` | `int` | `300` | Panel height (px) |
| `position` | `str` | `"float"` | `"float"`, `"inline"`, `"overlay"`, or `"fixed"` |
| `interactive` | `bool` | `False` | Forward mouse events to fd 5 |
| `**kwargs` | | | Any additional panel options (see below) |

Returns the panel ID (`str`).

### `ht.show_image(path, ...)`

Display an image file (PNG, JPEG, WebP, GIF) as a floating panel.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `str` | *required* | Path to image file |
| `x` | `int` | `100` | X position (px) |
| `y` | `int` | `100` | Y position (px) |
| `width` | `int\|str` | `"auto"` | Panel width (px or `"auto"`) |
| `height` | `int\|str` | `"auto"` | Panel height (px or `"auto"`) |
| `position` | `str` | `"float"` | `"float"`, `"inline"`, `"overlay"`, or `"fixed"` |
| `draggable` | `bool` | `True` | Allow drag |
| `resizable` | `bool` | `True` | Allow resize |
| `interactive` | `bool` | `False` | Forward mouse events to fd 5 |
| `**kwargs` | | | Any additional panel options (see below) |

Returns the panel ID (`str`).

### `ht.update(panel_id, **fields)`

Update an existing panel's properties or content.

```python
# Move
ht.update(panel_id, x=200, y=300)

# Replace content with bytes
ht.update(panel_id, data=new_svg.encode("utf-8"))

# Replace content with string (auto-encoded to UTF-8)
ht.update(panel_id, data="<svg>...</svg>")

# Change opacity
ht.update(panel_id, opacity=0.5)
```

Any field from the panel options table can be passed as a keyword argument. Pass `data=` (bytes or str) to replace the panel's binary content.

### `ht.clear(panel_id)`

Remove a panel from the terminal.

### `ht.read_event()`

Read a single event from fd 5. Returns a `dict` or `None` on EOF.

### `ht.events()`

Generator that yields events as dicts until the event fd closes.

```python
for event in ht.events():
    if event["event"] == "click":
        print(f"Clicked at {event['x']}, {event['y']}")
    elif event["event"] == "close":
        break
```

### `ht.send_meta(meta)`

Send raw metadata dict to the meta channel. Use for custom content types.

```python
ht.send_meta({"id": "md1", "type": "markdown", "position": "float", "byteLength": len(data)})
```

### `ht.send_data(data)`

Send raw binary data (bytes) to the data channel.

### `ht.get_channel_fd(name)`

Get the fd for a named channel from the channel map. Returns `int | None`.

### `ht.on_error(callback)`

Listen only for system error events. Blocks until the event stream closes.

```python
def handle_error(code, message, ref):
    print(f"Protocol error [{code}]: {message}", file=sys.stderr)

ht.on_error(handle_error)
```

## Panel Options (kwargs)

These can be passed to any `show_*` method or to `update()`:

| Option | Type | Description |
|--------|------|-------------|
| `draggable` | `bool` | Allow drag (default: `True` for float) |
| `resizable` | `bool` | Allow resize (default: `True` for float) |
| `interactive` | `bool` | Forward mouse events to fd 5 |
| `zIndex` | `int` | Stacking order |
| `opacity` | `float` | 0.0 - 1.0 |
| `borderRadius` | `int` | Border radius in px |
| `anchor` | `str\|dict` | `"cursor"` or `{"row": N}` (for inline panels) |

## Events

Events arrive as JSON dicts on fd 5:

| Event | Fields | Description |
|-------|--------|-------------|
| `dragend` | `x`, `y` | Panel was dragged to new position |
| `resize` | `width`, `height` | Panel was resized |
| `click` | `x`, `y` | Mouse click (interactive panels only) |
| `close` | | Panel was closed by the user |
| `error` | `code`, `message`, `ref` | Protocol error (id=`__system__`) |

## How It Works

τ-mux spawns scripts with sideband channels (extensible via `HYPERTERM_CHANNELS`). Default channels:

- **fd 3** (`HYPERTERM_META_FD`) — metadata channel (script -> terminal, JSONL)
- **fd 4** (`HYPERTERM_DATA_FD`) — binary data channel (script -> terminal, raw bytes)
- **fd 5** (`HYPERTERM_EVENT_FD`) — event channel (terminal -> script, JSONL)

The library writes panel metadata as JSON lines to fd 3, binary content (SVG, HTML, image bytes) to fd 4, and reads events from fd 5. The `byteLength` field in the metadata tells the terminal how many bytes to read from the data channel.

The library first checks `HYPERTERM_CHANNELS` for the structured channel map, falling back to the legacy individual env vars. Set `HYPERTERM_DEBUG=1` to enable error logging to stderr.

## Examples

See the demo scripts in this directory:

- `demo_dashboard.py` — Real-time CPU + Memory + Clock panels
- `demo_chart.py` — Live matplotlib SVG chart (requires matplotlib)
- `demo_interactive.py` — Clickable HTML buttons with event handling
- `demo_image.py` — Display an image file
