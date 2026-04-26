# Plan 09 — Plan panel in τ-mux: agent plan + auto-continue

## Source quote

> # Plan handled by t-mux
> agent sent the plan to t-mux (plan panel)
> on turn end, a small fast model — or an automation Say, based on
> plan update: Ok, continue M3, or OK, continue if the plan is not
> finished
> If it is a small fast model, it can maybe be more granular

## Goal

When an agent (Claude Code, pi, custom) maintains a multi-step plan
(M1: explore, M2: code, M3: test, M4: commit), τ-mux should:

1. Render the plan in a dedicated **Plan panel** — a new pane kind
   like the agent / telegram panes, or a sidebar widget — instead of
   each agent owning its own UI scribbled into the terminal.
2. On turn end, a small fast model decides **whether to auto-continue**
   the agent without bothering the user, e.g. send `Continue M3` to
   the surface so the agent picks up the next step.

This collapses the busy-work where the user is just clicking
"Continue" between every plan step.

## Two halves

### A. Plan panel (rendering)

#### Source of plan data

Two ingestion paths:

1. **`ht plan` CLI** — agent shells run e.g.
   ```
   ht plan set --workspace W --agent claude:1 --json '[
     {"id":"M1","title":"Explore code","state":"done"},
     {"id":"M2","title":"Implement fix","state":"active"},
     {"id":"M3","title":"Run tests","state":"waiting"},
     {"id":"M4","title":"Commit","state":"waiting"}
   ]'
   ht plan update M2 --state done
   ht plan complete  # or ht plan reset
   ```
2. **Status-key bridge** — re-uses Plan #02's `plan_array` renderer.
   Useful for one-off / tiny plans without a dedicated agent pane.

Internally, both paths land in a single `PlanStore` keyed by
`(workspaceId, agentId)`. The store emits diffs to the webview /
web mirror.

#### Panel UI

Per-step row:
- Status icon (●○✓✗) coloured by state.
- Step `M1` label + title.
- Optional inline progress bar / sub-tasks.
- Click step → highlight the originating agent surface; double-click
  → focus / scroll to that agent.

Position options:
- Sidebar widget (above the workspace card) — default.
- Docked pane like Telegram (`plan:` surface ID prefix), opt-in via
  ⌘⌥R or settings.

#### Files

- `src/bun/plan-store.ts` (new) — in-memory store + serialisation.
- `src/bun/rpc-handlers/plan.ts` (new) — `plan.set | plan.update |
  plan.complete | plan.list` RPCs.
- `src/views/terminal/plan-panel.ts` (new) — rendering.
- `src/views/terminal/sidebar.ts` — embed the widget.
- `bin/ht plan ...` — CLI subcommand.
- `src/shared/types.ts` — `Plan`, `PlanStep` types.
- `doc/system-plan-panel.md` (new).

### B. Auto-continue model

#### Decision input

After every "agent turn end" event (Claude `Stop` hook, pi end-of-turn
notification), gather:

- Plan (steps + states) for that agent.
- Last N lines of the agent surface (via `surface.read_text`).
- The notification message (e.g. "completed M2").

#### Decision policy

Three implementations, ordered by complexity:

1. **Heuristic (no model)**:
   - If plan has any `waiting` or `active` step beyond the most-recently
     `done` one → auto-continue.
   - If the surface tail contains "?" within the last 5 lines (likely
     a question) → don't auto-continue.
   - If notification text contains "error" / "failed" → don't.
2. **Small fast model** (e.g. Haiku 4.5 or local llama.cpp):
   - Prompt with plan + surface tail + notification.
   - Output: JSON `{action:"continue"|"wait", reason:"…", instruction:"Continue M3"}`.
   - Fall back to heuristic on model error.
3. **Both** — heuristic gates a model call; only invoke model when
   heuristic is "uncertain" (e.g. ambiguous turn end), saving tokens.

`AppSettings.autoContinue.engine`: `off | heuristic | model | hybrid`.
`AppSettings.autoContinue.modelProvider`: `anthropic | local | …`.
`AppSettings.autoContinue.dryRun`: log the decision but don't send.

#### Action

- If `continue` → `surface.send_text {surface_id, text: instruction + "\n"}`.
- Always log the decision + reason to the sidebar (level=info,
  source=`autocontinue`).
- Audit: store last 50 decisions in memory for the user to inspect.

#### Safety

- Per-agent counter: max N consecutive auto-continues without user
  intervention (default 5). Beyond that, surface a "auto-continue
  paused — agent looped" warning.
- Cooldown: ≥3 s between auto-sends to the same surface.

### Files (auto-continue)

- `src/bun/auto-continue.ts` (new) — engine.
- `src/bun/rpc-handlers/agent.ts` — emit `agent.turnEnded` events.
- `src/views/terminal/sidebar.ts` — show audit log.
- `src/shared/settings.ts` — settings.

## Tests

- `tests/plan-store.test.ts` — set/update/complete + diffs.
- `tests/auto-continue-heuristic.test.ts` — table of (plan,
  surfaceTail, expectedAction).
- `tests/auto-continue-model.test.ts` — mock LLM client.
- `tests/auto-continue-safety.test.ts` — counter / cooldown.

## Risks / open questions

- Adoption needs the agent integrations (Claude / pi) to actually call
  `ht plan ...`. Plan: ship a tiny shareBin parser that detects
  Claude's "## Plan" block in chat output and auto-publishes to
  `ht plan`.
- Auto-continue must not act on a notification meant for another
  surface. Always require an explicit `surface_id` in the turn-end
  event.
- Local LLM dependency is heavy. Default config: heuristic only.
  Anthropic provider is opt-in with API key in settings.

## Effort

L — plan panel ~1 day; CLI + RPC ~half day; auto-continue heuristic
~half day; model integration ~1 day; tests + docs ~1 day. Total
~4–5 days.

## Out of scope

- Editing plans in-UI (drag-reorder, rename steps). v1 is read-only;
  agents own the source of truth.
