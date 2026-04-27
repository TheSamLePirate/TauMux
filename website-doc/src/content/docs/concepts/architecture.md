---
title: Architecture
description: How the Bun main process, the Electrobun webview, and the web mirror fit together.
sidebar:
  order: 1
---

τ-mux runs three coordinated layers:

1. A **Bun main process** that owns PTYs, parses sideband channels, polls process metadata, and exposes RPC over both Electrobun and a Unix socket.
2. An **Electrobun webview** that renders xterm.js, the sidebar, the Process Manager, canvas overlays, and the browser pane.
3. An **optional web mirror** — a Bun-served HTTP/WebSocket endpoint that streams the same UI to anything on the LAN.

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
│   └───────────────────────────────────────────────────────────────────────────────┘ │
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
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Key constraints

These shape every architectural decision in the project.

- **No node-pty.** `Bun.spawn` with `terminal: true` is the only PTY API used.
- **No React.** Vanilla TypeScript + DOM in the webview. xterm.js is the only significant view dependency.
- **Keyboard goes to xterm.js.** Panels and chips are mouse-only (chip buttons are keyboard-focusable). Browser panes receive keyboard input when focused.
- **Each content block is its own DOM element.** Independent panels with CSS transforms — not a shared canvas.
- **Electrobun RPC is the webview bridge. Socket RPC is the CLI bridge.** They share a single handler registry merged from per-domain modules under `src/bun/rpc-handlers/`.
- **Metadata never touches the PTY.** The poller reads pids the app already owns and runs `ps` / `lsof` — if it breaks, the terminal keeps working.

## Three RPC surfaces, one handler registry

| Surface | Used by | Transport |
|---|---|---|
| Electrobun RPC | The Electrobun webview | IPC over the Electrobun runtime |
| Unix socket | The `ht` CLI, scripts, agents | `/tmp/hyperterm.sock`, newline-delimited JSON |
| WebSocket | The web mirror client | Per-session enveloped frames over WS |

All three share the same handler implementations — adding an RPC method automatically exposes it on every transport. Domains:

- `system` — ping, version, identify, tree, capabilities.
- `workspace` — list, current, create, select, close, rename, next, previous.
- `surface` — list, split, close, focus, send_text, send_key, read_text, metadata, open_port, kill_port, kill_pid, screenshot.
- `sidebar` — set_status, clear_status, set_progress, clear_progress, log.
- `notification` — create, list, clear, dismiss.
- `pane` — list.
- `browser` — open, navigate, click, fill, wait, snapshot, eval, console_list, errors_list, … (40+ methods).
- `telegram` — list_chats, read, send, status, settings.

See [JSON-RPC API overview](/api/overview/) for the full method catalogue.

## Read more

- [Workspaces & panes](/concepts/workspaces-and-panes/)
- [PTY model](/concepts/pty-model/)
- [Sideband overview](/concepts/sideband-overview/)
