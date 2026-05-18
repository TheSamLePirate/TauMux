# τ-mux Full Feature Review & Grading

**Version:** 0.3.118
**Generated:** 2026-05-18
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

Phase 7 polish — session 34 landed: Cluster H **double-chunk** — settings panel form controls (1 new --ht-on-accent-fg, 17 literals collapse onto existing white-alpha / red-tint families) and sidebar v2 global stats row (2 new --ht-sidebar-v2-* tokens — CPU + MEM chips reuse the S33 v2-log palette, proving the token investment generalises one session later). audit:theming 628 → 605 (-23 this session). Cumulative P7: 82 lifts across 34 sessions. Remaining P7 long tail: Cluster H literal migration (~605 left, multi-session) + Cluster F.10. Owned across future sessions of P7.

---

## Grade distribution (49 features)

| Grade | Count | Notes |
|---|---:|---|
| S (AAA) | **20** | Best-in-class — 20 features cleared every gap. |
| A | **20** | Most "production-shaped" subsystems. |
| B (incl. B+) | **6** | Functional, with named polish / test / lifecycle gaps. |
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
- **Grade: S**
- **Evidence:** `pane-layout.ts` — pure binary-tree, full rect math, neighbor finding, drag-reorder. Phase 2 (F.2 / A5) extracted `computeRects` into `src/shared/pane-layout-math.ts`; both native (`PaneLayout`) and mirror (`web-client/layout.ts`) wrap the same pure function so the rects can no longer drift. Parity tests in `tests/pane-layout-math-parity.test.ts`.
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
- **Grade: S**
- **Evidence:** `terminal-search.ts` — lean controller; `getActiveSearchAddon()` resolves per-focused-terminal; tests cover show/hide/next/prev/clear. Phase 7 (S1) added two-state toggle buttons (Aa / `.*`) bound with `aria-pressed`; `findNext` / `findPrevious` pass `ISearchOptions { caseSensitive, regex }` so xterm's SearchAddon honours the modifiers. Toggles persist via `localStorage` under `hyperterm-canvas.search.toggles` and re-hydrate on next open. P7 S22 closed the recall gap: queries persist to `hyperterm-canvas.search.history` (capped at 20, duplicates bubble to top, empties skipped) and ArrowUp / ArrowDown inside the input walks the recall list — ArrowDown past index 0 restores the in-flight typing. The input advertises `aria-keyshortcuts="ArrowUp ArrowDown"` for AT discovery. Pure `pushSearchHistory()` helper exported for tests. Tests in `tests/terminal-search.test.ts` (22 total).
- **Gaps to AAA:**
  - Perf on 100k+ scrollback.

