# Tracking — extract BrowserSurfaceController from SurfaceManager (H10)

Started: 2026-05-30. Source: `doc/full_app_review_2026-05.md` §3 (H10 — "Decompose SurfaceManager: a 131-method god object"). The review named the browser pass-throughs as **the cheapest first extraction** ("its logic already lives in browser-pane.ts").

This is the FIRST slice of the SurfaceManager decomposition — it establishes the `SurfaceKindController` pattern the review recommended, so the next surface kind (agent/editor/telegram) can follow the same template.

## What moved
Created `src/views/terminal/browser-surface-controller.ts` (`BrowserSurfaceController`). It now owns:
- The 17 `browser-pane` function imports (SurfaceManager keeps only `import type { BrowserPaneView }`).
- The view factory + all callback wiring (`createBrowserView`) — ~100 lines.
- All actions: navigate/back/forward/reload/evalJs/find/stopFind/devtools/injectCookies/getCookies/focusAddressBar/zoomIn/zoomOut/zoomReset + hide/show overlays.
- The private helpers `withBrowserView` + `applyBrowserZoom`.
- The cached `browserSearchEngine` state.
- Lifecycle ops the generic machinery calls: `destroyView` / `setHidden` / `syncDimensions` / `applyDarkMode` / `setSearchEngine`.

It reaches back into SurfaceManager through a small injected deps bag (`getSurface`, `getFocusedSurfaceId`, `allSurfaces`, `activeWorkspaceSurfaceIds`, `focusSurface`, `updateSidebar`) — the same pattern `PaneDragController` already uses.

## What stayed in SurfaceManager (correctly — generic surface machinery)
- `addBrowserSurface` / `addBrowserSurfaceAsSplit` / `removeBrowserSurface` (they drive the workspace/split/layout machinery; they now call `this.browser.createBrowserView`).
- `createBrowserSurfaceView` (assembles the `SurfaceView` shape; delegates pane creation to the controller).
- The browser branches inside generic methods — `removeSurface`, `applySettings`, `switchToWorkspace`, `applyLayout` — now **delegate** to `this.browser.{destroyView,applyDarkMode,setHidden,syncDimensions,setSearchEngine}`.
- The public `browser*` methods are kept as **thin forwards** to `this.browser` so the 25+ external call sites (keybindings in `index.ts`, the socket API in `socket-actions.ts`) are UNCHANGED — zero call-site churn, zero behavior change.

`SurfaceView` is now exported from `surface-manager.ts` (the controller imports it `type`-only; the runtime cycle is broken because the controller only needs the type).

## Result
- `surface-manager.ts`: **−138 net lines** (−185 / +47); 17 browser-pane imports gone; browser concern isolated in a 290-line controller.
- The browser logic is now **unit-testable in isolation** (it wasn't, as a god-object method).

## Verification (2026-05-30)
- `bun run typecheck`: ✅ clean. `bun run lint`: ✅ clean. `bun test`: ✅ **2996 pass / 0 fail** (+7 new controller tests; no mock-leak into other files).
- **Live end-to-end** (`bun start` + `ht` CLI): opened a browser surface (`[browser] created browser:1 → https://example.com`), then navigate/reload/back — all returned OK and routed through the controller, with **zero runtime errors** in the log. Exercises the full path: factory + callback wiring + container attach + SurfaceView assembly + the generic add machinery + the `applyLayout` → `syncDimensions` delegation.

## Behavior preservation
Pure code-move + delegation. No logic changed (zoom clamps, search-engine caching, callback emissions, overlay show/hide, OOPIF sync are byte-identical). The `browserInjectCookies` inline cookie type became the named `BrowserCookie` (structurally identical).

## H10 COMPLETE — all four non-terminal surface kinds extracted
Applied the same controller pattern to telegram, editor, and agent:
- `telegram-surface-controller.ts` — view factory + message/history/state broadcast handlers (glow + chime). Deps incl. `notifyGlow`. (commit `656e1bab`, v0.3.170)
- `editor-surface-controller.ts` — view factory + snapshot/save-result handlers + save/reload + title sync.
- `agent-surface-controller.ts` — view factory (10 callbacks) + event/add-message/focus handlers. (no destroy hook — agent panes use the generic container.remove())

SurfaceManager keeps the generic machinery and delegates each kind's branches; the public methods (`handleTelegram*`, `applyEditor*`/`saveEditorSurface`/`reloadEditorSurface`, `handleAgentEvent`/`agentAddUserMessage`/`agentFocusInput`) stay as thin forwards — zero call-site churn.

**Cumulative result:** `surface-manager.ts` is **−285 net lines** (vs commit 2071da80 before H10): −389/+104. The browser-pane/telegram-pane/editor-pane/agent-panel function imports are gone (only the `type` imports remain), and four cohesive controllers now own those concerns. Adding a 6th surface kind is now "one controller + one descriptor," not shotgun surgery across SurfaceManager.

### ⚠️ Controller unit tests removed (bun mock.module leakage)
I initially added per-controller unit tests that used `mock.module("./<kind>-pane", …)`. bun 1.3.9's `mock.module` is **process-global and pre-applied during collection** (and `mock.restore()` / re-mock-to-real in afterAll do NOT undo it), so the stubs leaked into the real-module tests that already exist (`browser-pane.test.ts`, `editor-pane.test.ts`, `sounds.test.ts`) — deterministically breaking `editor-pane.test.ts`. Removed all three controller test files. The extractions are pure behavior-preserving code-moves, covered by: typecheck (signatures), the full existing suite (which exercises the real pane modules + SurfaceManager), and **live `bun start` + `ht` verification** (browser surface create/navigate/reload/back end-to-end, editor open, zero runtime errors). A future controller test would need to inject the pane ops as deps (rather than mock.module) to be isolation-safe.

## Follow-ups (deferred)
- Optionally inline `surfaceManager.<kind>.X()` at call sites and drop the forwarding methods to also cut SurfaceManager's method COUNT (cosmetic; the logic/coupling reduction is done).
- A `SurfaceKindController` registry/descriptor so add/remove/restore for a new kind is one registration (the controllers are now uniform enough to unify).

## Commit / release
- Browser: **`108da04a`** (v0.3.169). Telegram: **`656e1bab`** (v0.3.170). Editor+agent (+ test removal): **`806e2852`** (v0.3.171). Not pushed.
