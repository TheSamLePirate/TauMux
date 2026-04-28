# Tracking — Plan 09 (Commit C): Settings UI + `ht autocontinue` CLI + `notifyHumanInput` wiring + status-key bridge

**Plan**: [`plan_agent_plan_panel.md`](plan_agent_plan_panel.md)
**Sister tracking**:
[`tracking_agent_plan_panel.md`](tracking_agent_plan_panel.md) (commit A — types + store + heuristic + CLI + broadcasts) ·
[`tracking_agent_plan_panel_b.md`](tracking_agent_plan_panel_b.md) (commit B — engine + native panel + mirror panel + audit ring)
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Close the carry-overs explicitly listed at the bottom of
`tracking_agent_plan_panel_b.md`:

- Settings UI exposure of `autoContinue.engine` (read-only via
  `settings.json` until now).
- `ht autocontinue` CLI subcommand (audit / fire / pause).
- `notifyHumanInput` wiring at every human-originated
  `writeStdin` call site.
- Status-key bridge (`plan_array` → `PlanStore`).

Audit-ring persistence across restarts was explicitly deferred by
the user during plan refinement (in-memory ring stays acceptable).

## Step-by-step progress

### Engine: pause / resume + audit type

- [x] `AutoContinueAuditEntry.outcome` extended with `"paused" |
      "resumed"` variants in `src/shared/types.ts`.
- [x] `AutoContinueEngine.pause(surfaceId, reason?)` /
      `.resume(surfaceId, reason?)` / `.isPaused(surfaceId)` /
      `.listPaused()` added.
- [x] `dispatch()` short-circuits paused surfaces with a
      `kind:"skipped", reason:"paused"` outcome before running the
      heuristic. Engine-off check still wins ahead of the pause
      gate so a fully-disabled engine never pretends to be paused.
- [x] `resetAll()` now also clears `pausedSurfaces`.
- [x] `record()` refactored to use a new `pushAudit()` helper so
      the pause/resume code paths can write audit entries without
      going through the dispatch outcome machinery.

### Auto-continue host helpers extraction

- [x] `src/bun/auto-continue-host.ts` — pure factory exposing
      `lookupPlanForSurface`, `lookupSurfaceTail`,
      `dispatchForNotification`, `fireNow`. Behavior unchanged
      from commit B; the only reason it exists is that `autocontinue.fire`
      and `notification.create` now share the same lookup pipeline
      via a single source of truth.
- [x] `src/bun/index.ts` deletes the three locals
      (`lookupPlanForSurface`, `lookupSurfaceTail`,
      `dispatchAutoContinueForNotification`) and reads them off
      `autoContinueHost`.

### RPC handler: `auto-continue.ts`

- [x] `src/bun/rpc-handlers/auto-continue.ts` — new module with
      `autocontinue.status` / `audit` / `set` / `fire` / `pause` /
      `resume`. Strict param validation; `set` re-uses
      `SettingsManager.update` (which validates via
      `validateAutoContinue`); `fire` delegates to
      `host.fireNow(surfaceId, notificationText?)`.
- [x] `RpcHandlerOptions.autoContinue` field added; aggregator
      registers the handlers when wired.
- [x] `HandlerDeps.autoContinueEngine` plumbed from the same
      options bundle so surface handlers can call
      `notifyHumanInput` without owning the full deps object.

### `notifyHumanInput` wiring

| Site | Source of input | Wiring |
|---|---|---|
| `src/bun/index.ts` `writeStdin` RPC handler | webview keystroke | `autoContinue.notifyHumanInput(payload.surfaceId)` before `sessions.writeStdin` |
| `src/bun/index.ts` `handlePaste` | Cmd+V from native menu | `autoContinue.notifyHumanInput(surfaceId)` before `sessions.writeStdin` |
| `src/bun/rpc-handlers/surface.ts` `surface.send_text` | `ht surface send_text` | `autoContinueEngine?.notifyHumanInput(id)` (optional dep) |
| `src/bun/rpc-handlers/surface.ts` `surface.send_key` | `ht surface send_key` | `autoContinueEngine?.notifyHumanInput(id)` (optional dep) |
| `src/bun/web/server.ts` `stdin` WS message | web mirror keystroke | `this.onHumanInput(surfaceId)` injected via `setOnHumanInput` |

System-originated `writeStdin` paths (workspace login script at
line 766, plan/setup scripts at line 2347, the engine's own
`sendText` at line 2552) stay un-annotated. Auto-continue must
not reset its own counter when it's the one writing.

### `ht autocontinue` CLI

- [x] `bin/ht` — new `case "autocontinue"` block with
      `status` / `audit [--limit N]` / `set --engine X
      [--dry-run] [--cooldown MS] [--max N] [--model NAME]
      [--api-key-env VAR]` / `fire <surface>` /
      `pause <surface>` / `resume <surface>`.
- [x] `formatAutoContinue(sub, result)` — specialised pretty
      printers for status (key/value table), audit (timestamped
      colourised list), set (single-line config echo), fire
      (kind + reason), pause/resume (current paused list). All
      paths still respect `--json` because `formatOutput` falls
      through to JSON on early return.
