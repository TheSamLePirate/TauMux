# Refactor Roadmap — Complete

Every item called out in the original roadmap has landed on
`refactor-code-as-best-practice`. This file is kept as a record of
what was done, why some items were intentionally skipped, and what
still needs to happen before merge.

Final state of the branch at the last commit:

- 25 commits, 666 tests passing, typecheck + lint clean
- `bun test` (bare) now scopes to `tests/` — no Playwright noise
- `src/web-client/main.ts` dropped from 1133 → 701 LOC (−38%)
- Seven new focused modules (sidebar, layout, panel-interaction,
  keyboard-shortcuts) plus three new test files covering them
- Discriminated unions for `SidebandMetaMessage` and `PanelEvent`
- Compile-time coverage check on `HyperTermRPC["bun"]["messages"]`
  via `satisfies BunMessageHandlers`

---

## 1. Smoke-test what's landed — STILL PENDING

Every commit is verified by `bun test` + `tsc --noEmit`, but neither
runner boots the webview. An interactive `bun start` is the real
smoke test and has **not** been run against this branch's final
state. Before merge, walk the original roadmap's checklist:

- App boots without devtools errors
- Create / split / close panes (terminal, browser, agent)
- Drag a pane onto another — each drop position (left/right/top/
  bottom/swap) renders the correct overlay and commits
- `/help`, `/settings`, `/hotkeys`, `/resume`, `/tree` dialogs
- Slash-menu filter + Tab/Enter autocomplete
- ⌘F search bar, next/prev, Escape to close
- Switch / close / rename workspace, set color
- Pi agent: prompt, model switch, compact, new session, fork
- Web mirror: connect browser tab, verify output streams, resize,
  sidebar sync, notifications

**Riskiest changes** to focus on:

- Keyboard shortcuts — the entire keydown handler is now data-driven;
  exercise the browser-pane context gate, the palette/settings
  preemption ladder, and every ⌘⌥/⌘⇧ combo.
- SidebandMetaMessage / PanelEvent narrowing — affects every
  sideband-rendered panel plus the drag/resize feedback loop.

Also run `bun run test:e2e` (Playwright) once the app is verified
booting.

---

## 2. Web-client extractions — DONE

`src/web-client/main.ts` had three medium-sized concerns peeled off
in commit `5f5ed33`:

- **`src/web-client/sidebar.ts`** — `applySidebarVisibility`,
  `updateWorkspaceSelect`, `renderSidebar`, click delegation for
  `clear-notifs` / `clear-logs`, plus `escapeHtml`. Tests in
  `tests/web-client-sidebar.test.ts` (18).
- **`src/web-client/layout.ts`** — pure `computeRects` tree walker
  plus the side-effectful `applyLayout` / `applyMirrorScale` /
  `scaleTerminals` DOM pass. Tests in
  `tests/web-client-layout.test.ts` (9).
- **`src/web-client/panel-interaction.ts`** — `setupPanelMouse` /
  `setupPanelDrag` / `setupPanelResize` with a shared
  `startPointerDrag` helper that dedup'd the three gestures'
  `document` listener setup. Tests in
  `tests/web-client-panel-interaction.test.ts` (11).

---

## 3. Keyboard shortcuts — DONE

Commit `15ff5c1`. `src/views/terminal/keyboard-shortcuts.ts` defines
`Binding<Ctx>` and `keyMatch()` helpers; `src/views/terminal/index.ts`
now holds two data tables (`HIGH_PRIORITY_BINDINGS`,
`KEYBOARD_BINDINGS`) that a small dispatcher walks.

Each binding carries `id`, `description`, `category`, optional `when`
predicate, `match`, and `action`. A future command palette or help
dialog can enumerate the same arrays.

---

## 4. Types polish — DONE

### 4a. Discriminated unions (commit `04f046f`)

- `SidebandMetaMessage = SidebandFlushMessage | SidebandContentMessage`.
  The parser narrows at the wire boundary and every downstream
  consumer (webview `Panel`, bun web state, web-client store, RPC
  schema) now holds the narrower `SidebandContentMessage`, so a flush
  op can't leak into the render path.
