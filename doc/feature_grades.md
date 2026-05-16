# τ-mux Full Feature Review & Grading

**Version:** 0.3.16
**Generated:** 2026-05-16
**Branch:** main
**Method:** Five parallel deep-dive audits across (1) core terminal + pane management, (2) sideband / canvas panels, (3) UI surfaces / chrome, (4) integrations / external bridges, (5) process metadata / infra / dev/test tooling. Each feature graded against an AAA bar: completeness, polish, robustness under failure, accessibility, performance, and test depth.

This doc is **generated** from `doc/feature_grades.json` by `bun run report:feature-grades`. Edit the JSON, not this file.

This is a **per-feature grading** companion to `doc/triple_a_analysis.md` (which catalogues cross-cutting issues by severity). Where this doc cites a `U#`/`A#`/`L#`/`S#`/`T#` id, the detail lives in `triple_a_analysis.md`.

---

## Scale

| Grade | Meaning |
|---|---|
| **S** | AAA. Complete, polished, robust, accessible, well-tested. No rough edges. |
| **A** | Works well; minor polish / edge-case / test gaps. Close to AAA. |
| **B** | Happy path solid; visible gaps in robustness, polish, or coverage. |
| **C** | Half-finished or naïve. Real bugs, missing controls, or lifecycle gaps. |
| **D** | Prototype. Brittle. |
| **F** | Broken / abandoned. |

---

## Headline

After Phase 1, the modal-a11y leg of the AAA programme is largely closed: Process Manager, Command Palette, Settings Panel, Ask-user modal and Keyboard Cheatsheet all carry `role="dialog"` + `aria-modal` + focus trap + focus restore via the shared `ModalHost` helper. The sidebar workspace list is keyboard-reachable via roving-tabindex. Touch targets ≥ 44 × 44 px land on the mirror's coarse-pointer media block. Remaining blockers: stringly-typed dispatch (P2), test depth for the five biggest UI modules (P3 — agent-panel + terminal-effects + browser-pane + editor-pane still pending), sandbox sideband HTML/SVG in the mirror (P4), and the light-mode + high-contrast theme system (P5).

---

## Grade distribution (49 features)

| Grade | Count | Notes |
|---|---:|---|
| S (AAA) | **1** | Best-in-class — 1 feature cleared every gap. |
| A | **24** | Most "production-shaped" subsystems. |
| B (incl. B+) | **21** | Functional, with named polish / test / lifecycle gaps. |
| C (incl. C+) | **3** | Half-wired audits & release plumbing. |
| D / F | **0** | No abandoned features. |

---

## 1. Core terminal & pane management

### PTY session lifecycle
- **Grade: B**
- **Evidence:** `pty-manager.ts:275-305` — SIGHUP → 500 ms grace → SIGKILL now in place (G.2 landed). Tests cover happy paths and exit codes; no crash-restart, ENOENT-shell, or low-memory spawn cases. Grace timeout hard-coded.
- **Gaps to AAA:**
  - Tests for failure spawns + zombie reaping.
  - Configurable grace; integration test that child `trap` handlers actually fire.

### xterm.js rendering integration
- **Grade: A**
- **Evidence:** `surface-manager.ts:140+` — FitAddon + SearchAddon + WebLinksAddon + Serialize; headless mirror in SessionManager for snapshot replay; streaming `TextDecoder` for split multi-byte chars.
- **Gaps to AAA:**
  - No stress test at >100 Hz throughput.
  - Large-paste perf not measured.
  - WebGL fallback silently noops with no diagnostic.

### Pane splits & layout
- **Grade: A**
- **Evidence:** `pane-layout.ts` — pure binary-tree, full rect math, neighbor finding, drag-reorder. Web `layout.ts:33-96` is param-injected (cleaner than the native module-level `setPaneGap`; A5 drift risk remains).
- **Gaps to AAA:**
  - Serialize-roundtrip test (JSON → `PaneLayout.fromNode` → identical rects).
  - Stress on deeply nested trees.
  - Rapid divider-drag invariants.

### Pane focus / keyboard routing
- **Grade: B**
- **Evidence:** `focusSurface()` at `surface-manager.ts:739-778` — DOM class updates, glow clear, `ht-surface-focused` dispatch, sidebar sync. Keyboard routing is implicit through `keydown` listeners spread across modules; no focus-restoration test after modal close.
- **Gaps to AAA:**
  - Explicit focus-routing module / state machine.
  - Focus-restoration tests.
  - Ordering guarantees vs concurrent layout pass.

