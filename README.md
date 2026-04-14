# HyperTerm Canvas

A hybrid terminal emulator where a traditional PTY text layer (xterm.js) coexists with floating canvas overlays and a live, cross-pane view of every process your shells spawn. Scripts running inside the terminal can stream structured content (images, charts, interactive widgets) through extra file descriptors, while the main process continuously observes cwd / pid / ports / CPU / RSS for every descendant of every shell and ships those observations into the UI and any attached CLI. Built on [Electrobun](https://electrobun.dev) + [Bun](https://bun.sh).

## Table of contents

- [Highlights](#highlights)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [CLI (`ht`)](#cli-ht)
- [Live process metadata](#live-process-metadata)
- [Process Manager](#process-manager)
- [Sideband protocol (fd 3/4/5)](#sideband-protocol-fd-345)
- [Web mirror](#web-mirror)
- [Browser panes](#browser-panes)
- [Settings](#settings)
- [Socket API](#socket-api-json-rpc)
- [Project layout](#project-layout)
- [Development](#development)
- [Further reading](#further-reading)

## Highlights

- **Terminal multiplexer.** Workspaces, tiling splits, draggable dividers, per-pane drag-and-drop, workspace colors.
- **Workspace-level package.json card.** The sidebar shows the nearest `package.json` from any pane's cwd — name, type, description, bin chips, and a one-click row per script. Pick `bun` / `npm` / `pnpm` / `yarn` from settings. Script dots: green pulse = running (detected in the process tree), red = last run exited non-zero, grey = idle.
- **Canvas panels.** Floating SVG / HTML / image / canvas2d overlays driven by sideband file descriptors. Panels are independent DOM elements — draggable, resizable, interactive.
- **Live process metadata.** A 1 Hz poller observes every descendant of every shell and surfaces cwd, pid, tty, full argv, listening TCP ports, CPU %, and RSS per process. Changes propagate to the pane header, sidebar, Process Manager, web mirror, and `ht` CLI — no tmux, no shell integration, just `ps` + `lsof` against pids we already own.
- **Process Manager.** A full-screen overlay (⌘⌥P) that tabulates every process in every workspace with CPU / memory / kill buttons. Shift-click for SIGKILL.
- **`ht` CLI.** Control everything from a shell: spawn panes, send keys, manipulate layouts, open ports in a browser (`ht open 3000`), send signals (`ht kill 8080`), inspect trees (`ht ps`), tail metadata (`ht metadata`). Installs via an in-app menu item — no Bun required on other Macs.
- **Web mirror.** The entire native UI, including chips and metadata, mirrored over WebSocket to anything on the LAN.
- **Client libraries.** Python + TypeScript helpers for the sideband protocol. Safe no-ops when not running inside HyperTerm.
- **Built-in browser.** Split a WebKit browser alongside terminals with `⌘⇧L`. Address bar with smart URL detection and configurable search engines. Full scriptable API: click, type, fill, wait, snapshot, eval, console capture — 40+ commands via `ht browser` CLI.
- **Themeable.** 10 built-in presets (Catppuccin, Tokyo Night, Dracula, Nord, Rosé Pine, Gruvbox, Solarized, Synthwave '84, Everforest, Obsidian) plus per-color overrides.

## Quick start

```bash
bun install
bun start                            # dev build + launch
```

Production build + DMG:

```bash
bun run build:stable                 # builds .app with bundled `ht` CLI and DMG
```

The built `.app` ships a compiled standalone `ht` binary at `Contents/MacOS/ht`. Click **HyperTerm Canvas → Install 'ht' Command in PATH** from the menu to symlink it to `/usr/local/bin/ht` (asks for admin when needed). Works on any Mac, no Bun required.

## Architecture

```
┌──────────────────────────── Bun main process (src/bun/) ────────────────────────────┐
│                                                                                      │
│  SessionManager  ──  N × PtyManager (Bun.spawn with terminal: true)                  │
│                         │                                                            │
│                         │ stdout / stdin / fd3 / fd4 / fd5                           │
│                         ▼                                                            │
│  SidebandParser / EventWriter      SocketServer (/tmp/hyperterm.sock — JSON-RPC)     │
│                         │                     ▲                                       │
│                         │                     │                                       │
│                         ▼                     │                                       │
│                       Electrobun RPC ───┐   ht CLI talks here                         │
│                                          │                                            │
│   ┌────────────── SurfaceMetadataPoller ─┘                                            │
│   │  1 Hz ps + 2 combined lsof calls;                                                 │
│   │  diffed snapshot emits to RPC + web mirror                                        │
│   └────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│  WebServer (Bun.serve + WebSocket — optional; set autoStartWebMirror=true or env)    │
│                                                                                      │
└──────────────────────────────────┬──────────────────────────────────────────────────┘
                                   │ RPC messages
                                   ▼
┌──────────────────── Electrobun webview (src/views/terminal/) ───────────────────────┐
│                                                                                      │
│  SurfaceManager (workspaces + PaneLayout + xterm.js + browser instances)              │
│     ├── per-pane chips row  (fg command, cwd, port badges — click to open)           │
│     ├── Sidebar (workspaces + fg command + port chips + status pills)                │
│     ├── ProcessManagerPanel (⌘⌥P overlay, CPU/MEM, kill)                              │
│     ├── PanelManager (floating canvas overlays)                                       │
│     ├── TerminalEffects (GPU ripple + bloom)                                          │
│     └── CommandPalette (⌘⇧P)                                                          │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Key constraints**

- **No node-pty.** `Bun.spawn` with `terminal: true` is the only PTY API used.
- **No React.** Vanilla TS + DOM in the webview. xterm.js is the only significant webview dep.
- **PTY is the source of truth.** Canvas panels and metadata chips are ephemeral overlays — they never affect terminal state.
- **Keyboard goes to xterm.js.** Panels + chips are mouse-only (plus keyboard for chip-button focus). Browser panes receive keyboard input when focused.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘N` | New workspace |
| `⌘D` | Split right |
| `⌘⇧D` | Split down |
| `⌘W` | Close focused pane |
| `⌘⇧W` | Close workspace |
| `⌘B` | Toggle sidebar |
| `⌘,` | Settings |
| `⌘⇧P` | Command palette |
| `⌘⌥P` | **Process Manager** |
| `⌘I` | **Pane Info** (full detail view for the focused pane) |
| `⌘F` | Find in terminal |
| `⌘⇧L` | **Open browser in split** |
| `⌘L` | **Focus browser address bar** (when browser pane focused) |
| `⌘[` / `⌘]` | **Browser back / forward** (when browser pane focused) |
| `⌘R` | **Reload browser page** (when browser pane focused) |
| `⌥⌘I` | **Toggle browser DevTools** (when browser pane focused) |
| `⌘⌥←↑→↓` | Focus neighboring pane |
| `⌃⌘]` / `⌃⌘[` | Next / previous workspace |
| `⌘1…9` | Jump to workspace N |
| `⌘C` / `⌘V` | Copy / paste |
| `⌘=` / `⌘-` / `⌘0` | Font size bigger / smaller / reset |
| `Esc` | Close active overlay (settings, process manager, command palette) |

## CLI (`ht`)

Installed via **HyperTerm Canvas → Install 'ht' Command in PATH** (production builds) or `bun link` (dev). Controls HyperTerm Canvas through a Unix socket.

```bash
# System
ht ping                              # check if running
ht version
ht identify                          # focused surface + workspace
ht tree                              # workspace/pane/surface tree
ht capabilities --json               # list all API methods

# Workspaces
ht list-workspaces
ht new-workspace --name proj --cwd ~/code
ht select-workspace --workspace ws:2
ht rename-workspace "my new name"
ht next-workspace
ht previous-workspace

# Surfaces & panes
ht list-surfaces
ht new-split right                   # left | right | up | down
ht close-surface
ht focus-surface --surface surface:3

# I/O
ht send "echo hello\n"
ht send-key enter
ht read-screen --lines 20            # or --scrollback true

# Sidebar
ht set-status build "ok" --color "#a6e3a1" --icon bolt
ht clear-status build
ht set-progress 0.42 --label "Testing"
ht clear-progress
ht log --level success --source build "Tests passed"

# Notifications
ht notify --title "Build" --body "Done"
ht list-notifications
ht clear-notifications

# Live metadata (see next section)
ht metadata                          # summary: pid / fg / cwd / git / counts
ht cwd                               # print cwd
ht ps                                # process tree with * marker on fg
ht ports                             # PORT PROTO ADDR PID COMMAND
ht git                               # branch, upstream, ahead/behind, dirty, +/-
ht open 3000                         # open http://localhost:3000
ht open                              # resolves the unique listening port
ht kill 3000                         # SIGTERM to the pid on :3000
ht kill 3000 --signal SIGKILL

# tmux compat
ht capture-pane --lines 50           # alias for read-screen

# Browser (see Browser Panes section below)
ht browser open https://example.com
ht browser open-split https://example.com
ht browser browser:2 navigate https://example.org
ht browser browser:2 click "button[type='submit']"
ht browser browser:2 fill "#email" "user@example.com"
ht browser browser:2 wait --text "Welcome" --timeout-ms 15000
ht browser browser:2 get title
ht browser browser:2 is visible "#dashboard"
ht browser browser:2 snapshot
ht browser browser:2 eval "document.title"
ht browser browser:2 console
ht browser browser:2 errors
ht browser list
```

Every command honors `--surface <id>` to target a specific pane; if omitted, the CLI falls back to `HT_SURFACE` (auto-set inside panes) and finally the focused surface. Add `--json` (or `-j`) to any command for raw JSON output.

### Environment

| Variable | Purpose |
|----------|---------|
| `HT_SOCKET_PATH` | Override `/tmp/hyperterm.sock` |
| `HT_SURFACE` | Auto-set per spawned shell (the CLI reads this for default `--surface`) |
| `HT_WORKSPACE_ID`, `HT_SURFACE_ID` | Legacy aliases documented in `ht --help` |
| `HYPERTERM_WEB_PORT` | Overrides the `webMirrorPort` setting and forces auto-start |
| `HYPERTERM_DEBUG` | Enables debug logs in the Python / TS client libs |

## Live process metadata

See [`doc/system-process-metadata.md`](doc/system-process-metadata.md) for the full spec. Summary:

- A single `SurfaceMetadataPoller` runs in the Bun process.
- Per tick (1 Hz while the window is focused, ~3 Hz when hidden): **one** `ps -axo pid,ppid,pgid,stat,%cpu,rss,args -ww` call, **one** combined `lsof -iTCP -sTCP:LISTEN` across the union of tree pids, **one** combined `lsof -d cwd` across foreground pids.
- Per surface we derive: `pid` (shell), `foregroundPid` (tty's foreground pgrp leader), `cwd`, full descendant tree with argv + CPU % + RSS KB, listening TCP ports (dedup by pid/port/address), and — when `cwd` is inside a git work tree — `branch`, `head`, `upstream`, `ahead`/`behind`, `staged`/`unstaged`/`untracked`/`conflicts` file counts, and `insertions`/`deletions` line counts. Git calls are TTL-cached per cwd (3 s) so idle panes don't spam git.
- Snapshots are diffed against the previous tick; `onMetadata(surfaceId, metadata)` only fires on real change.
- Emissions fan out to the Electrobun RPC (→ webview chips + sidebar + Process Manager), to the WebSocket web mirror (→ remote clients), and are cached for `ht` CLI queries.

Security / robustness notes:

- The poller runs `ps` / `lsof` as the user, seeing only their own processes.
- `ps` output parses both `.` and `,` decimal separators and spawns with `LC_ALL=C` for deterministic formatting.
- Zombie processes (`Z` in STAT) are excluded from the tree.
- Dead surfaces are drained: when `SessionManager.onSurfaceClosed` fires, the poller's cache is purged on the next tick.

## Process Manager

Open with `⌘⌥P` (or **View → Process Manager…**, or the command palette → "Process Manager"). The overlay groups by workspace → surface and shows a live-updating table:

| Column | What it shows |
|--------|---------------|
| PID    | pid (foreground row highlighted with accent) |
| Command | Full argv — `bun run dev`, `python3 -m http.server 8765`, etc. |
| CPU %  | Instantaneous from `ps %cpu`; cell color heats up to red via `color-mix` |
| Memory | RSS, formatted as K / M / G |
| Action | **kill** button — SIGTERM by default, **Shift+click for SIGKILL** |

Above the workspace list: a summary ("N processes · X.X% CPU · Y.Y M RSS"). Each surface row collapses, shows its cwd, and lists listening ports as chips. Selecting a port chip still opens it in the browser. The panel refreshes in place on every metadata change — no polling from the webview, all push-based.

## Sideband protocol (fd 3/4/5)

Scripts running inside HyperTerm can render structured content through extra file descriptors. The channel map is discoverable via the `HYPERTERM_CHANNELS` JSON env var; the default layout is:

- **fd 3** — metadata channel (script → terminal, JSONL)
- **fd 4** — binary data channel (script → terminal, raw bytes)
- **fd 5** — event channel (terminal → script, JSONL)

See [`doc/system-sideband-protocol.md`](doc/system-sideband-protocol.md) for the full framing spec.

### Metadata (fd 3)

```jsonl
{"id":"img1","type":"image","format":"png","x":100,"y":100,"byteLength":4096}
{"id":"chart","type":"svg","position":"float","width":400,"height":300,"byteLength":2048}
{"id":"widget","type":"html","interactive":true,"byteLength":512}
{"id":"img1","type":"update","x":200,"y":200}
{"id":"img1","type":"clear"}
```

### Content types

| Type | Renderer |
|------|----------|
| `image` | `<img>` from blob URL (PNG, JPEG, WebP, GIF) |
| `svg` | SVG string as innerHTML |
| `html` | HTML string as innerHTML |
| `canvas2d` | `<canvas>` with `drawImage` |

Custom types register through `registerRenderer()` in `content-renderers.ts`.

### Panel options

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique panel identifier |
| `type` | string | Any content type or protocol op (`update`, `clear`) |
| `position` | enum | `float` (viewport-fixed), `inline` (scrolls with content), `fixed` (no chrome, raw overlay) |
| `x`, `y` | number | Position in pixels |
| `width`, `height` | number or `"auto"` | Dimensions |
| `draggable` | boolean | Allow drag (default: true for float) |
| `resizable` | boolean | Allow resize (default: true for float) |
| `interactive` | boolean | Forward mouse events to fd 5 |
| `byteLength` | number | Size of binary payload on the data channel |
| `dataChannel` | string | Named data channel (default: `"data"` = fd 4) |
| `opacity` | number | 0.0–1.0 |
| `zIndex` | number | Stacking order |

### Events (fd 5)

```jsonl
{"id":"img1","event":"dragend","x":300,"y":400}
{"id":"img1","event":"resize","width":600,"height":400}
{"id":"widget","event":"click","x":42,"y":87}
{"id":"img1","event":"close"}
{"id":"__terminal__","event":"resize","cols":120,"rows":40}
{"id":"__system__","event":"error","code":"meta-validate","message":"Missing id"}
```

### Client libraries

Python (`scripts/hyperterm.py`):

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

TypeScript (`scripts/hyperterm.ts`):

```typescript
import { ht } from "./hyperterm";

const id = ht.showSvg('<svg>...</svg>', { x: 100, y: 50 });
await ht.showImage('photo.png');
ht.update(id, { x: 200 });
ht.clear(id);
ht.onEvent((e) => console.log(e));
```

Both libraries are safe no-ops when not running inside HyperTerm — detection is a simple `HYPERTERM_PROTOCOL_VERSION` env check.

### Demo scripts

```bash
bun scripts/demo_draw.ts                     # Live drawing with mouse
python3 scripts/demo_dashboard.py            # CPU + memory + clock panels
python3 scripts/demo_chart.py                # Matplotlib SVG chart
python3 scripts/demo_interactive.py          # Clickable HTML buttons
python3 scripts/demo_image.py photo.png      # Image panel
bun scripts/demo_3d.ts                       # WebGL 3D demo
bun scripts/demo_canvas_life.ts              # Game of life
bash scripts/test_sideband.sh                # Protocol integration check
```

## Browser panes

Open a browser split with `⌘⇧L` or from the command palette. Browser panes sit in the same tiling layout as terminal panes — they share workspaces, splits, and keyboard navigation.

Key features:

- **Address bar** with smart URL detection and search engine integration (Google, DuckDuckGo, Bing, Kagi)
- **Navigation** — back, forward, reload via buttons and keyboard (`⌘[`, `⌘]`, `⌘R`)
- **Developer tools** — WebKit inspector via `⌥⌘I`
- **Find in page** — `⌘F` when a browser pane is focused
- **Cookie sharing** — all browser panes share the same session
- **Session persistence** — browser URLs are saved and restored across app restarts
- **Dark mode** — force dark mode on pages via Settings → Browser

### Browser automation

The `ht browser` command group provides 40+ scriptable commands for agent automation:

```bash
# Navigate, wait, inspect
ht browser open https://example.com/login
ht browser browser:1 wait --load-state complete --timeout-ms 15000
ht browser browser:1 snapshot                 # accessibility tree
ht browser browser:1 get title

# Fill a form
ht browser browser:1 fill "#email" "ops@example.com"
ht browser browser:1 fill "#password" "$PASSWORD"
ht browser browser:1 click "button[type='submit']"
ht browser browser:1 wait --text "Welcome"
ht browser browser:1 is visible "#dashboard"

# Inject code
ht browser browser:1 addscript "console.log('hello')"
ht browser browser:1 addstyle "body { font-size: 20px }"

# Debug
ht browser browser:1 console                  # page console logs
ht browser browser:1 errors                   # page JS errors
```

See [`doc/system-browser-pane.md`](doc/system-browser-pane.md) for the full reference.

## Web mirror

Open from the sidebar footer or `ht` — the mirror runs on `http://127.0.0.1:3000` by default (loopback only). Flip `webMirrorBind` to `0.0.0.0` to expose it on the LAN, and set `webMirrorAuthToken` to require `?t=<token>` (or `Authorization: Bearer <token>`) on every request. Terminal output, sideband panels, metadata chips, and notifications all stream over a single WebSocket. Port chips open `http://<host>:<port>` in a new tab — handy for poking a dev server from a phone on the same Wi-Fi.

Auto-start is off by default; enable it in **Settings → Network → Auto-start Web Mirror**, or set `HYPERTERM_WEB_PORT` in the env to force-enable.

Under the hood (see [`doc/http-web-ui-refactor.md`](doc/http-web-ui-refactor.md) for the full write-up): protocol v2 envelopes with per-session sequence numbers, resume-on-reconnect backed by a 2 MB ring buffer, terminal-state-correct replay via `@xterm/headless` + `SerializeAddon`, 16 ms stdout coalescing, metadata dedup, and Graphite-themed chrome that matches the native app.

## Settings

All settings persist to `~/Library/Application Support/hyperterm-canvas/settings.json`. Sections:

- **General** — `shellPath` (empty = `$SHELL`), `scrollbackLines`.
- **Appearance** — font family/size, line height, cursor style, cursor blink.
- **Theme** — 10 presets + per-color overrides, background opacity, accent / secondary / foreground colors, full 16-color ANSI palette.
- **Effects** — terminal bloom toggle + intensity.
- **Network** — web mirror port + auto-start + bind address + optional auth token.
- **Browser** — search engine, home page, force dark mode, terminal link interception.
- **Advanced** — pane gap (px between splits), sidebar width.

Every setting takes effect live (no restart), with these caveats:
- `shellPath` applies to *new* surfaces only (matches the UI note).
- `webMirrorPort`, `webMirrorBind`, and `webMirrorAuthToken` restart a running mirror on change.
- `autoStartWebMirror` only matters at launch (the mirror can still be toggled any time after).

## Socket API (JSON-RPC)

Connect to `/tmp/hyperterm.sock` and send newline-delimited JSON:

```json
{"id":"1","method":"system.ping","params":{}}
```

Response:

```json
{"id":"1","result":"PONG"}
```

Errors are returned as `{"id":"1","error":"message"}`. See [`doc/system-rpc-socket.md`](doc/system-rpc-socket.md) for full method docs.

**System:** `system.ping`, `system.version`, `system.identify`, `system.capabilities`, `system.tree`

**Workspaces:** `workspace.list`, `workspace.current`, `workspace.create`, `workspace.select`, `workspace.close`, `workspace.rename`, `workspace.next`, `workspace.previous`

**Surfaces:** `surface.list`, `surface.split`, `surface.close`, `surface.focus`, `surface.send_text`, `surface.send_key`, `surface.read_text`, `surface.metadata`, `surface.open_port`, `surface.kill_port`, `surface.kill_pid`

**Sidebar:** `sidebar.set_status`, `sidebar.clear_status`, `sidebar.set_progress`, `sidebar.clear_progress`, `sidebar.log`

**Notifications:** `notification.create`, `notification.list`, `notification.clear`

**Panes:** `pane.list`

**Browser:** `browser.list`, `browser.open`, `browser.open_split`, `browser.close`, `browser.identify`, `browser.navigate`, `browser.back`, `browser.forward`, `browser.reload`, `browser.url`, `browser.wait`, `browser.click`, `browser.dblclick`, `browser.hover`, `browser.focus`, `browser.check`, `browser.uncheck`, `browser.scroll_into_view`, `browser.type`, `browser.fill`, `browser.press`, `browser.select`, `browser.scroll`, `browser.highlight`, `browser.snapshot`, `browser.get`, `browser.is`, `browser.eval`, `browser.addscript`, `browser.addstyle`, `browser.find`, `browser.stop_find`, `browser.devtools`, `browser.console_list`, `browser.console_clear`, `browser.errors_list`, `browser.errors_clear`, `browser.history`, `browser.clear_history`

## Project layout

```
src/
  bun/                          # Bun main process
    index.ts                    # BrowserWindow, RPC handlers, socket server, poller wiring
    session-manager.ts          # Multi-surface PTY manager (setShell, callbacks)
    browser-surface-manager.ts  # Browser surface state (URL, title, zoom, console, errors)
    browser-history.ts          # JSON-persisted browser history with search + dedup
    pty-manager.ts              # Single PTY, Bun.spawn with terminal option
    sideband-parser.ts          # Multi-channel JSONL + binary reader
    event-writer.ts             # fd 5 JSONL event writer (incl. system errors)
    socket-server.ts            # Unix socket JSON-RPC server
    rpc-handler.ts              # All socket methods (incl. surface.metadata/open/kill)
    surface-metadata.ts         # Poller + ps/lsof parsers + diff + emit
    settings-manager.ts         # Load/save + debounced persist
    web-server.ts               # Re-export shim → src/bun/web/
    web/
      asset-loader.ts           # xterm bundle + Nerd Font loading
      connection.ts             # SessionBuffer (ring buffer, seq, backpressure)
      page.ts                   # Inlined HTML that references the built client
      server.ts                 # Bun.serve, envelope protocol, resume, auth
      state-store.ts            # Server-side cache of metadata/panels/sidebar
    native-menus.ts             # App menu + context menus
  shared/
    types.ts                    # RPC schema, sideband types, ProcessNode, SurfaceMetadata
    settings.ts                 # AppSettings schema + validation + theme presets
  views/terminal/               # Electrobun webview
    index.html                  # Entry HTML
    index.ts                    # RPC handlers, keybinds, CustomEvent wiring
    index.css                   # All styles (theme variables drive everything)
    surface-manager.ts          # Workspaces, pane layout, xterm + browser instances, chip rendering
    browser-pane.ts             # Browser pane: <electrobun-webview>, address bar, nav, preload
    pane-layout.ts              # Binary tree split computation
    panel-manager.ts            # Sideband panel lifecycle
    panel.ts                    # Single panel (drag, resize, render)
    content-renderers.ts        # Extensible content renderer registry
    sidebar.ts                  # Workspaces, status pills, port chips, fg command
    process-manager.ts          # ⌘⌥P overlay — every process, CPU/MEM, kill
    settings-panel.ts           # Full settings UI (general, appearance, theme, effects, network, browser, advanced)
    terminal-effects.ts         # WebGL bloom layer
    command-palette.ts          # ⌘⇧P fuzzy command search
    toast.ts                    # In-webview toast notifications
    prompt-dialog.ts            # Rename prompts
bin/ht                          # CLI (compiled into .app via postBuild hook)
scripts/
  hyperterm.py / hyperterm.ts   # Client libs
  demo_*.py / demo_*.ts          # Panel demos
  post-build.ts                 # Electrobun hook: bun build --compile ht → .app
  build-cli.ts                  # Standalone `build/ht-cli` binary for local testing
doc/
  system-pty-session.md
  system-rpc-socket.md
  system-sideband-protocol.md
  system-canvas-panels.md
  system-webview-ui.md
  system-process-metadata.md    # Full spec for the metadata pipeline
  system-browser-pane.md        # Browser pane: architecture, API, automation, settings
tests/                          # 220 tests across 15 files
```

## Development

```bash
bun install                # dependencies
bun start                  # dev: build + launch once
bun dev                    # dev: build + launch with watch
bun test                   # 220 tests
bun run typecheck          # TypeScript check
bun run build:cli          # standalone ./build/ht-cli binary (for other Macs)
bun run build:dev          # dev .app (no CLI injection yet — requires stable/canary)
bun run build:stable       # stable .app + DMG + bundled ht at Contents/MacOS/ht
```

A `postBuild` Electrobun hook (`scripts/post-build.ts`) compiles `bin/ht` targeting the build's arch and injects it into the inner bundle before tarring, so `Install 'ht' Command in PATH` works out of the box.

## Further reading

- [`doc/system-pty-session.md`](doc/system-pty-session.md) — PTY architecture, environment, output buffering, session management
- [`doc/system-rpc-socket.md`](doc/system-rpc-socket.md) — JSON-RPC socket, full method reference
- [`doc/system-sideband-protocol.md`](doc/system-sideband-protocol.md) — fd 3/4/5 protocol framing, validation, backpressure
- [`doc/system-canvas-panels.md`](doc/system-canvas-panels.md) — panel rendering, positioning modes, content renderers
- [`doc/system-webview-ui.md`](doc/system-webview-ui.md) — workspaces, panes, sidebar, process manager, keyboard UX
- [`doc/system-process-metadata.md`](doc/system-process-metadata.md) — live process metadata: poller, parsers, diff, renderers, CLI
- [`doc/system-browser-pane.md`](doc/system-browser-pane.md) — built-in browser pane: architecture, automation API, CLI, settings
- [`scripts/README_python.md`](scripts/README_python.md), [`scripts/README_typescript.md`](scripts/README_typescript.md) — client library reference

## Tech stack

- **Runtime** — [Bun](https://bun.sh) 1.3.9
- **Framework** — [Electrobun](https://electrobun.dev) 1.16.0
- **Terminal** — [xterm.js](https://xtermjs.org) 5.3.0
- **PTY** — `Bun.spawn` with `terminal` option (no node-pty)
- **Process metadata** — `ps` + `lsof` (no tmux, no shell integration)
- **Theme default** — Obsidian (10 built-in presets)
- **Font** — JetBrains Mono Nerd Font

## License

MIT
