# tests/regressions/ — lifecycle + security catalogue

Single index of every Triple-A fix wired across Phases 0–6. Each row carries the issue id (cross-reference `doc/triple_a_analysis.md`), the file where the fix lives, and the test file:test-name that catches a regression.

The catalogue is **gated** by `tests/regressions/catalogue.test.ts` — every test name listed below must exist in the suite. Removing a test without updating this README fails CI; updating this README without the test fails the same gate. The two move together.

---

## Lifecycle (L#)

| Id | Summary | Fix location | Regression test |
|---|---|---|---|
| L1 | `PiAgentManager._managerExit` evicts dead instances even after the user overwrites the public `onExit` field. | `src/bun/pi-agent-manager.ts` `createAgent` | `tests/pi-agent-manager.test.ts` "evicts a dead instance via _managerExit when the per-instance onExit was overwritten" + `tests/pi-agent-manager-crash.test.ts` "a subprocess that exits non-zero fires _managerExit and evicts the instance" (forced-crash) |
| L2 | PTY `destroy()` sends SIGHUP first (500 ms grace) before SIGKILL so editors / shells can flush. | `src/bun/pty-manager.ts` `destroy()` | `tests/pty-manager-grace.test.ts` "child SIGHUP trap fires before the process is killed" |
| L3 | WebSocket `idleTimeout: 60` + `sendPings: true` so half-open peers don't pile up. | `src/bun/web/server.ts` Bun.serve.websocket opts | `tests/web-ws-heartbeat.test.ts` "sets Bun WebSocket idleTimeout to 60 seconds" + "enables sendPings" |
| L4 | Socket-server per-connection buffer cap at 1 MiB. | `src/bun/socket-server.ts` `MAX_BUFFER_BYTES` | `tests/socket-server.test.ts` (1.5 MiB garbage write → error) |
| L5 | Reconnect-jitter ±25 % so N peers don't reconnect in lockstep. | `src/web-client/transport.ts` `applyReconnectJitter` | `tests/web-reconnect-jitter.test.ts` (7 spread invariants) |
| L6 | `gracefulShutdown` re-entry guard via the `shuttingDown` flag. | `src/bun/index.ts` `gracefulShutdown` | `tests/index-shutdown.test.ts` "guards re-entry by checking the flag before doing work" |
| L7 | Atomic settings/cookies/history writes via temp+rename so a crash mid-write doesn't corrupt the JSON. | `src/bun/atomic-write.ts` `writeFileAtomic` | `tests/atomic-write.test.ts` "creates the destination file with the given contents" + "overwrites an existing file in one rename" + cleanup tests |
| L8 | `CommandPalette` destroy lifecycle via single AbortController. | `src/views/terminal/command-palette.ts` `destroy()` | `tests/command-palette-destroy.test.ts` (3 tests) |
| L10 | `PiAgentInstance.kill()` drains pending response waiters + clears timers. | `src/bun/pi-agent-manager.ts` `kill()` | `tests/pi-agent-manager.test.ts` "rejects all pending waiters synchronously and clears their timers" |
| L12 | `gracefulShutdown` clears all five debounce timers (`plansBroadcastTimer`, `autoContinueAuditTimer`, `app.htKeysSeenTimer`, `domReadyDebounce`, `app.layoutSaveTimer`). | `src/bun/index.ts` `gracefulShutdown` | `tests/index-shutdown.test.ts` per-timer clears |
| L13 | Subprocess hard timeouts on git audits (5 s) + pbcopy/pbpaste (2 s). | `src/bun/audits.ts` `defaultRunGit` + `src/bun/index.ts` pb* paths | `tests/audits-timeout.test.ts` (3 invariants) |
| L14 | Telegram-db `PRAGMA busy_timeout = 5000` + WAL mode so concurrent reader/writer doesn't trip SQLITE_BUSY. | `src/bun/telegram-db.ts` constructor | `tests/telegram-db-busy.test.ts` (3 invariants) |

## Security (S#)

| Id | Summary | Fix location | Regression test |
|---|---|---|---|
| S1 | File mode 0o600 on logger / settings / cookies / history / telegram.db. | `src/bun/atomic-write.ts` mode opt + `src/bun/logger.ts` chmod + `src/bun/telegram-db.ts` chmod | `tests/atomic-write.test.ts` "[S1] applies mode 0o600" + `tests/file-modes.test.ts` (3 live-stat checks) |
| S2 | iframe-`sandbox=""` + strict CSP for sideband HTML/SVG in the mirror. | `src/web-client/panel-renderers.ts` `wrapInSandboxedShell` + `ensureSandboxIframe` | `tests/web-client-panel-sandbox.test.ts` (11 invariants) |
| S3 | Telegram outbound text capped at 4096 chars. | `src/bun/index.ts` `TELEGRAM_MAX_TEXT_LEN` | `tests/telegram-outbound-cap.test.ts` "drops the send when text exceeds the cap" |
| S4 | Token entropy floor warning on `0.0.0.0` boot with `webMirrorAuthToken.length < 16`. | `src/bun/web/server.ts` `TOKEN_MIN_LEN_FOR_LAN` | `tests/web-token-entropy.test.ts` (3 invariants) |
| S5 | Brute-force throttle — 10 fails / 60 s / IP → 10-min HTTP 429 cooldown. | `src/bun/web/server.ts` brute-force window | `tests/web-auth.test.ts` "excessive auth failures from same peer trip a 429 cooldown" |
| S6 | Security headers (CSP, X-Frame-Options DENY, nosniff, no-referrer, permissions-policy). | `src/bun/web/server.ts` `securityHeaders()` | `tests/web-auth.test.ts` "every response carries security headers" |
| S7 | Telegram outbound chatId allow-list — mirror-originated sends rejected for unknown chats. | `src/bun/index.ts` `sendTelegramAndBroadcast` allow-list | `tests/telegram-outbound-cap.test.ts` "chatId allow-list (mirror-path bypass guard)" |
| S11 | Telegram `parse_mode` allow-list — only MarkdownV2 survives. | `src/bun/telegram-service.ts` `sanitizeParseMode` | `tests/telegram-parse-mode.test.ts` (7 invariants) |