### Terminal search
- **Grade: A**
- **Evidence:** `terminal-search.ts` — lean controller; `getActiveSearchAddon()` resolves per-focused-terminal; tests cover show/hide/next/prev/clear.
- **Gaps to AAA:**
  - Regex + case-sensitivity toggle in UI.
  - Persisted history.
  - Perf on 100k+ scrollback.

### Terminal effects (WebGL bloom)
- **Grade: B**
- **Evidence:** `terminal-effects.ts` (1011 LOC) — dual-canvas (2D occluder + WebGL2 shader), rate limit 16 ms input / 35 ms output, graceful `available=false` fallback (lines 285-310), proper destroy. **Zero unit tests** on the math. No `prefers-reduced-motion` on the effects canvas. WebGL context-loss not handled.
- **Gaps to AAA:**
  - Unit tests on shader math (intensity curve, ring expansion, light visibility).
  - Reduced-motion respect.
  - Context-loss recovery.
  - Profiled perf budget on target hardware.

### Workspaces
- **Grade: B**
- **Evidence:** `SurfaceManager` lines 173-1509 — `activeWorkspaceIndex`, `switchToWorkspace()`, `focusWorkspaceByIndex/ById`; persistence via `PersistedLayout` in `layout.json`. Race risk when `switchToWorkspace` interleaves with a `removeSurface` that deletes the active workspace.
- **Gaps to AAA:**
  - Invariant tests for concurrent mutations.
  - Recovery from truncated `layout.json`.
  - Drag-reorder coverage.

---

## 2. Sideband / canvas panels

### Sideband FD 3/4/5 parser
- **Grade: A**
- **Evidence:** `sideband-parser.ts:340-378` — per-channel queue depth cap (`MAX_CHANNEL_QUEUE_DEPTH=64`), timeout, oversized-payload reject before allocation, leftover buffering between reads. 425 LOC of tests for the boundary cases.
- **Gaps to AAA:**
  - Fuzz corpus of malformed JSONL (T9).
  - e2e that spawns a real subprocess (T10).
  - Configurable backoff for slow producers.

### Event writer / RPC envelope
- **Grade: B**
- **Evidence:** `event-writer.ts:12-32` — JSONL serialization via `Bun.write`, error callback. `send()` returns true before writes complete; tests don't verify bytes reach fd5. No buffering or backpressure — a mousemove flood at 60 fps from a buggy panel can overflow.
- **Gaps to AAA:**
  - Queued writes with backpressure.
  - Per-channel rate limits.
  - Tests that read back the bytes.

### Canvas panels (float / inline / fixed)
- **Grade: A**
- **Evidence:** `panel.ts:25-96` constructor, `:147-153` cleanup; inline anchor-row tracking at `panel-manager.ts:89-92, 193-200`; RAF-throttled drag/resize; pending-data TTL pruning (`panel-manager.ts:10-11, 44-51`).
- **Gaps to AAA:**
  - Inline panels lose anchor when scrollback fills (design limitation, doc system-canvas-panels.md:103-104).
  - No "bring to front on click" (z-index collision).
  - No pan/zoom for large content.

### Panel content renderers (SVG / HTML / image / canvas2d)
- **Grade: B**
- **Evidence:** `content-renderers.ts` — clean registry; blob-URL lifecycle managed; image element reused to avoid blank flashes; canvas pooled. **Security gap (S2):** SVG (line 123) and HTML (line 138) injected via `.innerHTML`. Web mirror has the same gap.
- **Gaps to AAA:**
  - iframe-`srcdoc` sandbox + strict CSP in mirror.
  - Renderer allow-list (any code with access to `registerRenderer` can register malicious ones).
  - PNG-decode failure path for canvas2d.

### Panel registry
- **Grade: B**
- **Evidence:** `panel-registry.ts` — per-surface `Map<surfaceId, Map<id, PanelDescriptor>>`; create/update/clear via `handleMeta` (lines 33-64); RPC `list()` for e2e. Acknowledged not authoritative; webview is. No max-panels cap; no resync if Bun-side parser crashes.
- **Gaps to AAA:**
  - Authoritative model with versioning + resync protocol.
  - Max-panels cap.
  - `update` should support position-mode transitions.

