---
title: Auto-continue
description: A heuristic + optional LLM engine that decides whether to send `Continue` to an agent on every turn-end notification — with dry-run, cooldown, runaway protection, and a full audit ring.
sidebar:
  order: 13
---

Long-running agents — Claude Code, pi, custom shells — frequently produce a turn-end notification asking the user to type "Continue". When the user is paying attention this is fine; when they're not, the agent stalls. Auto-continue closes that loop: on every turn-end notification, the engine consults the agent's [published plan](/features/plan-panel/), the last few lines of the surface, and (optionally) a fast LLM, and decides whether to send `Continue` automatically.

## Safety posture

Three safety layers ship by default — an opt-in is two deliberate clicks.

1. **Engine off by default.** A fresh install never decides anything. You enable the feature in `Settings → Auto-continue → Engine`.
2. **Dry-run by default.** Even after enabling, the engine logs decisions to the audit ring without sending text. Flip `Dry run` off when you trust what you see.
3. **Per-surface guards.** A cooldown (default 3 s) prevents the engine from chattering at a fast agent; a runaway counter (default 5) pauses auto-continue if it fires that many times without intervening user input.

## Engine modes

| Mode | What happens |
|---|---|
| `off` | The engine never decides anything. |
| `heuristic` | Pure decision tree. No model call. Fast, free, deterministic. |
| `model` | Every turn-end consults the configured LLM (Anthropic Haiku 4.5 by default). Falls back to the heuristic on network / parse failure. |
| `hybrid` | Heuristic first; only call the model when the heuristic returns an ambiguous wait (no plan, no error, no question). Saves tokens vs always-on `model`. |

## The heuristic

A pure function (`decideAutoContinue` in `src/bun/auto-continue.ts`) that returns `{ action: "continue" | "wait", reason, instruction? }`:

1. **Error guard.** Notification text or surface tail mentions "error" / "failed" → wait.
2. **Question guard.** Surface tail (last 5 non-blank lines) ends with a `?` → wait. The agent is asking the user something.
3. **Active or waiting step.** Plan has an `active` step → emit `Continue <activeStep.id>`. Otherwise the first `waiting` step.
4. **All done / err only.** Every step `done` or `err` → wait. The agent finished.
5. **No plan published.** No anchor → wait. (In `hybrid` mode this is the case that escalates to the model.)

The heuristic never throws. Every reason is clamped to ≤120 characters so the audit ring stays readable.

## The model

When the engine runs in `model` or `hybrid` mode, it calls Anthropic's Messages API with a structured prompt:

```
Decide whether to auto-continue an agent's multi-step plan.
Respond ONLY as JSON; do not explain.
Schema: { action: 'continue'|'wait', reason: string, instruction?: string }

Plan steps:
- [done]    M1: Explore
- [active]  M2: Implement
- [waiting] M3: Test

Turn-end notification: implement done — running tests next?

Last lines of agent surface:
> ✓ all checks passed
> next: M3
```

The model returns JSON. Markdown fences are tolerated. Reason strings are clamped to 200 chars; instruction strings to 240. Any deviation from the contract makes the engine fall back to the heuristic — the user never sees a half-parsed model response.

API key is read from the env var named in `Settings → Auto-continue → API key env var` (default `ANTHROPIC_API_KEY`). Never written to `settings.json`.

## Settings

`Settings → Auto-continue` (between Telegram and Advanced).

| Field | Default | Notes |
|---|---|---|
| Engine | `off` | The mode toggle. |
| Dry run | `true` | Log decisions only; never sends text. |
| Cooldown (ms) | `3000` | Minimum gap between auto-fires on the same surface. Clamped 0–60000. |
| Max consecutive | `5` | Pause after this many fires without user input. Clamped 1–50. |
| Model name | `claude-haiku-4-5-20251001` | Any Anthropic model id. |
| API key env var | `ANTHROPIC_API_KEY` | The shell env var the engine reads at request time. |

The engine re-reads its config on every dispatch, so a Settings flip takes effect immediately for the next turn-end. No restart needed.

## Audit ring

