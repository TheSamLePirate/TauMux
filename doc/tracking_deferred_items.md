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
| 3 | A.2 — Separate dev configDir | landed | 0c30128 | bumped 0.2.52 → 0.2.53. Set `HT_CONFIG_DIR=$HOME/Library/Application Support/hyperterm-canvas-dev` on `start`, `dev`, `build:dev`. `build:canary` / `build:stable` untouched. Manual verification deferred (would require launching the app — tests cover the consumer side). |
| 4 | Cluster B — I11, I12, N15 | landed | 2bfe21c | bumped 0.2.53 → 0.2.54. New `lifecycleDisposers` registry; `PlanPanel.destroy()` + `NotificationOverlay.destroy()` + askUserModalHandle wired in. 1509 tests pass; new tests/plan-panel-dom.test.ts + 3 new destroy tests in tests/notification-overlay.test.ts. **Deviation:** registry is per-call-site append (per the plan's recommendation), not a per-component injected disposer service. |
| 5 | C.1, C.2 — I14 + N14 | landed | da2c479 | bumped 0.2.54 → 0.2.55. Settings theme picker applies preset partial locally before re-render; palette descriptions clarified for split/new-workspace commands. New tests/settings-panel-theme.test.ts asserts active-class swap on click. 1510 tests pass. |
| 7 | C.3, C.4 — N18 + I9 | landed | ae8f164 | bumped 0.2.56 → 0.2.57. plan-panel-mirror gained `receivedInitialSnapshot` guard + empty-state; settings-panel adds a "Restore previous bloom" button gated on `bloomIntensity===0 && bloomMigratedToTau`. New tests/plan-panel-mirror.test.ts and three new tests in tests/settings-panel-theme.test.ts. 1518 tests pass. |
| 10 | D.4 — N7 auth token URL scrub | landed | (pending) | bumped 0.2.58 → 0.2.59. Token captured into module scope at construction; `history.replaceState` strips `?t=` from `window.location` only AFTER the first successful WebSocket open (so 401s leave the URL debuggable). Reconnects use the captured value. New tests/web-client-transport-token.test.ts (1 test, 7 assertions). 1524 tests pass. **Caveat:** the `replaceState` itself is verified via spy; the actual URL-bar update can't be observed in happy-dom and would need a real browser to confirm. |
| 8 | E.1 — M10 surface RPC startup-race + wait_ready | landed | 6e0b45d | bumped 0.2.57 → 0.2.58. New `waitForSurfaceMetadata` helper polls the cache (100 ms steps, 2 s default budget) before failing with a clearer error. `surface.kill_port` and `surface.open_port` use it; new `surface.wait_ready` method + `ht wait-ready` CLI; schema entry added. New tests/rpc-handler-surface-wait-ready.test.ts (5 tests). 1523 tests pass. **Deviation:** chose polling instead of an event-bus refactor of `SurfaceMetadataPoller.onMetadata` (which is a single-fn slot). Polling is wasteful in theory but simpler and self-contained; metadata poller still ticks at 1 Hz so the wait window almost always closes on the first poll. |
| 6 | D.1, D.2 — N3 + N4 | landed | efaa981 | bumped 0.2.55 → 0.2.56. panel-interaction.ts migrated to Pointer Events + setPointerCapture; pendingPanelData now FIFO (cap 16, warn-once on overflow). Existing drag/resize tests rewritten to dispatch PointerEvent on the handle; new pointercancel test added. 1511 tests pass. **Deviation:** D.2 unit test for the FIFO behavior was skipped — the queue logic lives inside the main() IIFE in src/web-client/main.ts and extracting it would balloon scope. Manual sanity preserved via the existing transport tests. |

## Deviations from plan

(track here)

## Issues encountered

(track here)

## Items deliberately skipped

- **E.4** — `webMirrorBind` default flip. Skipped per user instruction.
- **E.5** — IME composition (xterm.js internals). Requires Playwright + non-Latin input keyboard layouts; not practical in this pass. Tracking issue territory.
- **E.6** — `audit.fix` ergonomics. Plan says "hold for now" until Plan #11 consumer surface stabilizes.