### OSC progress (OSC 9;4)
- **Grade: A**
- **Evidence:** `osc-progress.ts:51-78` — pure table-driven parser, 27-case test suite covering happy path, clamping, rounding, trailing junk; xterm OSC 9 fallback for non-`4` dialects.
- **Gaps to AAA:**
  - Per-pane chips, not just workspace-level bar.
  - e2e fixture emitting real frames.

### Demo scripts & sideband client libs
- **Grade: B**
- **Evidence:** Eight working demos under `scripts/`, Python (`hyperterm.py`) + TS (`hyperterm.ts`) client libs, docs `how-to-use-sideband.md` and protocol guide. None of the demos are in CI; Python/TS libs have minor API drift.
- **Gaps to AAA:**
  - Demos as CI smoke tests so they can't bit-rot.
  - Library parity gate.
  - True 50-line "hello world" tutorial.

---

## 3. UI surfaces / chrome

### Sidebar
- **Grade: A**
- **Evidence:** `sidebar.ts` (2964 LOC) — perf-tuned slice rendering with card-slot cache (lines 24-43); state slice tests exist (sidebar-state.test.ts, sidebar-card-stability.test.ts). Phase 1 (U12) added roving-tabindex on the workspace list — active card carries `tabindex="0"`, arrow-nav rotates it. New tests in `tests/sidebar-roving-tabindex.test.ts`.
- **Gaps to AAA:**
  - Drop indicator + Escape-cancel + `aria-live` on reorder (U14).
  - DOM-level integration tests beyond the per-slice ones.

### Sidebar CWD file explorer
- **Grade: B**
- **Evidence:** `sidebar-file-explorer.ts` (113 LOC) — lazy load, 1000-entry cap, dotfile filter, defaults collapsed. Native-only — no mirror protocol yet.
- **Gaps to AAA:**
  - Mirror parity (HTTP/WS protocol).
  - Symlink-cycle protection.
  - UI feedback when truncation cap hit.

### Process Manager overlay (⌘⌥P)
- **Grade: A**
- **Evidence:** `process-manager.ts` (~300 LOC) — tree + per-workspace totals (CPU/RSS), collapse/expand. Phase 1 wired ModalHost (role=dialog + aria-modal + aria-labelledby + focus trap + focus restore + scrim/Escape close). First direct unit tests landed in `tests/process-manager.test.ts` (mount, show/hide, idempotency, toggle, a11y attrs, close paths).
- **Gaps to AAA:**
  - Arrow-key navigation through the process tree + Enter-to-kill (U14).

### Command palette (⌘⇧P)
- **Grade: A**
- **Evidence:** `command-palette.ts` (398 LOC) — AbortController-clean destroy (L8 fix), recents in `localStorage`. Phase 1 wired ModalHost (role=dialog + aria-modal + aria-labelledby + focus trap + focus restore + scrim/Escape close) and added the U15 IME composition guard on Enter. Tests in `tests/command-palette-destroy.test.ts`.
- **Gaps to AAA:**
  - Empty-state / result-count feedback.
  - Broader unit coverage (filter ranking, recents persistence).

### Settings panel
- **Grade: A**
- **Evidence:** `settings-panel.ts` (1891 LOC), 10 sections; theme + bloom-migration tests. Phase 1 wired ModalHost (role=dialog + aria-modal + aria-labelledby + focus trap + focus restore + scrim/Escape close). Tests in `tests/settings-panel-a11y.test.ts`.
- **Gaps to AAA:**
  - Number-input validation feedback + `aria-invalid` (U9).
  - Reset-to-default per field + show default alongside current (U10).
  - IME composition guards on text inputs (partial — palette/ask-user covered; settings inputs still uncovered).
  - Broader unit coverage for the 1891 LOC (renderers per section).

### Keyboard shortcuts + cheatsheet
- **Grade: S**
- **Evidence:** `keyboard-shortcuts.ts` (106 LOC) — typed `Binding<Ctx>` registry, `keyMatch` display formatting. `keyboard-cheatsheet.ts` — proper `role="dialog"` + `aria-modal` + `aria-labelledby` + full focus trap + focus restore + Escape close + scrim close via Phase 1 ModalHost. Tests in `tests/keyboard-cheatsheet-render.test.ts`.
- **Gaps to AAA:**
  - Touch-friendly mobile alt (lives partly in the touch-target shim landed alongside).

