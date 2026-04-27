---
title: Architecture deep-dive
description: For contributors — directory layout, module boundaries, and how the pieces talk.
sidebar:
  order: 2
---

This page goes deeper than the user-facing [Architecture](/concepts/architecture/) doc. If you're contributing code, start here.

## Process model

Two processes:

1. **Bun main process** (`src/bun/`) — owns PTYs, parses sideband channels, polls process metadata, exposes RPC over Electrobun + Unix socket + WebSocket.
2. **Electrobun WebView** (`src/views/terminal/`) — renders xterm.js, the sidebar, the Process Manager, canvas overlays, browser panes.

There is no other server, no daemon, no helper process.

## Directory roles

```
src/
├── bun/                          # Bun main process
│   ├── index.ts                  # BrowserWindow, RPC handlers, socket server, poller wiring
│   ├── session-manager.ts        # Multi-surface PTY manager
│   ├── pty-manager.ts            # Single PTY, Bun.spawn with terminal: true
│   ├── browser-surface-manager.ts # Browser surface state
│   ├── browser-history.ts        # JSON-persisted browser history
│   ├── sideband-parser.ts        # Multi-channel JSONL + binary reader
│   ├── event-writer.ts           # fd 5 JSONL event writer
│   ├── socket-server.ts          # Unix socket JSON-RPC server
│   ├── rpc-handler.ts            # Dispatcher merging per-domain handlers
│   ├── rpc-handlers/             # system / workspace / surface / sidebar / pane / notification / agent / browser-* / telegram
│   │   └── shared.ts             # METHOD_SCHEMAS + validateParams + geometry helpers
│   ├── surface-metadata.ts       # 1 Hz poller + ps/lsof parsers + diff
│   ├── settings-manager.ts       # Load/save with debounced persist
│   ├── web/                      # Web mirror server
│   │   ├── server.ts             # Bun.serve, envelopes, resume, auth
│   │   ├── connection.ts         # SessionBuffer (ring buffer, seq, backpressure)
│   │   └── state-store.ts        # Server-side cache of metadata/panels/sidebar
│   └── native-menus.ts
├── shared/
│   ├── types.ts                  # RPC schema, sideband types, ProcessNode, SurfaceMetadata
│   └── settings.ts               # AppSettings schema + validation + theme presets
├── views/terminal/               # Electrobun webview
│   ├── index.ts                  # RPC handlers + keydown dispatch + CustomEvent wiring
│   ├── surface-manager.ts        # Workspaces, pane layout, xterm + browser instances, chip rendering
│   ├── browser-pane.ts           # <electrobun-webview>, address bar, navigation, preload
│   ├── pane-layout.ts            # Binary tree split computation
│   ├── pane-drag.ts              # Drop-position overlay + commit state machine
│   ├── panel-manager.ts          # Sideband panel lifecycle
│   ├── panel.ts                  # Single panel: drag, resize, render
│   ├── content-renderers.ts      # Extensible content renderer registry
│   ├── sidebar.ts                # Workspaces, status pills, port chips
│   ├── process-manager.ts        # ⌘⌥P overlay
│   ├── settings-panel.ts         # Full settings UI
│   ├── command-palette.ts        # ⌘⇧P fuzzy command search
│   ├── terminal-effects.ts       # WebGL bloom layer
│   └── keyboard-shortcuts.ts     # Bindings array
├── web-client/                   # Web mirror client
│   ├── main.ts                   # Entry; transport + protocol + views
│   ├── store.ts                  # Reducer-driven AppState
│   ├── transport.ts              # WebSocket v2 envelopes, reconnect, resume
│   ├── protocol-dispatcher.ts    # Server-message → store-action dispatch
│   ├── sidebar.ts                # Mirror sidebar render
│   ├── layout.ts                 # Pure computeRects + applyLayout DOM pass
│   └── panel-interaction.ts      # Pointer/drag/resize gesture routing
└── shared/                       # Types shared across both processes
```

## Common code paths

### Adding a settings field

1. Extend `AppSettings` + `DEFAULT_SETTINGS` + `validateSettings` in `src/shared/settings.ts`.
2. Add a renderer in `src/views/terminal/settings-panel.ts`.
3. Read the new field in `SurfaceManager.applySettings` (webview-only) or in the `updateSettings` RPC handler (bun-side).
4. Optionally add a command-palette entry in `buildPaletteCommands` to flip it without opening the panel.

### Adding a CLI / socket command

1. Add the method to the matching `src/bun/rpc-handlers/<domain>.ts`. It auto-merges into the dispatch table via `createRpcHandler` in `src/bun/rpc-handler.ts`.
2. Add a case in `bin/ht mapCommand`.
3. Optionally add a formatter in `formatOutput` for the human-readable form (the `--json` path needs no extra code).

### Adding a keyboard shortcut

Append a `Binding<KeyCtx>` entry to `KEYBOARD_BINDINGS` (or `HIGH_PRIORITY_BINDINGS`) in `src/views/terminal/keyboard-shortcuts.ts`. The id / description / category fields are picked up by the command palette automatically.

### Adding a metadata field

See `doc/system-process-metadata.md` § 7 (contributor reference).

### Adding a pane-bar chip

Extend `renderSurfaceChips` in `surface-manager.ts`; add CSS in `index.css`. Follow the `surface-chip` / `chip-*` class conventions.

### Adding a non-PTY surface kind

A surface kind beyond terminal / browser / agent / telegram requires:

1. Extending `PaneLeaf.surfaceType` in `src/shared/types.ts` and the parallel `surfaceTypes` records in `WorkspaceSnapshot` / `PersistedWorkspace`.
2. Adding `add<Kind>Surface` / `add<Kind>SurfaceAsSplit` / `remove<Kind>Surface` on `SurfaceManager`.
3. Teaching `applyLayout` how to size the new kind (skip `terminal.fit()`).
4. Adding `surfType === "<kind>"` to the `tryRestoreLayout` branch in `src/bun/index.ts` so saved layouts re-mount instead of leaking PTY shells.

Telegram (`src/views/terminal/telegram-pane.ts` + `src/bun/telegram-service.ts`) is the smallest reference implementation.

## RPC contract

All three transports share the contract type `TauMuxRPC` in `src/shared/types.ts`. The Electrobun-facing handlers in `src/bun/index.ts` are gated by `satisfies BunMessageHandlers`, so any new method without a wired handler fails the typecheck — adding to the contract forces you to wire it everywhere.

## Read more

- [User-facing Architecture](/concepts/architecture/)
- [Building](/development/building/)
- [Testing](/development/testing/)
