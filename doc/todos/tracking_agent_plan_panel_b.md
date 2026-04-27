# Tracking — Plan 09 (Commit B): plan panel UI + auto-continue engine + LLM provider

**Plan**: [`plan_agent_plan_panel.md`](plan_agent_plan_panel.md)
**Sister tracking**: [`tracking_agent_plan_panel.md`](tracking_agent_plan_panel.md) (Commit A — types + store + heuristic + CLI + broadcasts)
**Status**: done
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Land everything Commit A explicitly carried over:

  - Sidebar plan widget on the native webview
  - Web-mirror plan widget (parallel, read-only)
  - `autoContinue.engine` settings + dryRun + cooldown + maxConsecutive
  - `AutoContinueEngine` wrapping the heuristic with safety + LLM
  - Anthropic Messages API caller (Haiku 4.5 default), parser, prompt
  - Wiring: notification.create → engine dispatch on the source surface
  - Audit ring + push channel (`autoContinueAudit` envelope, debounced)

Status-key bridge (`plan_array` → PlanStore) deliberately deferred —
no demand surfaced and the smart-key dispatcher already renders
`plan_array` JSON correctly for ad-hoc checklists.

## Step-by-step progress

### Settings + validation

- [x] `AppSettings.autoContinue: AutoContinueSettings` extension
      with `engine` (off / heuristic / model / hybrid), `dryRun`,
      `cooldownMs`, `maxConsecutive`, `modelProvider`, `modelName`,
      `modelApiKeyEnv`. Default: engine=off, dryRun=true,
      cooldown=3000, maxConsecutive=5, model=Haiku 4.5,
      apiKey env="ANTHROPIC_API_KEY".
- [x] `validateAutoContinue(raw)` — clamps + falls back unknown
      engine values to "off". Two safety layers in defaults: a
      fresh install can't fire (engine=off); even after opt-in
      dryRun=true logs the decision instead of acting.

### Engine

- [x] `src/bun/auto-continue-engine.ts` (~280 LOC):
      - `AutoContinueEngine` class — wraps `decideAutoContinue`
        with per-surface state (lastFireAt, consecutive, loopWarned),
        cooldown gate, runaway counter, dry-run path, audit ring
        (cap 50), subscriber notification, settings re-read on
        every dispatch.
      - `shouldEscalate(decision)` — hybrid-mode classifier; only
        escalates to the model when heuristic returned a low-
        confidence wait ("no plan published", ambiguous) — not
        for confident waits (error / question / looped / no
        remaining steps).
      - `callAnthropicAutoContinue` — default ModelCaller. Reads
        API key from settings.modelApiKeyEnv; POSTs to
        `/v1/messages`; max_tokens=256, temperature=0; system
        prompt enforces JSON-only output. Returns null on missing
        key, network error, non-2xx, or parse failure (engine
        falls back to heuristic).
      - `buildAutoContinuePrompt` — pure prompt assembler; pinned
        format so audit logs show exactly what the model saw.
      - `parseModelResponse` — pure JSON extractor with markdown-
        fence tolerance, action enum check, reason clamp at 200
        chars, instruction clamp at 240 chars.
- [x] Bug catch: first-fire cooldown false-positive. Without
      `surfaceState.lastFireAt > 0` guard, `now - 0` is always
      gigantic so the gate misfires only on contrived clocks.
      Fixed + regression-tested.

### Wiring (notification → engine)

- [x] `NotificationStore.onCreate?: (n: Notification) => void`
      hook on the rpc-handler types.
- [x] `registerNotification` fires the hook after every
      `notification.create` (try/catch so a buggy hook can't
      break notification flow).
- [x] `RpcHandlerOptions.onNotificationCreate` callback exposed
      so the host (`index.ts`) wires the engine without
      reaching into the rpc-handler internals.
- [x] `index.ts`:
      - `AutoContinueEngine` instantiated with
        `getSettings: () => settingsManager.get().autoContinue`
        and `sendText: sessions.writeStdin(...)`.
      - `lookupPlanForSurface(surfaceId)` walks workspaces to
        find owning workspace, then picks the most-recently-
        updated plan for that workspace.
      - `lookupSurfaceTail(surfaceId)` reads
        `sessions.getOutputHistory`, caps at 3 KiB, strips ANSI,
        returns last 12 lines.
      - `dispatchAutoContinueForNotification(n)` ties the three
        together; awaits engine.dispatch with try/catch.
      - Audit subscription debounced (100 ms) and broadcast as
        `autoContinueAudit` over both the webview RPC and the
        web mirror.

