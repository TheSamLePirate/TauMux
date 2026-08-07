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
- **Live process metadata** — a `SurfaceMetadataPoller` observes every descendant of every shell and publishes cwd / fg command / listening ports / CPU / RSS at 1 Hz. It reads libSystem directly through `bun:ffi` (`src/bun/native-proc.ts` — `sysctl` + `proc_pidinfo`, ~5 ms/tick instead of the ~200 ms the old three-subprocess path cost); `ps` / `lsof` remain as a self-validating fallback that engages automatically if the struct-offset probe fails. Chips in the pane header, sidebar aggregates, the Process Manager overlay (⌘⌥P), `ht` CLI, and the web mirror all feed from this single pipeline.
- **`ht` CLI** — JSON-RPC over a Unix socket. Ships as a standalone binary inside the .app, installable via an in-app menu item (no Bun required on other Macs).
- **Telegram bridge** — long-poll bot service + first-class chat pane + optional notification forwarding. SQLite log at `~/Library/Application Support/hyperterm-canvas/telegram.db` with dedup + offset persistence. CLI access via `ht telegram {status|chats|read|send|restart}`. See `doc/system-telegram.md`.
- **Agent harness** — first-class integrations for pi and Claude Code: native agent panes, a sidebar plan panel mirroring the agent's task list, ask-user modals with Telegram fan-out, an auto-continue engine, and remote/terminal permission approvals. See `doc/system-claude-integration.md` and `doc/system-pi-agent.md`.
- **Seven surface kinds** — `terminal`, `browser`, `agent`, `telegram`, `editor`, `extension`, `claude` — all share the tiling layout and persist to `layout.json`.

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
  ├── SurfaceMetadataPoller — 1 Hz libSystem FFI (native-proc.ts); ps/lsof fallback; diff-based emit
  ├── SocketServer — JSON-RPC over /tmp/hyperterm.sock (for `ht` CLI)
  ├── SidebandParser / EventWriter — fd 3/4/5 protocol
  ├── SettingsManager — debounced JSON persistence
  ├── PlanStore / AutoContinueEngine / AskUserQueue — agent-facing surfaces
  ├── claude-agent-manager (Agent SDK) + claude-integration (hooks, statusline, approvals)
  ├── pi-agent-manager — pi --mode rpc JSONL over stdio
  ├── ExtensionManager — extension app install + backends
  ├── TelegramService / TelegramDb — long-poll bot + SQLite log
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
  ├── SurfaceManager — workspaces, pane tree layout, 7 surface kinds, chip rendering
  ├── PaneLayout — binary-tree split computation with configurable gap
  ├── *-surface-controller.ts — per-kind mount/unmount/resize (agent, browser, claude, editor, extension, telegram)
  ├── Sidebar — workspaces, fg command, port chips, status pills, logs, file explorer
  ├── PlanPanel — agent plans: progress bar, inline step detail, clear control
  ├── AskUserModal — agent → human question dialog with telegram fan-out
  ├── ClaudeAgentPane — Claude Code transcript, tool cards, meters, switchers
  ├── AgentPanel — pi agent pane (split across agent-panel-*.ts)
  ├── EditorPane — CodeMirror 6 file editor
  ├── ExtensionPane — extension app host
  ├── ProcessManagerPanel — ⌘⌥P overlay with CPU/MEM/kill
  ├── PanelManager — floating canvas overlays (sandboxed html/svg, images, canvas2d)
  ├── TerminalEffects — WebGL bloom layer
  ├── SettingsPanel — full settings UI (general, appearance, theme, effects, layout, network, browser, telegram, advanced)
  ├── TelegramPaneView — chat pane with picker + status pill + composer
  ├── variants/ — layout variant orchestrator (bridge / cockpit / atlas)
  ├── KeyboardCheatsheet — ⌘⇧? generated from the bindings arrays
  └── CommandPalette — ⌘⇧P fuzzy command search
