# Tracking — §5.3: activity-adaptive idle backoff for the metadata poller

Source: `doc/full_app_review_2026-05.md` §5.3 (medium; flagged the review's #1
priority — idle CPU ≠ 0).

## Problem

As long as ≥1 surface existed, every 1 Hz tick ran `ps -axo` (over all ~900
system processes) + combined `lsof` even when metadata had been byte-identical
for minutes. The only throttle was 1 s → 3 s when `document.hidden`. Result:
sustained ~6–9 % of one core on an idle-but-focused terminal.

## Fix — `src/bun/surface-metadata.ts`

Replaced the fixed `setInterval` with a **self-rescheduling `setTimeout`** loop so
each tick picks its own next delay, and added an activity-adaptive cadence:

- `idleStreak` counts consecutive ticks that produced **no emit** and **no
  surface add/remove**. `effectiveInterval()` = `base × 2^min(streak,8)`, capped
  at `IDLE_POLL_CAP_MS` (5 s): 1 s → 2 s → 4 s → 5 s while idle.
- **Snap back to base** on any change — an emit, a pane open/close (tracked via a
  `lastLiveKey` signature of the live surface-id set), `setPollRate` (window
  visibility), or a tick error / no-surfaces / ps-failure (all reset to base so
  recovery and new surfaces stay prompt).
- `setPollRate` now sets the **base** rate (renamed `intervalMs` →
  `baseIntervalMs`), resets the streak, and fires a near-immediate tick when
  speeding up (window visible again) — same focus-return UX as before.
- `start`/`stop` reworked for the timeout model: a `running` flag guards
  re-entrant `start()`; `stop()` clears the pending timeout and resets streak +
  `lastLiveKey`. `scheduleNext()` always clears any pending timer first so a
  `setPollRate` racing an in-flight tick's reschedule can't leave two timers.

The active (non-idle) cadence is unchanged at 1 s, so a working terminal feels
identical; only a *stable* terminal coasts down to 5 s.

## Verification

- `bun run typecheck` — clean. `bun run lint` — 0.
- `bun test` — 3025 pass / 0 fail (+4 backoff tests in
  `tests/surface-metadata-tick.test.ts`): backoff 1→2→4→5 s cap; change snaps to
  base; pane open/close snaps to base with no emit; `setPollRate` rebases +
  resets the streak.
- Existing real-timer `integration-pipeline` + `hardening-extra` poller tests
  (start/stop/prune/multi-surface) still pass — the backoff ramps over seconds
  while those act within the first ~second, so first-emit/prune latency is
  unaffected.
- `bun start` — boots clean; self-rescheduling loop runs with no `tick failed`.

## Deviations / notes

- The new `tick()` test harness from H14 (injectable runners + `runTickForTest`)
  made this safe to land deterministically — the backoff is asserted via a new
  `peekNextDelayForTest()` seam rather than by sleeping.
- Caught a self-inflicted test bug pre-commit: the pane-open/close case
  initialized its `live` array with one surface instead of two, so there was no
  live-set change to detect; fixed the fixture.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
