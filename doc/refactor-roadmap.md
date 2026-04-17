# Refactor Roadmap

What's left to do on the `refactor-code-as-best-practice` branch to
call the codebase "perfect". Ordered roughly by leverage-per-effort,
highest first. Each item lists where it is, what it'd involve, what
it'd unlock, and what's risky.

Current state snapshot (end of sprint):

- 18 commits on the branch, 566 tests passing, typecheck + lint clean
- Five god-objects broken into 24 focused modules
- `@types/node` back on `^20.19.0`, happy-dom scoped per-file for DOM tests
- `bun start` has NOT been verified end-to-end — interactive Electrobun
  window required. Do this first.

---

## 1. Smoke-test what's landed

**Before anything else.** All extractions were verified by `bun test`
+ `tsc --noEmit`, but the webview code doesn't load under either.
An interactive `bun start` is the real smoke test.

**What to check:**

- App boots without errors in the devtools console
- Create / split / close panes (terminal, browser, agent)
- Drag a pane onto another — each drop position (left/right/top/
  bottom/swap) should render the correct overlay and commit
- `/help`, `/settings`, `/hotkeys`, `/resume`, `/tree` — all dialogs
- Slash-menu filter + Tab/Enter autocomplete
- ⌘F search bar, next/prev, Escape to close
- Switch workspaces, close workspace, rename workspace, set color
- Pi agent: prompt, model switch, compact, new session, fork
- Web mirror (enable via menu): connect a browser tab, verify output
  streams, resize, sidebar sync, notifications
- **Regression-smell areas** — the drag/drop state machine and the
  socket-actions dispatcher are the biggest pure mechanical moves;
  test those paths first.

If anything breaks, the blame lands cleanly because each commit is
one extraction.

---

## 2. Finish `src/web-client/main.ts` (1133 lines remaining)

Two medium-leverage extractions remain. Everything else in the boot
closure (DOM element lookups, render orchestration, pane reconciler,
chips, panels, glow, misc) is either core orchestration or too
DOM-entangled to peel off cleanly.

### 2a. Sidebar rendering + listeners → `src/web-client/sidebar.ts`

- **Lines:** roughly 470–595 of `main.ts` (applySidebarVisibility,
  updateWorkspaceSelect, renderSidebar, attachSidebarListeners)
- **Estimated extraction:** ~130 lines
- **Risk:** MEDIUM — HTML is built by string concat with `escapeHtml`
  sprinkled in; every event handler closes over `store`, `sendMsg`,
  and DOM refs
- **Dependencies to inject:** `store`, `sendMsg`, the sidebar root +
  toggle button elements, and the `escapeHtml` helper (already
  defined inline — could move to a util file)
- **Unlocks:** testable sidebar render against a fake store, easier
  theme/keyboard-nav changes later
- **Why not done:** no DOM tests for this module yet, so the value
  of extracting isn't fully realized without also writing 15–20
  sidebar tests

### 2b. Layout + geometry → `src/web-client/layout.ts`

- **Lines:** roughly 610–715 of `main.ts` (computeRects, applyLayout,
  scaleTerminals, applyMirrorScale)
- **Estimated extraction:** ~125 lines
- **Risk:** MEDIUM — applyLayout reads `terms`, `panelsDom`, viewport
  state, sidebar state; the recursive rect computation is pure
- **Dependencies to inject:** `container` element, `terms` and
  `panelsDom` maps, current state (for viewport + sidebar + focused)
- **Unlocks:** the pure `computeRects(node, bounds)` tree walker
  becomes trivially testable; separating "compute rects" from "apply
  them to DOM" is the real structural win
- **Why not done:** splitting pure compute from side-effectful apply
  is the actual refactor — mechanical move alone isn't worth much

### 2c. Panel interaction helpers (not fully extracted yet)

- **Lines:** ~810–980 (setupPanelMouse, setupPanelDrag,
  setupPanelResize)
- **Estimated extraction:** ~175 lines
- **Risk:** LOW/MEDIUM
- **Dedup win:** each of the three functions redefines `sendXY`,
  `txy`, and `document` listener cleanup
- **Why not done:** mouse/touch gesture code needs end-to-end
  verification; without Playwright coverage for the web-mirror
  panels, subtle regressions would ship silently

---

## 3. Keyboard shortcuts extraction (HIGH cost)

- **File:** `src/views/terminal/index.ts`
- **Lines:** ~720–940 (~225-line keydown handler)
- **Why it's hard:** closes over ~15 local functions — `toggleSidebar`,
  `openCommandPalette`, `toggleProcessManager`, `openSettings`,
  `copySelection`, `pasteClipboard`, `selectAll`, `requestSplit`,
  `promptRenameWorkspace`, `promptRenameSurface`, and others. The
  context bundle would be the largest we've assembled.
- **Shape of the extraction:** `registerKeyboardShortcuts(ctx)` that
  takes a `KeyboardShortcutsContext` callback bundle and wires the
  single `keydown` listener. Internally represent bindings as a
  `Binding[]` array: `{ match: (e) => bool, action: () => void,
  description?: string, category?: string }`. That structure also
  becomes the natural input for the help dialog.
- **Unlocks:** one source of truth for every keybind; command palette
  could be built from the same data; a keybind-dump command becomes
  trivial
