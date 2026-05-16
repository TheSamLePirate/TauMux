# tests/baselines/

Phase 0 acceptance artefacts — snapshots that anchor the CI gates landing in later phases.

## What lives here

### `coverage-baseline.lcov` (committed)

The lcov output of `bun run test:coverage` at the close of Phase 0 (commit `703b671`, version `0.2.100`, 1729 tests).

**Used by:** P3 (Phase 3, test depth) — the coverage gate sets its floor at `baseline + 5 pp` so each PR can only improve coverage, never regress it.

**Refresh policy:** never auto-refreshed. A deliberate snapshot promotion via `bun run baseline:coverage` (to be added in P3) is the only way to move the floor up.

### `design-report/` (not yet populated)

Snapshot of `bun run report:design:web` output as of Phase 0 close. Populated in P5 (theming) — the design report needs a live Electrobun/Playwright environment to produce stable artefacts, so it lands as part of the theme system work where every screen is re-baselined under Light + Dark + High-Contrast.

**Used by:** P8 (release engineering) — `bun run report:design:gate` blocks merges that introduce visual regressions against the baseline.

**Refresh policy:** promotion via `bun run baseline:design` (already exists) writes here when the team agrees a visual change is intentional.

### `tau-focus-audit.json` (not yet populated)

JSON snapshot of `tau-focus-audit.ts` walking the rendered DOM and listing chromatic glow leaks. Populated in P8 when the audit gets wired into a Playwright runner; today the file is only callable from DevTools / REPL.

**Used by:** P8 — the gate compares the live audit against this snapshot and fails on any new leak.

**Refresh policy:** explicit promotion via a P8-defined script.

## Why baselines instead of thresholds

Hard-coded thresholds (e.g. "coverage must be ≥ 60%") drift downward over time as exceptions accumulate. A baseline file is a fixed reference point: the test framework asserts `current ≥ baseline`, and the only way to lower the baseline is a deliberate commit that everyone sees in code review.
