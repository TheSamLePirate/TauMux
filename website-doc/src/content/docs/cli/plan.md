---
title: Plan
description: ht plan — publish, update, and inspect agent plans surfaced in the τ-mux plan panel.
sidebar:
  order: 11
---

`ht plan` is the agent's side of the [plan panel](/features/plan-panel/). The agent publishes a step-by-step plan (Explore → Implement → Test → Commit), keeps step states current, and the τ-mux sidebar widget renders it live for the user. Each plan is keyed by `(workspaceId, agentId?)` so multiple agents in the same workspace stay isolated.

## Step states

| State | Glyph | Meaning |
|---|---|---|
| `done` | `✓` | Step finished. |
| `active` | `●` | Step in progress (one per plan, conventionally). |
| `waiting` | `○` | Not yet started. |
| `err` | `✗` | Step failed; agent should report. |

The CLI prints these glyphs colourised when stdout is a TTY.

## plan list

```bash
ht plan list
ht plan list --json
```

Prints every active plan in the bun-side `PlanStore`. Without `--json`, each plan renders as:

```
ws:5  claude:1
  ✓  M1       Explore code
  ●  M2       Implement fix
  ○  M3       Run tests
  ○  M4       Commit
```

## plan set

```bash
ht plan set --workspace ws:5 --agent claude:1 --json '[
  {"id":"M1","title":"Explore","state":"done"},
  {"id":"M2","title":"Implement","state":"active"},
  {"id":"M3","title":"Test","state":"waiting"},
  {"id":"M4","title":"Commit","state":"waiting"}
]'
```

Replaces the plan for `(workspaceId, agentId?)`. Steps come in as a JSON array; each entry needs at minimum `id` and `title` (state defaults to `waiting`). Re-issuing `set` is the canonical way to **rewrite** a plan — `update` only patches one step at a time.

| Flag | Purpose |
|---|---|
| `--workspace <id>` | Target workspace. Optional inside a τ-mux pane (the server resolves the workspace from `HT_SURFACE`); required from a non-pane shell, or pass `HT_WORKSPACE_ID`. |
| `--agent <id>` | Optional. Lets multiple agents in the same workspace own separate plans. |
| `--json '<steps>'` | The full step array (required). |

The CLI parses your JSON locally and forwards verbatim — invalid JSON exits non-zero with a parse error before hitting the socket.

## plan update

```bash
ht plan update M2 --workspace ws:5 --agent claude:1 --state done
ht plan update M2 --workspace ws:5 --title "Implement fix v2"
ht plan update M3 --workspace ws:5 --state active
```

Patch a single step. `--state` accepts `done|active|waiting|err`. `--title` replaces the step title. Either or both can be passed.

When the named step doesn't exist, the CLI prints `(no plan)` — not an error, just a signal the patch missed. `update` against a stale plan never crashes.

## plan complete

```bash
ht plan complete --workspace ws:5 --agent claude:1
```

Mark every step `done` in one call. Useful as the agent's "I'm finished" signal — combined with `plan clear` it gives scripts a clean finish-and-tear-down path:

```bash
trap 'ht plan complete' EXIT   # inside a τ-mux pane, no flags needed
```

## plan clear

```bash
ht plan clear --workspace ws:5 --agent claude:1
```

Drop the plan entirely. Returns:

- `ok (plan removed)` — the plan existed and was removed.
- `(no plan to clear)` — nothing was registered for that key.

## Status-key bridge

`ht set-status` keys whose name contains "plan" and whose value is a JSON array of `{id, title, state}` objects are **automatically mirrored** into the typed `PlanStore` — agents already publishing checklists via the [smart status-key system](/features/sidebar/) light up the plan panel for free, no `ht plan` calls required:

```bash
ht set-status build_plan '[{"id":"compile","title":"Compile","state":"active"}]'
# → both the sidebar smart-key renderer AND the plan panel update.
```

The bridge derives the plan's `agentId` from the surface (`status:<surfaceId>`) so each surface gets its own plan card.

## Environment

| Variable | Purpose |
|---|---|
| `HT_SURFACE` | Auto-set in τ-mux panes. The server resolves the owning workspace from it, so `--workspace` is optional inside a pane. |
| `HT_WORKSPACE_ID` | Optional explicit override. **Not** auto-set — export it manually if you want a non-pane shell to default to a specific workspace. |

## Read more

- [Plan panel feature overview](/features/plan-panel/)
- [Auto-continue engine](/features/auto-continue/) — uses the published plan to decide when to send `Continue` automatically.
- [`ht autocontinue`](/cli/autocontinue/) — driver for the engine.
