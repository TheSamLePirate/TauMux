# CLAUDE.md

## Development Rules

- Follow `DEV_RULES.md` for repository-wide coding and maintenance rules.
- When something is modified, update the relevant tests, run the required verification, update the docs, and update any impacted skill/workflow documentation.

## Task Completion Requirements

- All of `bun test` and `bun run typecheck` must pass before considering tasks completed.
- Run `bun start` to verify the app launches and the terminal works after UI changes.

## Project Snapshot

HyperTerm Canvas is a hybrid terminal emulator built on Electrobun + Bun:

- **Traditional PTY text layer** (xterm.js) coexists with multiple floating canvas overlays.
- **Sideband protocol** (fd 3/4/5) lets scripts render structured content (images, SVG, HTML, interactive widgets).
- **Live process metadata** — a `SurfaceMetadataPoller` observes every descendant of every shell via `ps` + `lsof` and publishes cwd / fg command / listening ports / CPU / RSS at 1 Hz. Chips in the pane header, sidebar aggregates, the Process Manager overlay (⌘⌥P), `ht` CLI, and the web mirror all feed from this single pipeline.
- **`ht` CLI** — JSON-RPC over a Unix socket. Ships as a standalone binary inside the .app, installable via an in-app menu item (no Bun required on other Macs).
- **Built-in browser panes** — `<electrobun-webview>` OOPIF browser that can split alongside terminals. Address bar, navigation, search engines, scriptable DOM interaction (click, fill, wait, snapshot), console/error capture, and 40+ `browser.*` RPC methods.

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
  ├── BrowserSurfaceManager — browser pane state (URL, title, zoom, console, errors)
  ├── BrowserHistoryStore — JSON-persisted browser navigation history
  ├── SurfaceMetadataPoller — 1 Hz ps + lsof; diff-based emit
  ├── SocketServer — JSON-RPC over /tmp/hyperterm.sock (for `ht` CLI)
  ├── SidebandParser / EventWriter — fd 3/4/5 protocol
  ├── SettingsManager — debounced JSON persistence
  ├── WebServer — optional WebSocket mirror (HTML bundle inlined)
  └── Electrobun RPC ↔ Webview

Electrobun Webview (src/views/terminal/)
  ├── SurfaceManager — workspaces, pane tree layout, xterm.js + browser instances, chip rendering
  ├── BrowserPaneView — <electrobun-webview> OOPIF, address bar, navigation, preload
  ├── PaneLayout — binary-tree split computation with configurable gap
  ├── Sidebar — workspaces, fg command, port chips, status pills, logs
  ├── ProcessManagerPanel — ⌘⌥P overlay with CPU/MEM/kill
  ├── PanelManager — floating canvas overlays (SVG, HTML, images, canvas2d)
  ├── TerminalEffects — WebGL bloom layer
  ├── SettingsPanel — full settings UI (general, appearance, theme, effects, network, browser, advanced)
  └── CommandPalette — ⌘⇧P fuzzy command search
```

## Key Constraints

- **No node-pty.** Use `Bun.spawn` with `terminal: true` exclusively.
- **No React.** Vanilla TypeScript + DOM APIs in the webview. xterm.js is the only significant view dependency.
- **Keyboard never goes to panels or chips.** All keystrokes go to xterm.js → stdin. Panels are visual output + mouse interaction; chips are mouse / keyboard-activation only. **Exception:** browser panes receive keyboard input when focused (address bar, web page interactions).
- **Each content block = its own DOM element.** Not a single shared canvas. Independent panels with CSS transforms.
- **No sandboxing of fd4 content** for now. HTML/SVG from fd4 is rendered directly. Scripts are trusted.
- **Electrobun RPC is the webview bridge.** Socket RPC is the CLI/external bridge. They share the handler registry in `src/bun/rpc-handler.ts`.
- **Metadata pipeline never touches the PTY.** `SurfaceMetadataPoller` reads pids we already own and runs `ps` / `lsof` — if it breaks, the terminal keeps working.
- **Browser panes have no PTY.** They track URL/title/zoom state bun-side via `BrowserSurfaceManager`. DOM interaction is via `executeJavascript()` + `host-message` on the `<electrobun-webview>` element. Console and errors are captured by a preload script.

## Directory Roles

- `src/bun/` — Main process. PTY management, sideband parsing, metadata poller, settings, socket + RPC, web mirror. Runs in Bun.
- `src/views/terminal/` — Webview code. xterm.js, chip rendering, pane layout, process manager, settings panel, sidebar. Runs in system WebView.
- `src/shared/` — Types shared between bun and webview. RPC contracts, `SurfaceMetadata`, `AppSettings`, sideband protocol types.
- `tests/` — Bun test files (220 tests across 15 files). Parser tests for `ps` / `lsof` output, PTY manager, sideband parser, RPC handler, pane layout, browser surface manager, browser history, URL helpers.
- `scripts/` — Demo scripts + client libraries (Python, TS) for the sideband protocol. Also build hooks (`post-build.ts` for CLI injection into the .app, `build-cli.ts` for standalone binary).
- `doc/` — Extensive subsystem docs (PTY, RPC, sideband, canvas panels, webview UI, process metadata).

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
- **Adding a socket/CLI command** — add method in `rpc-handler.ts` (namespace `system.*`, `workspace.*`, `surface.*`, `sidebar.*`, `notification.*`, `pane.*`, `browser.*`); add case in `bin/ht mapCommand` (or `mapBrowserSubcommand` for browser commands); optionally add a formatter in `formatOutput`.
- **Adding a browser automation command** — add `browser.*` method in `rpc-handler.ts`; for DOM interaction, build a JS string and `dispatch("browser.evalJs", ...)`. Add subcommand in `mapBrowserSubcommand()` in `bin/ht`. See `doc/system-browser-pane.md` § 6.
- **Agent skill** — the `.agents/skills/hyperterm-canvas/` directory contains a complete skill file that any AI coding agent can load to operate HyperTerm Canvas through the `ht` CLI. It covers terminals, browser panes, sidebar, notifications, metadata, and full browser automation.
- **Adding a metadata field** — see `doc/system-process-metadata.md` § 7.
- **Adding a pane-bar chip** — extend `renderSurfaceChips` in `surface-manager.ts`; matching CSS in `index.css`. Same class conventions (`surface-chip`, `chip-*` variants).
