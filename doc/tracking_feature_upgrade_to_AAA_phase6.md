# Tracking — Phase 6 execution (Lifecycle regression tests)

**Source plan:** `doc/feature_upgrade_to_AAA/07_phase6_lifecycle.md`
**Started at:** branch `main` @ Phase 5 close (`98b2073`), version `0.3.32`.
**Ended at:** branch `worktree-aaa-phase6-lifecycle` @ `f971b63`, version `0.3.35`.
**Tests at start:** 1964.
**Tests at end:** 1976 (+12 net).
**Status:** complete on the high-leverage front; remaining lifecycle items (L8..L14) already covered by Phase 0's tests and now catalogued.

## Discovery

Phase 0 shipped 15 regression tests covering L1..L14 (source-grep + behavioural). Most were source-grep. Phase 6's contribution: turn the rank-1 top-blocker (L1) into a behavioural forced-crash test, upgrade the L5 jitter test from source-grep to spread-distribution, and catalogue every fix in a single index doc that's two-way-coupled to the live test suite.

## Execution log

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Phase 6 sub-plan | landed | (with Step 1) | docs change. |
| 2 | Step 1 — L1 forced-crash regression test | landed | b104a47 | bumped → 0.3.33. New `tests/pi-agent-manager-crash.test.ts` (2 tests). Spawns a fake-pi shell script that ignores its CLI args and exits non-zero; observes the real `proc.exited.then` chain firing `_managerExit`. **Test-env hack:** `process.env.SHELL = "/bin/echo"` during the test so the manager's internal `[SHELL, "-ilc", "echo $PATH"]` PATH probe returns immediately (under bun:test without a TTY the interactive shell stalled for 20+ seconds). Runs in 1.1 s. Reverting the `_managerExit = …` line in `createAgent` makes the test fail with a 5 s timeout. |
| 3 | Step 2 — L3+L5 behavioural jitter test | landed | 4477a44 | bumped → 0.3.34. Extracted the inline jitter math into an exported `applyReconnectJitter(baseDelay, rand)` helper with `rand: () => number = Math.random` as a test seam. Caller in `ws.onclose` switches from `(Math.random() - 0.5) * 0.5; …` to `applyReconnectJitter(reconnectDelay)`. +7 spread invariants in `tests/web-reconnect-jitter.test.ts`: mid-point pass-through, ±25 % bounds via deterministic seeds, 1000-call bounds with real Math.random, 100-seed sweep covers ≥ 40 % of base D (thundering-herd defense), non-determinism check, integer-rounding. |
| 4 | Step 3 — `tests/regressions/` catalogue + gate | landed | f971b63 | docs-only — no version bump. New `tests/regressions/README.md` catalogues 30+ fixes across L# / S# / U# / A# / T# columns. New `tests/regressions/catalogue.test.ts` (3 tests) parses the README and asserts every quoted test name exists, plus pins a floor of ≥ 20 required ids (L1..L7, S1/S2/S4/S5/S6/S11, U1/U2/U12, A1/A2/A13, T1). |
| 5 | Phase 6 close-out (feature_grades + tracking) | landed | (this commit) | bumped → 0.3.36. Distribution moved from `6 S / 28 A / 12 B / 3 C` → `7 S / 28 A / 11 B / 3 C`. |

## Summary

- **3 functional commits** (L1 crash test, L5 jitter helper + spread test, catalogue + gate) + 1 close-out.
- Every named L# fix has either a behavioural test or a source-grep test, all catalogued.
- The catalogue is gated by `tests/regressions/catalogue.test.ts` — removing a test breaks the suite, not just the doc.
- +12 net new tests.

## Grade lifts (re-baselined in `feature_grades.json`)

| Feature | Before | After |
|---|---|---|
| `ht-cli` | A | S |
| `settings-persistence` | B+ | A |

Distribution moved from `6 S / 28 A / 12 B / 3 C` → **`7 S / 28 A / 11 B / 3 C`**.

## Items deferred

The Phase 6 sub-plan listed three steps; all three landed. Phase 5's rank-1 outstanding blocker (verify `_managerExit` under crash) is closed.

Items left from prior phases that remain to land in later phases:
- **Coverage gate CI wiring + design-report gate** — local scripts exist; CI wiring is **P8**.
- **Playwright failure-path tests + mobile bounding-box gate** — needs live Playwright env; **P8**.
- **Theme switcher UI + literal migration + per-surface browser partition + WorkspaceCollection extract + settings schema source-of-truth + typed event bus + ARIA chip labels** — all **P7**.

## Deviations from the sub-plan

1. **L1 test required a `SHELL` env hack.** PiAgentInstance.start() runs `Bun.spawnSync([SHELL, "-ilc", "echo $PATH"])`; under bun:test without a TTY an interactive shell stalls for 20+ seconds. Setting `SHELL=/bin/echo` for the test window makes the probe a no-op and the test runs in 1.1 s instead of timing out. This is a test-only env mutation with explicit save+restore in `beforeAll` / `afterAll`.

2. **L5 jitter math extracted into a pure helper** rather than tested through a stubbed WebSocket. The helper is the cleanest seam — `applyReconnectJitter(baseDelay, rand)`. The Phase 0 source-grep test was updated to pin the helper indirection (caller uses `applyReconnectJitter(…)` not the inline expression). Net: cleaner contract + behavioural test.

3. **The catalogue gate doesn't auto-flag new fixes that land without a row.** That's an intentional gap — humans review the PR; an automatic gate would force-rule on every commit that touches `tests/`. The catalogue catches *removals* and typos, which is the actual rot risk.

## Exit criteria — assessment

| Criterion | Status |
|---|---|
| L1 forced-crash test passes; reverting `_managerExit` makes it fail | ✅ |
| L5 behavioural jitter spread test passes deterministically | ✅ |
| `tests/regressions/README.md` exists with ≥ 20 rows | ✅ (30+) |
| `tests/regressions/catalogue.test.ts` passes | ✅ |
| `bun test` green | ✅ 1976 / 0 |
| `bun run report:feature-grades:check` green | ✅ |
| `bun run report:coverage:check` green | ✅ |

Phase 6 is **complete**. The lifecycle leg of the AAA programme is now behaviourally verified and indexed.

## Next phase

P7 — Per-feature polish sweep. The long tail of named gaps in `feature_grades.json` (theme switcher UI, literal migration, ARIA chip labels, settings schema, WorkspaceCollection extract, typed event bus, browser partition, etc.). ~4 engineer-weeks per the master plan — by far the longest phase.

P8 — Release engineering (CI wiring for the coverage gate + design report + τ-focus-audit; changelog generator; cross-platform packaging). ~1 engineer-week.