- `PanelEvent` is a six-variant union: `PanelPointerEvent`,
  `PanelWheelEvent`, `PanelDragEndEvent`, `PanelResizeEvent`,
  `PanelCloseEvent`, `PanelErrorEvent`. Branches that used to spread
  optional `x/y/width/height` across every kind now handle each
  variant explicitly.

### 4b. THEME_PRESETS palette factory (commit `abc524f`)

`createAnsiPalette(tuple)` takes an ordered 16-color tuple. Each
preset drops from ~26 lines of named properties to ~4 lines of hex
strings. `DEFAULT_SETTINGS` now references `THEME_PRESETS[0]` instead
of duplicating graphite inline.

### 4c. Bun stdio types — no action needed

Already handled in an earlier commit.

---

## 5. RPC schema completeness — DONE

Commit `04f046f`. `src/bun/index.ts` pulls the Electrobun message
handlers out into a typed `const bunMessageHandlers` with
`satisfies BunMessageHandlers`. Electrobun's native handler type
treats every method as optional; the satisfies check turns a missing
handler into a compile error, so new methods added to
`HyperTermRPC["bun"]["messages"]` can no longer silently fail at
runtime.

---

## 6. Test coverage gaps — DONE

100 new tests added across three commits:

- **`562841d`** — web-client modules (38 tests across layout, sidebar,
  panel-interaction). Covers split math at various ratios / gaps,
  nested splits, HTML escaping, event wiring, gesture coordinate math,
  throttling, and document-listener teardown.
- **`da18481`** — terminal event routers (50 tests across
  socket-actions, agent-events, browser-events). Covers required-field
  drop behavior, default-field filling, the ht-agent-prompt echo side
  effect, the extension-ui-response cancel fallback, and teardown.
- **`6522220`** — SurfaceManager smoke suite (12 tests). xterm and
  its addons are stubbed via `mock.module` so the workspace / surface
  lifecycle can be exercised without a real terminal. Covers
  `addSurface`, `removeSurface`, `focusSurface`,
  `focusWorkspaceByIndex`, `renameSurface`, sidebar toggle, font size.

Coverage still missing (not regression-critical):

- `applyLayout` pixel geometry — would need a real layout engine.
- Chip rendering and drag-drop state inside SurfaceManager — either
  a broader DOM harness or Playwright.

---

## 7. Not worth doing — unchanged guidance

### Agent-panel further decomposition

The current split (utils / messages / model / response / dialogs /
slash) already halved the file and covered every clean boundary. The
remaining 1711 lines are core orchestration: `createAgentPaneView`
(panel construction + event wiring), streaming render, state update
coordinator. Further splitting would require breaking the one
function that ties it all together, regressing to the pre-refactor
state under a different name.

### Full SurfaceManager extraction

Earlier surveys proposed pulling out `createSurfaceView` /
`createBrowserSurfaceView` / `createAgentSurfaceView` and
`settings-applier`. Both would need 10+ callback parameters for the
panelManager / effects / dividers / focus / layout touchpoints.
Mechanically doable; practically adds more ceremony than it removes.

### Per-rpc-method request/response schemas

Sketched earlier as a zod-style schema registry. The existing
`METHOD_SCHEMAS` in `src/bun/rpc-handlers/shared.ts` covers the
security-sensitive methods; adding schemas for the other ~60 methods
adds validation overhead for little real-world safety — the
TypeScript type of each handler already constrains the shape at the
call site.

### Rewriting the webview in React / Preact / Solid / …

Not in scope. The vanilla-TS + xterm.js posture is deliberate per
CLAUDE.md (performance, bundle size, no framework churn).

---

## Useful commands

```
bun run typecheck        # tsc --noEmit
bun test                 # tests/ only (bunfig.toml)
bun run test             # also rebuilds web-client first
bun run test:e2e         # playwright (requires a running app)
bun start                # electrobun dev — interactive, the smoke test
bunx eslint src/ tests/  # lint
```

---

## Summary of what this branch is NOT trying to be

Not a rewrite. Not a framework migration. Not a behavior change.
Every commit is either a pure structural move with identical
behavior, a correctness fix that fills in missing edge-case handling,
or a new test.
