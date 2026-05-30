# Tracking — C3: graceful persistence on macOS GUI quit

Source: `doc/full_app_review_2026-05.md` §4.1 (last remaining CRITICAL).

## Problem

`gracefulShutdown` (the synchronous-save block: `saveLayout`,
`settingsManager.saveNow`, `browserHistory.saveNow`, `cookieStore.saveNow`,
RPC-token unlink, `sessions.destroy`, `telegramService.stop`,
`telegramDb.close`) was only wired to `process.on("SIGINT"|"SIGTERM")`.

On macOS, GUI quits — window-close button, ⌘Q (menu Quit), Dock → Quit, and
the programmatic close after the last surface exits — all go through
Electrobun's `quit()` → native `forceExit(0)` and **never deliver
SIGINT/SIGTERM**. So on the dominant exit paths none of that persistence ran:
a split/rename/cwd change, a settings tweak made right before quitting,
freshly-set cookies, and browser history were silently dropped.

## Fix

In `src/bun/index.ts`:

1. Extracted the synchronous save+close block from `gracefulShutdown` into a
   standalone `persistAndCloseSync(): void`, guarded by a module-level
   `let syncTeardownDone = false` so it runs **at most once** (first caller
   wins; a second call — SIGINT racing `before-quit`, or vice-versa — is a
   no-op, so the JSON saves never double-run).
2. `gracefulShutdown` now calls `persistAndCloseSync()` after its async
   `forceLayoutSync` round-trip, then `clearTimeout(hardExit); process.exit(0)`.
3. Added `Electrobun.events.on("before-quit", () => persistAndCloseSync())`.
   `before-quit` fires **synchronously** inside `quit()` before the native
   `forceExit`, so synchronous persistence completes there. The async
   `forceLayoutSync` can't run in that window, but the webview's debounced
   `workspaceStateSync` keeps `app.workspaceState` within ~100 ms of current,
   so `saveLayout()` is accurate without it.
4. `telegramService?.stop()` became fire-and-forget (`void`) in the sync path —
   `stop()` only aborts the long-poll; the flush that matters is
   `telegramDb.close()`, which is synchronous.

Imported the `Electrobun` default export alongside the existing named imports
from `electrobun/bun`.

## Verification

- `bun run typecheck` — clean.
- `bun run lint` — clean (0).
- `bun test tests/index-shutdown.test.ts` — 12 pass. Extended the existing
  source-guard suite with a `[C3]` block asserting: `persistAndCloseSync`
  exists + is idempotent; it persists every durable store; `before-quit` is
  subscribed; `gracefulShutdown` still delegates to it.
- `bun test` — 3003 pass / 0 fail.
- `bun start` — launches clean (socket listening, surface spawned, no errors).

## Deviations / notes

- The persistence is asserted by source inspection rather than a live quit
  integration test: `persistAndCloseSync` is module-private, closes over
  process singletons, and calls `process.exit()`. Spawning the packaged app
  and driving a real ⌘Q is out of scope for the unit suite; the source guards
  catch the regression we care about (dropping the `before-quit` subscription
  or stopping a durable save).
- No new SIGINT/SIGTERM behavior — those paths are unchanged and now share the
  same extracted function.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
