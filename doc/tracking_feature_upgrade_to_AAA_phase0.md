# Tracking — Phase 0 execution

**Source plan:** `doc/feature_upgrade_to_AAA/01_phase0_foundation.md`
**Working tree at start:** branch `main` @ `5005608` (Merge worktree-feature-grades-doc), version `0.2.84`.
**Working tree at end:** branch `worktree-aaa-phase0` @ `c5f22de`, version `0.2.100`.
**Tests at start:** 1544 (per audit doc).
**Tests at end:** 1729 (+185 net).
**Status:** complete.

## Convention

Per `CLAUDE.md`, every functional commit was preceded by `bun run bump:patch`. Pure docs-only commits (just adding markdown files) skipped the bump and noted why in the commit message.

Per the master plan, one PR per issue id with a `test(<id>): …` subject line.

## Execution log

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 0 | Phase 0 sub-plan + audit matrix | landed | 34dd537 | docs-only — no version bump |
| 1 | [A13] escapeHtml unit test | landed | 520116a | bumped → 0.2.85 |
| 2 | [A3+A17] SurfaceKind canonical-union | landed | 4900054 | bumped → 0.2.86. **Deviation:** audit doc claimed zero `startsWith("tg:")` in bun/, but one legitimate residual lives in `src/bun/index.ts:607` (`closeSurface` has no per-id manager for telegram). Test was tightened to "at most one, in the documented spot". |
| 3 | [S1] atomic-write mode 0o600 weak-test upgrade | landed | 6c1326e | bumped → 0.2.87 |
| 4 | [S1] logger + telegram-db file modes | landed | 129dba6 | bumped → 0.2.88. Logger test routes through `HT_CONFIG_DIR` to avoid touching `~/Library/Logs/tau-mux`. |
| 5 | [L6+L12] gracefulShutdown idempotency + timer clears | landed | e63ffda | bumped → 0.2.89. **Decision:** source-grep invariants test — `gracefulShutdown` is module-private and calls `process.exit()`, so a runtime test would require spawning a child process. The source-grep pins enough invariants to catch the regression we're guarding. |
| 6 | [L8] CommandPalette destroy lifecycle | landed | 763fc84 | bumped → 0.2.90. **Deviation:** audit doc said palette has a `mount()` API; actually the constructor self-appends to `document.body`. Tests adjusted. |
| 7 | [L2] PTY SIGHUP grace before SIGKILL | landed | e616ad5 | bumped → 0.2.91. **Decision:** runtime SIGHUP-trap-fires test passes; the SIGKILL-escalation path is pinned via source-grep because `destroy()` sets `_destroyed = true` which short-circuits `trackExit()` before it can flip `_exited` — there is no exposed signal that the escalation timer fired. |
| 8 | [L3+L5] WS heartbeat + reconnect jitter | landed | 4b18449 | bumped → 0.2.92. **Deviation:** audit doc described jitter as "Math.random * 0.5"; actual implementation is `(Math.random() - 0.5) * 0.5` (±25% shift, not [0, 0.5]). Test pattern corrected. |
| 9 | [L14] telegram-db PRAGMA busy_timeout | landed | 54f949f | bumped → 0.2.93 |
| 10 | [U2+U3] a11y media queries (native + mirror) | landed | 1a8ea35 | bumped → 0.2.94 |
| 11 | [L13] audit subprocess timeouts | landed | 4a9ad6f | bumped → 0.2.95 |
| 12 | [S4] token entropy floor warn | landed | b6dee04 | bumped → 0.2.96 |
| 13 | [S3+S7] telegram outbound cap + chatId allow-list | landed | afafd0d | bumped → 0.2.97 |
| 14 | [U13] selectWorkspaceByIndex + ⌘1..⌘9 | landed | 2b8a210 | bumped → 0.2.98 |
| 15 | [U11] keyboard cheatsheet rendered DOM + a11y | landed | 28a8657 | bumped → 0.2.99 |
| 16 | Step 3 — `bun run report:feature-grades` pipeline | landed | 703b671 | bumped → 0.2.100. **Discovery:** the original `feature_grades.md` hand-counted "40 features"; the actual feature inventory is 49. The renderer auto-computes distribution so this drift can't recur. |
| 17 | Step 5 — coverage baseline | landed | c5f22de | bumped → 0.2.101 (current). design-report + tau-focus-audit baselines deferred to P5/P8 (need live Playwright env). |
| 18 | Step 4 — re-baseline / re-grade | no-op | — | All 19 audited PR claims verified truthfully present in the working tree. No grade changes needed. |
| 19 | Phase 0 closing | landed | (this commit) | docs-only — tracking doc + close-out. |

## Summary

