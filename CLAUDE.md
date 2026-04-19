# CLAUDE.md

## Task Completion Requirements

- All of `bun test` and `bun run typecheck` must pass before considering tasks completed.
- Run `bun start` to verify the app launches and the terminal works after UI changes.
- For visual work, `bun run report:design:web` (fast) or `bun run test:full-suite` (web + native) regenerate `test-results/design-report/index.html`. Baseline via `bun run baseline:design`. Full workflow in `doc/design-report.md`.

## Project Snapshot

HyperTerm Canvas is a hybrid terminal emulator built on Electrobun + Bun:

- **Traditional PTY text layer** (xterm.js) coexists with multiple floating canvas overlays.
- **Sideband protocol** (fd 3/4/5) lets scripts render structured content (images, SVG, HTML, interactive widgets).
- **Live process metadata** — a `SurfaceMetadataPoller` observes every descendant of every shell via `ps` + `lsof` and publishes cwd / fg command / listening ports / CPU / RSS at 1 Hz. Chips in the pane header, sidebar aggregates, the Process Manager overlay (⌘⌥P), `ht` CLI, and the web mirror all feed from this single pipeline.
- **`ht` CLI** — JSON-RPC over a Unix socket. Ships as a standalone binary inside the .app, installable via an in-app menu item (no Bun required on other Macs).

This is an early-stage project. Performance and correctness are prioritized over feature breadth.

## Core Priorities

1. **Performance first** — <50 ms startup, minimal memory overhead, idle CPU ~0 when nothing is happening.
2. **Correctness first** — the terminal MUST behave like a real terminal (colors, TUI apps, line editing).
3. **Keep behavior predictable** — PTY is the source of truth; canvas panels and metadata chips are ephemeral overlays and never affect terminal state.

If a tradeoff is required, choose correctness and simplicity over feature completeness.

## Architecture

```
Bun Main Process (src/bun/)
  ├── SessionManager — spawns shells via Bun.spawn with terminal: true
  ├── SurfaceMetadataPoller — 1 Hz ps + lsof; diff-based emit
  ├── SocketServer — JSON-RPC over /tmp/hyperterm.sock (for `ht` CLI)
  ├── SidebandParser / EventWriter — fd 3/4/5 protocol
  ├── SettingsManager — debounced JSON persistence
  ├── WebServer — optional WebSocket mirror (serves src/web-client/ bundle)
  └── Electrobun RPC ↔ Webview

Web mirror client (src/web-client/)
  ├── main.ts                — entry; wires transport + protocol + views
  ├── store.ts               — reducer-driven AppState (framework-free)
  ├── transport.ts           — WebSocket v2 envelopes, reconnect, resume
  ├── protocol-dispatcher.ts — server-message → store-action dispatch
  ├── sidebar.ts             — workspace list, notifications, logs
  ├── layout.ts              — pure computeRects + applyLayout DOM pass
  ├── panel-interaction.ts   — pointer/drag/resize gesture routing
  └── panel-renderers.ts     — sideband content renderer registry

Electrobun Webview (src/views/terminal/)
  ├── SurfaceManager — workspaces, pane tree layout, xterm.js instances, chip rendering
  ├── PaneLayout — binary-tree split computation with configurable gap
  ├── Sidebar — workspaces, fg command, port chips, status pills, logs
  ├── ProcessManagerPanel — ⌘⌥P overlay with CPU/MEM/kill
  ├── PanelManager — floating canvas overlays (SVG, HTML, images, canvas2d)
  ├── TerminalEffects — WebGL bloom layer
  ├── SettingsPanel — full settings UI (general, appearance, theme, effects, network, advanced)
  └── CommandPalette — ⌘⇧P fuzzy command search
```

## Key Constraints

- **No node-pty.** Use `Bun.spawn` with `terminal: true` exclusively.
- **No React.** Vanilla TypeScript + DOM APIs in the webview. xterm.js is the only significant view dependency.
- **Keyboard never goes to panels or chips.** All keystrokes go to xterm.js → stdin. Panels are visual output + mouse interaction; chips are mouse / keyboard-activation only.
- **Each content block = its own DOM element.** Not a single shared canvas. Independent panels with CSS transforms.
- **No sandboxing of fd4 content** for now. HTML/SVG from fd4 is rendered directly. Scripts are trusted.
- **Electrobun RPC is the webview bridge.** Socket RPC is the CLI/external bridge. They share the handler registry aggregated in `src/bun/rpc-handler.ts` from per-domain modules under `src/bun/rpc-handlers/` (system / workspace / surface / sidebar / pane / notification / agent / browser-*). The Electrobun-facing handlers in `src/bun/index.ts` are gated by `satisfies BunMessageHandlers` so any new method in `HyperTermRPC["bun"]["messages"]` without a wired handler fails the typecheck.
- **Metadata pipeline never touches the PTY.** `SurfaceMetadataPoller` reads pids we already own and runs `ps` / `lsof` — if it breaks, the terminal keeps working.

