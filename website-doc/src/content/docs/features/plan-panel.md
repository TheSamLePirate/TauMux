---
title: Plan panel
description: A typed, sidebar-rendered view of every active agent plan — kept in lockstep with `ht plan` calls and surfaced live in both the native UI and the web mirror.
sidebar:
  order: 12
---

When an agent (Claude Code, pi, a custom script) maintains a multi-step plan — Explore → Implement → Test → Commit — τ-mux renders that plan in a dedicated sidebar widget rather than each agent scribbling it into its terminal output. The widget is read-only by design: the agent owns the plan, the panel shows it.

## What it does

- **One source of truth.** Plans live in the bun-side `PlanStore`, keyed by `(workspaceId, agentId?)`. `ht plan set` / `update` / `complete` / `clear` mutate it; the panel listens via the `restorePlans` push channel.
- **Step states with glyphs.** Each step renders as `✓ done` · `● active` · `○ waiting` · `✗ err`. Active steps animate so the user sees progress at a glance.
- **Click to focus.** Clicking a plan card switches to the originating workspace.
- **Audit ring.** Every [auto-continue](/features/auto-continue/) decision (fired / dry-run / skipped / paused / resumed) appears below the plan. Cap 50 entries in memory, debounced 100 ms over the wire.
- **Web mirror parity.** The same panel renders in the [web mirror](/features/web-mirror/), reading `plansSnapshot` and `autoContinueAudit` envelopes off the WebSocket.
- **Status-key bridge.** Agents publishing plan-shaped checklists via `ht set-status <key-with-"plan"> '<json-array>'` light up the panel **without changing their publishing code** — the smart-key sidebar rendering keeps working too.

## Quick example

```bash
# Inside a τ-mux pane HT_SURFACE is auto-set, so the workspace is
# resolved server-side — no --workspace flag needed.
ht plan set --agent claude:1 --json '[
  {"id":"M1","title":"Explore","state":"active"},
  {"id":"M2","title":"Implement","state":"waiting"},
  {"id":"M3","title":"Test","state":"waiting"},
  {"id":"M4","title":"Commit","state":"waiting"}
]'

# As work progresses:
ht plan update M1 --state done
ht plan update M2 --state active

# When done:
ht plan complete
ht plan clear

# From outside τ-mux, pass --workspace explicitly:
#   ht plan set --workspace ws:5 --json '[…]'
```

The sidebar widget shows the card the moment `set` lands; updates animate in 100 ms after each `update`.

## Anatomy of a plan card

```
ws:5  claude:1                       ← header (workspace · agent)
0/3 done · 1 active                  ← progress summary
●  M1   Explore                      ← step rows
○  M2   Implement
○  M3   Test
AUTO-CONTINUE · LAST 3               ← audit ring header
fired      next plan step: M2
skipped    cooldown — 1842ms
dry-run    would continue: M2
```

Empty plans are hidden — when nothing is published in any workspace, the native panel collapses to zero height.

In the [web mirror](/features/web-mirror/) the agent-plans widget instead renders a **"No active agent plans"** placeholder once the first `plansSnapshot` envelope arrives — even if it's empty. This way users discover the widget exists before any agent posts a plan, rather than waiting in vain for it to appear.

## How the bridge works

The status-key smart system (Plan #02) renders any `ht set-status` value with a known kind (`pct`, `lineGraph`, etc.). Plan #09 commit C adds a tap on that pipeline:

1. `ht set-status build_plan '[…steps…]'` lands in bun's dispatch.
2. The smart-key sidebar broadcast fires unchanged.
3. The `planStatusBridge` inspects the same payload — if the key contains "plan" and the value parses as a JSON array of `{id, title, state?}` objects, it calls `PlanStore.set` with `agentId: status:<surfaceId>`.
4. The plan panel re-renders.

The match is intentionally narrow (key name must contain "plan", value must be a JSON-string array). Anything outside that contract passes through silently.

| Use this if | … |
|---|---|
| You're writing a new agent | Call `ht plan set` directly — typed, attribution-aware, supports multiple agents per workspace. |
| You have an agent that already emits status keys | Rename the key to include "plan" and use the right payload shape — both the sidebar and the panel light up. |

## How auto-continue uses the plan

The [auto-continue engine](/features/auto-continue/) reads the most-recently-updated plan in the surface's owning workspace on every turn-end notification. The heuristic decides:

- Plan has any `waiting` or `active` step → continue (`Continue M3`-style instruction).
- Every step `done` → wait (the agent finished).
- No plan published → wait (no anchor; ambiguous).

A confident wait blocks; an ambiguous wait can escalate to the model in `hybrid` mode. The audit ring on the panel reflects each decision.

## Source files

- `src/bun/plan-store.ts` — keyed in-memory store; `set` / `update` / `complete` / `clear` / `list` / `subscribe`.
- `src/bun/rpc-handlers/plan.ts` — `plan.*` JSON-RPC handlers.
- `src/bun/plan-status-bridge.ts` — `plan_array` translator.
- `src/shared/plan-panel-render.ts` — pure HTML helpers shared by native + mirror.
- `src/views/terminal/plan-panel.ts` — native sidebar widget.
- `src/web-client/plan-panel-mirror.ts` — web-mirror rendering.
- `bin/ht plan` — CLI entry point.
- `tests/plan-store.test.ts`, `tests/plan-panel-renderer.test.ts`, `tests/auto-continue-bridge.test.ts` — unit coverage.

## Read more

- [`ht plan` CLI reference](/cli/plan/) — every subcommand with examples.
- [Auto-continue](/features/auto-continue/) — the engine that reads plans and decides whether to send `Continue`.
- [`ht autocontinue` CLI reference](/cli/autocontinue/) — driver for the engine.