### Notifications + overlay + toasts
- **Grade: B**
- **Evidence:** Shared overlay in `src/shared/notification-overlay.ts` (mirror reuse, M15). Pure `composeStack` (lines 77-87) for unit testing. Toast uses `aria-live` polite + error-alert role. Auto-dismiss + hover pause.
- **Gaps to AAA:**
  - Error toasts: copy button + detail expansion (U8).
  - Persistent sidebar notification history (U7).
  - Older notifications evaporate silently when max-3 cap hit.

### Native menus
- **Grade: A**
- **Evidence:** `native-menus.ts` (322 LOC) — full menu tree, context menus with proper roles/accelerators, typed `MENU_ACTIONS`. Tests verify structure + colors.
- **Gaps to AAA:**
  - State-aware dynamic items (Undo, recent files).
  - Window list (standard macOS).
  - Per-variant icons.

### App variants (Atlas / Cockpit / Bridge)
- **Grade: B**
- **Evidence:** Cockpit (296 LOC) cleanly mounts/unmounts rail + HUDs on enter/exit. Atlas (596 LOC) renders SVG workspace graph. Both restore sidebar on exit. Coupling via global `window` events (A6/A7 — 47+ implicit channels).
- **Gaps to AAA:**
  - Typed `VariantContext` (drop the `__tau*` window globals).
  - Mount/unmount lifecycle tests.
  - Documented Bridge variant spec.

### Tau primitives / icons / tokens
- **Grade: A**
- **Evidence:** `tau-icons.ts` enforces §6 geometric-SVG rules (sizes 10/11/14/22 px, ≤12 strokes, no curves except circles). `tau-primitives.ts` factories return pure DOM. `tauVar()` helper bridges TS tokens ↔ CSS variables.
- **Gaps to AAA:**
  - Light mode + high-contrast palette (U2/U3).
  - Semantic icon-size scaling.
  - Reduced-motion in primitive components.

---

## 4. Integrations / external bridges

### ht CLI (socket RPC)
- **Grade: A**
- **Evidence:** `socket-server.ts` — 1 MiB buffer cap (L4 fix), live-peer probe before unlink, typed dispatch via `satisfies BunMessageHandlers`. ~40+ methods. Docs accurate.
- **Gaps to AAA:**
  - Brute-force throttle on token check (S5 landed — verify).
  - Reconnect jitter (L5 landed — verify).
  - Idempotent shutdown guard (L6 landed — verify).

### Web mirror (WebSocket bridge)
- **Grade: B+**
- **Evidence:** M1–M10 shipped; session ring + resume-on-reconnect; reducer-driven store; @xterm/headless for state correctness; 16 ms coalescing; Graphite theme tokens. WS heartbeat + reconnect jitter landed (H.5). **S2 (HIGH):** `innerHTML` panel renderers still un-sandboxed in LAN-visible context.
- **Gaps to AAA:**
  - iframe-`srcdoc` sandbox + strict CSP for sideband HTML/SVG.
  - Coverage gate.
  - Protocol-dispatcher typed (A2).

### Telegram bridge
- **Grade: A**
- **Evidence:** Three-table schema with atomic `kv.poll_offset` resume (`telegram-service.ts:225-226`); per-chat token bucket 1 msg/sec; partial-UNIQUE dedup; inbound allow-list; outbound chatId allow-list landed via H.6. Bidirectional flow with persistence.
- **Gaps to AAA:**
  - Message TTL / DB pruning.
  - `parse_mode` validation (S11).
  - Broader e2e.

### Pi agent
- **Grade: B**
- **Evidence:** `pi-agent-manager.ts` — subprocess JSON-RPC over stdin/stdout; model-state tracking; PI binary resolution via login shell. **L1 (HIGH):** instance-level `onExit` fires but the manager-level callback was unwired; fix landed in PR 2 (commit `38453fe`) via private `_managerExit` hook.
- **Gaps to AAA:**
  - Verify dead-instance cleanup under forced crash regression test.
  - User-visible restart UX (currently surface freezes).
  - Optional auto-restart policy.

### Claude integration / ht-bridge
- **Grade: A**
- **Evidence:** Both `claude-integration/` and `pi-extensions/ht-bridge/` mirror the same pattern: active label, cost ticker, idle pill, atomic state writes (temp+rename), skills system. Comprehensive — 16 capabilities in pi-extensions including bash-safety gate, ask-user tools, browser tools, plan mirror.
- **Gaps to AAA:**
  - Transcript-parse fallback when file missing/malformed.
  - Hard file-count cap on `$TMPDIR` session state (currently 24 h pruning only).
  - Plan-compat validation across reboots.

