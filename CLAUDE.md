# CLAUDE.md



 The main documentation for pi is located at:                                          
                                                                                       
 /Users/olivierveinand/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/README.md                                                                 
                                                                                       
 You can also find additional documentation in this directory:                         
                                                                                       
 /Users/olivierveinand/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/docs 

 and you can look at the source code of pi : 
 /Users/olivierveinand/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/

## Task Completion Requirements

- All of `bun test` and `bun run typecheck` must pass before considering tasks completed.
- Run `bun start` to verify the app launches and the terminal works after UI changes.
- For visual work, `bun run report:design:web` (fast) or `bun run test:full-suite` (web + native) regenerate `test-results/design-report/index.html`. Baseline via `bun run baseline:design`. Full workflow in `doc/design-report.md`.

## Project Snapshot

τ-mux is a hybrid terminal emulator built on Electrobun + Bun:

- **Traditional PTY text layer** (xterm.js) coexists with multiple floating canvas overlays.
- **Sideband protocol** (fd 3/4/5) lets scripts render structured content (images, SVG, HTML, interactive widgets).
- **Live process metadata** — a `SurfaceMetadataPoller` observes every descendant of every shell via `ps` + `lsof` and publishes cwd / fg command / listening ports / CPU / RSS at 1 Hz. Chips in the pane header, sidebar aggregates, the Process Manager overlay (⌘⌥P), `ht` CLI, and the web mirror all feed from this single pipeline.
- **`ht` CLI** — JSON-RPC over a Unix socket. Ships as a standalone binary inside the .app, installable via an in-app menu item (no Bun required on other Macs).
- **Telegram bridge** — long-poll bot service + first-class chat pane + optional notification forwarding. SQLite log at `~/Library/Application Support/hyperterm-canvas/telegram.db` with dedup + offset persistence. CLI access via `ht telegram {status|chats|read|send}`. See `doc/system-telegram.md`.

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
  ├── SettingsPanel — full settings UI (general, appearance, theme, effects, network, browser, telegram, advanced)
  ├── TelegramPaneView — chat pane with picker + status pill + composer
  └── CommandPalette — ⌘⇧P fuzzy command search
