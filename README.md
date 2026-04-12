# HyperTerm Canvas

A hybrid terminal emulator where a traditional PTY text layer (xterm.js) coexists with multiple floating canvas overlays. Scripts running inside the terminal can output structured content (images, charts, interactive widgets) via extra file descriptors. Built with [Electrobun](https://electrobun.dev) + Bun.

## Features

- **Terminal multiplexer** — workspaces, split panes, keyboard shortcuts
- **Canvas panels** — floating SVG/HTML/image overlays driven by sideband file descriptors
- **Sidebar** — workspace list, status pills, progress bars, logs
- **CLI tool (`ht`)** — control everything from the command line via Unix socket API
- **Client libraries** — Python and TypeScript helpers for the sideband protocol
- **Catppuccin Mocha** theme, macOS-native look

## Quick Start

```bash
bun install
bun start
```

## Architecture

```
Bun Main Process (src/bun/)
  ├── SessionManager — manages PTY sessions (workspaces, surfaces)
  ├── SocketServer — Unix socket at /tmp/hyperterm.sock (JSON-RPC)
  ├── SidebandParser — reads fd3 (metadata JSONL) + fd4 (binary data)
  ├── EventWriter — writes fd5 (event JSONL)
  └── Electrobun RPC ↔ Webview

Electrobun Webview (src/views/terminal/)
  ├── SurfaceManager — workspaces, pane tree layout, xterm.js instances
  ├── PaneLayout — binary tree for split computation
  ├── PanelManager — floating canvas panels (SVG, HTML, images)
  ├── Sidebar — workspace list, status, progress, logs, notifications
  └── CommandPalette — Cmd+Shift+P fuzzy command search
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New workspace |
| `Cmd+D` | Split right |
| `Cmd+Shift+D` | Split down |
| `Cmd+W` | Close focused pane |
| `Cmd+B` | Toggle sidebar |
| `Cmd+Shift+P` | Command palette |
| `Cmd+Alt+Arrow` | Focus pane in direction |
| `Ctrl+Cmd+]` / `[` | Next / previous workspace |
| `Cmd+1..9` | Switch to workspace N |
| `Cmd+C` | Copy selection |
| `Cmd+V` | Paste |

## CLI Tool (`ht`)

Installed globally via `bun link`. Controls HyperTerm Canvas through a Unix socket.

```bash
ht ping                              # Check if running
ht version                           # Show version
ht tree                              # Workspace/surface tree
ht list-workspaces                   # List workspaces
ht new-workspace [--name N]          # Create workspace
ht select-workspace --workspace W    # Switch workspace
ht new-split right                   # Split focused pane
ht send "echo hello\n"               # Send text to terminal
ht send-key enter                    # Send key press
ht read-screen --lines 10            # Read terminal content
ht set-status build "ok" --color "#a6e3a1"  # Sidebar status pill
ht set-progress 0.5 --label "Building"      # Sidebar progress bar
ht log --level success "Tests passed"       # Sidebar log entry
ht notify --title "Build" --body "Done"     # Notification
ht capabilities --json               # List all 30 API methods
```

Add `--json` to any command for raw JSON output.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HT_SOCKET_PATH` | Override socket path (default: `/tmp/hyperterm.sock`) |
| `HT_WORKSPACE_ID` | Auto-set in HyperTerm terminals |
| `HT_SURFACE_ID` | Auto-set in HyperTerm terminals |

## Sideband Protocol (fd 3/4/5)

Scripts can render structured content via extra file descriptors (extensible channel system):

- **fd 3** — metadata channel (script -> terminal, JSONL)
- **fd 4** — binary data channel (script -> terminal, raw bytes)
- **fd 5** — event channel (terminal -> script, JSONL)

Channels are discoverable via `HYPERTERM_CHANNELS` env var. Additional channels can be configured at spawn time.

### Metadata (fd 3)

```jsonl
{"id":"img1","type":"image","format":"png","x":100,"y":100,"byteLength":4096}
{"id":"chart","type":"svg","position":"float","width":400,"height":300,"byteLength":2048}
{"id":"widget","type":"html","interactive":true,"byteLength":512}
{"id":"doc","type":"markdown","byteLength":1024}
{"id":"img1","type":"update","x":200,"y":200}
{"id":"img1","type":"clear"}
```

### Content Types

The `type` field is an open string — any value is valid. Built-in renderers:

| Type | Rendering |
|------|-----------|
| `image` | `<img>` from blob URL (PNG, JPEG, WebP, GIF) |
| `svg` | SVG string as innerHTML |
| `html` | HTML string as innerHTML |
| `canvas2d` | `<canvas>` with drawImage |

Custom types can be added via `registerRenderer()` in `content-renderers.ts`.

### Panel Options

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique panel identifier |
| `type` | string | Any content type or protocol op (`update`, `clear`) |
| `position` | enum | `float` (fixed in viewport), `inline` (scrolls with content), `fixed` (no chrome, raw overlay) |
| `x`, `y` | number | Position in pixels |
| `width`, `height` | number or `"auto"` | Dimensions |
| `draggable` | boolean | Allow drag (default: true for float) |
| `resizable` | boolean | Allow resize (default: true for float) |
| `interactive` | boolean | Forward mouse events to fd 5 |
| `byteLength` | number | Size of binary payload on data channel |
| `dataChannel` | string | Named data channel (default: `"data"` = fd 4) |
| `opacity` | number | 0.0-1.0 |
| `zIndex` | number | Stacking order |

### Events (fd 5)

```jsonl
{"id":"img1","event":"dragend","x":300,"y":400}
{"id":"img1","event":"resize","width":600,"height":400}
{"id":"widget","event":"click","x":42,"y":87}
{"id":"img1","event":"close"}
{"id":"__system__","event":"error","code":"meta-validate","message":"Missing id"}
```

## Client Libraries

### Python

```python
from hyperterm import ht

panel = ht.show_svg('<svg>...</svg>', x=100, y=50)
ht.show_image('photo.png', draggable=True)
ht.show_html('<div>Hello</div>', interactive=True)
ht.update(panel, x=200, y=200)
ht.clear(panel)

for event in ht.events():
    print(event)
```

### TypeScript

```typescript
import { ht } from "./hyperterm";

const id = ht.showSvg('<svg>...</svg>', { x: 100, y: 50 });
await ht.showImage('photo.png');
ht.update(id, { x: 200 });
ht.clear(id);
ht.onEvent((e) => console.log(e));
```

Both libraries are safe no-ops when not running inside HyperTerm.

## Demo Scripts

```bash
# Inside HyperTerm Canvas:
bun scripts/test_cpu.ts              # Real-time CPU graph (10 FPS)
python3 scripts/demo_dashboard.py    # CPU + Memory + Clock panels
python3 scripts/demo_chart.py        # Live matplotlib SVG chart
python3 scripts/demo_interactive.py  # Clickable HTML buttons
python3 scripts/demo_image.py photo.png  # Display an image
bun scripts/test_inline.ts          # Inline panel that scrolls with content
bash scripts/test_sideband.sh       # SVG + HTML sideband test
```

## Socket API (JSON-RPC)

Connect to `/tmp/hyperterm.sock` and send newline-delimited JSON:

```json
{"id":"1", "method":"system.ping", "params":{}}
```

Response:

```json
{"id":"1", "result":"PONG"}
```

### Available Methods

**System:** `system.ping`, `system.version`, `system.identify`, `system.capabilities`, `system.tree`

**Workspaces:** `workspace.list`, `workspace.current`, `workspace.create`, `workspace.select`, `workspace.close`, `workspace.rename`, `workspace.next`, `workspace.previous`

**Surfaces:** `surface.list`, `surface.split`, `surface.close`, `surface.focus`, `surface.send_text`, `surface.send_key`, `surface.read_text`

**Sidebar:** `sidebar.set_status`, `sidebar.clear_status`, `sidebar.set_progress`, `sidebar.clear_progress`, `sidebar.log`

**Notifications:** `notification.create`, `notification.list`, `notification.clear`

**Panes:** `pane.list`

## Project Structure

```
src/
  bun/                          # Main process (Bun runtime)
    index.ts                    # Entry: BrowserWindow, RPC, socket server
    session-manager.ts          # Multi-surface PTY manager
    pty-manager.ts              # Single PTY with terminal option
    sideband-parser.ts          # Multi-channel JSONL + binary reader
    event-writer.ts             # fd5 JSONL event writer (incl. system error events)
    socket-server.ts            # Unix socket server (JSON-RPC)
    rpc-handler.ts              # 30 RPC method implementations
  shared/
    types.ts                    # RPC schema, sideband types
  views/terminal/               # Webview (system WebView)
    index.html                  # Entry HTML
    index.ts                    # Entry: RPC handlers, shortcuts
    index.css                   # All styles (Catppuccin Mocha)
    surface-manager.ts          # Workspaces, pane layout, xterm.js
    pane-layout.ts              # Binary tree split computation
    panel-manager.ts            # Canvas panel lifecycle
    panel.ts                    # Single panel (drag, resize, render)
    content-renderers.ts        # Extensible content renderer registry
    sidebar.ts                  # Sidebar UI (workspaces, status, logs)
    command-palette.ts          # Cmd+Shift+P command palette
    context-menu.ts             # Right-click context menus
bin/ht                          # CLI tool
scripts/                        # Client libraries + demos
tests/                          # 109 tests across 9 files
```

## Development

```bash
bun install           # Install dependencies
bun start             # Build + run (dev mode)
bun dev               # Build + run with watch
bun test              # Run tests (109 tests)
bun run typecheck     # TypeScript check
```

## Tech Stack

- **Runtime:** [Bun](https://bun.sh) 1.3.9
- **Framework:** [Electrobun](https://electrobun.dev) 1.16.0
- **Terminal:** [xterm.js](https://xtermjs.org) 5.3.0
- **PTY:** `Bun.spawn` with `terminal` option (no node-pty)
- **Theme:** [Catppuccin Mocha](https://catppuccin.com)
- **Font:** JetBrains Mono Nerd Font

## License

MIT