- **17 functional commits** + 2 docs commits = 19 total.
- All 19 PR rows from `tracking_triple_a_analysis.md` audited; 19/19 fixes present in tree.
- **15 new test files** landed covering the previously-untested fixes:
  - `tests/escape-html.test.ts` (A13)
  - `tests/surface-kind.test.ts` (A3+A17)
  - `tests/file-modes.test.ts` (S1 — logger + telegram-db chmod)
  - `tests/index-shutdown.test.ts` (L6+L12)
  - `tests/command-palette-destroy.test.ts` (L8)
  - `tests/pty-manager-grace.test.ts` (L2)
  - `tests/web-ws-heartbeat.test.ts` (L3+L5)
  - `tests/telegram-db-busy.test.ts` (L14)
  - `tests/a11y-media-queries.test.ts` (U2+U3)
  - `tests/audits-timeout.test.ts` (L13)
  - `tests/web-token-entropy.test.ts` (S4)
  - `tests/telegram-outbound-cap.test.ts` (S3+S7)
  - `tests/select-workspace-by-index.test.ts` (U13)
  - `tests/keyboard-cheatsheet-render.test.ts` (U11)
  - `tests/scripts/build-feature-grades.test.ts` (pipeline sanity)
- **1 weak-test upgrade** landed: `tests/atomic-write.test.ts` (S1 mode assertions).
- **New pipeline:** `bun run report:feature-grades` (+ `:check`) generating `doc/feature_grades.md` from `doc/feature_grades.json`. 49 features, distribution auto-computed.
- **Coverage baseline captured:** `tests/baselines/coverage-baseline.lcov` (32 712 lines, 1729 tests).

## Items not landed in Phase 0 (per the master plan)

The master plan §P0 Step 4 was explicit that the items remaining from `tracking_triple_a_analysis.md` are owned by later phases:

- **Cluster F (architecture):** F.1 chip-render extract, F.2 pane-layout-math extract, F.5 protocol-dispatcher narrow, F.6 settings schema, F.7 typed dispatch, F.8 typed event-bus, F.9 broadcaster, F.10 move handlers, F.11 WorkspaceCollection — owned by P2.
- **Cluster G:** G.9 prepared-statement caching (re-confirmed deferred).
- **Cluster H (security):** H.7 sideband iframe sandbox, H.8 per-surface partition, H.9 session cap, H.10 docs, H.11 telegram parse-mode — owned by P4.
- **Cluster I (a11y):** I.1 modal a11y helper, I.4 semantic colour tokens, I.5 phone touch + visualViewport, I.7–I.13 — owned by P1 (a11y kit).
- **Cluster J (test depth):** J.2–J.19 covering the five biggest UI files, bootstrap, settings migration, telegram offset crash, surface-metadata diff — owned by P3.

The coverage gate (P3 acceptance) is not yet wired into CI; that lands in P3 with the threshold definition.

## Deviations from the sub-plan

1. **Three runtime tests were converted to source-grep tests** where the runtime path required either a child process (gracefulShutdown), no exposed signal for the path we wanted to assert (PTY SIGKILL escalation), or heavy live infrastructure (Bun.serve mock for entropy warning, 4096-char cap, brute-force throttle internals). Each deviation is documented in the relevant commit message and audit-matrix row. Source-grep tests are sufficient to catch the regression class we're guarding — a refactor that drops or weakens the invariant.
2. **The grading doc count was wrong.** The original `feature_grades.md` claimed "40 features" but the actual inventory is 49 across the five clusters. The renderer now auto-computes the distribution so this drift can't recur.
3. **The audit doc claimed zero `startsWith("tg:")` residuals.** One legitimate residual lives in `src/bun/index.ts:607` (telegram close path — no per-id manager to call). The test was tightened to "at most one in the documented spot" rather than zero.
4. **Coverage gate not landed in CI.** The coverage script + lcov generation exist, the baseline is captured, but the threshold check is a P3 deliverable, not a P0 one. Phase 0 only sets the floor; P3 enforces it.
5. **Design-report + τ-focus-audit baselines not captured.** Both need a live Playwright/Electrobun environment and are owned by P5/P8. README documents the intent.

## Exit criteria — assessment

| Criterion | Status |
|---|---|
| Audit matrix exists with all 19 PR rows graded | ✅ `phase0_audit_matrix.md` |
| Every landed HIGH item has a named regression test | ✅ 15 new + 1 upgraded |
| `bun run report:feature-grades` regenerates the .md byte-identical | ✅ `:check` exit 0 |
| `--check` mode wired (CI integration deferred to P8) | ✅ `report:feature-grades:check` |
| `bun test` green | ✅ 1729 pass / 0 fail |
| `bun run typecheck` green | ⚠ 1 pre-existing error in `src/bun/index.ts:16` (electrobun internal import path, environment issue, not introduced in Phase 0) |
| Coverage baseline committed | ✅ `tests/baselines/coverage-baseline.lcov` |
| design-report + tau-focus-audit baselines | ⚠ deferred to P5/P8 with documented intent |
| Items-remaining list redistributed to phase owners | ✅ (this doc) |

## Next phase

P1 (a11y kit) — highest single-step leverage. The work plan in `02_phase1_a11y_kit.md` is the next sub-plan to author.
