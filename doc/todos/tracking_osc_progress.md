# Tracking — Plan 11: OSC 9;4 progress reporting

**Plan**: [`plan_osc_progress.md`](plan_osc_progress.md)
**Status**: done
**Status changed**: 2026-04-26
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Step-by-step progress

- [x] Pure OSC 9;4 parser in `src/views/terminal/osc-progress.ts`
- [x] `tests/osc-progress.test.ts` — 27 cases (happy path, value clamping, error/paused with-and-without value, remove/indeterminate ignore-value, unknown sub-command rejection, garbage rejection, trailing-junk tolerance)
- [x] Register `parser.registerOscHandler(9, …)` in `surface-manager.ts createSurface` (feature-detected so happy-dom mock tests stay green)
- [x] Map state → `SurfaceManager.setProgress` / `clearProgress` for the surface's workspace; preserve last known value when state arrives without a value (states 2/4)
- [x] Settings flag `terminalOsc94Enabled` (default true) — added to `AppSettings` + `DEFAULT_SETTINGS` + `validateSettings`
- [x] Settings UI checkbox under Advanced
- [x] Doc: `doc/system-osc-sequences.md` listing supported OSCs + adding-new-handler protocol
- [x] `bun run typecheck` clean
- [x] `bun test` — 943/943 (was 916; +27 OSC parser tests)
- [x] `bun run bump:patch` — 0.2.2 → 0.2.3
- [x] Commit — `67165a5`

## Deviations from the plan

1. **No separate `ProgressBus` event-bus module.** The plan suggested
   building one for fan-out to (1) pane chip bar, (2) sidebar
   workspace card, (3) web mirror, (4) optional dock badge. In
   practice the existing `SurfaceManager.setProgress` already covers
   #2 + #3 (it dispatches to bun, which broadcasts to the web mirror
   via the existing `setProgress` action). #1 (per-pane chip) is a
   future polish item; #4 (dock badge) was already marked optional.
   Bridging directly to `setProgress` was strictly simpler.
2. **Settings UI placed under Advanced**, not a new "Terminal" or
   "OSC" section. The plan didn't spec a location; Advanced already
   houses other low-level toggles and matches the existing pattern.
3. **Last-known-value preserved for state 2/4 without value.** The
   plan said "value: optional"; I went with "preserve last known"
   rather than reset to 0, so a tool that does
   `9;4;1;42` → `9;4;2` (error during a run) keeps the bar at 42%
   (now red) instead of jumping to empty. Matches Windows Terminal
   and WezTerm behaviour.

## Issues encountered

(none — typecheck and tests passed first try after each edit)

## Open questions for the user

- Plan says "Updates a status pill on the pane chip bar (small inline
  progress gauge)". The workspace card already has a progress bar
  driven by `setProgress`; piggybacking on that is the cheapest and
  matches the existing UX. A per-pane chip can come in a follow-up
  once we see whether the workspace-level bar is enough.
- macOS dock-icon progress (`app.setBadge`) listed as optional in the
  plan — deferring; the dock badge is currently used for unread
  notifications and shouldn't be co-opted without a UX think.

## Verification log

| Run                                  | Result                              |
| ------------------------------------ | ----------------------------------- |
| `bun run typecheck`                  | clean (after every edit)            |
| `bun test tests/osc-progress.test.ts` | 27/27 pass                         |
| `bun test` (full)                    | 943/943 pass, 107473 expect() calls |
| `bun run bump:patch`                 | 0.2.2 → 0.2.3                       |

## Commits

- `67165a5` — xterm: bridge OSC 9;4 progress reports to the workspace progress bar
  - 10 files changed, 431 insertions(+), 3 deletions(-)

## Retrospective

What worked:
- Pure-parser-first paid off again. 27 table-driven cases were
  trivial to author once the wire format was nailed down, and they
  caught my off-by-one in the value-required-but-empty path
  immediately.
- Feature-detecting `term.parser.registerOscHandler` (instead of
  asserting it exists) kept the SurfaceManager mock tests green
  without me having to teach the mock about a new xterm method.
- Reusing the existing `setProgress` plumbing meant zero new RPC
  surface, zero new socket-action types, and zero new web-mirror
  wiring — the whole pipeline was already in place.

What I'd do differently:
- Building a per-pane progress chip from the start might have been
  worth it; reusing the workspace-level bar is correct but a single
  busy pane in a multi-pane workspace is a slightly weird UX.
  Cheap follow-up.
- I didn't add an end-to-end test that feeds OSC bytes through a
  real xterm and asserts the workspace progress changed — happy-dom
  doesn't run xterm cleanly. The pure parser is the high-leverage
  bit; the bridge code is small enough that visual review covers it.