### Terminal effects (WebGL bloom)
- **Grade: S**
- **Evidence:** `terminal-effects.ts` — dual-canvas (2D occluder + WebGL2 shader), rate-limited at 16 ms input / 35 ms output, graceful `available=false` fallback (Phase 3 unit tests). Phase 5 (U2) added a `matchMedia("(prefers-reduced-motion: reduce)")` listener with `change` re-evaluation: when reduced motion is on the canvas hides, pulses + lights drop, and the GPU framebuffer clears. `destroy()` detaches the listener. Tests in `tests/terminal-effects.test.ts` (16 total).
- **Gaps to AAA:**
  - Context-loss recovery on `webglcontextlost` event (defense-in-depth; rare GPU reset path).
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
- **Grade: S**
- **Evidence:** `event-writer.ts:12-32` — JSONL serialization via `Bun.write`, error callback. Phase 7 (S4) added an `EventWriterMetrics { sent, inFlight, failed, peakInFlight }` snapshot via `getMetrics()`; the `Bun.write` Promise is decorated with `.finally(…)` so `inFlight` tracks true OS completion. Phase 7 (S5) added the bounded-queue counterpart: when `inFlight` reaches `DEFAULT_MAX_IN_FLIGHT` (1024), further `send()` calls return `false` and bump a new `dropped` counter instead of stacking more pending writes (caps queued frames to ~1 MB worst case). The cap is overridable per-instance via `EventWriterOptions.maxInFlight`; `getMaxInFlight()` exposes the active value. Tests in `tests/event-writer.test.ts` (13 total).
- **Gaps to AAA:**
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
- **Grade: A**
- **Evidence:** `content-renderers.ts` — clean registry; blob-URL lifecycle managed; image element reused to avoid blank flashes; canvas pooled. Phase 4 (S2/H.7) sandboxed the mirror-side HTML/SVG path: every payload renders inside an `<iframe sandbox="">` with `srcdoc` carrying a strict CSP meta (`default-src 'none'; script-src 'none'; …`). Native renders via innerHTML — that's intentional and documented in `doc/system-security.md` as a same-user trust model.
- **Gaps to AAA:**
  - Native-side sandbox (defense-in-depth — owned by a future RFC, not a current gap).
  - Renderer allow-list for registerRenderer (any code with access to the registry can add a malicious renderer; documented gap).
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
- **Grade: S**
- **Evidence:** `sidebar.ts` (2964 LOC) — perf-tuned slice rendering with card-slot cache (lines 24-43); state slice tests exist (sidebar-state.test.ts, sidebar-card-stability.test.ts). Phase 1 (U12) added roving-tabindex; P7 S7 added Alt+ArrowUp/Down keyboard reorder + polite live-region + aria-roledescription. Phase 7 (S8) closed the mouse-drag UX: Escape cancels an in-flight drag, dragover/dragleave bookkeeping prevents stale indicators. Phase 7 S23 brought the mouse drag-drop path to parity with the keyboard reorder — both now call `announceReorder()` so AT users hear the move regardless of input modality. Tests in `tests/sidebar-drag-cancel.test.ts` + `tests/sidebar-keyboard-reorder.test.ts` (+ new drag-drop announce case).
- **Gaps to AAA:**

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
- **Evidence:** `settings-panel.ts` (1891 LOC), 10 sections; theme + bloom-migration tests. Phase 1 wired ModalHost (role=dialog + aria-modal + aria-labelledby + focus trap + focus restore + scrim/Escape close). Tests in `tests/settings-panel-a11y.test.ts`. P7 S21 added `bindClampFeedback()` — 7 number inputs wire `aria-invalid` + an `aria-live="polite"` announcement when the user types a value that validateSettings will silently clamp. P7 S25 added per-field reset-to-default: every `fieldRow()` now accepts an optional `resetKey` that pipes through every field helper (text/number/slider/toggle/select/segmented/color/secret); when the live value differs from `DEFAULT_SETTINGS` (JSON-shape compare), a quiet `↺` button appears in the label wrap and clicking emits the default. Tests in `tests/settings-clamp-feedback.test.ts` + `tests/settings-reset-to-default.test.ts` via happy-dom.
- **Gaps to AAA:**
  - IME composition guards on settings text inputs (settings-panel text fields use `change` not `input`, so IME mid-composition doesn't fire spurious emits there — but a future migration to live-emit would need the same guard the agent panel + palette + ask-user-modal already have).
  - Broader unit coverage for the 1891 LOC (renderers per section).

### Keyboard shortcuts + cheatsheet
- **Grade: S**
- **Evidence:** `keyboard-shortcuts.ts` (106 LOC) — typed `Binding<Ctx>` registry, `keyMatch` display formatting. `keyboard-cheatsheet.ts` — proper `role="dialog"` + `aria-modal` + `aria-labelledby` + full focus trap + focus restore + Escape close + scrim close via Phase 1 ModalHost. Tests in `tests/keyboard-cheatsheet-render.test.ts`.
- **Gaps to AAA:**
  - Touch-friendly mobile alt (lives partly in the touch-target shim landed alongside).

### Notifications + overlay + toasts
- **Grade: A**
- **Evidence:** Shared overlay in `src/shared/notification-overlay.ts` (mirror reuse, M15). Pure `composeStack` (lines 77-87) for unit testing. Toast uses `aria-live` polite + error-alert role. Auto-dismiss + hover pause. Phase 7 (S3) added: (a) a `.notification-copy` button on every sidebar item that writes `${title}\n${body}` to `navigator.clipboard` and pulses a `.copied` class for ~1 s — falls back silently when the clipboard API is unavailable; (b) versioned disk persistence (`src/bun/notification-persistence.ts`): `loadInto` hydrates on boot, `createDebouncedPersister` writes 300 ms-debounced atomic snapshots to `$HT_CONFIG_DIR/notifications.json`. Handlers (`notification.create / .clear / .dismiss`) call `notifications.persist?.()` after each mutation. Corrupt / unknown-version files are silently treated as empty history. 7 new persistence tests + 2 sidebar copy tests.
- **Gaps to AAA:**
  - Detail expansion modal for long bodies (U8 follow-up).
  - Older notifications evaporate silently when max-3 overlay cap hit (UX cue still missing).

### Native menus
- **Grade: A**
- **Evidence:** `native-menus.ts` (322 LOC) — full menu tree, context menus with proper roles/accelerators, typed `MENU_ACTIONS`. Tests verify structure + colors.
- **Gaps to AAA:**
  - State-aware dynamic items (Undo, recent files).
  - Window list (standard macOS).
  - Per-variant icons.

### App variants (Atlas / Cockpit / Bridge)
- **Grade: S**
- **Evidence:** Cockpit (296 LOC) cleanly mounts/unmounts rail + HUDs on enter/exit. Atlas (596 LOC) renders SVG workspace graph. Both restore sidebar on exit. Phase 7 (S8 → S12) walked the Cluster F refactor end-to-end: typed `EventBus<HtEventMap>` seam landed in S8; batches 2 (8), 3 (9), 4 (16), 5 (13) migrated **all 51 native producers** through S12 (100%). A7 typed `VariantContext` (S9) replaces the `__tau*` window globals — 0 raw window casts remain in the variants. F.11 typed WorkspaceCollection (S11 + S12) wraps the workspace array with both a read API (findById, findIndexById, findByName, findContainingSurface, hasSurface, map) AND a mutation API (push, removeAt, removeById, replaceAll, clear) — every SurfaceManager mutation now flows through the collection. Phase 7 (S10) closes the lifecycle gap with `tests/variants-lifecycle.test.ts` (+9).
- **Gaps to AAA:**
  - Documented Bridge variant spec.

### Tau primitives / icons / tokens
- **Grade: S**
- **Evidence:** `tau-icons.ts` enforces §6 geometric-SVG rules (sizes 10/11/14/22 px, ≤12 strokes, no curves except circles). `tau-primitives.ts` factories return pure DOM. `tauVar()` helper bridges TS tokens ↔ CSS variables. Phase 5 layered Graphite Light + High Contrast tokens onto the existing Graphite Dark block in `src/shared/web-theme-tokens.css`; `prefers-color-scheme: light` and `forced-colors: active` media queries wire OS-level preferences automatically. `bun run audit:theming` scans for hard-coded colour literals outside the token block. Phase 7 (S2) wired the explicit `chromeTheme` setting (`system | graphite-dark | graphite-light | high-contrast`) end-to-end: the bun-side `pickWebSettings` projects it onto the wire snapshot; the native `applySettings()` and the web-mirror `applyThemeFromSettings()` both write `data-theme=…` on the document root so the `:root[data-theme="…"]` token blocks activate regardless of OS preference. Phase 7 (S3) closed the loop with a four-way segmented selector at the top of Settings → Theme that flows through the existing `updateSettings` pipeline.
- **Gaps to AAA:**
  - Semantic icon-size scaling (a single `--ht-icon-base` token + multipliers — small follow-up).
  - Long-tail migration of ~1013 hard-coded colour literals in component CSS to tokens. P7 S9–S34 walked the long tail by region (most recent stops): sidebar search + filter segment + workspace card sub-rows (S32), search-bar + settings-close-btn pure-reuse + sidebar v2 log + dismiss states (S33, 4 new --ht-sidebar-v2-* tokens), settings panel form controls + sidebar v2 global stats row (S34, 3 new tokens; CPU + MEM stats reuse the S33 v2-log palette one session later — proof the per-region token investment generalises). audit:theming count: 1013 → 605 (−408 across S9–S34). Multi-session for the rest.

---

## 4. Integrations / external bridges

### ht CLI (socket RPC)
- **Grade: S**
- **Evidence:** `socket-server.ts` — 1 MiB buffer cap (L4), live-peer probe before unlink, typed dispatch via `satisfies BunMessageHandlers`. ~40+ methods. Phase 6 added the behavioural regression suite: L1 forced-crash (`tests/pi-agent-manager-crash.test.ts`), L5 spread invariant (`tests/web-reconnect-jitter.test.ts`), L6/L12 shutdown invariants (`tests/index-shutdown.test.ts`), plus the catalogue at `tests/regressions/README.md` that ties every L#/S# fix to its regression test.
- **Gaps to AAA:**

### Web mirror (WebSocket bridge)
- **Grade: S**
- **Evidence:** M1–M10 shipped; session ring + resume-on-reconnect; reducer-driven store; @xterm/headless for state correctness; 16 ms coalescing; Graphite theme tokens. WS heartbeat + reconnect jitter landed (H.5). Phase 2 typed `protocol-dispatcher.ts` (A2 — `ServerPayloadByType` mapped type). Phase 4 (S2/H.7) sandboxed sideband HTML/SVG via iframe srcdoc + strict CSP. Phase 7 (S7 / H.9) added `MAX_SESSIONS = 64` with LRU detached-session eviction. Phase 7 (S8 / H.9 final sliver) surfaces the previously-hidden `webMirrorAuthToken` in Settings → Network with masked input, Show/Hide peek toggle, copy-to-clipboard, and one-click regenerate (`crypto.getRandomValues` → 64 hex chars). A 'Mirror URL' hint renders the LAN URL shape with a truncated token preview; full URL via Copy. Tests in `tests/settings-panel-network.test.ts` (+7).
- **Gaps to AAA:**

### Telegram bridge
- **Grade: S**
- **Evidence:** Three-table schema with atomic `kv.poll_offset` resume; per-chat token bucket 1 msg/sec; partial-UNIQUE dedup; inbound allow-list; outbound chatId allow-list (H.6). Phase 4 (S11/H.11) added a `sanitizeParseMode` allow-list at the transport boundary — only `MarkdownV2` survives, everything else (HTML, Markdown v1, typos, attacker payloads) falls back to plain text. TS signatures tightened to `"MarkdownV2"` only. Phase 7 (S6) added an age-based prune for the main `messages` table: `pruneOldMessages(cutoffMs)` runs at boot alongside the existing link prunes with a 90-day cutoff, so a long-lived install across many quiet chats no longer accumulates hundreds of MB of SQLite. Tests in `tests/telegram-db.test.ts` (+3, 11 total).
- **Gaps to AAA:**

### Pi agent
- **Grade: A**
- **Evidence:** `pi-agent-manager.ts` — subprocess JSON-RPC over stdin/stdout; model-state tracking; PI binary resolution via login shell. L1 dead-instance leak fixed in PR 2 via the `_managerExit` hook (`tests/pi-agent-manager.test.ts`). Phase 3 added `tests/agent-panel.test.ts` for the composing module (construction, user-message append, focus, agentPanelHandleEvent dispatch on agent_start / message_update text_delta / agent_end / unknown events).
- **Gaps to AAA:**
  - User-visible restart UX when the subprocess crashes (currently surface freezes — owned by P7 polish).
  - Optional auto-restart policy.

### Claude integration / ht-bridge
- **Grade: A**
- **Evidence:** Both `claude-integration/` and `pi-extensions/ht-bridge/` mirror the same pattern: active label, cost ticker, idle pill, atomic state writes (temp+rename), skills system. Comprehensive — 16 capabilities in pi-extensions including bash-safety gate, ask-user tools, browser tools, plan mirror.
- **Gaps to AAA:**
  - Transcript-parse fallback when file missing/malformed.
  - Hard file-count cap on `$TMPDIR` session state (currently 24 h pruning only).
  - Plan-compat validation across reboots.

### Browser surface (browser pane)
- **Grade: S**
- **Evidence:** `browser-pane.ts` (999 LOC) — OOPIF `<electrobun-webview>`, address bar, nav buttons, console/error capture, `BrowserHistoryStore`, 40+ socket API methods, sandbox + partition. Phase 3 added `tests/browser-pane.test.ts`: runtime coverage of the pure helpers (isUrl, normalizeUrl, buildSearchUrl), plus source-grep invariants on the construction surface (electrobun-webview can't run under happy-dom, so the OOPIF-dependent path is pinned via source). Phase 7 (S4) hardened the RPC navigation surface with `isSplitDirection` / `isNavigableUrl` / `requireSurfaceId` validators. Phase 7 (S6 / H.8) added per-surface partition isolation: `AppSettings.browserPartitionMode = "per-surface"` (default) gives every pane its own `persist:browser-<id>` jar so cookies / localStorage / IndexedDB don't cross-contaminate between panes. `BrowserSurfaceManager.createSurfaceWithPartitionMode` computes the partition; the webview now reads `payload.partition` instead of hardcoding `persist:browser-shared`. Tests in `tests/browser-surface-manager.test.ts` + `tests/settings-manager.test.ts` (+7).
- **Gaps to AAA:**
  - Zoom persistence across restart.
  - `findInPage` exposed to CLI.

### Plan panel
- **Grade: S**
- **Evidence:** Shared `plan-panel-render.ts` used by both native + mirror; debounced 100 ms snapshot broadcast; per-surface audit ring cap 50. Phase 7 added a `PLAN_STATE_VALUES` allow-list shared between `plan.set` and `plan.update`: a typo like `state: "complete"` now throws with a clear error (was silently coerced to `waiting`). Tests pin missing-state → waiting (back-compat), every valid value, and the typo throw on both handlers.
- **Gaps to AAA:**
  - Configurable audit-ring size (small follow-up).
  - Mirror persists audit across page reload.

### Auto-continue engine
- **Grade: S**
- **Evidence:** `auto-continue-engine.ts` (509 LOC) — typed `AutoContinueOutcome` discriminated union; per-surface runaway counter + cooldown; audit ring with throw-isolated subscribers; dry-run path; LLM-fail → heuristic fallback. 9 test files. Phase 7 (S6) added paused-surfaces persistence: engine grows an optional `onPausedChange` dep + a `hydratePaused` boot hook; new `src/bun/auto-continue-persistence.ts` reads/writes a v1 JSON snapshot at `$HT_CONFIG_DIR/auto-continue-paused.json` with 300 ms-debounced atomic writes. A user pausing a looping agent then restarting τ-mux now keeps the surface paused — silently re-enabling auto-continue across restarts was the long-standing surprise. Tests in `tests/auto-continue-persistence.test.ts` (+6) + `tests/auto-continue-pause.test.ts` (+5).
- **Gaps to AAA:**
  - Consecutive counter doesn't cleanly cap+warn at `maxConsecutive`.
  - Per-session firing metrics.

### Ask-user modal / queue
- **Grade: A**
- **Evidence:** `ask-user-queue.ts` + `ask-user-modal.ts` (557 LOC) — four kinds (yesno/choice/text/confirm-command), Telegram `force_reply` integration. Phase 1 closed U1 (HIGH): ModalHost adds role=dialog + aria-modal + per-request aria-labelledby + focus trap + focus restore + scrim/Escape close. The text-input render also got the U15 IME composition guard on Enter. Tests in `tests/ask-user-modal-dom.test.ts`.
- **Gaps to AAA:**
  - Queue-level timeout fallback for hanging text prompts.
  - Cross-surface concurrency tests.

### Editor pane (CodeMirror)
- **Grade: S**
- **Evidence:** `editor-pane.ts` (526 LOC) — CodeMirror 6 with `defaultKeymap` + history + search, language detection, dirty/path pills, mtime + line-ending tracking. Phase 3 added `tests/editor-pane.test.ts` (14 tests) covering construction, snapshot apply (wrong-surface guard, error state, new-vs-existing), save/reload callbacks with expectedMtimeMs round-trip, apply save result (success + wrong-surface guard), and destroy lifecycle. Phase 7 (S5) added the save-race UX: structured `conflictDetail { expectedMtimeMs, actualMtimeMs, actualSize }` on `EditorSaveResult` so the UI can render an actionable dialog; new `force: true` flag bypasses conflict checks for explicit overwrites; out-of-band deletes (file vanished from disk with a non-null expectedMtimeMs) now surface a structured 'deleted on disk' conflict instead of silently re-creating. Tests in `tests/editor-files.test.ts` (+5, 10 total).
- **Gaps to AAA:**
  - Line-ending convert on save.

---

## 5. Process metadata / infra / dev/test tooling

### SurfaceMetadataPoller
- **Grade: S**
- **Evidence:** `surface-metadata.ts:114-117` — `parsePs` / `parseListeningPorts` / `parseCwds` / `parseGitStatusV2` with 5 s subprocess timeouts; TTL caching (3 s git/`package.json`, stale-entry pruning at 12 s+ idle); focus-aware cadence (1 Hz visible, 3.3 Hz hidden). 126 tests; doc `system-process-metadata.md` exhaustive. Phase 7 (S1) added a `gitStaleCooldownMs = 30 s` skip-tick guard: when a `git status` subprocess hangs past 0.8 × the 5 s timeout, the cwd is parked in a stale-set for the cooldown so subsequent ticks short-circuit instead of stacking parallel hangs (relevant on NFS / sshfs mounts). Tests in `tests/surface-metadata-git-stale.test.ts`.
- **Gaps to AAA:**
  - Metadata rot detection when WS is mute >10 s.
  - Deeper tree-diff than `tree.length` (descendant swap goes undetected).

### Pane-bar chip rendering
- **Grade: S**
- **Evidence:** Extracted to `src/shared/pane-chips.ts:32-94` with signature cache to skip redundant DOM rebuilds; web-mirror parity tested. Phase 2 (F.1) verified the dual-implementation drift is closed — both native (`surface-manager.ts:949`) and mirror (`web-client/main.ts:650, :907`) import from the same shared module. Phase 7 (S3) added A11y coverage: the chip host carries `role="status"` + `aria-live="polite"` so screen readers announce metadata changes politely; every chip carries an `aria-label` spelling out its value — cwd (full path), command (full command, no truncation), port ("Open port N (proto address, pid X)"), git ("branch X, N ahead, N behind, +X lines, -Y lines" via `formatGitAria` helper). Phase 7 (S5) added a per-pane OSC 9;4 progress chip: `▰▰▱▱▱ 40%` for normal, `⏸ ▰▰▰▱▱ 60%` for paused, `× error`, `…` for indeterminate, each with the matching aria-label. Wired through `SurfaceMetadata.progress` so the chip survives 1 Hz metadata refreshes. +6 tests (18 total).
- **Gaps to AAA:**
  - Unified port-click handler / config (native dispatches `ht-open-external` CustomEvent; mirror routes via `http://${location.hostname}:${port}` which fails on `0.0.0.0` when hostname≠IP).
  - Tooltip overflow tests.

### Settings persistence & migration
- **Grade: A**
- **Evidence:** `settings-manager.ts` — 500 ms debounced save; atomic writes (mode 0o600 since H.1); corrupt-file `.bak` recovery; partial-schema merge. Phase 6 catalogue ties the L7 atomic-write behaviour to `tests/atomic-write.test.ts` + the S1 mode invariant to `tests/file-modes.test.ts`. Bloom migration via `applyBloomMigration`. P7 S13–S20 built the typed `FieldSchema<T>` seam in `src/shared/settings.schema.ts`: factories `numberRange` / `bool` (S13), `boolStrict` / `numberRangeStrict` (S14), `enumStr<T>` / `stringTrim` / `stringArray` (S15), `string` / `nullableString` (S16), `wrapped` (S17, plus `AUTO_CONTINUE_SCHEMA`). P7 S20 closed the seam at **56 / 56 fields (100% coverage)** by adding `THEME_PRESET_SCHEMA` (wrapped against the known-preset id set), four colour `string()` schemas, and `ANSI_COLORS_SCHEMA` (wrapped per-key string validator). Every settings field now flows through `validateSettings` with explicit shape sanitisation; the prior silent-gap class where colour / boolean / object fields slipped through the unmodified `...s` spread is closed. Tests pin clamp / round / strict-bool / strict-number / enum / trim / array / pass-through / nullable / wrapped / theme-preset / ansi semantics.
- **Gaps to AAA:**
  - Schema-version field + ordered migrations (currently a single `applyBloomMigration` with no version metadata).
  - Sync-on-quit for security-critical fields (telegram token, mirror auth).

### Logging
- **Grade: A**
- **Evidence:** `logger.ts` — daily rotation by UTC date; 14-day pruning matches pattern only; tee preserves TTY; `[boot]` banner sync; disposal restores writers. File mode 0o600 (H.1).
- **Gaps to AAA:**
  - Size-based rotation (multi-day runs can produce multi-GiB files).
  - Gzip of old logs.
  - Structured log-level filter.

### RPC handlers (typed dispatch)
- **Grade: A**
- **Evidence:** 21 handler files under `src/bun/rpc-handlers/`; `rpc-handler.ts` aggregates via `createRpcHandler`; `METHOD_SCHEMAS` validated pre-dispatch; `satisfies BunMessageHandlers` gates the socket/RPC side. Phase 2 (A1) typed the parallel `dispatch(action, payload)` in `index.ts` via a `WebviewActionEnvelope` discriminated union + `ActionPayloadByAction` lookup; every branch now has a typed payload shape. Tests in `tests/webview-actions-types.test.ts`.
- **Gaps to AAA:**
  - End-to-end JSON-RPC shape test (deferred to P3 — assert every method declared in `TauMuxRPC` has a corresponding handler registered).
  - Move remaining ad-hoc handlers into the per-domain `rpc-handlers/` directory (F.10 — most landed, audit the stragglers).

### Audits
- **Grade: S**
- **Evidence:** `audits.ts:22-46` — async check + optional fix pattern; 5 s timeouts with explicit `proc.kill` on expiry (G.10). P7 S4 added `runAndPublishAudits()` so flipping `auditsGitUserNameExpected` (or any future audit-relevant setting) re-runs + refreshes the health snapshot without a restart. P7 S24 tripled the canary set with `locale-utf8` + `bun-on-path` + `shell-exists`. P7 S26 closed the remediation UX hookup: audit results that carry a `r.fix` now propagate to the HealthRegistry via `health.set(id, sev, msg, fix)`. The wrapped action runs `applyFix(r, registry)` (which re-runs the audit's `check()` post-action) and pushes the recovered result back to health in the same tick. Existing audits that declared a fix (git-user-name → "Set git user.name to …") now surface that button to any sidebar pill or `ht health fix audit:git-user-name` consumer. Tests in `tests/audits.test.ts` + `tests/audit-fix-health-bridge.test.ts`.
- **Gaps to AAA:**

### Health checks
- **Grade: S**
- **Evidence:** `health.ts` — pure state machine; severity model (ok / degraded / error / disabled); idempotent set; subscriber notifications with error isolation; snapshot includes `updatedAt` for staleness. Phase 7 (S1) added a remediation `fix()` channel mirroring the `audits.ts` pattern: `set(id, severity, message, fix?)` accepts an optional `{ label, action }`; `HealthEntrySnapshot` projects a wire-safe `fixLabel` (no callback over the wire); `runFix(id)` invokes the action and returns the post-fix snapshot. Idempotency includes the fix label so swapping `Restart` → `Re-auth` re-notifies. Tests in `tests/health.test.ts` (+8).
- **Gaps to AAA:**
  - UI pill / badge wiring (sidebar consumer follows in cluster H).
  - Staleness auto-demotion if entry goes silent N seconds.

### Manifest scanner
- **Grade: S**
- **Evidence:** `manifest-scanner.ts` — generic walk-up + TTL cache; max-depth 40 to bound symlink cycles; per-cwd TTL (3 s default) with mtime invalidation; idle eviction at 4× TTL. Phase 7 added a realpath-aware `$HOME` boundary check: when the env value differs from its realpath (macOS firmlinks, Linux build-mount realpaths), the walk resolves the current dir and compares against the realpath'd `$HOME` so symlinked homes don't escape.
- **Gaps to AAA:**
  - Symmetric depth between `Cargo.toml` parser (name+version only) and `package.json` parser (small follow-up).

### Cookie store
- **Grade: A**
- **Evidence:** `cookie-store.ts` — JSON-persisted with domain index for O(k) lookup; LRU 50 k global cap; debounced async save + sync `saveNow` on shutdown; atomic writes (H.1). Phase 7 added URL-host normalization on insert (`Example.com`, `.example.com`, `EXAMPLE.COM` collide as the browser does) + per-domain cap (`MAX_PER_DOMAIN = 500` evicts oldest entries inside one bucket — a hostile site can't dominate the global cap). `delete()` and `deleteForDomain()` also normalize input so pre- and post-normalize callers both work.
- **Gaps to AAA:**
  - Export / import (test-automation use case; small follow-up).

### Browser history
- **Grade: A**
- **Evidence:** `browser-history.ts` — JSON-persisted; relevance ranking = recency boost × visit count; LRU 10 k cap; atomic writes. Phase 7 extended `normalizeUrl()` with case-insensitive hostname (RFC 3986), fragment strip, and default-port strip (`:80` http, `:443` https) on top of the existing trailing-slash + www handling. Combined: WWW + case + port + fragment + trailing-slash all aggregate into one entry.
- **Gaps to AAA:**
  - Time-window filter (small follow-up).
  - Privacy / clear command (small follow-up).

### Test suite breadth & quality
- **Grade: A**
- **Evidence:** 155+ test files, 1927+ tests, <16 s; `bunfig.toml` scopes bare `bun test` to `tests/`. Pure-function tests for parsers + settings + health + logger + RPC; e2e via Playwright. T1 closed across Phase 1 + Phase 3: process-manager / settings-panel (Phase 1), editor-pane / browser-pane / terminal-effects / agent-panel (Phase 3). Coverage gate live via `bun run report:coverage:check` against `tests/baselines/coverage-baseline.lcov`. RPC method↔handler invariant test pins the `system.capabilities` surface.
- **Gaps to AAA:**
  - Failure-path Playwright cases (network loss, subprocess crash — owned by P8).
  - Bootstrap-path integration test (SessionManager → RPC → SurfaceManager wire — small follow-up).

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

1. **Design-report + τ-focus-audit gated in CI** — , not just generated artifacts. Owned by P8.
2. **Coverage gate threshold in CI** — Phase 3 landed `bun run report:coverage:check` locally; P8 wires it into CI so a PR can't merge below baseline.
3. **Mobile/web mirror runtime bounding-box gate** — Phase 1 added the 44 × 44 CSS-px shim on coarse pointers. P3 deferred the Playwright mobile-viewport assertion to P8 (where the live Playwright env runs). (I.5)
4. **Theme switcher UI + boot-time data-theme application** — Phase 5 landed the token blocks + matchMedia wiring; the Settings panel field that lets users pick a theme is a small follow-up (P7 polish).
5. **ARIA labels + live regions for git-status chips + notifications** — Phase 1 deferred U7/U8 details. Add `aria-label` to chips and an `aria-live="polite"` region for notification count changes. Owned by P7.
6. **Typed EventBus + VariantContext (A6 + A7)** — Replace 47+ implicit `window.dispatchEvent("ht-…")` channels with a typed `EventBus<EventMap>`; drop the `__tau*` window globals in favour of a `VariantContext` interface. Owned by P7.
7. **WorkspaceCollection extract + settings schema source-of-truth** — F.11 (split `WorkspaceCollection` out of the 2717-LOC `SurfaceManager`) + F.6 (single `settings.schema.ts` driving `AppSettings` / `DEFAULT_SETTINGS` / `validateSettings` / migrations). Owned by P7.
8. **Per-surface browser partition + session cap (H.8/H.9)** — Embedded browser pane shares a webview partition across surfaces; mirror accepts unbounded resume sessions and doesn't validate the Origin header. Documented gaps in `doc/system-security.md`; owned by P7.
9. **Long-tail literal-to-token migration** — `bun run audit:theming` reports ~1013 hard-coded colour literals in component CSS. Migrating them to `var(--ht-…)` references is one-PR-per-cluster work owned by P7 polish.
10. **Release engineering — changelog generator + cross-platform packaging** — `scripts/bump-version.ts` doesn't commit/tag/changelog; `scripts/post-package.ts` is macOS-only. Owned by P8.

---

## Companion docs

- `doc/triple_a_analysis.md` — severity-ranked cross-cutting issue catalogue (the source for `A#`/`L#`/`S#`/`U#`/`T#` ids).
- `doc/tracking_triple_a_analysis.md` — execution log for F–J clusters.
- `doc/feature_upgrade_to_AAA/00_master_plan.md` — programme to move every feature to AAA.
- `doc/full_analysis.md`, `doc/issues_now.md`, `doc/deferred_items.md` — earlier audit rounds (context only).
- `doc/changes_to_document.md` — running website-doc changelog (per CLAUDE.md convention).