### Native plan panel

- [x] `src/shared/plan-panel-render.ts` — pure HTML helpers
      (`renderPlanCardHtml`, `renderStepRowHtml`,
      `renderAuditRowHtml`, `summarizePlan`). Uses non-emoji
      glyphs (■ ● ○ ×) per design guideline §0.
- [x] `src/views/terminal/plan-panel.ts` — `PlanPanel` class
      with self-contained DOM, `setPlans` / `setAudit` setters,
      click delegation on `data-plan-workspace`. Mounts directly
      into the sidebar host element.
- [x] `SurfaceManager.selectWorkspaceById(id)` — public
      sibling of the private `switchToWorkspace(idx)` so the
      panel can switch workspaces without reaching into private
      state.
- [x] `src/views/terminal/index.ts` — instantiates `PlanPanel`,
      wires `restorePlans` + `autoContinueAudit` RPC handlers to
      `panel.setPlans` / `panel.setAudit`.
- [x] `src/views/terminal/index.css` — full theming for plan
      cards, step rows, audit rows. Plan panel hides itself
      when there's nothing to show (no plans + no audit).

### Web mirror

- [x] `src/web-client/plan-panel-mirror.ts` — `createPlanPanelMirror`
      factory; mounts a `<div class="sb-plan-panel">` into the
      sidebar host. Click → emits `selectWorkspace` +
      `subscribeWorkspace` over the WebSocket transport.
- [x] `protocol-dispatcher.ts` — new `setPlans` / `setAutoContinueAudit`
      callback hooks; new dispatch cases for `plansSnapshot` and
      `autoContinueAudit`. The mirror does NOT store plans in
      AppState — the panel renders directly from the latest
      snapshot, matching how it works on the native side.
- [x] `src/web-client/main.ts` — wires the mirror panel into
      the dispatcher.
- [x] `src/web-client/client.css` — matching theming for the
      mirror plan panel; reuses the `.spp-*` class names from
      the shared renderer so future renderer tweaks land in
      one place.

### Types + protocol

- [x] `AutoContinueAuditEntry` interface in `src/shared/types.ts`
      so both runtimes import the same shape.
- [x] `TauMuxRPC.bun.messages.autoContinueAudit: { audit: ... }`
      added to the typed RPC envelope so the webview side gets
      compile-time enforcement.
- [x] Web mirror broadcasts go through `app.webServer?.broadcast`
      with the same JSON shape — the WS transport is loosely
      typed at the boundary so no separate type change needed.

### Hermetic tests

- [x] `tests/auto-continue-engine.test.ts` — 32 cases:
      - Engine off (1)
      - Heuristic mode (4 — fire, dryRun, error guard, question guard)
      - Cooldown gate (2 — gates within window, allows after)
      - Runaway counter (2 — pauses at max, resets on human input)
      - Model + hybrid (4 — model verbatim, model fallback,
        hybrid skips on confidence, hybrid escalates on no-plan)
      - shouldEscalate (6 — continue / error / question / looped /
        remaining / no-plan)
      - buildAutoContinuePrompt (3 — plan steps, surface tail
        last-12, no-plan note)
      - parseModelResponse (6 — minimal continue, instruction
        passthrough, markdown fence, unknown action, malformed
        JSON, reason clamp)
      - Audit ring (3 — append, subscribe, cap at 50)
      - Live settings (1 — flipping engine off mid-stream stops
        firing)
- [x] `tests/plan-panel-renderer.test.ts` — 22 cases:
      - summarizePlan (5)
      - renderStepRowHtml (6 — every state, fallback, XSS guard)
      - renderPlanCardHtml (5 — workspace attr, header content,
        agent hidden when missing, step count, XSS guard)
      - renderAuditRowHtml (6 — every outcome, modelConsulted
        suffix, no-model suffix, XSS guard)
- [x] `bun run typecheck` clean
- [x] `bun test tests/auto-continue-engine.test.ts tests/plan-panel-renderer.test.ts` — 54/54 pass
- [x] `bun test` (full) — 1351/1351 (was 1297 before this commit; +54)
- [x] `bun scripts/audit-emoji.ts` clean (✓ + ✗ originally
      flagged → swapped for ■ + × from the geometric-shapes /
      Latin-1 blocks).