```

## Key Constraints

- **No node-pty.** Use `Bun.spawn` with `terminal: true` exclusively.
- **No React.** Vanilla TypeScript + DOM APIs in the webview. xterm.js is the only significant view dependency.
- **Keyboard never goes to panels or chips.** All keystrokes go to xterm.js → stdin. Panels are visual output + mouse interaction; chips are mouse / keyboard-activation only.
- **Each content block = its own DOM element.** Not a single shared canvas. Independent panels with CSS transforms.
- **fd4 html/svg is sandboxed by default** (H4 / C2). Display-only `html`/`svg` — inline `meta.data` or binary fd4 — renders inside a strict-CSP `<iframe sandbox>` (no scripts, no same-origin) via the shared `src/shared/sideband-sandbox.ts`, on BOTH the native webview and the web mirror. A producer that sets `interactive` opts into the legacy direct-`innerHTML` path (needed for DOM event forwarding) — that is the one explicit, full-privilege native trust boundary, documented at each sink. Producers are still trusted; the sandbox is defense-in-depth against a **careless** one. Be precise about what that buys: `interactive` is producer-controlled, so on the native webview a *compromised* producer just sets it and gets `innerHTML` anyway — the sandbox stops accidents there, not attacks. The web mirror has no such escape hatch (it always sandboxes), so the LAN-facing sink *is* hardened against a hostile producer.
- **Electrobun RPC is the webview bridge.** Socket RPC is the CLI/external bridge. They share the handler registry aggregated in `src/bun/rpc-handler.ts` from per-domain modules under `src/bun/rpc-handlers/` (system / workspace / surface / sidebar / pane / notification / agent / browser-* / claude / editor / extension / plan / autocontinue / audit / script / panel / telegram — 139 methods across 17 domains). The Electrobun-facing handlers in `src/bun/index.ts` are gated by `satisfies BunMessageHandlers` so any new method in `TauMuxRPC["bun"]["messages"]` without a wired handler fails the typecheck.
- **Docs drift is a CI failure, not a chore.** `tests/docs-coverage.test.ts` asserts that every registered RPC method, every `ht` command, and every `AppSettings` field appears in the website reference (EN *and* FR), that no documented setting is a ghost, that documented defaults match `DEFAULT_SETTINGS`, that every `SurfaceKind` is named in the concepts page, and that EN and FR have the same page inventory. Adding a method/command/setting without documenting it fails the build.
- **Metadata pipeline never touches the PTY.** `SurfaceMetadataPoller` reads pids we already own via libSystem FFI (falling back to `ps` / `lsof`) — if it breaks, the terminal keeps working. `native-proc.ts` self-validates its struct offsets and returns `null` rather than trusting them.
- **Pi agents use a different IPC than everything else.** `pi-agent-manager` consumes `pi --mode rpc` JSONL over **stdin/stdout**, NOT the fd 3/4/5 sideband used by every other producer. The pi CLI is upstream-defined; we don't get to reshape its protocol. See `doc/system-pty-session.md` § 9 for the rationale.

## Directory Roles

- `src/bun/` — Main process. PTY management, sideband parsing, metadata poller, settings, socket + RPC, web mirror. Runs in Bun.
- `src/views/terminal/` — Webview code. xterm.js, chip rendering, pane layout, process manager, settings panel, sidebar. Runs in system WebView.
- `src/shared/` — Types shared between bun and webview. RPC contracts, `SurfaceMetadata`, `AppSettings`, sideband protocol types.
- `tests/` — Bun test files (3400+ tests across 278 files). Parser tests (`ps` / `lsof` / sideband), native-proc FFI offset assertions against live `ps`/`lsof`, PTY manager, RPC handlers, pane layout, web-client reducer + view modules, native sidebar notification lifecycle, agent-panel sub-modules, Claude session registry / auto-approve / plan mirror, SurfaceManager smoke suite, shared sound helper, Telegram db / service / settings / forwarder, docs-coverage gate. `bunfig.toml` scopes bare `bun test` to this directory so `tests-e2e/` Playwright specs are not picked up.
- `tests-e2e/` — Playwright specs against the web mirror (`bun run test:e2e`). `tests-e2e-native/` — Playwright against the native webview (`bun run test:native`).
- `scripts/` — Demo scripts + client libraries (Python, TS) for the sideband protocol. Also build hooks (`post-build.ts` for CLI injection into the .app, `build-cli.ts` for standalone binary, `bump-version.ts` for release stamping).
- `doc/` — Extensive subsystem docs (PTY, RPC, sideband, canvas panels, webview UI, process metadata, Claude integration, pi agent, plan panel, telegram, security, sharebin, OSC).
- `website-doc/` — Astro Starlight documentation site, EN + FR. Verified against the source by `tests/docs-coverage.test.ts`.
- `pi-extensions/` — Pi coding-agent extensions. `ht-bridge/` is bundled with τ-mux and surfaces pi turns into the sidebar via active labels, cost/context ticks, tool badges, plan mirroring with review-first `.pi/plans/*.md` files, ask-user modals, custom LLM-callable tools, and a system-prompt primer.
- `claude-integration/` — Claude Code integration. `ht-bridge/` forwards the full session lifecycle (session start/end, prompt/stop, API failures, subagent start/stop, compaction, cwd changes, task created/completed, permission + idle notifications, and the `PreToolUse`/`PostToolUse` pair scoped to `AskUserQuestion|ExitPlanMode`) into status pills, the sidebar ticker, the plan panel, and approval modals. `skills/tau-mux/` ships a Claude Code skill for the `ht` surfaces. Installed with `ht claude install`; `install.sh` + `settings.snippet.jsonc` remain for manual wiring.
- `examples/extensions/` — Sample extension apps (`http-client`, `nebula`, `three-demo`).

## Coding Style

- TypeScript everywhere, ES modules.
- Minimal dependencies. No frameworks in the webview.
- Interface-heavy design, minimal class inheritance.
- Error handling: try-catch with graceful degradation. Log errors, don't throw from callbacks. The metadata poller must never crash the main process — all subprocess runners *and* every `native-proc.ts` FFI entry point return empty results on failure rather than throwing.
- Use `Bun.file(fd).stream()` for reading fds, `Bun.write(fd, data)` for writing.
- Parsers are pure functions (strings → structured maps) so they can be unit-tested without subprocesses.
- Locale-robustness: any subprocess whose output we parse should run with `LC_ALL=C, LANG=C` — decimal separators, thousand separators, and date formats all vary by locale and have bitten us before (`0,4` vs `0.4` for CPU%).

## Common Patterns

- **Adding a settings field** — extend `AppSettings` + `DEFAULT_SETTINGS` + `validateSettings`; add field renderer in `SettingsPanel`; read in `SurfaceManager.applySettings` for webview concerns or in the `updateSettings` RPC handler for bun concerns. See how `shellPath`, `webMirrorPort`, `paneGap`, `bloomIntensity`, `notificationSoundEnabled` / `notificationSoundVolume` are threaded end-to-end. For an optional command-palette shortcut, append a `PaletteCommand` in `buildPaletteCommands` (src/views/terminal/index.ts) whose action routes through the same `updateSettings` pipeline.
- **Adding a socket/CLI command** — add method in the matching `src/bun/rpc-handlers/<domain>.ts` (system / workspace / surface / sidebar / pane / notification / agent / browser-* / claude / editor / extension / plan / autocontinue / audit / script / panel / telegram); it auto-merges into the dispatch table via `createRpcHandler` in `src/bun/rpc-handler.ts`. Then add a case in `mapCommand` (`src/cli/map-command.ts`); optionally add a formatter in `formatOutput`. **Document it in `website-doc` (EN + FR) in the same change** — `tests/docs-coverage.test.ts` fails otherwise.
- **Adding a keyboard shortcut** — append a `Binding<KeyCtx>` entry to `KEYBOARD_BINDINGS` (or `HIGH_PRIORITY_BINDINGS` for shortcuts that must fire even when the palette is visible) in `src/views/terminal/index.ts`. Use `keyMatch({ key, meta?, shift?, ctrl?, alt? })` for the matcher; helpers live in `src/views/terminal/keyboard-shortcuts.ts`. `id` / `description` / `category` feed the command palette and the `⌘⇧?` cheat-sheet (`keyboard-cheatsheet.ts`), which enumerate the same arrays.
- **Adding a metadata field** — see `doc/system-process-metadata.md` § 7.
- **Adding a pane-bar chip** — extend `renderSurfaceChips` in `surface-manager.ts`; matching CSS in `index.css`. Same class conventions (`surface-chip`, `chip-*` variants).
- **Adding a bundled binary asset (audio/image/font)** — drop the file in `assets/<type>/`, add a copy rule in `electrobun.config.ts` (destination under `vendor/` for packaged builds), register it in `src/bun/web/asset-loader.ts` (`VENDOR_MAP` + `readBinaryAsset` export), and serve it from `src/bun/web/server.ts` if the web mirror needs it. `assets/audio/finish.mp3` is the reference case — webview plays via relative `audio/finish.mp3`, web mirror fetches from `/audio/finish.mp3`.
- **Adding a non-PTY surface kind** — there are currently seven (`terminal`, `browser`, `agent`, `telegram`, `editor`, `extension`, `claude`). Extend `SurfaceKind` / `PaneLeaf.surfaceType` in `src/shared/types.ts` and the parallel `surfaceTypes` records in `WorkspaceSnapshot` / `PersistedWorkspace`; add `add<Kind>Surface` / `add<Kind>SurfaceAsSplit` / `remove<Kind>Surface` on `SurfaceManager` (per-kind mount/resize logic belongs in a `<kind>-surface-controller.ts`); teach `applyLayout` how to size it (skip terminal fit); add `surfType === "<kind>"` to the `tryRestoreLayout` branch in `src/bun/index.ts` so saved layouts re-mount instead of leaking PTY shells; and name the kind in `website-doc` `concepts/workspaces-and-panes.md` (EN + FR) or `tests/docs-coverage.test.ts` fails. Telegram is the smallest reference (`src/views/terminal/telegram-pane.ts` + `src/bun/telegram-service.ts`).

allways use bun run bum:patch/minor/major before commit, if you dont, explain why

when modifying website-doc, make sure you incude the app version in :
website-doc/src/content/docs/api/system.md
and
website-doc/src/content/docs/cli/system.md

for the website-doc, for each content, you must aso translate to french 

When working, keep track of the changes that needs to be documented in a doc/changes_to_document.md and keep it up to date. clear it when you do update de website-doc

update the website-doc on user request. you can propose to update it when needed


when folowing a plan, track your progress, deviation and issues in doc/tracking_*plan_name*.md include the commit id when you commit



