# Plan Panel + Auto-continue

This document describes Plan #09 — the typed plan panel that surfaces agent plans in the sidebar and the auto-continue engine that decides whether to send `Continue` to an agent on every turn-end notification.

## Goals

- Render every active agent plan as a typed sidebar widget (Explore → Implement → Test → Commit) instead of letting agents scribble plans into terminal output.
- On every turn-end notification, decide deterministically whether to auto-send `Continue` — heuristic, model, or hybrid.
- Keep the user safe: engine off by default; even after opt-in, default to dry-run; per-surface cooldown; per-surface runaway cap; per-surface manual pause.
- Surface every decision in an in-memory audit ring so the user can scroll back and see what the engine did and why.
- Stay decoupled from PTY state — the plan panel and audit ring are overlays that read derived state, never write into the terminal except through the explicit `sendText` path.

The panel is read-only by design: the agent owns the plan. Editing in-UI is out of scope (agents resync via `ht plan set` / `update`).

## Architecture

### Bun side

- **`src/bun/plan-store.ts`** — `PlanStore` is an in-memory, keyed-by-`(workspaceId, agentId?)` map of plans. Owns:
  - `set` / `update` / `complete` / `clear` / `list` / `get` — strict normalisation in `set` (dedupe ids, trim titles, default unknown states to `waiting`).
  - `subscribe(fn)` — every mutation pushes a snapshot; throw-isolation so a buggy subscriber can't poison the store.
