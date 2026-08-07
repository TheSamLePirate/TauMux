---
title: plan.*
description: set, update, complete, clear, list — the sidebar plan panel.
---

Multi-step plans rendered in the sidebar [plan panel](/features/plan-panel/).
Plans are keyed by `(workspace_id, agent_id)`, so several agents can publish
independent plans into the same workspace. Claude Code's native task list is
mirrored here automatically — see the
[Claude Code integration](/integrations/claude-code/#task-list-mirror).

| Method | Params | Result |
|---|---|---|
| `plan.set` | `{ workspace_id?, agent_id?, steps: PlanStep[] }` | the stored `Plan` |
| `plan.update` | `{ workspace_id?, agent_id?, id: string, title?, state? }` | the updated `Plan`, or `null` when the plan/step is unknown |
| `plan.complete` | `{ workspace_id?, agent_id? }` | the `Plan` with every step `done` |
| `plan.clear` | `{ workspace_id?, agent_id? }` | `{ cleared: boolean }` |
| `plan.list` | `{}` | `{ plans: Plan[] }` |

**`PlanStep`**

```ts
{ id: string; title: string; state: "waiting" | "active" | "done" | "err";
  description?: string }
```

`description` is optional longer context, rendered as a hover tooltip on the
step row (used by the Claude Code task mirror to carry `task_description`).

**Workspace resolution** — `workspace_id` (or `workspace`) wins; otherwise the
workspace owning `surface_id` is used. Inside a τ-mux pane `HT_SURFACE` is
exported, so the CLI resolves it for free. Calls that cannot resolve a
workspace throw.

`plan.set` normalises input: unknown `state` values become `waiting`, duplicate
step ids collapse (last wins), and titles are trimmed. Steps that are not an
array are rejected.

See [`ht plan`](/cli/plan/).