- **Risk assessment:** LOW if you go straight to the data-driven
  form. The mechanical "wrap the existing switch in a module" move
  would be the same HIGH cost for nearly no benefit.

---

## 4. Types polish

### 4a. Sideband protocol: `SidebandMetaMessage` + `PanelEvent`

- **File:** `src/shared/types.ts:178–224`
- **Issue:** both interfaces use loose optional fields (`x?`, `y?`,
  `width?`, `height?`, `byteLength?`, `timeout?`) with no
  discrimination between message variants. `ContentType = string & {}`
  silently allows any string at runtime even though the parser
  enforces specific literals.
- **What to do:** turn both into proper discriminated unions on `type`:
  ```ts
  type SidebandMetaMessage =
    | { id: string; type: "image"; format: ImageFormat; byteLength: number; ... }
    | { id: string; type: "svg"; byteLength: number; ... }
    | { id: string; type: "clear" }
    | { id: string; type: "flush"; dataChannel?: string }
    | ...
  ```
- **Affected call sites:** `src/bun/sideband-parser.ts`, all the
  fd4-writer scripts, `src/web-client/main.ts` panel reconciler
- **Risk:** MEDIUM — every consumer currently over-accepts, so
  narrowing may surface real bugs. That's the point.
- **Unlocks:** typed script authoring for sideband producers; the
  parser's validation can shrink because the compiler carries more
  of the load

### 4b. THEME_PRESETS palette factory

- **File:** `src/shared/settings.ts` (~1000 lines of repetitive
  ANSI color literals)
- **What to do:** extract a `createAnsiPalette(base, overrides)`
  factory and express each preset as `base + 16-color array`. Each
  preset drops from ~80 lines of literals to ~20.
- **Risk:** LOW — pure data restructuring, no runtime behavior change
- **Unlocks:** adding a new theme becomes a 10-line exercise rather
  than copy-pasting a full preset

### 4c. Bun stdio types — no further action

Already handled in the `Unpin @types/node` commit. The narrowing
casts (`as ReadableStream<Uint8Array>`, `as Bun.FileSink`) are
documented inline. If `@types/bun` ever stops unioning `number`
with the stream types, strip them.

---

## 5. RPC schema completeness — nice-to-have

- The extracted `rpc-handlers/*` modules all satisfy the dispatch
  table manually. A compile-time check that every method declared in
  `HyperTermRPC["bun"]["messages"]` has a corresponding entry in
  one of the domain modules would catch drift.
- Shape idea: a `Satisfies<HyperTermRPC["bun"]["messages"], typeof methods>`
  helper that errors if a method is missing or extra.
- Effort: LOW. Value: LOW-MEDIUM. Only matters if the RPC surface
  starts drifting.

---

## 6. Test coverage gaps we know about

- **`src/web-client/*`** — zero unit tests. Any of the extractions in
  §2 become real wins once paired with a ~10–20-test module.
- **`src/views/terminal/index.ts`** — the three extractions done
  (agent-events, browser-events, socket-actions) were committed
  without DOM tests. The event routing is mechanical enough that
  tests would mostly exercise the dispatch-table shape; add ~30 tests
  spread across the three modules to match the agent-panel coverage.
- **`src/views/terminal/surface-manager.ts`** — the pure extractions
  (workspace-factory, sidebar-state, pane-drag helpers, terminal-search)
  all got tests. The non-pure surface-manager methods themselves
  (switchToWorkspace, removeSurface, focusSurface, applyLayout) are
  still untested; a happy-dom suite for SurfaceManager would be a
  ~day's work and catch regressions across the whole webview refactor.

---

## 7. Not worth doing (captured so we don't re-argue it)

### Agent-panel further decomposition

The current split (utils / messages / model / response / dialogs /
slash) already halved the file and covered every clean boundary. The
remaining 1711 lines are the core orchestration: `createAgentPaneView`
(panel construction + event wiring), streaming render, state update
coordinator. Further splitting would require breaking the one
function that ties it all together, which means passing the whole
view around as a parameter — a regression to the pre-refactor state
under a different name.

### Full SurfaceManager extraction

Earlier surveys proposed pulling out `createSurfaceView` /
`createBrowserSurfaceView` / `createAgentSurfaceView` and
`settings-applier`. Both would need 10+ callback parameters for the
panelManager/effects/dividers/focus/layout touchpoints. Mechanically
doable; practically adds more ceremony than it removes. Skip.

### Per-rpc-method request/response schemas

Sketched in earlier surveys as a zod-style schema registry. The
existing `METHOD_SCHEMAS` in `src/bun/rpc-handlers/shared.ts` covers
the security-sensitive methods; adding schemas for the other ~60
methods adds validation overhead for little real-world safety — the
TypeScript type of each handler already constrains the shape at the
call site. Don't.

### Rewriting the webview in React / Preact / Solid / …

Not in scope. The vanilla-TS + xterm.js posture is a deliberate
choice per CLAUDE.md (performance, bundle size, no framework churn).

---

## Useful commands

```
bun run typecheck        # tsc --noEmit
bun test tests/          # unit + DOM-level suite
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
or a new test. If a commit starts to drift into design changes,
split the design change into its own PR on top of this branch.