```

## Key Constraints

- **No node-pty.** Use `Bun.spawn` with `terminal: true` exclusively.
- **No React.** Vanilla TypeScript + DOM APIs in the webview. xterm.js is the only significant view dependency.
- **Keyboard never goes to panels or chips.** All keystrokes go to xterm.js → stdin. Panels are visual output + mouse interaction; chips are mouse / keyboard-activation only.
- **Each content block = its own DOM element.** Not a single shared canvas. Independent panels with CSS transforms.
- **No sandboxing of fd4 content** for now. HTML/SVG from fd4 is rendered directly. Scripts are trusted.
- **Electrobun RPC is the webview bridge.** Socket RPC is the CLI/external bridge. They share the handler registry aggregated in `src/bun/rpc-handler.ts` from per-domain modules under `src/bun/rpc-handlers/` (system / workspace / surface / sidebar / pane / notification / agent / browser-* / telegram). The Electrobun-facing handlers in `src/bun/index.ts` are gated by `satisfies BunMessageHandlers` so any new method in `TauMuxRPC["bun"]["messages"]` without a wired handler fails the typecheck.
- **Metadata pipeline never touches the PTY.** `SurfaceMetadataPoller` reads pids we already own and runs `ps` / `lsof` — if it breaks, the terminal keeps working.
- **Pi agents use a different IPC than everything else.** `pi-agent-manager` consumes `pi --mode rpc` JSONL over **stdin/stdout**, NOT the fd 3/4/5 sideband used by every other producer. The pi CLI is upstream-defined; we don't get to reshape its protocol. See `doc/system-pty-session.md` § 9 for the rationale.

## Directory Roles

- `src/bun/` — Main process. PTY management, sideband parsing, metadata poller, settings, socket + RPC, web mirror. Runs in Bun.
- `src/views/terminal/` — Webview code. xterm.js, chip rendering, pane layout, process manager, settings panel, sidebar. Runs in system WebView.
- `src/shared/` — Types shared between bun and webview. RPC contracts, `SurfaceMetadata`, `AppSettings`, sideband protocol types.
- `tests/` — Bun test files (1500+ tests across 100 files). Parser tests (`ps` / `lsof` / sideband), PTY manager, RPC handlers, pane layout, web-client reducer + view modules, native sidebar notification lifecycle, agent-panel sub-modules, SurfaceManager smoke suite, shared sound helper, Telegram db / service / settings / forwarder. `bunfig.toml` scopes bare `bun test` to this directory so `tests-e2e/` Playwright specs are not picked up.
- `scripts/` — Demo scripts + client libraries (Python, TS) for the sideband protocol. Also build hooks (`post-build.ts` for CLI injection into the .app, `build-cli.ts` for standalone binary).
- `doc/` — Extensive subsystem docs (PTY, RPC, sideband, canvas panels, webview UI, process metadata).
- `pi-extensions/` — Pi coding-agent extensions. `ht-bridge/` is bundled with τ-mux 0.2.81 and surfaces pi turns into the sidebar via active labels, cost/context ticks, tool badges, plan mirroring with review-first `.pi/plans/*.md` files, ask-user modals, custom LLM-callable tools, and a system-prompt primer.
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

- **Adding a settings field** — extend `AppSettings` + `DEFAULT_SETTINGS` + `validateSettings`; add field renderer in `SettingsPanel`; read in `SurfaceManager.applySettings` for webview concerns or in the `updateSettings` RPC handler for bun concerns. See how `shellPath`, `webMirrorPort`, `paneGap`, `bloomIntensity`, `notificationSoundEnabled` / `notificationSoundVolume` are threaded end-to-end. For an optional command-palette shortcut, append a `PaletteCommand` in `buildPaletteCommands` (src/views/terminal/index.ts) whose action routes through the same `updateSettings` pipeline.
- **Adding a socket/CLI command** — add method in the matching `src/bun/rpc-handlers/<domain>.ts` (system / workspace / surface / sidebar / pane / notification / agent / browser-*); it auto-merges into the dispatch table via `createRpcHandler` in `src/bun/rpc-handler.ts`. Then add a case in `bin/ht mapCommand`; optionally add a formatter in `formatOutput`.
- **Adding a keyboard shortcut** — append a `Binding<KeyCtx>` entry to `KEYBOARD_BINDINGS` (or `HIGH_PRIORITY_BINDINGS` for shortcuts that must fire even when the palette is visible) in `src/views/terminal/index.ts`. Use `keyMatch({ key, meta?, shift?, ctrl?, alt? })` for the matcher. `id` / `description` / `category` are there so a future help dialog or command palette can enumerate the same array.
- **Adding a metadata field** — see `doc/system-process-metadata.md` § 7.
- **Adding a pane-bar chip** — extend `renderSurfaceChips` in `surface-manager.ts`; matching CSS in `index.css`. Same class conventions (`surface-chip`, `chip-*` variants).
- **Adding a bundled binary asset (audio/image/font)** — drop the file in `assets/<type>/`, add a copy rule in `electrobun.config.ts` (destination under `vendor/` for packaged builds), register it in `src/bun/web/asset-loader.ts` (`VENDOR_MAP` + `readBinaryAsset` export), and serve it from `src/bun/web/server.ts` if the web mirror needs it. `assets/audio/finish.mp3` is the reference case — webview plays via relative `audio/finish.mp3`, web mirror fetches from `/audio/finish.mp3`.
- **Adding a non-PTY surface kind** (browser, agent, telegram) — extend `PaneLeaf.surfaceType` in `src/shared/types.ts` and the parallel `surfaceTypes` records in `WorkspaceSnapshot` / `PersistedWorkspace`; add `add<Kind>Surface` / `add<Kind>SurfaceAsSplit` / `remove<Kind>Surface` on `SurfaceManager`; teach `applyLayout` how to size it (skip terminal fit); add `surfType === "<kind>"` to the `tryRestoreLayout` branch in `src/bun/index.ts` so saved layouts re-mount instead of leaking PTY shells. Telegram is the smallest reference (`src/views/terminal/telegram-pane.ts` + `src/bun/telegram-service.ts`).

allways use bun run bum:patch/minor/major before commit, if you dont, explain why

when modifying website-doc, make sure you incude the app version in :
website-doc/src/content/docs/api/system.md
and
website-doc/src/content/docs/cli/system.md

for the website-doc, for each content, you must aso translate to french 

When working, keep track of the changes that needs to be documented in a doc/changes_to_document.md and keep it up to date. clear it when you do update de website-doc

update the website-doc on user request. you can propose to update it when needed


when folowing a plan, track your progress, deviation and issues in doc/tracking_*plan_name*.md include the commit id when you commit