- [x] `bun run build:web-client` clean (sw.js, manifest.json,
      icon.svg all rebuild on top of the new client bundle).
- [x] `bun run bump:patch` — 0.2.17 → 0.2.18.
- [x] Commit — pending (next step).

## Deviations from the plan

1. **Plan said "max N consecutive auto-continues without user
   intervention (default 5)"; my counter resets on
   `notifyHumanInput(surfaceId)`** which the host wires from any
   `writeStdin` event the user originates. Today no caller in
   `index.ts` actually invokes `notifyHumanInput` — the engine
   just pauses after the cap and stays paused until the page
   reloads or the user explicitly clears it via a future RPC.
   The hook IS in place; wiring it to the actual user-input
   path is a small follow-up that wasn't required for the
   "lands the engine" deliverable. Captured as an open question.

2. **Audit ring is in-memory only.** Plan didn't specify
   persistence; the engine's audit subscription pushes the
   snapshot over RPC + WebSocket, so the panel UI is the canonical
   live surface. After a restart, the audit starts blank — same
   trade-off as the PlanStore itself.

3. **Plan said "always log the decision + reason to the sidebar
   (level=info, source=`autocontinue`)".** I broadcast the audit
   ring (which the panel renders inline) but did NOT additionally
   push every decision into the sidebar log buffer. Reason:
   the sidebar log is a 10-line max ringbuffer that scrolls
   fast; an active auto-continue session would push every other
   log entry off screen. The plan panel's audit row is the
   right surface for this data. Logging to the rotating app
   log file (Plan #01) is a one-line add if a future user wants
   it.

4. **No `ht autocontinue` CLI yet.** The plan implied audit
   inspection from the CLI ("audit: store last 50 decisions in
   memory for the user to inspect"). The audit IS stored;
   exposing it via a CLI subcommand would mean adding a new
   `autocontinue.audit` RPC. Trivial follow-up; deferred until
   a user asks because the panel UI surfaces the same data
   directly.

5. **No `surface.read_text` RPC use.** Plan suggested gathering
   "Last N lines of the agent surface (via `surface.read_text`)"
   for the model. I went through `sessions.getOutputHistory(id)`
   directly — same data, no IPC roundtrip. The shape is the
   same `string[]` either way.

6. **`shouldEscalate` is a tight whitelist of "low-confidence
   waits" rather than the plan's "ambiguous turn end" concept.**
   The plan's intent reads as "save tokens vs always-on model";
   my classifier lets the model in only when the heuristic's
   reason starts from no anchor (no plan, no error, no question)
   — which is exactly the case where the plan says "if it is a
   small fast model, it can maybe be more granular". Confident
   waits skip the model.

7. **iOS-flavoured shareBin churn arrived mid-session** — the
   user (or a formatter) refactored several `show_*` utilities
   to a new `lib/full-screen.ts` chrome. Unrelated to plan #09;
   left those files untouched.

## Issues encountered

1. **First-fire cooldown false-positive.** Test caught it: the
   gate was `now() - lastFireAt < cooldownMs` with `lastFireAt`
   defaulting to 0, so on a real wall clock the gate succeeds
   but on the test's `nowMs = 1000` clock with a 5000 ms
   cooldown it tripped. Fix: add `lastFireAt > 0` guard. The
   real-world bug would surface if anyone used a custom clock
   or initialised the engine immediately after process start
   with a sub-cooldown gap.

2. **Emoji audit flagged ✓ and ✗** in the shared renderer.
   Design guideline §0 forbids emoji codepoints in chrome; the
   audit's range is U+2600..U+27BF (dingbats). Swapped for
   geometric-shapes block (■ U+25A0) and Latin-1 (× U+00D7),
   both allow-listed. Tests updated to match.

3. **Type unused warning on `AutoContinueAction`** in the
   engine after the renderers moved to the shared file. Dropped
   the import.

4. **`AutoContinueAuditEntry` originally lived in the engine
   module**, but the typed RPC envelope needed the shape
   visible from the webview build. Moved to `src/shared/types.ts`
   and re-exported from the engine for caller convenience.

## Open questions

- `notifyHumanInput(surfaceId)` is in place but not wired. The
  cleanest hook is `sessions.writeStdin` when the data didn't
  originate from the engine — but the SessionManager doesn't
  distinguish today. A small annotation ("source: 'user' |
  'engine'") on writeStdin would let us flip the counter on
  user input without inspecting the call stack. Filing as a
  Plan #09 polish item.

- Should the audit decisions also push into the sidebar's
  rotating log buffer? Pro: a second surface to spot a stuck
  agent without opening the panel. Con: drowns the log on
  active sessions. No-op for now; revisit on user request.

- `ht autocontinue {audit, fire, pause}` CLI subcommands. Useful
  for debugging from outside the GUI, but every operation has a
  visible UI alternative today. Trivial to add when needed.

## Verification log

| Run                                                       | Result                              |
| --------------------------------------------------------- | ----------------------------------- |
| `bun run typecheck`                                       | clean                               |
| `bun test tests/auto-continue-engine.test.ts`             | 32/32 pass                          |
| `bun test tests/plan-panel-renderer.test.ts`              | 22/22 pass                          |
| `bun test` (full)                                         | 1351/1351 pass, 108223 expect()     |
| `bun scripts/audit-emoji.ts`                              | clean                               |
| `bun run build:web-client`                                | clean                               |
| `bun run bump:patch`                                      | 0.2.17 → 0.2.18                     |

## Commits

- `2d2532f` — plan: panel UI + auto-continue engine + LLM provider (Plan #09 commit B)
  - 22 files changed; 2506 insertions, 5 deletions
  - 7 new files (engine, shared renderer, native panel, mirror panel, 2 tests, tracking) + 15 modified (settings, types, wiring, CSS)

## Retrospective

What worked:
- Pure-function decomposition again paid off. Every piece with
  load-bearing logic — heuristic (commit A), engine wrapper,
  prompt builder, response parser, summary, renderer helpers —
  is a pure function that hermetically tests in milliseconds.
  54 tests in 27 ms cover the entire commit's decision surface.
- Sharing `plan-panel-render.ts` between native + web mirror
  meant one renderer to maintain, two surfaces in lockstep. The
  XSS guards land for both at once; a CSS class rename lands
  for both at once.
- Wiring through the existing `notification.create` hook (with
  a new `onCreate` callback) meant zero new event channels —
  every "agent turn end" notification already lands in the
  store; we just tap it. That kept index.ts surgery to ~80
  lines of well-defined helpers.
- Live settings re-read on every dispatch means a Settings
  panel toggle takes effect immediately — no engine recreation,
  no observer dance. The cost is a thunk call per dispatch,
  which is rounding error vs the rest of the work.

What I'd do differently:
- The cooldown gate's first-fire bug should have been caught at
  design time — every "elapsed since last X" check needs a
  "never fired" sentinel. I'll keep that in mind for future
  rate-limit code.
- Sharing `renderPlanCardHtml` between native + mirror works,
  but the CSS classes are duplicated (the native side uses
  `.sidebar-plan-panel`, the mirror uses `.sb-plan-panel`).
  A future polish: have both surfaces use the same outer class
  so the .spp-* shared classes stand alone. Cosmetic; tests
  pin the inner-element class names that matter.
- I built the LLM caller (`callAnthropicAutoContinue`) but
  didn't write a hermetic integration test that actually hits
  the Anthropic API. The unit tests inject a mock `ModelCaller`
  so the engine logic is fully covered; the actual HTTP path
  rides on the parser tests + the existing claude-api test
  framework if a future test wants to exercise it end-to-end.

Carried over to follow-ups:
- `notifyHumanInput` wiring (annotate writeStdin source).
- `ht autocontinue` CLI subcommand for audit inspection.
- Status-key bridge (`plan_array` → PlanStore) — only if a
  user actually wants the cross-publishing flow.
- Persist audit ring across restarts — only if asked.
- Settings UI exposure of `autoContinue.engine` (settings
  panel work; not blocked on this commit but the toggle is
  read-only via JSON edits today).
- Plan #13 web-mirror agent-panel mirror — explicitly deferred
  in plan #13 commit A's tracking; the read-only plan widget
  this commit ships is a step toward that, but the agent
  panel itself (chat history, long-running responses, etc.)
  is still its own future commit.
