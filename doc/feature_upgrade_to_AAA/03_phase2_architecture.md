# Phase 2 — Architecture detoxification

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase2.md`
**Status:** In progress — started 2026-05-16.
**Owner:** platform.
**Engineer-weeks:** ~3.0 (medium confidence).
**Lifts:** RPC handlers B→A, Web mirror B+→A, Variants B→A, Chip rendering B→A, Settings persistence B+→A, Workspaces B→A.

---

## Goal

A1 and A2 are typed-dispatch regressions: a ~180 LOC stringly-typed `dispatch(action, payload)` router in `src/bun/index.ts` re-implements the typed RPC handlers, and `web-client/protocol-dispatcher.ts` types payloads as `any`. These keep growing while features evolve. Phase 2 kills them now so new features inherit the typed boundary.

The same phase also extracts the shared modules that prevent future drift between native and mirror: chip rendering, pane-layout math, and the global `window.dispatchEvent` channels.

---

## Steps (ordered for risk + leverage)

### Step 1 — F.1 — Shared `chip-render` module

The native `surface-manager.ts:renderSurfaceChips` (~lines 2503+) and the mirror `web-client/main.ts:renderPaneChips` (~lines 800+) are two parallel implementations of the same logic. The mirror typing is `meta: any`.

Plan:
- Find the actual call sites and current shape.
- Build `src/shared/chip-render.ts` with a framework-free `renderChips(host, meta, opts)` (DOM-only, no xterm dep).
- Native + mirror both import it.
- Tests: unit tests for the pure render path; smoke tests confirm both consumers still produce the same DOM.

**Risk:** medium. Chip rendering touches user-visible UI. Mitigate with parity tests.

**Note:** the mirror already extracted `src/shared/pane-chips.ts` in an earlier sweep (per the audit doc). Verify whether F.1 still applies as written or has already partially landed.

### Step 2 — F.2 — Shared `pane-layout-math` module

Native `pane-layout.ts:computeRects` (101-152) reads module-level state via `setPaneGap`. Mirror `web-client/layout.ts:32-95` takes gap as a parameter (the better design). Drift = panes don't line up between native and mirror.

Plan:
- Build `src/shared/pane-layout-math.ts` with pure `computeRects(node, container, opts)`.
- Native `PaneLayout` class wraps it (mutation methods stay; the pure math moves out).
- Mirror `layout.ts` imports it.
- Remove the native module-level setter.
- Tests: round-trip rect parity between native and mirror for fixed trees + gaps.

**Risk:** medium. Touches the layout pipeline.

### Step 3 — A2 — `protocol-dispatcher.ts` narrowing

`web-client/protocol-dispatcher.ts:44` types `Payload = any`. The B3 sweep landed a `ServerMessage` union but the dispatcher doesn't use it.

Plan:
- Change the dispatcher signature to `(msg: ServerMessage)`.
- `switch(msg.type)` with per-branch narrowing.
- Enable `noFallthroughCasesInSwitch` (or the local equivalent).
- Tests: a compile-only test that asserts adding a `type` to `ServerMessage` without a matching case is a TS error.

**Risk:** low. Single file. Tests catch the regression class.

### Step 4 — A1 — `WebviewActionEnvelope` typed dispatch

`src/bun/index.ts:2331-2508` — ~180 LOC if/else on action strings. Each branch casts `workspaceId as string` from an untyped record.

Plan:
- Define `WebviewActionEnvelope` discriminated union in `src/shared/` mirroring the socketAction payload shapes.
- Rewrite `dispatch(envelope: WebviewActionEnvelope)` as a typed `switch(envelope.action)`.
- Existing callers stay on the old signature; add a thin runtime validator that converts the loose `(action: string, payload: object)` into the typed envelope at the webview boundary. Reject unknown actions loudly.
- `satisfies` the union against every action that webview-side code sends.
- Tests: exhaustiveness via `noFallthroughCasesInSwitch`; runtime test that an unknown action is rejected.

**Risk:** medium-high. Behaviour change in the hot path. Mitigate by landing the typed version *alongside* the string router, deprecating across two patch versions per the master-plan risk register.

### Step 5 — A6 — Typed `EventBus<EventMap>`

124 `dispatchEvent`/`new CustomEvent` sites and 25 `window.addEventListener("ht-…")` calls (per the audit). The pattern is identical at every site.

Plan:
- `src/views/terminal/event-bus.ts`: a generic `EventBus<EventMap>` keyed on literal-string union.
- Migrate `ht-*` channels incrementally — top 5 channels first as a proof of concept; the long tail in P7.
- Co-locate the union with handler signatures.

**Risk:** medium. Touching every event handler is a lot of mechanical change. Mitigate by migrating channels one-at-a-time, each a separate PR.

**Likely outcome for this session:** land the EventBus class + 2–3 channels as a pattern; defer the long tail.

### Step 6 — A7 — `VariantContext` (drop globals)

`__tauSurfaceManager` / `__tauNotifyWorkspaces` / `__tauFocusedSurfaceId` window globals. Variant code reads them; main code sets them.

Plan:
- Define `VariantContext` interface with the methods variants need.
- Construct one and pass it into `VariantController`.
- Remove the four globals.
- Tests: grep assertion that `__tau` globals are gone.

**Risk:** low. Mechanical refactor.

### Step 7 — F.6 — Settings JSON-schema source-of-truth

Today: `AppSettings` type, `DEFAULT_SETTINGS` constant, `validateSettings` function, and migrations are all hand-maintained in separate places.

Plan:
- Single `settings.schema.ts` declaring shape + defaults + migrations.
- Generate `AppSettings`, `DEFAULT_SETTINGS`, `validateSettings` from it.
- Tests: schema validation tests.

**Risk:** medium. Touches everywhere settings are read. Defer to a separate PR if Phase 2 is already overflowing.

### Step 8 — F.11 — Extract `WorkspaceCollection` from `SurfaceManager`

`SurfaceManager` is 2717 LOC. Workspace operations are a logical sub-class.

**Risk:** high. Large refactor of the central class. Defer to P7 polish unless explicitly scoped here.

### Step 9 — F.10 — Move remaining ad-hoc handlers into `src/bun/rpc-handlers/*.ts`

Per the audit, most handlers already moved. Confirm no stragglers remain.

---

## Per-step acceptance criteria

| Step | Acceptance |
|---|---|
| 1 | `src/shared/chip-render.ts` (or confirmation that `pane-chips.ts` covers this); native + mirror import it; parity test green. |
| 2 | `src/shared/pane-layout-math.ts`; native + mirror import it; rect parity test green. |
| 3 | `protocol-dispatcher.ts` accepts `ServerMessage` union; no `: any` remains; exhaustive switch test green. |
| 4 | `WebviewActionEnvelope` union exists; `dispatch` is a typed switch; unknown-action runtime test green. |
| 5 | `EventBus` class exists; ≥ 2 channels migrated; pattern documented for the long tail. |
| 6 | `VariantContext` interface; `__tau*` globals removed; grep assertion green. |
| 7 | Single schema source; generated types match handwritten ones byte-for-byte during migration. |

---

## Lifts to track in `feature_grades.json`

- `rpc-handlers` B → A (after Step 4 — typed dispatch).
- `web-mirror` B+ → A (after Step 3 — typed protocol-dispatcher).
- `app-variants` B → A (after Step 6).
- `pane-chip-rendering` B → A (after Step 1).
- `pane-layout` A → S (after Step 2).
- `workspaces` B → A (partial — full lift requires F.11 in P7).
- `settings-persistence` B+ → A (after Step 7).

---

## Rollback

Every step lands as its own PR. The risk-mitigated approach (typed alongside string for one cycle) means A1 in particular can be safely reverted by removing the typed path without leaving the codebase broken.

---

## Open questions

1. **Whether F.1 has already landed via `src/shared/pane-chips.ts`** — Phase 0 audit noted this; verify before duplicating work.
2. **Scope cap for this session:** the master plan sizes Phase 2 at 3 engineer-weeks. Landing all eight items in one session is unrealistic. Confirm with the user which to prioritise.

---

## Exit criteria

- `tsc --noEmit` clean; no `: any` in `protocol-dispatcher.ts`.
- `grep -rn "__tauSurfaceManager\|__tauNotify" src/` returns 0 lines.
- Both consumers of pane-chip rendering import from a shared module.
- Native and mirror `computeRects` are the same function (different wrappers).
- `bun test` green; `bun run report:feature-grades:check` green after the JSON update.