Every decision lands in an in-memory ring (cap 50 entries) and broadcasts to:

- The plan panel's "AUTO-CONTINUE · LAST N" zone (debounced 100 ms).
- The web mirror's plan widget over the same envelope.
- `ht autocontinue audit` from the CLI.

Each entry: `{ at, surfaceId, agentId?, outcome, reason, engine, modelConsulted }`. Outcomes are `fired`, `dry-run`, `skipped`, `paused`, `resumed`. The audit is in-memory only — a restart starts fresh.

## Per-surface pause / resume

Beyond the engine-wide setting, you can pin a single surface:

```bash
ht autocontinue pause surface:1   # this surface stops auto-continuing
ht autocontinue resume surface:1  # back on; runaway counter reset too
```

The pause is administrative — it survives engine mode changes. Real user input on the paused surface does **not** clear it (only `resume` does), because typing a single character shouldn't unwind a deliberate pause.

The runaway counter is separate: when an agent loops, the engine pauses itself with a `looped — N auto-continues without user input` audit row. That auto-pause **does** clear when the user types into the surface (`notifyHumanInput` is wired at every human-originated `writeStdin` site).

## What "real user input" means

The engine's runaway counter resets on:

| Input source | Resets counter? |
|---|---|
| Webview keystroke (typed into the τ-mux pane) | yes |
| Cmd-V paste | yes |
| `ht surface send_text` / `send_key` from a sibling shell | yes (treated as remote-but-human) |
| Web mirror keystroke (typed in a browser) | yes |
| Workspace login / setup script (`runScript`) | no (system-originated) |
| The engine's own `sendText` | no (recursive guard) |

## Manual fire

```bash
ht autocontinue fire surface:1
```

Forces a dispatch using the same lookup pipeline used for turn-end notifications. The engine still respects every gate — engine off, paused, cooldown, dry-run all apply. Useful when:

- Testing a heuristic / model decision without waiting for an actual agent notification.
- Driving the engine from a script that knows the agent finished but didn't fire `ht notify`.

## How a turn-end becomes a decision

```
agent (e.g. Claude Code Stop hook)
   │
   │  ht notify --title "implement done" --surface "$HT_SURFACE"
   ▼
notification.create RPC
   │
   │  hook fires onCreate(notification)
   ▼
autoContinueHost.dispatchForNotification(n)
   │  - lookupPlanForSurface(surfaceId)   → most-recent plan in workspace
   │  - lookupSurfaceTail(surfaceId)       → last 12 ANSI-stripped lines
   ▼
engine.dispatch({surfaceId, plan, surfaceTail, notificationText})
   │  1. engine === "off"          → skipped
   │  2. surface paused             → skipped
   │  3. heuristic                  → continue / wait
   │  4. (hybrid + ambiguous wait)  → call model, override decision
   │  5. cooldown / runaway gates   → skipped
   │  6. dry-run                    → audit-only, never sends
   │  7. fire: sessions.writeStdin(surfaceId, instruction + "\n")
   ▼
audit ring update → plan panel re-renders
```

## Source files

- `src/bun/auto-continue.ts` — pure heuristic.
- `src/bun/auto-continue-engine.ts` — engine wrapper (settings, cooldown, runaway, audit, model caller).
- `src/bun/auto-continue-host.ts` — host helpers (plan lookup, surface tail, dispatch, manual fire).
- `src/bun/rpc-handlers/auto-continue.ts` — `autocontinue.*` JSON-RPC handlers.
- `src/views/terminal/plan-panel.ts` — sidebar audit zone (native).
- `src/web-client/plan-panel-mirror.ts` — sidebar audit zone (web mirror).
- `bin/ht autocontinue` — CLI entry point.
- `tests/auto-continue-engine.test.ts`, `auto-continue-pause.test.ts`, `auto-continue-rpc.test.ts` — unit coverage.

## Read more

- [`ht autocontinue` CLI reference](/cli/autocontinue/) — every subcommand with examples.
- [Plan panel](/features/plan-panel/) — the data the engine reads, and the surface that shows the audit ring.
- [Settings](/features/settings/) — UI overview including the Auto-continue section.
