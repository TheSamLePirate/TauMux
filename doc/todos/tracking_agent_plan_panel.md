# Tracking — Plan 09 (Commit A): PlanStore + RPC + ht plan CLI + heuristic auto-continue

**Plan**: [`plan_agent_plan_panel.md`](plan_agent_plan_panel.md)
**Status**: Commit A done; UI panel + LLM auto-continue deferred
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session — Commit A

Protocol layer + heuristic engine, all headless-testable.

Defer (for a Commit B):
- Panel UI rendering (sidebar widget + docked pane)
- LLM-backed auto-continue (Anthropic / local model providers)
- Settings UI for `autoContinue.engine`
- Webview wiring of `restorePlans` broadcast (the broadcast itself
  ships now, so the UI can land later without a protocol churn)

## Step-by-step progress

- [x] Types: `Plan`, `PlanStep`, `PlanStepState` in `src/shared/types.ts`
- [x] `src/bun/plan-store.ts`: keyed by `(workspaceId, agentId)`,
      `set` / `update` / `complete` / `clear` / `list`, subscribe
      channel with throw-isolation, normalisation in `set`
      (deduplicate ids, trim titles, default unknown states to
      `waiting`)
- [x] `tests/plan-store.test.ts` — 15 cases (set / normalisation /
      update / complete / clear / agent-vs-workspace scoping /
      subscribe / unsubscribe / throw-isolation / no-op clear)
- [x] `src/bun/auto-continue.ts`: pure `decideAutoContinue({plan,
      surfaceTail, notificationText})` → `{action, reason,
      instruction?}`. Decision tree: error guard → question guard
      → plan-step continue → all-done wait → no-plan wait. Reason
      strings clipped to ≤120 chars.
- [x] `tests/auto-continue.test.ts` — 14 cases covering every
      branch (error in notif / surface tail; question lookback
      capped at 5 non-blank lines; active-step preferred over
      waiting; first waiting picked when none active; all-done /
      err-only / no-plan / empty-plan all wait; reason length
      clipped; blank-line skip)
- [x] `src/bun/rpc-handlers/plan.ts`: `plan.set` / `plan.update` /
      `plan.complete` / `plan.list` / `plan.clear` — strict param
      validation, returns the freshest plan snapshot for caller
      confirmation
- [x] Wired `PlanStore` into `RpcHandlerOptions.plans`; aggregator
      only registers `plan.*` when wired (tests stay slim)
- [x] `bin/ht plan` — list (default) / set / update / complete /
      clear with TTY-aware ✓/●/○/✗ markers; help text expanded
- [x] Bun → webview broadcast `restorePlans: { plans: Plan[] }`
      (debounced 100 ms) + matching `plansSnapshot` web-mirror
      broadcast — UI consumers can land in Commit B without a
      protocol change
- [x] `bun run typecheck` clean
- [x] `bun test` — 1055/1055 (was 1026; +15 store + 14 heuristic)
- [x] `bun run bump:patch` — 0.2.10 → 0.2.11
- [x] Commit — `f72c275`

## Deviations from the plan

1. **Heuristic-only engine in v1.** Plan called for three options
   (heuristic / model / hybrid). Shipping just the heuristic keeps
   the code path total + zero external dependencies; LLM
   integration lands in Commit B with the matching settings. The
   heuristic is exposed as a pure function so any future
   model-backed engine can wrap or fall back to it.
2. **No turn-end wiring yet.** Plan referenced "Claude Stop hook /
   pi end-of-turn notification" → `agent.turnEnded` event →
   auto-continue dispatch. Commit A ships the *function* but not
   the wiring; the host that consumes it lands in Commit B
   alongside the safety counters (max consecutive auto-continues,
   per-surface cooldown).
3. **No status-key bridge from `plan_array`.** Plan called for it;
   the smart-key dispatcher already renders `plan_array` JSON
   nicely (Plan #02 commit A), and bridging would mean writing the
   parsed array back into `PlanStore`. Deferred until we see whether
   anyone wants the cross-publishing flow — for now the typed
   `ht plan` and the `plan_array` smart key serve different audiences
   and don't need to share state.
4. **`title` patches go through `update`** even though the plan
   only mentioned state changes. Cheap addition; lets agents fix
   typos without re-issuing the full plan.
5. **Reason strings clipped to ≤120 chars** to fit cleanly on a
   single sidebar log line. Plan didn't specify; this was a
   tactical choice to keep the audit trail readable.

## Issues encountered

(none — typecheck and tests passed first try after each edit;
formatter ran on multiple writes per the existing pattern)

## Open questions

- Plan suggested ingestion via Plan #02's `plan_array` status-key
  too. v1 ships only the typed `ht plan` path; the `plan_array`
  status key keeps working for ad-hoc one-offs since it goes
  through the smart-key dispatcher. Bridging the two would mean
  parsing `plan_array` JSON into a `Plan` and writing into the
  store; deferring until we see whether anyone wants the
  cross-publishing behavior.
- Plan calls for "agent turn end" events to drive the auto-
  continue decision. v1 exposes `decideAutoContinue` as a pure
  function; wiring it to the actual Claude Stop / pi turn-end
  hooks (and adding the cooldown / runaway counter) lands in
  Commit B alongside the engine settings.

## Verification log

| Run                                        | Result                              |
| ------------------------------------------ | ----------------------------------- |
| `bun run typecheck`                        | clean (after every edit)            |
| `bun test tests/plan-store.test.ts`        | 15/15 pass                          |
| `bun test tests/auto-continue.test.ts`     | 14/14 pass                          |
| `bun test` (full)                          | 1055/1055 pass, 107704 expect() calls |
| `bun run bump:patch`                       | 0.2.10 → 0.2.11                     |

## Commits

- `f72c275` — plan: typed PlanStore + ht plan CLI + heuristic auto-continue
  - 12 files changed; 5 new files (plan-store, auto-continue, rpc handler, 2 tests)

## Retrospective

What worked:
- Splitting Plan #09 into a protocol commit and a UI/engine commit
  meant I could ship the durable contract (types + store + RPC +
  CLI + broadcast) without blocking on the panel UI or the LLM
  provider story.
- Heuristic-as-pure-function lets the test suite cover every
  branch in 14 cases without spawning a process or mocking an API.
  Future Commit B's model-backed engine can wrap or fall back to
  this function unchanged.
- Reusing the existing `RpcHandlerOptions` shape (audits, health)
  for `plans` kept the wiring boilerplate at one line in the
  aggregator and one line at the bun bootstrap.
- The `restorePlans` broadcast lands a finished pipeline now —
  Commit B's panel just listens; no server-side wire change later.

What I'd do differently:
- The CLI's `plan set` requires a JSON-on-the-command-line for
  steps. For agents it's fine (they emit JSON), but for humans
  testing it's awkward. A future polish: `ht plan add <id> --title
  --state` to append one step at a time would round it out.
- I considered persisting plans to `~/Library/Application Support/
  hyperterm-canvas/plans.json` so they survive a restart. Skipped:
  agents that emit plans are mostly long-running anyway, and a
  restart often wants a clean slate. Trivial to add when needed.

Carried over to Commit B:
- Plan panel UI (sidebar widget + optional docked pane variant)
- Settings: `autoContinue.engine` (off / heuristic / model / hybrid)
- LLM provider integration (Anthropic / local) with safe fallback
  to heuristic on model error
- `agent.turnEnded` event wiring + per-surface cooldown +
  consecutive-auto-continue counter
- Status-key bridge (`plan_array` → PlanStore) — open to demand;
  parser is small if we go that way
