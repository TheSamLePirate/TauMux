# Phase 3 — Test depth

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase3.md`
**Status:** In progress — started 2026-05-16.
**Owner:** tests.
**Engineer-weeks:** ~3.0 (medium confidence).
**Lifts:** Sidebar B→A (Phase 1), Settings Panel B→A (Phase 1), Browser pane B→A, Terminal effects B→A, Editor pane B→A, Plan panel A→S, Pi agent B→A.

---

## Goal

Phase 1 already covered sidebar (roving-tabindex tests), settings-panel (a11y tests), and process-manager (full unit tests). Phase 3 closes the test-depth gap on the four still-uncovered big UI modules and stands up the coverage gate that locks in the progress.

The four targets (LOC, current coverage):
- `agent-panel.ts` — 1755 LOC. Sub-modules (`agent-events`, `agent-panel-dialogs`, `agent-panel-messages`, `agent-panel-model`, `agent-panel-response`, `agent-panel-slash`) are well-covered. The main composing module is not.
- `terminal-effects.ts` — 1011 LOC. Zero direct unit tests on the WebGL bloom math.
- `browser-pane.ts` — 999 LOC. Zero direct unit tests.
- `editor-pane.ts` — 526 LOC. Zero direct unit tests.

Plus the supporting infrastructure:
- Coverage gate that compares against `tests/baselines/coverage-baseline.lcov` (captured in Phase 0).
- An RPC method ↔ handler invariant test that catches a class of A1 regressions at runtime even if a future refactor slips past typecheck.

---

## Steps (ordered for risk + leverage)

### Step 1 — Coverage gate

`scripts/check-coverage.ts` reads `coverage/lcov.info` and compares against `tests/baselines/coverage-baseline.lcov`. Two modes:
- `bun run report:coverage:check` — gate. Fails if any file's lines-hit-ratio dropped below the baseline (with a small slack `--slack` for floating-point noise).
- `bun run baseline:coverage` — promote. Copies the current lcov to the baseline file. The promotion needs an explicit commit so a reviewer sees the regression cause.

Tests: `tests/scripts/check-coverage.test.ts` validates the parser + comparator on synthetic lcov pairs.

### Step 2 — RPC method ↔ handler invariant test

Walk every method declared in `TauMuxRPC["bun"]["messages"]`; assert that the aggregated handler registry from `createRpcHandler` exposes a function for each. Catches the runtime equivalent of A1's stringly-typed escape route — a new method added without a handler now fails this test.

### Step 3 — Editor pane unit tests

Smallest of the four. DOM-level coverage:
- Construct EditorPane in happy-dom; load a file via `setContent`; assert the editor view renders with the right language.
- Mark dirty via `setDirty(true)`; assert the dirty pill shows.
- `setPath("/foo.json")`; assert the language detection picks JSON.
- Concurrent-save mtime check: simulate two `onSave` calls; assert the second sees the updated mtime baseline (or call out the known gap if the impl doesn't yet handle it).

### Step 4 — Browser pane unit tests

Construct BrowserPane; address-bar value updates; navigation history push; console-capture appends to the panel; OOPIF visibility toggle on focus change.

### Step 5 — Terminal effects unit tests

Math-only:
- `clampIntensity` curve (if exposed) — boundary values.
- Ring expansion at a given delta-t.
- Light visibility trace.
Skip the actual WebGL render; assert the math primitives in isolation.

### Step 6 — Agent panel main module tests

The sub-modules (`agent-panel-dialogs`, `messages`, `model`, `response`, `slash`) are already tested in Phase 0. The main `agent-panel.ts` composes them. Tests:
- Construction wires the right child modules.
- `submitPrompt()` routes through the response pipeline.
- Tool-badge rendering on incoming tool events.

### Step 7 — Bootstrap path test

Spin up SessionManager → RPC handlers → SurfaceManager with mocked Electrobun RPC; assert the wiring is correct. Catches the "everything works in isolation but not when wired together" class.

### Step 8 — Failure-path Playwright cases

Deferred — needs running Playwright. Listed for completeness; lands in P8.

### Step 9 — Sideband / OSC fuzz corpora

Optional polish; the parsers are already tested for normal input. Defer to P7.

---

## Per-step acceptance criteria

| Step | Acceptance |
|---|---|
| 1 | `bun run report:coverage:check` against the baseline lcov is green; a synthetic regression makes it fail loudly. |
| 2 | `tests/rpc-handler-coverage.test.ts` asserts every TauMuxRPC method has a registered handler. |
| 3 | `tests/editor-pane.test.ts` covers construction + dirty + language detection. |
| 4 | `tests/browser-pane.test.ts` covers construction + address bar + console capture. |
| 5 | `tests/terminal-effects-math.test.ts` covers the pure math primitives. |
| 6 | `tests/agent-panel.test.ts` covers the composing module's surface. |
| 7 | `tests/bootstrap.test.ts` proves the SessionManager → RPC → SurfaceManager wire. |

---

## Lifts to track in `feature_grades.json`

- `editor-pane` B → A (after Step 3).
- `browser-pane` B → A (after Step 4).
- `terminal-effects` B → A (after Step 5).
- `pi-agent` B → A (after Step 6 + regression test for L1).
- `test-suite` B+ → A (after the coverage gate + four UI modules cover the T1 backlog).

---

## Risk

The four UI modules touch xterm.js, OOPIF webviews, and CodeMirror — components that need real browser APIs to work end-to-end. Happy-dom covers most but not all. Where a runtime test would require the actual webview, this phase uses source-grep tests pinning the relevant invariants (same pattern as Phase 0). The pragmatic line is "if a test can be DOM-only via happy-dom, write the DOM test; otherwise pin the invariant via source-grep".

---

## Exit criteria

- All four UI modules have a `tests/<module>.test.ts` next to them.
- `bun run report:coverage:check` is wired and green.
- Every TauMuxRPC method has a handler (asserted by test).
- `bun test` green.
- `bun run report:feature-grades:check` green after the JSON update.
