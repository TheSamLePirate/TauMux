# Tracking — Phase 2 execution (Architecture detoxification)

**Source plan:** `doc/feature_upgrade_to_AAA/03_phase2_architecture.md`
**Started at:** branch `main` @ Phase 1 close (`61e690b`), version `0.3.16`.
**Ended at:** branch `worktree-aaa-phase2-arch` @ `1acb511`, version `0.3.20`.
**Tests at start:** 1843.
**Tests at end:** 1854 (+11 net — typing refactors, low new-test count).
**Status:** partial — high-value steps landed; A6 / A7 / F.6 / F.11 deferred.

## Execution log

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Phase 2 sub-plan | landed | (included in PR 2) | Authored alongside Step 2 commit. Pure docs change in the worktree. |
| 2 | F.1 — chip-render extract | already-landed | — | Discovery: `src/shared/pane-chips.ts` was extracted in a prior sweep. Both native (`surface-manager.ts:949`) and mirror (`web-client/main.ts:650, :907`) already import from it. Marked complete; no new code. |
| 3 | F.2 — pane-layout-math extract | landed | 6281e88 | bumped → 0.3.17. New `src/shared/pane-layout-math.ts` with the canonical pure `computeRects`. Native `PaneLayout.computeRects` now wraps the shared function (passes module-level `paneGap`). Mirror `layout.ts:computeRects` becomes a thin wrapper that coerces the loose `LayoutNode` shape (defaults for direction/ratio/children) and flips Map→Record. +7 parity tests. **Deviation:** the mirror's optional-field shape was preserved (not strict-only) because reconnect-resume payloads can arrive partial; the wrapper absorbs the difference and the strict shared function only ever sees a valid `PaneNode`. |
| 4 | A2 — protocol-dispatcher narrowing | landed | 077780a | bumped → 0.3.18. New `ServerPayloadByType` mapped type keyed on the `ServerMessage` union; each `case` body uses `rawPayload as ServerPayloadByType["…"]`. The function signature stays `(type: string, payload: unknown)` so the transport boundary doesn't change. **Deviation from plan:** the plan called for changing the signature to `(msg: ServerMessage)` and switching on `msg.type`. The lookup-map approach is a smaller diff with the same compile-time effect — adding a new server message without a `case` branch now fails `tests/protocol-dispatcher-types.test.ts`. +4 tests. |
| 5 | A1 — typed WebviewActionEnvelope | landed | 1acb511 | bumped → 0.3.19. New `src/shared/webview-actions.ts` with 18-arm `WebviewActionEnvelope` discriminated union + `ActionPayloadByAction` lookup. Every branch in `dispatch()` (`src/bun/index.ts:2517+`) now uses `payload as ActionPayloadByAction["…"]`; the 19 `payload["field"] as Type` index-casts are gone. **Deviation:** same as A2 — the runtime entry point stays `(action: string, payload: Record<string, unknown>)` so existing callers don't need to change; the typing happens in the body. The exit-criteria test forbids any future `payload["…"] as` cast surviving in the body. +5 tests. |
| 6 | Phase 2 close-out (feature_grades.json + tracking) | landed | (this commit) | bumped → 0.3.20. Distribution moved from `1 S / 24 A / 21 B / 3 C` → `2 S / 26 A / 18 B / 3 C`. |

## Summary

- **3 functional commits** + 1 close-out.
- Both typed-dispatch regressions (A1, A2) closed.
- Pane-layout math is a single shared pure function on both sides.
- F.1 (chip-render extract) verified already-landed from a prior sweep.
- +11 net new tests; full suite 1854 / 0.

## Grade lifts (re-baselined in `feature_grades.json`)

| Feature | Before | After |
|---|---|---|
| `pane-layout` | A | S |
| `web-mirror` | B+ | A |
| `pane-chip-rendering` | B | A |
| `rpc-handlers` | B | A |

Total: **3 features lifted B → A**, **1 feature lifted A → S**.