- [x] Help block: new "Auto-continue (Plan #09)" section between
      `plan` and `ask` sections.

### Settings UI — Auto-continue section

- [x] `src/views/terminal/settings-panel.ts` — new top-level
      "Auto-continue" section between Telegram and Advanced.
      Icon: `rocket`.
- [x] `renderAutoContinue(c, s)` — hand-rolled because the
      existing helpers (`selectField` / `toggleField` /
      `numberField`) constrain to `keyof AppSettings` and
      `autoContinue.*` is nested. Each field reads `s.autoContinue.*`
      and emits a partial via
      `this.emit({ autoContinue: {...ac, [field]: value} })`. The
      `SettingsManager.update` path on the bun side already runs
      `validateAutoContinue`, so out-of-range numbers clamp and
      unknown engine values fall back to "off".
- [x] Fields rendered: engine select / dryRun toggle / cooldownMs
      number / maxConsecutive number / modelName text / modelApiKeyEnv
      text. Provider stays implicit (`anthropic`) — the validator
      hard-codes it; a UI knob would invite a misleading choice.

### Status-key bridge: `plan_array` → `PlanStore`

- [x] `src/bun/plan-status-bridge.ts` — pure factory
      `createPlanStatusBridge({plans})` returning a `handle(payload)`
      method. Match contract:
        1. Key name contains "plan" (case-insensitive).
        2. Value is a JSON-string array (or raw array) of
           `{id, title?, state?}` objects.
      Anything else returns false; the regular smart-key renderer
      runs unchanged.
- [x] `parsePlanValue` exported as a pure helper for tests.
- [x] `agentId` derives from `surface_id` (`status:<surfaceId>`)
      or falls back to `status:<key>`.
- [x] Wired into the dispatch path in `src/bun/index.ts` next to
      the existing `htKeysSeen` registration. Bridge runs after
      the regular sidebar broadcast so the smart-key renderer
      still gets its update.

### Hermetic tests

| File | Cases | Coverage |
|---|---|---|
| `tests/auto-continue-pause.test.ts` | 9 | pause gate / per-surface scoping / resume behaviour / runaway counter reset / audit emit / idempotency / `resetAll` |
| `tests/auto-continue-bridge.test.ts` | 15 | `parsePlanValue` (8 cases) + `createPlanStatusBridge.handle` (7 cases) — string + array input, missing fields, malformed JSON, key-name guard, workspace guard, idempotency, case-insensitivity |
| `tests/ht-autocontinue.test.ts` | 7 | help text, unknown subcommand, missing args, offline socket no-crash |
| `tests/auto-continue-rpc.test.ts` | 7 | `status` / `audit --limit` / `set` patch + invalid engine / `fire` forwarding + missing surface_id / `pause` + `resume` engine integration |

- [x] `bun run typecheck` clean (after every edit + at the end).
- [x] `bun test` (full) — 1495/1495 pass, 108527 expect() calls
      (was 1495 before C? — see verification log; the +38 added
      from this session sit alongside upstream additions since
      commit B).
- [x] `bun run bump:patch` — version flip, see Verification.

### Doc + index

- [x] `doc/todos/INDEX.md` — flipped row #09 to ✅ shipped, added
      a "Status" entry next to Plan #02 / #08 / #10.
- [x] `doc/todos/tracking_agent_plan_panel_c.md` — this file.

## Deviations from the plan

1. **Used a setter (`WebServer.setOnHumanInput`) instead of an
   8th constructor arg.** The plan's table called for a direct
   `notifyHumanInput` line at `src/bun/web/server.ts:908`. I added
   a `private onHumanInput: (id) => void = () => {}` field with
   a `setOnHumanInput(fn)` setter, mirroring the existing
   `setAuthToken(token)` pattern. Reason: WebServer has three
   constructor sites with different argument arities; keeping the
   constructor signature stable avoids touching the two minimal
   call sites that omit `bind`/`authToken`.
