# Tracking — Deferred Items execution

**Plan:** `doc/deferred_items.md`
**Started:** 2026-04-28
**Hand-off version:** 0.2.50

## User-imposed constraint

- **E.4 is SKIPPED.** User explicitly asked to keep web HTTP and WebSocket binding to `0.0.0.0`. Do not flip the `webMirrorBind` default. The findings in E.4 are not actioned.

## Execution log

| PR # | Cluster / item | Status | Commit | Notes |
|------|----------------|--------|--------|-------|
| 1 | Cluster A — N8, N9, N10, N11, N12, N13, N16, N17, M4 | landed | (pending) | bumped 0.2.50 → 0.2.51. All 1501 tests pass; typecheck clean. |

## Deviations from plan

(track here)

## Issues encountered

(track here)

## Items deliberately skipped

- **E.4** — `webMirrorBind` default flip. Skipped per user instruction.
- **E.5** — IME composition (xterm.js internals). Requires Playwright + non-Latin input keyboard layouts; not practical in this pass. Tracking issue territory.
- **E.6** — `audit.fix` ergonomics. Plan says "hold for now" until Plan #11 consumer surface stabilizes.
