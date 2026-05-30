# Tracking — H12: delete dead PiAgentInstance request/response machinery

Source: `doc/full_app_review_2026-05.md` §10.3 (H12, high).

## Problem

`PiAgentInstance` carried a Promise-based `send()` (id-injected, timeout-armed,
correlated via a `responseWaiters` map + `reqCounter`) plus ~25 typed wrappers
(`prompt`, `abort`, `getState`, `setModel`, `compact`, `fork`, `exportHtml`,
`bash`, …). **Nothing called any of it.** Every one of the ~28 agent handlers in
`webview-handlers/agent.ts` uses `sendNoWait`; pi's `response` events are
correlated in the webview by the command's own `type`, never by the injected
`id`. So `responseWaiters`, `reqCounter`, the per-request timeouts, the
id-correlation branch in `handleMessage`, and the waiter-drain loops in `start()`
and `kill()` existed only to serve `send()` — ~200 lines of intricate async
plumbing that looked load-bearing but wasn't. A test poked `responseWaiters`
just to keep it "covered."

## Fix — option (a): delete (the review's lower-risk path)

`src/bun/pi-agent-manager.ts`:

- Removed `send()`, the `responseWaiters` map, and `reqCounter`.
- Removed all 23 `send()`-based wrappers (`prompt`, `abort`,
  `getAvailableModels`, `setModel`, `setThinkingLevel`, `getState`,
  `getSessionStats`, `compact`, `newSession`, `bash`, `cycleModel`,
  `cycleThinkingLevel`, `getCommands`, `getForkMessages`,
  `getLastAssistantText`, `setSteeringMode`, `setFollowUpMode`,
  `setAutoCompaction`, `setAutoRetry`, `setSessionName`, `switchSession`,
  `fork`, `exportHtml`).
- Simplified `handleMessage` to a single `this.onEvent?.(msg)` forward (dropped
  the dead id-correlation branch).
- Simplified the `start()` exit handler and `kill()` — both dropped the
  now-impossible waiter drain.

**Kept** (all `sendNoWait`-based and live, or lifecycle):
`start`, `sendNoWait`, `respondToExtensionUI`, `steer`, `followUp`, `abortBash`,
`abortRetry`, `kill`, `isAlive`, plus `onEvent`/`onExit`/`_managerExit` and the
stdout/stderr readers. `respondToExtensionUI`/`abortBash`/`abortRetry` are
called from `webview-handlers/agent.ts`; `steer`/`followUp` are kept public per
the review.

**Net: pi-agent-manager.ts 610 → 411 lines (−199).**

## Verification

- `bun run typecheck` — clean (no dangling references; confirmed nothing outside
  the file referenced `send`/`responseWaiters`/`reqCounter` or any deleted
  wrapper before removal).
- `bun run lint` — 0.
- `bun test` — 3010 pass / 0 fail.
- `bun start` — boots clean; agent surface path (createAgent → start →
  sendNoWait handlers) intact.

## Test + catalogue updates

- `tests/pi-agent-manager.test.ts` — the "kill() drains pending response
  waiters" test poked the now-removed private map; replaced with "kill() before
  start() marks the instance dead without throwing" (idempotency + pre-start
  crash-safety, the kill() contract that survives).
- `tests/regressions/README.md` L10 + `doc/feature_upgrade_to_AAA/
  phase0_audit_matrix.md` — re-pointed the catalogue row (gated by
  `catalogue.test.ts`) to the new test name and noted H12 removed the drained
  machinery.

## Deviations / notes

- `steer`/`followUp` are themselves not currently called externally (the webview
  steers via raw `sendNoWait`), but they're `sendNoWait`-based public API the
  review explicitly listed as keepers and are out of the `send()`-machinery
  scope this finding targets — left in place.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