### Browser surface (browser pane)
- **Grade: B**
- **Evidence:** `browser-pane.ts` (999 LOC) — OOPIF `<electrobun-webview>`, address bar, nav buttons, console/error capture, `BrowserHistoryStore`, 40+ socket API methods, sandbox + partition. **Zero direct unit tests.** Navigation rules loaded but not validated. Zoom not persisted.
- **Gaps to AAA:**
  - DOM-level unit tests.
  - Navigation-rule validation with diagnostics.
  - Zoom persistence across restart.
  - `findInPage` exposed to CLI.

### Plan panel
- **Grade: A**
- **Evidence:** Shared `plan-panel-render.ts` used by both native + mirror; debounced 100 ms snapshot broadcast; per-surface audit ring cap 50.
- **Gaps to AAA:**
  - RPC input validation for `state` strings (currently any string accepted, normalized on `set`).
  - Configurable audit-ring size.
  - Mirror persists audit across page reload.

### Auto-continue engine
- **Grade: A**
- **Evidence:** `auto-continue-engine.ts` (509 LOC) — typed `AutoContinueOutcome` discriminated union; per-surface runaway counter + cooldown; audit ring with throw-isolated subscribers; dry-run path; LLM-fail → heuristic fallback. 9 test files.
- **Gaps to AAA:**
  - Paused-surfaces list persists in-memory only — lost on restart.
  - Consecutive counter doesn't cleanly cap+warn at `maxConsecutive`.
  - Per-session firing metrics.

### Ask-user modal / queue
- **Grade: A**
- **Evidence:** `ask-user-queue.ts` + `ask-user-modal.ts` (557 LOC) — four kinds (yesno/choice/text/confirm-command), Telegram `force_reply` integration. Phase 1 closed U1 (HIGH): ModalHost adds role=dialog + aria-modal + per-request aria-labelledby + focus trap + focus restore + scrim/Escape close. The text-input render also got the U15 IME composition guard on Enter. Tests in `tests/ask-user-modal-dom.test.ts`.
- **Gaps to AAA:**
  - Queue-level timeout fallback for hanging text prompts.
  - Cross-surface concurrency tests.

### Editor pane (CodeMirror)
- **Grade: B**
- **Evidence:** `editor-pane.ts` (526 LOC) — CodeMirror 6 with `defaultKeymap` + history + search, language detection, dirty/path pills, mtime + line-ending tracking. No unit tests. Concurrent-save race not handled (no `expectedMtimeMs` compare). Line-ending display is read-only.
- **Gaps to AAA:**
  - DOM-level unit tests.
  - Save-race detection + conflict UX.
  - Line-ending convert on save.

---

## 5. Process metadata / infra / dev/test tooling

### SurfaceMetadataPoller
- **Grade: A**
- **Evidence:** `surface-metadata.ts:114-117` — `parsePs` / `parseListeningPorts` / `parseCwds` / `parseGitStatusV2` with 5 s subprocess timeouts; TTL caching (3 s git/`package.json`, stale-entry pruning at 12 s+ idle); focus-aware cadence (1 Hz visible, 3.3 Hz hidden). 126 tests; doc `system-process-metadata.md` exhaustive.
- **Gaps to AAA:**
  - Shared "stale-git skip-tick" guard so two parallel NFS hangs don't wedge a tick.
  - Metadata rot detection when WS is mute >10 s.
  - Deeper tree-diff than `tree.length` (descendant swap goes undetected).

### Pane-bar chip rendering
- **Grade: B**
- **Evidence:** Extracted to `src/shared/pane-chips.ts:32-94` with signature cache to skip redundant DOM rebuilds; web-mirror parity tested. Port-click is inconsistent: native dispatches `ht-open-external` CustomEvent (`surface-manager.ts:949`); mirror routes to `http://${location.hostname}:${port}` which fails on `0.0.0.0` when hostname≠IP. Chips have `role="button"` + `tabIndex=0` but no ARIA labels or live-region.
- **Gaps to AAA:**
  - Unified port-click handler / config.
  - ARIA labels + live-region for git status transitions.
  - Tooltip overflow tests.

