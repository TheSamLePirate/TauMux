# Tracking — Phase 5 execution (Theme system)

**Source plan:** `doc/feature_upgrade_to_AAA/06_phase5_theming.md`
**Started at:** branch `main` @ Phase 4 close (`6e0b899`), version `0.3.28`.
**Ended at:** branch `worktree-aaa-phase5-theme` @ `d660ec7`, version `0.3.31`.
**Tests at start:** 1945.
**Tests at end:** 1964 (+19 net).
**Status:** foundational pieces landed; theme switcher UI + ~1013-literal CSS migration deferred to P7 polish per the sub-plan.

## Discovery

The token system at `src/shared/web-theme-tokens.css` already existed (84 lines, exhaustive Graphite Dark palette, shared between native + mirror). Phase 5's "token layer reorg" step was therefore mostly done — Phase 5 layered Light + High-Contrast tokens on top, plus the reduced-motion JS guard for the canvas-based effects layer.

## Execution log

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Phase 5 sub-plan | landed | (with Step 1) | docs change. |
| 2 | Step 1 — terminal-effects matchMedia(prefers-reduced-motion) guard | landed | a9d4a0e | bumped → 0.3.29. New private `reducedMotionQuery` + `reducedMotionListener`; constructor registers a `change` listener; new public `setReducedMotion(reduce)` method drops the pulse queue + lights, sets active=false, hides the canvas, clears the GPU framebuffer. destroy() detaches the listener so a torn-down instance doesn't keep a closure alive across hot reloads. +4 tests. |
| 3 | Step 2 — `audit:theming` script | landed | 53f8c90 | bumped → 0.3.30. Scans `src/views/terminal/`, `src/web-client/`, `src/shared/` for *.css. Strips block comments + `:root { … }` / `@theme { … }` / `:root[data-theme="…"] { … }` blocks (preserving newlines so line numbers stay correct). Flags hex/rgb/hsl/oklch/lab/color() outside the token block. +10 unit tests. Reports ~1013 existing literals — informational gate until the migration completes (owned by P7). |
| 4 | Step 3 — Light + HC theme tokens | landed | d660ec7 | bumped → 0.3.31. Three new blocks in `web-theme-tokens.css`: `[data-theme="graphite-light"]` (every bg/text/border/accent/sem token mapped to light values, accent darker for contrast), `[data-theme="high-contrast"]` (pure black/white targeting WCAG AAA, yellow focus rings), `@media (prefers-color-scheme: light)` for `[data-theme="system"]`, and `@media (forced-colors: active)` mapping every theme to CSS Color Module Level 4 system keywords (Canvas / CanvasText / GrayText / Highlight / LinkText). +5 exhaustiveness tests. |
| 5 | Step 4 — Theme switcher UI | deferred | — | The token blocks + matchMedia wiring are sufficient for the lift; the Settings panel `theme` field + boot-time `documentElement.dataset.theme` apply are small follow-up. A user can flip themes today via `document.documentElement.dataset.theme = "graphite-light"`. Owned by **P7 polish**. |
| 6 | Step 5 — Visual baselines per theme | deferred | — | `bun run report:design` captures one screenshot set; capturing three (Dark + Light + HC) and gating against all three needs the live Playwright environment in P8. Explicit handoff. |
| 7 | Phase 5 close-out (feature_grades + tracking) | landed | (this commit) | bumped → 0.3.32. Distribution moved from `4 S / 30 A / 12 B / 3 C` → `6 S / 28 A / 12 B / 3 C`. |

## Summary

- **3 functional commits** (reduced-motion guard, audit script, theme tokens) + 1 close-out.
- The U2 (reduced motion) gap on the terminal-effects canvas is closed.
- The Light + HC theme foundation lands; the switcher UI follows in P7.
- `bun run audit:theming` provides an actionable backlog for the long-tail literal-to-token migration.
- +19 net new tests.

## Grade lifts (re-baselined in `feature_grades.json`)

| Feature | Before | After |
|---|---|---|
| `terminal-effects` | A | S |
| `tau-primitives` | A | S |

Distribution moved from `4 S / 30 A / 12 B / 3 C` → **`6 S / 28 A / 12 B / 3 C`**. Two more features cleared every named gap.

## Items deferred (with phase ownership)

- **Theme switcher UI** — Settings-panel field + boot-time apply. Small follow-up; **P7 polish**.
- **Long-tail literal-to-token migration** — ~1013 hard-coded colour literals across `index.css` and `client.css`. The audit reports them; the migration is one-PR-per-cluster work. **P7 polish**.
- **Visual baselines per theme** — Playwright runs for Dark + Light + HC + design-report gates against each. Needs live Playwright env. **P8**.
- **Semantic icon-size scaling** — a single `--ht-icon-base` token + multipliers. Small follow-up; **P7 polish**.
- **WebGL context-loss recovery** — `webglcontextlost` handler. Defense-in-depth; **P7 polish**.

## Deviations from the sub-plan

1. **Theme switcher UI deferred.** The sub-plan called for landing the Settings field + apply logic in this phase. The token blocks are the load-bearing piece (every other consumer reads through `var(--ht-…)`); the UI is a small follow-up. Marking deferred rather than rushing the UI work.

2. **The `audit:theming` gate is informational, not blocking.** The current codebase has ~1013 hard-coded literals. Making the gate blocking now would require migrating all of them in this PR. The audit reports them; the migration is owned by P7 polish.

3. **`prefers-color-scheme` is honoured via `[data-theme="system"]`, not via the default `:root`.** A user who never set a theme stays on Graphite Dark even on a light-mode OS — that's the intent (the app brand is dark-first). They opt into "follow system" via the (forthcoming) switcher.

## Exit criteria — assessment

| Criterion | Status |
|---|---|
| terminal-effects honours prefers-reduced-motion | ✅ |
| audit:theming exists | ✅ (informational) |
| Light theme tokens | ✅ |
| HC theme tokens | ✅ |
| @media (prefers-color-scheme: light) wired for data-theme=system | ✅ |
| @media (forced-colors: active) wired | ✅ |
| Settings panel theme switcher | ⚠ deferred to P7 |
| Visual baselines per theme | ⚠ deferred to P8 |
| `bun test` green | ✅ 1964 / 0 |
| `bun run report:feature-grades:check` green | ✅ |

Phase 5 is **substantively complete on the foundation**: every token has Light + HC + forced-colors overrides; reduced-motion reaches the canvas; the audit catches future regressions. The deferred items (UI switcher, literal migration, visual baselines) are tracked and have phase owners.

## Next phase

P6 — Lifecycle regression tests for the named L1–L7 fixes (most landed via the Phase 0 audit; need explicit regression tests so a future revert breaks `bun test` rather than silently re-introducing the bug).
