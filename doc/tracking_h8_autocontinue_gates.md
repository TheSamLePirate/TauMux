# Tracking — H8 (+10.2): auto-continue cost gates run before the model

Source: `doc/full_app_review_2026-05.md` §10.1 (H8, high) + §10.2 (medium).

## Problem

**H8 (§10.1):** In `auto-continue-engine.ts`, `model`/`hybrid` mode called the
paid Anthropic round-trip (`tryModel`) **before** the cooldown gate and the
runaway gate. So a chatty agent firing faster than `cooldownMs` made one billed
call per notification with *no* fire, and a runaway-latched agent (past
`maxConsecutive`) kept paying indefinitely — unbounded LLM cost on exactly the
runaway/chatty scenarios the engine exists to contain.

**10.2 (§10.2):** The runaway gate set `surfaceState.loopWarned = true` but
nothing ever read `loopWarned` (dead state, written in 4 places / read in 0),
and it re-emitted a fresh "paused — looped" audit entry on *every* notification.

## Fix

`src/bun/auto-continue-engine.ts` `dispatch()` reordered:

1. Run the heuristic (free, deterministic) — unchanged.
2. **Cooldown gate** — moved *before* any `tryModel`. On a hit: skip with the
   heuristic decision and `modelConsulted: false`. No billed call.
3. **Runaway gate** — moved *before* any `tryModel`. `loopWarned` now latches so
   the "paused — looped" audit fires **once per loop episode** (first trip goes
   through `record()`; subsequent trips return the skipped outcome directly,
   pushing no duplicate audit). `notifyHumanInput()`/`resume()` already clear
   `loopWarned`, so a genuine human intervention re-arms auto-continue and a
   fresh loop re-emits the warning. No billed call while looping.
4. **Only now** consult the model (`model`/`hybrid`), then the `wait` check,
   dry-run, and fire — all unchanged.

### Why option (b) for 10.2, not the latch-into-pausedSurfaces option (a)

The review offered either `this.pause()` on the runaway trip (durable latch) or
using `loopWarned` to de-dupe. Chose the latter: `pause()` adds the surface to
`pausedSurfaces`, but `notifyHumanInput()` only resets the counter — it does
*not* resume — so latching would have silently broken the existing
auto-recovery semantics (type-something → auto-continue resumes). H8 already
removes the *cost* harm of a looping surface (no more model call per turn), so
the residual 10.2 harm was purely audit-log spam + dead state, both fixed by the
de-dupe without changing recovery behavior.

## Verification

- `bun run typecheck` — clean.
- `bun run lint` — 0.
- `bun test tests/auto-continue-engine.test.ts` — 36 pass (30 + 6 new):
  cooldown-skips-without-model, runaway-skips-without-model, looped-audit-once,
  human-intervention-re-arms-warning.
- `bun test` — 3007 pass / 0 fail.

## Deviations / notes

- Cooldown/runaway audit entries now record the **heuristic** decision (not a
  model-overridden one) and `modelConsulted: false` — more honest, since the
  model is no longer consulted on those paths.
- Behavior is otherwise identical: same skip reasons, same fire path, same
  auto-recovery via `notifyHumanInput`.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