## Directory Roles

- `src/bun/` — Main process. PTY management, sideband parsing, metadata poller, settings, socket + RPC, web mirror. Runs in Bun.
- `src/views/terminal/` — Webview code. xterm.js, chip rendering, pane layout, process manager, settings panel, sidebar. Runs in system WebView.
- `src/shared/` — Types shared between bun and webview. RPC contracts, `SurfaceMetadata`, `AppSettings`, sideband protocol types.
- `tests/` — Bun test files (756 tests across 54 files). Parser tests (`ps` / `lsof` / sideband), PTY manager, RPC handlers, pane layout, web-client reducer + view modules, native sidebar notification lifecycle, agent-panel sub-modules, SurfaceManager smoke suite, shared sound helper. `bunfig.toml` scopes bare `bun test` to this directory so `tests-e2e/` Playwright specs are not picked up.
- `scripts/` — Demo scripts + client libraries (Python, TS) for the sideband protocol. Also build hooks (`post-build.ts` for CLI injection into the .app, `build-cli.ts` for standalone binary).
- `doc/` — Extensive subsystem docs (PTY, RPC, sideband, canvas panels, webview UI, process metadata).
- `pi-extensions/` — Pi coding-agent extensions. `ht-notify-summary/` surfaces pi turns into the sidebar via `ht set-status` + `ht notify`.
- `claude-integration/` — Claude Code shell-hook bridge. `ht-bridge/` mirrors the pi-extension pattern (active label pill + persistent ticker + completion notification) for Claude Code's `UserPromptSubmit` / `Stop` / `Notification` events. `install.sh` symlinks it into `~/.claude/scripts/ht-bridge`; `settings.snippet.jsonc` shows the drop-in hook blocks.

## Coding Style

- TypeScript everywhere, ES modules.
- Minimal dependencies. No frameworks in the webview.
- Interface-heavy design, minimal class inheritance.
- Error handling: try-catch with graceful degradation. Log errors, don't throw from callbacks. The metadata poller must never crash the main process — all subprocess runners return empty maps on failure.
- Use `Bun.file(fd).stream()` for reading fds, `Bun.write(fd, data)` for writing.
- Parsers are pure functions (strings → structured maps) so they can be unit-tested without subprocesses.
- Locale-robustness: any subprocess whose output we parse should run with `LC_ALL=C, LANG=C` — decimal separators, thousand separators, and date formats all vary by locale and have bitten us before (`0,4` vs `0.4` for CPU%).

## Common Patterns

- **Adding a settings field** — extend `AppSettings` + `DEFAULT_SETTINGS` + `validateSettings`; add field renderer in `SettingsPanel`; read in `SurfaceManager.applySettings` for webview concerns or in the `updateSettings` RPC handler for bun concerns. See how `shellPath`, `webMirrorPort`, `paneGap`, `bloomIntensity` are threaded end-to-end.
- **Adding a socket/CLI command** — add method in the matching `src/bun/rpc-handlers/<domain>.ts` (system / workspace / surface / sidebar / pane / notification / agent / browser-*); it auto-merges into the dispatch table via `createRpcHandler` in `src/bun/rpc-handler.ts`. Then add a case in `bin/ht mapCommand`; optionally add a formatter in `formatOutput`.
- **Adding a keyboard shortcut** — append a `Binding<KeyCtx>` entry to `KEYBOARD_BINDINGS` (or `HIGH_PRIORITY_BINDINGS` for shortcuts that must fire even when the palette is visible) in `src/views/terminal/index.ts`. Use `keyMatch({ key, meta?, shift?, ctrl?, alt? })` for the matcher. `id` / `description` / `category` are there so a future help dialog or command palette can enumerate the same array.
- **Adding a metadata field** — see `doc/system-process-metadata.md` § 7.
- **Adding a pane-bar chip** — extend `renderSurfaceChips` in `surface-manager.ts`; matching CSS in `index.css`. Same class conventions (`surface-chip`, `chip-*` variants).
- **Adding a bundled binary asset (audio/image/font)** — drop the file in `assets/<type>/`, add a copy rule in `electrobun.config.ts` (destination under `vendor/` for packaged builds), register it in `src/bun/web/asset-loader.ts` (`VENDOR_MAP` + `readBinaryAsset` export), and serve it from `src/bun/web/server.ts` if the web mirror needs it. `assets/audio/finish.mp3` is the reference case — webview plays via relative `audio/finish.mp3`, web mirror fetches from `/audio/finish.mp3`.