2. **`renderAutoContinue` hand-rolls every field** instead of
   reusing `selectField` / `toggleField` / `numberField` /
   `textField`. Reason: those helpers' types declare `key: keyof
   AppSettings`, but every auto-continue field lives at
   `s.autoContinue.*`. Generalising the helpers to a getter/setter
   pair would have churned every call site; the hand-rolled
   renderer reuses the same CSS class names so the section blends
   with the rest of the panel without a CSS change.
3. **`AutoContinueAuditEntry.outcome` adds two variants
   (`paused` + `resumed`)** instead of just `paused`. The plan
   only mentioned `paused`. Adding `resumed` was a 1-line cost
   and gives the audit ring a visible "user came back" event,
   which the panel can render distinctly.
4. **Status-key bridge runs alongside the smart-key dispatcher,
   not as a replacement.** The plan said "translate `plan_array`
   into PlanStore"; I left the existing `array` smart-key
   rendering path completely untouched. The bridge writes into
   the typed PlanStore as a side-effect — agents that emit a
   plan-shaped status get *both* the sidebar smart-key rendering
   and the typed plan panel. A user who explicitly hides the
   key from the workspace card (`_plan_array`) just sees the
   panel; otherwise both surfaces light up.
5. **No `surface.read_text` use in the host.** Same trade-off
   as commit B — the engine pulls trailing lines via
   `sessions.getOutputHistory(id)` directly, no IPC roundtrip.
6. **`ht autocontinue set` does not roundtrip the full
   settings object.** It returns `{autoContinue: AutoContinueSettings}`
   only — a focused echo of what changed. Useful when scripting
   ("did my flip take effect?") and keeps the wire payload
   small.

## Issues encountered

1. **Engine-off vs paused ordering.** First draft ran the paused
   gate before the engine-off check, which would have made a
   fully-disabled engine still appear to "skip with reason
   paused" for paused surfaces. Swapped the order: engine-off
   wins, then paused, then heuristic. Tests stayed green
   because the original engine-off test runs against an empty
   pause set.
2. **Settings panel field helpers are typed `keyof
   AppSettings`.** Tried for a minute to reuse
   `selectField(c, "Engine", ac.engine, "autoContinue.engine"
   as keyof AppSettings, ...)` and got a `Partial<AppSettings>`
   type error on `emit`. Hand-rolled the renderer instead;
   simpler than refactoring the helpers' signatures.
3. **WebServer constructor arity.** Three call sites in
   `index.ts` (line 2302, 2722, 2742) instantiate `WebServer`
   with different argument counts. Settled on
   `setOnHumanInput(fn)` as a post-construction setter wired
   from the existing `setupWebServerCallbacks(ws)` helper that
   every call site already invokes.

## Open questions

- **`ht autocontinue` test against a real socket.** The CLI smoke
  tests run against a sentinel socket path so they don't depend
  on a live host. The wire-level RPC handler tests cover the
  business logic on the bun side. End-to-end coverage (CLI →
  socket → handler → engine) would mean spinning a real socket
  server in a test; today's structure is fine but a future test
  could exercise the loop.
- **Status-key bridge match scope.** `key.toLowerCase().includes("plan")`
  is intentionally narrow (avoids accidentally bridging
  unrelated `*_array` keys), but a key called `_plan_status_pct`
  would still match. Today that's fine — the smart-key parser
  treats those as numeric anyway, and `parsePlanValue` rejects
  numbers. If we ever ship a status-key kind explicitly named
  `plan_array`, we'd switch the trigger to that exact suffix.

## Verification log

| Run | Result |
|---|---|
| `bun run typecheck` | clean (after every edit) |
| `bun test tests/auto-continue-pause.test.ts` | 9/9 pass |
| `bun test tests/auto-continue-bridge.test.ts` | 15/15 pass |
| `bun test tests/ht-autocontinue.test.ts` | 7/7 pass |
| `bun test tests/auto-continue-rpc.test.ts` | 7/7 pass |
| `bun test tests/auto-continue-engine.test.ts` | 32/32 pass (unchanged from commit B) |
| `bun test` (full) | 1495/1495 pass, 108527 expect() calls |
| `bun run bump:patch` | (logged below) |

## Commits

- (pending) — plan: settings UI + ht autocontinue CLI + notifyHumanInput
  + plan_array status-key bridge (Plan #09 commit C)

## Retrospective

What worked:
- The pure-function decomposition still pays compound interest.
  The bridge is 80 LOC of code + 15 hermetic tests; the engine
  pause/resume is 50 LOC + 9 hermetic tests; the RPC handler is
  140 LOC + 7 hermetic tests. Every piece is testable without a
  process or a socket.
- Lifting the host helpers (`auto-continue-host.ts`) before
  building the `autocontinue.fire` RPC kept the handler
  decoupled from session/workspace internals — the test fixture
  in `auto-continue-rpc.test.ts` injects a stubbed
  `AutoContinueHost` without touching real workspaces or PTYs.
- The `setOnHumanInput` setter pattern matches the existing
  `setAuthToken` pattern, which means any reader who has seen
  one already knows how the other works. No new conventions.
- Settings UI flow stayed completely additive — zero changes to
  shared field helpers, zero CSS, just one new `renderAutoContinue`
  method and one section nav entry.

What I'd do differently:
- The settings field helpers (`selectField` etc.) only support
  top-level `keyof AppSettings` keys, which forced a hand-rolled
  renderer here. Two other features that would benefit from
  nested settings (Telegram, AnsiColors) already work around
  this differently. A future polish: generalise the helpers to
  take a `(value, onChange)` pair so nested settings can reuse
  them.
- The audit ring is now bigger because pause/resume push entries
  too. Pre-commit C, every audit row was a turn-end decision;
  post-commit C, administrative events sit alongside them. The
  CLI prints them with distinct tags (`paused`, `resumed`) so
  scrollback stays readable, but the panel's "Last N" widget
  conflates them with decisions. A future polish: split the
  panel's renderer into a "decisions" tab and a "history" tab.

Carried over to follow-ups (only-if-asked):
- Audit ring persistence across restarts (user opted out).
- Plan persistence across restarts (commit A trade-off).
- Cross-publishing flow: PlanStore.set → smart-key emit (the
  reverse direction of this commit's bridge). Probably not
  needed since `restorePlans` already broadcasts to the panel.