- **`src/bun/auto-continue.ts`** — pure heuristic. `decideAutoContinue({plan, surfaceTail, notificationText})` returns `{action, reason, instruction?}`. Decision tree: error guard → question guard → plan-step continue → all-done wait → no-plan wait. Reason strings clamped to ≤120 chars.
- **`src/bun/auto-continue-engine.ts`** — `AutoContinueEngine` wraps the heuristic with host concerns:
  - Per-surface state map (`lastFireAt`, `consecutive`, `loopWarned`).
  - Per-surface pause set (`pausedSurfaces: Set<string>`).
  - Cooldown gate (skip when `now() - lastFireAt < cooldownMs` and `lastFireAt > 0`).
  - Runaway gate (skip when `consecutive >= maxConsecutive`).
  - Dry-run path (audit but don't `sendText`).
  - Audit ring (cap 50; subscriber notification with throw-isolation).
  - LLM caller hook (default `callAnthropicAutoContinue`; tests inject a stub).
  - `notifyHumanInput(surfaceId)` resets the runaway counter.
  - `pause(surfaceId, reason?)` / `resume(surfaceId, reason?)` / `isPaused` / `listPaused`. Resume also resets the runaway counter so a paused-on-runaway surface can fire again. Pause and resume both push audit entries.
- **`src/bun/auto-continue-host.ts`** — pure factory `createAutoContinueHost({engine, plans, getWorkspaceForSurface, getOutputHistory})` exposes:
  - `lookupPlanForSurface(surfaceId)` — most-recently-updated plan in the owning workspace.
  - `lookupSurfaceTail(surfaceId)` — last 12 ANSI-stripped lines from the PTY output buffer, capped at 3 KiB.
  - `dispatchForNotification(notification)` — driven by `notification.create`.
  - `fireNow(surfaceId, notificationText?)` — manual trigger used by `autocontinue.fire` RPC.
  Lifting these out of `index.ts` keeps the RPC handler decoupled from session/workspace internals.
- **`src/bun/plan-status-bridge.ts`** — `createPlanStatusBridge({plans})` returns `handle(payload)` that translates plan-shaped status updates into `PlanStore.set` calls. Match contract:
  1. Key name contains "plan" (case-insensitive).
  2. Value is a JSON-string array (or raw array) of `{id, title?, state?}` objects.
  Anything outside that contract returns false; the regular smart-key sidebar renderer keeps working unchanged.
- **`src/bun/rpc-handlers/plan.ts`** — `plan.set` / `plan.update` / `plan.complete` / `plan.clear` / `plan.list` JSON-RPC handlers.
- **`src/bun/rpc-handlers/auto-continue.ts`** — `autocontinue.status` / `audit` / `set` / `fire` / `pause` / `resume` JSON-RPC handlers.
- **`src/bun/rpc-handler.ts`** — aggregator. `RpcHandlerOptions.autoContinue: AutoContinueDeps` wires the new family. `HandlerDeps.autoContinueEngine` is plumbed so `surface.send_text` / `surface.send_key` can call `notifyHumanInput` without owning the full deps bundle.
- **`src/bun/index.ts`** — instantiation + lifecycle:
  - `plans = new PlanStore()`; subscribe → debounced (100 ms) `restorePlans` rpc broadcast + `plansSnapshot` web-mirror broadcast.
  - `autoContinue = new AutoContinueEngine({getSettings: () => settingsManager.get().autoContinue, sendText: sessions.writeStdin})`.
  - `autoContinueHost = createAutoContinueHost({...})` lifts the lookup helpers.
  - `planStatusBridge = createPlanStatusBridge({plans})` — wired into the `setStatus` dispatch path.
  - `audit subscribe` → debounced (100 ms) `autoContinueAudit` rpc + web-mirror broadcast.
  - `notifyHumanInput` wired at every human-originated `writeStdin` site (see Data flow below).

### Webview side

- **`src/views/terminal/plan-panel.ts`** — `PlanPanel` class. Self-contained DOM mounted into the sidebar host; `setPlans(plans)` / `setAudit(audit)` setters. Click delegation on `data-plan-workspace` calls `SurfaceManager.selectWorkspaceById`.
- **`src/views/terminal/surface-manager.ts`** — `selectWorkspaceById(id)` is the public sibling of the private `switchToWorkspace(idx)` that the panel uses.
- **`src/views/terminal/index.ts`** — instantiates `PlanPanel`; wires `restorePlans` + `autoContinueAudit` RPC handlers to `panel.setPlans` / `panel.setAudit`.
- **`src/views/terminal/index.css`** — `.spp-*` classes for plan cards, step rows, audit rows. Plan panel hides itself when there's nothing to show.
- **Settings panel** — `renderAutoContinue(c, s)` adds a top-level "Auto-continue" section between Telegram and Advanced. Hand-rolled (the existing field helpers expect `keyof AppSettings`; `autoContinue.*` is nested) but reuses the shared CSS classes via `fieldRow`.

### Web mirror

- **`src/web-client/plan-panel-mirror.ts`** — `createPlanPanelMirror({transport})` factory. Mounts `<div class="sb-plan-panel">` into the sidebar host. Click → emits `selectWorkspace` + `subscribeWorkspace` over the WebSocket transport.
- **`src/web-client/protocol-dispatcher.ts`** — translates `plansSnapshot` and `autoContinueAudit` envelopes into `setPlans` / `setAutoContinueAudit` callbacks. Plans are not stored in `AppState` — the panel renders directly from the latest snapshot, matching the native side.
- **`src/web-client/client.css`** — matching `.sb-plan-panel` selector wraps the shared `.spp-*` classes.

### Shared

- **`src/shared/plan-panel-render.ts`** — pure HTML helpers (`renderPlanCardHtml`, `renderStepRowHtml`, `renderAuditRowHtml`, `summarizePlan`). Used by both native + mirror so a CSS rename or XSS fix lands in one place.
- **`src/shared/types.ts`** — `Plan`, `PlanStep`, `PlanStepState`, `AutoContinueAuditEntry` (with `outcome: "fired" | "dry-run" | "skipped" | "paused" | "resumed"`).
- **`src/shared/settings.ts`** — `AutoContinueSettings` interface + `validateAutoContinue` (clamps cooldown 0–60000, max 1–50; falls unknown engine values back to `off`; `modelProvider` is hard-coded to `anthropic`).

## Data flow

### Plan publishing

1. Agent runs `ht plan set --workspace W [--agent A] --json '[…]'`.
2. CLI parses the JSON locally, sends `{method: "plan.set", params}` over the socket.
3. `plan.set` handler validates params, calls `PlanStore.set(key, steps)`. The store normalises and stamps `updatedAt`.
4. `PlanStore` notifies subscribers; the bun bootstrap's debounced broadcaster pushes `restorePlans` to the webview rpc and `plansSnapshot` to every web mirror client (100 ms after the last write).
5. Webview `PlanPanel.setPlans` re-renders the panel (full diff at the panel level; the plan card HTML is built from scratch each time — there are typically ≤3 plans).
6. Web mirror `createPlanPanelMirror` does the same.

### Status-key bridge

1. Agent (or a Plan #02 status-key publisher) runs `ht set-status build_plan '[{id,title,state},…]'`.
2. The bun-side `setStatus` dispatch fires the smart-key sidebar broadcast unchanged.
3. `planStatusBridge.handle({workspaceId, surfaceId, key, value})` runs alongside:
   - Key contains "plan" (case-insensitive)?
   - Value parses as a JSON array of `{id, title?, state?}` objects?
   - Both pass → `PlanStore.set({workspaceId, agentId: "status:<surfaceId>"}, steps)`.
4. The store's normal subscriber path pushes the broadcast — the panel re-renders.

The bridge is intentionally narrow. Agents who don't want their key bridged can omit "plan" from the key name; agents who want both surfaces (sidebar smart-key + plan panel) get them automatically.

### Auto-continue dispatch

```
agent
   │  ht notify --title "M2 done" --surface "$HT_SURFACE"
   ▼
notification.create RPC
   │  registerNotification → notifications.list.push(notification)
   │  notifications.onCreate?.(notification)   ← Plan #09 commit B hook
   ▼
autoContinueHost.dispatchForNotification(notification)
   │  - lookupPlanForSurface(surfaceId)   → most-recent Plan or null
   │  - lookupSurfaceTail(surfaceId)       → last 12 ANSI-stripped lines
   ▼
engine.dispatch({surfaceId, agentId?, plan, surfaceTail, notificationText})
   │  read settings.autoContinue (live)
   │
   ├─ engine === "off"     → record "engine disabled" (skipped)
   ├─ pausedSurfaces.has() → record "paused" (skipped)
   │
   │  heuristic = decideAutoContinue({plan, surfaceTail, notificationText})
   │  if heuristic.action === "wait" → record "wait" + reason (skipped)
   │
   ├─ engine === "model"   → tryModel; on null fall back to heuristic
   ├─ engine === "hybrid" + shouldEscalate(heuristic) → tryModel
   │
   ├─ cooldown gate (lastFireAt > 0 && elapsed < cooldownMs) → skipped
   ├─ runaway gate (consecutive >= maxConsecutive)            → skipped + loopWarned
   ├─ dryRun                                                  → audit + return "dry-run"
   │
   │  fire: deps.sendText(surfaceId, instruction + "\n")
   │       state.lastFireAt = now()
   │       state.consecutive += 1
   ▼
record(...) → audit ring push → debounced broadcast (100 ms)
   │
   ▼
plan panel "AUTO-CONTINUE · LAST N" zone re-renders on both surfaces
```

### `notifyHumanInput` wiring

The runaway counter resets on every human-originated `writeStdin` call site:

| Site | Origin |
|---|---|
| `src/bun/index.ts:518` (RPC `writeStdin` from webview keystroke) | human |
| `src/bun/index.ts:2270` (`handlePaste`, Cmd+V from native menu) | human |
| `src/bun/rpc-handlers/surface.ts` (`surface.send_text` via ht CLI) | human |
| `src/bun/rpc-handlers/surface.ts` (`surface.send_key` via ht CLI) | human |
| `src/bun/web/server.ts` (web-mirror `stdin` WS message) | human (via `WebServer.setOnHumanInput` setter) |

`runScript` (workspace login + plan/setup script paths) and the engine's own `sendText` deliberately do not call `notifyHumanInput` — those are system-originated.

### Manual pause / resume

`pause(surfaceId)` / `resume(surfaceId)` are administrative; they do **not** decay on user input. The pause set is in-memory only; a restart starts with no surfaces paused.

`resume(surfaceId)` also resets the runaway counter for that surface. This is convenient for the "agent looped → I paused → I checked in → I resume" workflow.

## Settings

```ts
interface AutoContinueSettings {
  engine: "off" | "heuristic" | "model" | "hybrid";  // default "off"
  dryRun: boolean;                                    // default true
  cooldownMs: number;                                 // default 3000, clamped 0..60000
  maxConsecutive: number;                             // default 5, clamped 1..50
  modelProvider: "anthropic";                         // hard-coded
  modelName: string;                                  // default "claude-haiku-4-5-20251001"
  modelApiKeyEnv: string;                             // default "ANTHROPIC_API_KEY"
}
```

`validateAutoContinue` is the canonical path. `SettingsManager.update({autoContinue})` runs it. Both the Settings UI (via `emit({autoContinue: {…}})`) and `autocontinue.set` RPC flow through the same path.

The engine reads `getSettings()` on every dispatch, so a UI flip applies to the next turn-end without restart.

## Tests

| File | Cases | Target |
|---|---|---|
| `tests/plan-store.test.ts` | 15 | Set / normalisation / update / complete / clear / agent-vs-workspace scoping / subscribe / throw-isolation. |
| `tests/auto-continue.test.ts` | 14 | Pure heuristic — every branch (error / question / active step / waiting / all-done / no-plan / clipped reason). |
| `tests/auto-continue-engine.test.ts` | 32 | Engine off / heuristic / cooldown / runaway / model / hybrid / shouldEscalate / prompt + parser / audit ring / live settings. |
| `tests/auto-continue-pause.test.ts` | 9 | Pause gate / per-surface scoping / resume + counter reset / audit emit / idempotency / `resetAll`. |
| `tests/auto-continue-bridge.test.ts` | 15 | `parsePlanValue` (8) + `createPlanStatusBridge.handle` (7). |
| `tests/auto-continue-rpc.test.ts` | 7 | Handler shapes + invalid engine + missing surface_id. |
| `tests/ht-autocontinue.test.ts` | 7 | CLI smoke against a sentinel socket — help text, unknown subcommand, missing args. |
| `tests/plan-panel-renderer.test.ts` | 22 | Pure renderer helpers + XSS guards. |

All hermetic; no PTY, no socket, no network. Total: 121 tests across 8 files dedicated to Plan #09.

## Risks

- **Audit ring is in-memory only.** A restart starts blank. Persistence was deliberately deferred (commit C scope). When asked, write to `~/Library/Application Support/hyperterm-canvas/autocontinue-audit.json` on each subscriber notification with a debounced flush.
- **`notifyHumanInput` is best-effort.** Any new `writeStdin` call site needs to remember to call it (or not, when the input is system-originated). Adding a `source: "user" | "engine" | "system"` annotation on `SessionManager.writeStdin` would let us flip the counter without inspecting the call stack — tracked as a follow-up.
- **Status-key bridge match scope.** `key.toLowerCase().includes("plan")` is intentionally narrow (avoids accidentally bridging unrelated `*_array` keys), but a key called `_plan_status_pct` would still match. Today that's fine — `parsePlanValue` rejects numeric values. If we ever ship a status-key kind explicitly named `plan_array`, switch the trigger to that exact suffix.
- **Model provider lock-in.** `modelProvider: "anthropic"` is hard-coded. Adding a `local` provider (llama.cpp / ollama) means broadening the validator + adding a sibling `callLocalAutoContinue` function. The engine's `ModelCaller` interface is already pluggable for tests; making it user-pluggable is a small extension.

## Adding capabilities

- **Adding a plan field** — extend `PlanStep` in `src/shared/types.ts`, update `coerceStep` in `plan.ts` RPC handler, update the panel renderer in `src/shared/plan-panel-render.ts`, update tests in `tests/plan-store.test.ts` and `tests/plan-panel-renderer.test.ts`.
- **Adding an engine mode** — add the variant to `AutoContinueSettings.engine`, extend `validateAutoContinue`, branch in `engine.dispatch`, write a test in `tests/auto-continue-engine.test.ts`. CLI/UI exposure is automatic via the `--engine` flag and the Settings select.
- **Adding an `autocontinue.*` RPC method** — drop the handler in `src/bun/rpc-handlers/auto-continue.ts`. CLI surfaces it via a new `case` in the `autocontinue` block in `bin/ht`.
- **Persisting the audit ring** — subscribe in the bun bootstrap to write a debounced JSON snapshot to `~/Library/Application Support/hyperterm-canvas/autocontinue-audit.json`; load it on startup before the first dispatch.