## UX / a11y (U#)

| Id | Summary | Fix location | Regression test |
|---|---|---|---|
| U1 | Shared `ModalHost` helper: `role="dialog"` + `aria-modal` + focus trap + focus restore + scrim/Escape. | `src/views/terminal/a11y/modal-host.ts` | `tests/views/a11y/modal-host.test.ts` (16 tests) + per-modal application tests (cheatsheet, palette, settings, ask-user, process-manager) |
| U2 | `prefers-reduced-motion` JS guard on the WebGL bloom canvas + CSS blanket on both surfaces. | `src/views/terminal/terminal-effects.ts` `setReducedMotion` + `src/views/terminal/index.css` + `src/web-client/client.css` blanket | `tests/terminal-effects.test.ts` "[U2] TerminalEffects — prefers-reduced-motion guard" (4 tests) + `tests/a11y-media-queries.test.ts` |
| U3 | High-contrast + light-mode token blocks + `forced-colors: active` mapping. | `src/shared/web-theme-tokens.css` | `tests/web-theme-tokens.test.ts` (5 invariants) |
| U5/I.5 | Touch targets ≥ 44 × 44 px under `@media (pointer: coarse)`. | `src/web-client/client.css` block | `tests/web-client-touch-targets.test.ts` (3 invariants) |
| U11 | Keyboard cheatsheet rendered DOM + a11y attrs. | `src/views/terminal/keyboard-cheatsheet.ts` | `tests/keyboard-cheatsheet-render.test.ts` (9 tests) |
| U12 | Sidebar roving-tabindex on the workspace list. | `src/views/terminal/sidebar.ts` `populateWorkspaceCard` + `moveHighlight` | `tests/sidebar-roving-tabindex.test.ts` (4 invariants) |
| U13 | `selectWorkspaceByIndex()` + ⌘1..⌘9 keybindings. | `src/views/terminal/surface-manager.ts` + `src/views/terminal/index.ts` KEYBOARD_BINDINGS | `tests/select-workspace-by-index.test.ts` (5 invariants) |
| U15 | IME composition guard on Enter for command palette + ask-user text input. | `src/views/terminal/command-palette.ts` + `src/views/terminal/ask-user-modal.ts` | `tests/command-palette-destroy.test.ts` "[U15] CommandPalette — IME composition guard on Enter" (2 tests) |

## Architecture (A#)

| Id | Summary | Fix location | Regression test |
|---|---|---|---|
| A1 | Typed `WebviewActionEnvelope` discriminated union + `ActionPayloadByAction` lookup. | `src/shared/webview-actions.ts` + `src/bun/index.ts` dispatch | `tests/webview-actions-types.test.ts` (5 invariants — no `: any`, no `payload["…"] as` casts) |
| A2 | `protocol-dispatcher.ts` typed via `ServerPayloadByType` mapped type. | `src/web-client/protocol-dispatcher.ts` | `tests/protocol-dispatcher-types.test.ts` (4 invariants — exhaustive switch over ServerMessage union) |
| A3+A17 | `SurfaceKind` canonical literal-string union (single declaration). | `src/shared/types.ts` `SurfaceKind` | `tests/surface-kind.test.ts` (3 invariants) |
| A13 | `escapeHtml` shared helper. | `src/shared/escape-html.ts` | `tests/escape-html.test.ts` (4 invariants) |
| F.2 / A5 | Shared `computeRects` pane-layout math — native + mirror use the same pure function. | `src/shared/pane-layout-math.ts` | `tests/pane-layout-math-parity.test.ts` (7 parity tests) |

## Test infrastructure (T#)

| Id | Summary | Fix location | Regression test |
|---|---|---|---|
| T1 | Direct unit tests for the five biggest UI modules (process-manager, settings-panel, agent-panel, terminal-effects, browser-pane, editor-pane). | `tests/process-manager.test.ts`, `tests/settings-panel-a11y.test.ts`, `tests/agent-panel.test.ts`, `tests/terminal-effects.test.ts`, `tests/browser-pane.test.ts`, `tests/editor-pane.test.ts` | (the tests themselves are the gate) |
| J.1 | Coverage gate — per-file lcov comparator against `tests/baselines/coverage-baseline.lcov`. | `scripts/check-coverage.ts` | `tests/scripts/check-coverage.test.ts` (12 invariants) |
| RPC↔handler | `system.capabilities` exposes a non-empty method list; every `METHOD_SCHEMAS` entry has a registered handler. | `src/bun/rpc-handler.ts` + per-domain `register*` | `tests/rpc-handler-coverage.test.ts` (3 invariants) |
| Feature grades | `bun run report:feature-grades` regenerates `doc/feature_grades.md` deterministically from `doc/feature_grades.json`. | `scripts/build-feature-grades.ts` | `tests/scripts/build-feature-grades.test.ts` (6 invariants) |

---

## Gate

`tests/regressions/catalogue.test.ts` parses this README and asserts that every test name in the "Regression test" column resolves to a test that exists in the suite. A future PR that:

- removes a test without updating this catalogue → catalogue gate fails
- updates this catalogue with a typo / made-up test name → catalogue gate fails
- adds a new control without a catalogue row → no automatic gate (humans review the PR)

The two-way coupling is the contract. The "no automatic gate for new fixes" gap is intentional — a new triple-A fix should land with both the runtime change AND a catalogue row in the same PR.
