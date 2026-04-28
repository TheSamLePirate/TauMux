# Tracking — Perf pass merge (Commit D): codex non-conflicting wins

**Plan**: `~/.claude/plans/doc-todos-index-md-doc-todos-plan-user-prancy-island.md`
**Sister tracking**: [`tracking_perf_pass_a.md`](tracking_perf_pass_a.md) ·
[`tracking_perf_pass_b.md`](tracking_perf_pass_b.md) ·
[`tracking_perf_pass_c.md`](tracking_perf_pass_c.md)
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this commit

Pure-additive cherry-pick from a parallel worktree
(`/Users/olivierveinand/.codex/worktrees/4929/crazyShell`) where
codex tackled the same perf brief. This first merge commit takes
the things with **zero overlap** with my Phases 1–4:

1. `src/bun/native-stdout-coalescer.ts` — 8 ms / 8 KB coalescer
   for the bun → webview RPC `writeStdout` path. The web mirror
   already had its 16 ms `OUTPUT_COALESCE_MS` coalescer; the
   native bridge had none. Now both transports batch.
2. CSS containment + compositor hints on `.surface-container`,
   `.panel`, `.terminal-effects-layer`. Limits layout/paint
   invalidation scope; helps the GPU put bloom + panels on their
   own layers.
3. Test stability: replaces fixed `Bun.sleep` waits with
   condition-based polling in `tests/web-coalescer`,
   `tests/web-server`, `tests/hardening-extra`. Resolves the 5–7
   flaky web-mirror failures that the previous three perf
   commits had to excuse as "pre-existing."

## Step-by-step progress

- [x] Copy `src/bun/native-stdout-coalescer.ts` from codex tree
      (69 LOC, push / flushSurface / flushAll / dispose with timer
      coalescing).
- [x] Copy `tests/native-stdout-coalescer.test.ts` (56 LOC, 7
      cases covering coalesce window, soft cap, multi-surface
      separation, flush ordering).
- [x] Wire `NativeStdoutCoalescer` into `src/bun/index.ts`:
      - `sessions.onStdout` pushes via the coalescer (still
        broadcasts to web mirror eagerly — different transport).
      - `flushSurface` called before every `sidebandMeta` /
        `sidebandData` / `sidebandDataFailed` / `surfaceClosed` /
        `surfaceExit` so a final burst lands before the
        downstream UI sees the new event.
      - `dispose()` called in `gracefulShutdown()` so a final
        flush happens during clean exit.
- [x] Add `contain: layout paint style` to `.surface-container`.
- [x] Add `transform: translateZ(0)` + `will-change: opacity` to
      `.terminal-effects-layer`.
- [x] Add `contain: layout paint style` + `will-change:
      transform, opacity` to `.panel`.
- [x] Replace `await new Promise(r => setTimeout(r, 100))` style
      sleeps with a `waitFor(predicate, timeoutMs)` helper in the
      three test files (codex's pattern, copied verbatim).
- [x] `bun run typecheck` clean.
- [x] `bun test` (full) — **1457/1457 pass.** Up from 1448–1452
      with this commit's test stability fixes; the flaky
      web-mirror cases that had been excused as "pre-existing"
      are no longer flaky.

## Deviations from the plan

1. **Skipped codex's `optimisations.md`** — superseded by this
   tracking file + the per-commit tracking series.
2. **`gracefulShutdown` flushes via `nativeStdout.dispose()`**
   that codex's diff didn't include explicitly. Lifecycle
   correctness — without it, a SIGTERM during a fast-output
   stream would lose the in-flight batch.

## Issues encountered

None. Pure-additive merge; no overlap with my Phases 1–4.

## Verification log

| Run                                  | Result |
| ------------------------------------ | ------ |
| `bun run typecheck`                  | clean  |
| `bun test` (full)                    | 1457/1457 — first green run since perf pass started |

## Commits

(filled after commit lands)

## Carried over to follow-up commits

- Commit E: layout coalescer + browser-pane sync cache
  relocation (architectural).
- Commit F: TerminalEffects budget + panel.ts translate3d +
  agent-panel rAF stream batch (medium-sized additions).