### Settings persistence & migration
- **Grade: B+**
- **Evidence:** `settings-manager.ts:53` — 500 ms debounced save; `atomic-write.ts:24-48` atomic writes (mode 0o600 since H.1); corrupt-file `.bak` recovery; partial-schema merge via `mergeSettings`. Bloom migration via `applyBloomMigration`.
- **Gaps to AAA:**
  - Schema-version field + ordered migrations (currently a single `applyBloomMigration` with no version metadata).
  - Sync-on-quit for security-critical fields (telegram token, mirror auth).
  - Defensive boolean coercion in validator, not just in tests.

### Logging
- **Grade: A**
- **Evidence:** `logger.ts` — daily rotation by UTC date; 14-day pruning matches pattern only; tee preserves TTY; `[boot]` banner sync; disposal restores writers. File mode 0o600 (H.1).
- **Gaps to AAA:**
  - Size-based rotation (multi-day runs can produce multi-GiB files).
  - Gzip of old logs.
  - Structured log-level filter.

### RPC handlers (typed dispatch)
- **Grade: B**
- **Evidence:** 21 handler files under `src/bun/rpc-handlers/`; `rpc-handler.ts` aggregates via `createRpcHandler`; `METHOD_SCHEMAS` validated pre-dispatch; `satisfies BunMessageHandlers` gates the socket/RPC side. **A1 (HIGH):** `dispatch(action: string)` in `index.ts:2331-2508` is ~180 LOC of stringly-typed parallel router. **A2 (HIGH):** `web-client/protocol-dispatcher.ts:44` types Payload as `any`.
- **Gaps to AAA:**
  - Replace `dispatch` with a typed `WebviewActionEnvelope` discriminated union.
  - Narrow `protocol-dispatcher` on `msg.type` to land the `ServerMessage` union win.
  - End-to-end JSON-RPC shape test.

### Audits
- **Grade: A**
- **Evidence:** `audits.ts:22-46` — async check + optional fix pattern; 5 s timeouts with explicit `proc.kill` on expiry (`:57-95`, G.10). Five audits: git author/email, clipboard read/write, shell path. Settings-driven.
- **Gaps to AAA:**
  - More audits (locale, node version, shell capabilities).
  - Auto-rerun on settings change.
  - Remediation UX hookup.

