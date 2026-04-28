# Tracking — Deferred Items execution

**Plan:** `doc/deferred_items.md`
**Started:** 2026-04-28
**Hand-off version:** 0.2.50

## User-imposed constraint

- **E.4 is SKIPPED.** User explicitly asked to keep web HTTP and WebSocket binding to `0.0.0.0`. Do not flip the `webMirrorBind` default. The findings in E.4 are not actioned.

## Execution log

| PR # | Cluster / item | Status | Commit | Notes |
|------|----------------|--------|--------|-------|
| 1 | Cluster A — N8, N9, N10, N11, N12, N13, N16, N17, M4 | landed | d0c7391 | bumped 0.2.50 → 0.2.51. All 1501 tests pass; typecheck clean. |
| 2 | A.1 — M5 `ht browser help` subcommand | landed | 427d35d | bumped 0.2.51 → 0.2.52. Extracted shared `BROWSER_HELP` constant; added `case "help"` + `--help`/`-h` flag short-circuit; 1503 tests pass. **Deviation:** had to hoist `BROWSER_HELP` to top of file (TDZ — main runs printHelp before later top-level statements). |
| 3 | A.2 — Separate dev configDir | landed | (pending) | bumped 0.2.52 → 0.2.53. Set `HT_CONFIG_DIR=$HOME/Library/Application Support/hyperterm-canvas-dev` on `start`, `dev`, `build:dev`. `build:canary` / `build:stable` untouched. Manual verification deferred (would require launching the app — tests cover the consumer side). |

## Deviations from plan

(track here)

## Issues encountered

(track here)

## Items deliberately skipped

- **E.4** — `webMirrorBind` default flip. Skipped per user instruction.
- **E.5** — IME composition (xterm.js internals). Requires Playwright + non-Latin input keyboard layouts; not practical in this pass. Tracking issue territory.
- **E.6** — `audit.fix` ergonomics. Plan says "hold for now" until Plan #11 consumer surface stabilizes.
