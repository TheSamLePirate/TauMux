# Tracking — H14: test the metadata poller `tick()` orchestration

Source: `doc/full_app_review_2026-05.md` §5.2 (H14, high).

## Problem

`SurfaceMetadataPoller.tick()` — the 1 Hz orchestration that filters surfaces,
evicts dead snapshots, computes process trees + foreground pid, unions the
port/cwd lookups, resolves git/pkg/cargo (TTL-cached), prunes on empty, evicts
stale gitCache entries, and makes the emit decision — had **zero** coverage.
Tests covered only the pure parsers (`parsePs`, `parseListeningPorts`, …)
because the subprocess runners were module-private and not injectable.

## Fix

### Production seam — `src/bun/surface-metadata.ts`

- Exported a `MetadataRunners` interface (`runPs` / `runListeningPorts` /
  `runCwds` / `runGit`).
- Added an optional 3rd constructor param `runners: MetadataRunners` that
  **defaults to the real module functions** (function declarations, hoisted, so
  the default is safe to evaluate at construction). Zero behavior change in
  production — the default path is identical to before.
- Routed the four call sites in `tick()` / `resolveGit()` through
  `this.runners.*`.
- Added a `runTickForTest(): Promise<void>` seam that runs exactly one tick and
  awaits it (production drives ticks via the `start()` interval).

### Coverage — `tests/surface-metadata-tick.test.ts` (new, 11 tests)

Drives `tick()` with canned runner fixtures + a fake `SessionsLike`:

- **emit on change** — first tick builds a full snapshot (pid/fg/cwd/tree/
  ports/git) and emits; a stable second tick does **not** re-emit; a changed
  foreground command re-emits.
- **cpu/rss delta gate (H7/5.1)** — a sub-threshold cpu wiggle (<1.0 pt) does
  not re-emit; a ≥1.0 pt jump does; a ≥4 MiB rss jump re-emits.
- **lifecycle & pruning** — a disappeared surface has its cached snapshot
  evicted; pid-less surfaces are skipped; `runPs → null` aborts without
  emitting; **no live surfaces → early return before `ps` is even spawned**.
- **git TTL + multi-repo** — git resolves once per distinct cwd in a tick
  (parallel multi-repo); the result is TTL-cached so the next tick (within the
  3 s TTL) does not re-probe.

## Verification

- `bun run typecheck` — clean. `bun run lint` — 0.
- `bun test tests/surface-metadata-tick.test.ts` — 11 pass.
- `bun test` — 3021 pass / 0 fail (was 3010; +11).
- `bun start` — boots clean; the default-runner path (real ps/lsof/git) drives
  the live poller with no `[metadata] tick failed` errors.

## Deviations / notes

- Scoped the injection to the four subprocess runners exactly as the review
  proposed. The `pkgScanner`/`cargoScanner` manifest singletons are left as-is —
  they `existsSync`-guard before reading, so synthetic test cwds resolve to
  `null` deterministically without needing their own seam.
- Pure-parser tests stay in `surface-metadata.test.ts`; this file is
  orchestration-only.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