### Health checks
- **Grade: A**
- **Evidence:** `health.ts` — pure state machine; severity model (ok / degraded / error / disabled); idempotent set; subscriber notifications with error isolation; snapshot includes `updatedAt` for staleness.
- **Gaps to AAA:**
  - Remediation `fix()` equivalent (audits has it; health doesn't).
  - UI pill / badge wiring.
  - Staleness auto-demotion if entry goes silent N seconds.

### Manifest scanner
- **Grade: A**
- **Evidence:** `manifest-scanner.ts` — generic walk-up + TTL cache; max-depth 40 to bound symlink cycles; per-cwd TTL (3 s default) with mtime invalidation; idle eviction at 4× TTL.
- **Gaps to AAA:**
  - Symlinked `$HOME` handling (real-path vs symlink-path mismatch).
  - Test for the 4× TTL eviction.
  - Symmetric depth between `Cargo.toml` parser (name+version only) and `package.json` parser.

### Cookie store
- **Grade: B**
- **Evidence:** `cookie-store.ts` — JSON-persisted with domain index for O(k) lookup; LRU 50 k cap; debounced async save + sync `saveNow` on shutdown; atomic writes (H.1).
- **Gaps to AAA:**
  - Per-domain cap (currently only global).
  - Export/import (test-automation use case).
  - URL-host normalization on insert.

### Browser history
- **Grade: B**
- **Evidence:** `browser-history.ts` — JSON-persisted; relevance ranking = recency boost × visit count; LRU 10 k cap; atomic writes.
- **Gaps to AAA:**
  - Normalize URLs on insert (trailing slash, `www`) — currently dupes leak in.
  - Time-window filter.
  - Privacy / clear command.

### Test suite breadth & quality
- **Grade: B+**
- **Evidence:** 126 test files, 1544 tests, <10 s; `bunfig.toml` scopes bare `bun test` to `tests/`. Pure-function tests for parsers + settings + health + logger + RPC; e2e via Playwright. **T1 (HIGH):** five biggest UI modules (sidebar 2964 LOC, settings-panel 1891, agent-panel 1755, terminal-effects 1011, browser-pane 999) have ~zero direct unit tests; bootstrap path untested; no coverage gate.
- **Gaps to AAA:**
  - DOM-level tests for the five big modules.
  - Coverage gate in CI (J.1 added a script, no threshold).
  - Failure-path Playwright cases (network loss, subprocess crash).

### Design report / visual regression
- **Grade: C+**
- **Evidence:** `bun run report:design:web` exists; `tau-focus-audit.ts` validates focus glow rules. Baseline workflow is manual via `bun run baseline:design`. `prefers-reduced-motion` blanket landed in I.2/I.3 — verify still active.
- **Gaps to AAA:**
  - Gate `bun run report:design:gate` in CI.
  - Light mode RFC.
  - High-contrast palette.

### Version bumping / release
- **Grade: C**
- **Evidence:** `scripts/bump-version.ts` reads `package.json`, applies targeted regex replaces to 7 files. **Does not commit, tag, or generate changelog.** `scripts/post-package.ts` patches CFBundleDisplayName on macOS only; Linux release path undefined. No rollback on partial build failures.
- **Gaps to AAA:**
  - Changelog generator + tag/commit.
  - Cross-platform packaging.
  - Rollback on partial failure.

### Tau focus audit
- **Grade: C**
- **Evidence:** `tau-focus-audit.ts` walks DOM detecting chromatic glow leaks via box-shadow parsing. Lives in DevTools/REPL — **not wired into `bun test`** (line 22-26). Box-shadow only; filter drop-shadows excluded by design.
- **Gaps to AAA:**
  - Playwright-runnable assertion.
  - Report file output.
  - Broader focus-leak detection (outline + filter).

### Sound notification system
- **Grade: A**
- **Evidence:** `src/shared/sounds.ts` — clones `HTMLAudioElement` per play (WebKit reuse bug); template caching; volume clamp [0,1]; failure-isolated; native + mirror parity; tests cover cloning + clamping + failure + `__setAudioFactory` seam.
- **Gaps to AAA:**
  - App-level mute control.
  - File-existence check before play attempt.
  - Concurrent-play test.

---

## Top 10 blockers to AAA across the whole app

Ranked by leverage — each lifts multiple features by one letter.

1. **Kill stringly-typed dispatch in `index.ts:2331`** — with a typed `WebviewActionEnvelope` union — A1 unblocks RPC handlers grade, A2 unblocks web-mirror grade. Owned by P2.
2. **Unit tests for the four still-uncovered big UI modules** — (agent-panel 1755 LOC, terminal-effects 1011, browser-pane 999, editor-pane 526). Phase 1 covered process-manager and settings-panel; T1 is half-closed. Owned by P3.
3. **Sandbox sideband HTML/SVG in the web mirror** — via iframe-`srcdoc` + CSP. (S2). Owned by P4.
4. **Light-mode + high-contrast palette + design tokens** — every colour token-driven; ship Graphite Light + High-Contrast themes. Owned by P5.
5. **Verify `PiAgentManager._managerExit` cleanup under crash** — regression test — L1 was claimed landed but the regression test under forced crash is what makes the grade move. Owned by P6.
6. **Design-report + τ-focus-audit gated in CI** — , not just generated artifacts. Owned by P8.
7. **Coverage gate** — with an agreed lcov threshold against `tests/baselines/coverage-baseline.lcov`. Owned by P3.
8. **Per-feature failure regression tests** — for the seven named lifecycle items (heartbeat, atomic writes, SIGHUP grace, idempotent shutdown — most landed; need regression tests for each). Owned by P6.
9. **Mobile/web mirror runtime bounding-box gate** — Phase 1 added the 44 × 44 CSS-px shim on coarse pointers. P3 should add a Playwright mobile-viewport test asserting every interactive element clears the threshold. (I.5)
10. **ARIA labels + live regions for git-status chips + notifications** — Phase 1 deferred U7/U8 details. Add `aria-label` to chips and an `aria-live="polite"` region for notification count changes.

---

## Companion docs

- `doc/triple_a_analysis.md` — severity-ranked cross-cutting issue catalogue (the source for `A#`/`L#`/`S#`/`U#`/`T#` ids).
- `doc/tracking_triple_a_analysis.md` — execution log for F–J clusters.
- `doc/feature_upgrade_to_AAA/00_master_plan.md` — programme to move every feature to AAA.
- `doc/full_analysis.md`, `doc/issues_now.md`, `doc/deferred_items.md` — earlier audit rounds (context only).
- `doc/changes_to_document.md` — running website-doc changelog (per CLAUDE.md convention).