## Items deferred (to later phases)

The Phase 2 sub-plan listed eight steps. The high-leverage, lower-risk four landed:

- **F.5 — settings JSON schema** (Step 7). Touches every settings caller; deferred until the schema-version migration (Phase 7 polish) so both changes can land together.
- **A6 — Typed EventBus** (Step 5). 47+ `window.dispatchEvent("ht-…")` channels are mechanical to migrate but high-risk under a single PR. Deferred to **P7** with one-channel-at-a-time PRs.
- **A7 — VariantContext** (Step 6). Drop the `__tau*` window globals; pass an interface into `VariantController`. Deferred to **P7** — same per-variant care as A6.
- **F.11 — extract `WorkspaceCollection`** (Step 8). Large refactor of the 2717-LOC `SurfaceManager`. Deferred to **P7**.
- **F.10 — move remaining ad-hoc handlers** (Step 9). Audit task; deferred to **P7** polish.

The remaining work fits the "long tail" bucket per the master plan's P7 polish budget. The grade lifts are unaffected — the four moves listed above land independently of A6/A7/F.6/F.11.

## Deviations from the sub-plan

1. **A1 and A2 used a typed payload-lookup pattern, not a signature change.** The sub-plan called for changing each dispatcher's signature to accept a discriminated union directly. The lookup-map pattern is a smaller diff (no boundary change), has the same compile-time effect (per-case typed payload), and the tests we added explicitly forbid the anti-pattern (`payload["…"] as` casts) and exhaustiveness regressions (missing case branches). The end-state typing is equivalent; the diff is smaller.

2. **F.1 was discovered already-landed.** Phase 2 audit doc claimed F.1 still applied, but `src/shared/pane-chips.ts` was extracted in an earlier sweep (M16 per a comment in `surface-manager.ts`). Verified, marked done, no new code.

3. **F.2's mirror wrapper accepts a loose `LayoutNode` shape** rather than requiring strict `PaneNode`. Reconnect-resume payloads can arrive partial; the wrapper applies defaults (direction='horizontal', ratio=0.5, children=[]) and skips nodes without an identity. The strict shared function only ever sees a valid `PaneNode`.

4. **Deferred items above are explicit handoffs**, not slippage. The master plan sized Phase 2 at 3 engineer-weeks; landing all eight items in one session was never going to happen. The four high-leverage items shipped; the long tail is parked in P7 with one-channel-at-a-time PRs as the mitigation.

## Exit criteria — assessment

| Criterion | Status |
|---|---|
| `tsc --noEmit` clean | ⚠ pre-existing electrobun-internal import error survives (not introduced in Phase 2). |
| No `: any` in `protocol-dispatcher.ts` | ✅ asserted by `tests/protocol-dispatcher-types.test.ts` |
| No `payload["…"] as` cast in `dispatch` body | ✅ asserted by `tests/webview-actions-types.test.ts` |
| Both consumers of pane-chip rendering import from a shared module | ✅ verified |
| Native + mirror `computeRects` are the same function | ✅ asserted by `tests/pane-layout-math-parity.test.ts` |
| `__tauSurfaceManager` / `__tauNotify` globals removed | ⚠ deferred to P7 |
| Typed EventBus | ⚠ deferred to P7 |
| Settings schema source-of-truth | ⚠ deferred to P7 |
| `bun test` green | ✅ 1854 / 0 |
| `bun run report:feature-grades:check` green | ✅ |

Phase 2 is **substantively complete on the high-leverage front**: A1 and A2 closed (both rank-1 blockers from Phase 1's top-10 list), F.2 / A5 closed, F.1 verified. The deferred items are tracked in the master plan's top-10 as rank-10 ("A6+A7 owned by P7"); they don't block any other phase.

## Next phase

P3 — Test depth for the four still-uncovered big UI modules + coverage gate. The coverage baseline is captured (`tests/baselines/coverage-baseline.lcov`); P3 lands the threshold check and the per-module DOM tests.
