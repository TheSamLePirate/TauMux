# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-05-05 — pi-extensions/ht-bridge "follow the pi session model" + the new claude-integration `tau-mux` skill are documented in website-doc/integrations/pi.md and website-doc/integrations/claude-code.md (en + fr), changelog (en + fr), and the system version docs were bumped to 0.2.82._

## Pending — M11 web mirror parity (0.2.85)

- **Web mirror gains theme + settings broadcast.** New `settingsSnapshot` and `htKeysSeen` envelopes on the v2 protocol carry the user's chosen theme preset, ANSI palette, font, density, status-bar key order, and `ht set-status` discovery list to every connected web client. Sensitive fields (auth token, telegram bot token, allowed user ids) are intentionally dropped by `pickWebSettings` and never reach the wire. The browser mirror now switches palette without reload when the user picks a different theme in the native settings panel.
- Surface in `website-doc/src/content/docs/api/system.md` (envelope additions) and `cli/system.md` (no CLI change but bump the version note). Translate both content blocks into French.

## Pending — M12 web mirror parity bottom status bar (0.2.86)

- **Web mirror gains a bottom status bar.** A 26 px fixed bar at the foot of the browser mirror runs the same data-driven `renderStatusKey` registry the native bottom bar uses — workspace identity, CPU/mem meters, focused fg / cwd / branch, plus the `ht set-status` bridge keys. Three zones (identity / meters / focus) match the native zone split. Tokens from `theme-bridge` recolour the bar so a theme switch in native settings reflects in the browser mirror without reload.
- **Shared registry refactor.** `src/views/terminal/status-renderers.ts` and `status-keys.ts` moved to `src/shared/status-render.ts` and `src/shared/status-keys.ts`. The native-only DOM-querying keys (`model`, `kind`) now register from `src/views/terminal/native-status-keys.ts` via a new `registerStatusKey()` API; the shared registry stays pure-data. `Meter` extracted to `src/shared/tau-meter.ts`; `tau-primitives.ts` re-exports for back-compat.
- Surface in `website-doc/src/content/docs/api/system.md` (no API change but bump version). Translate version note into French.

## Pending — M13 web mirror parity sidebar workspace cards (0.2.87)

- **Web mirror sidebar gains rich workspace cards.** Each workspace card now renders the same content shape as the native sidebar: 3 px coloured stripe, header with dot + name + pane-count badge, focused command + listening-port chips (with +N overflow past 3), aggregated CPU + RAM stats with rolling sparkline, pinned-CWD chip row, collapsible pane list, status pills via the shared `renderStatusEntry` dispatcher, OSC 9;4 progress bar. Manifest cards are stubbed (the real `runScript` action is deferred to M14).
- **Shared sidebar projection.** `buildSidebarWorkspaces` + helpers moved from `src/views/terminal/sidebar-state.ts` to `src/shared/sidebar-state.ts` and generalised over `SidebarStateWorkspace` (an abstract shape that both `Workspace` (native) and `ServerWorkspaceRef + sidebar.status[id]` (web) project into). Native callers route through a thin adapter shim; existing import paths unchanged.
- **New protocol envelope `selectWorkspaceCwd`.** Web client emits when a user pins a CWD from the chip row. v1 stores the selection in localStorage (key `tau-mux.sidebar.selected-cwds`); the server-side hook is null-safe so bun-side wiring is deferred to v1.1 without breaking the protocol contract.
- Surface in `website-doc/src/content/docs/api/system.md` (new client→server envelope) and `cli/system.md` (no CLI change but bump version note). Translate both content blocks into French.

## Pending — M14 web mirror parity manifest cards (0.2.88)

- **Web mirror manifest cards (npm + Cargo).** `package.json` and `Cargo.toml` cards now render in the workspace card via the shared `renderManifestCard` (extracted to `src/shared/sidebar-manifest-card.ts`). Header with icon + name + version + type chip; expanded body shows description + `bin` chips + per-script action rows with state dots (idle / running / error pulse). Cargo card auto-derives default subcommands (`build`/`run`/`test`/`check`/`clippy`/`fmt`) plus an entry per declared binary on non-workspace crates.
- **Per-manifest expand/collapse persists in localStorage** under `tau-mux.sidebar.ui-state` → `manifestsExpanded` keyed `<workspaceId>:npm` / `<workspaceId>:cargo`, mirroring the native sidebar's `expandedPackages` Set.
- **`runScript` is deferred for the web mirror v1.** Action-button clicks dispatch the same `ht-run-script` window CustomEvent the native sidebar uses, but the web client only logs + fires a Web Notification. Real surface spawning is tracked in `doc/deferred_items.md` as item M14-1 (v1.1).
- Surface in `website-doc/src/content/docs/api/system.md` (no API change but bump version) and `cli/system.md` (same). Translate both content blocks into French.

## Pending — M15 web mirror parity notification overlay (0.2.89)

- **Web mirror gains the floating notification overlay.** When a notification arrives carrying a `surfaceId`, the browser mirror anchors a card stack inside that pane container (top-right) — same DOM + auto-dismiss + hover-pause + +N overflow pill semantics as the native overlay. Up to 3 cards visible per surface; older cards collapse into the overflow pill which opens the sidebar on click.
- **Shared `NotificationOverlay`.** The 398-LOC overlay manager moved from `src/views/terminal/notification-overlay.ts` to `src/shared/notification-overlay.ts`. The native side keeps its existing `new NotificationOverlay(hooks)` call surface via a thin subclass shim that pre-binds the native `createIcon`; the web bridge passes its own 1-glyph inline-SVG shim for the close button.
- **Settings-driven.** `notificationOverlayEnabled` + `notificationOverlayMs` from the `settingsSnapshot` envelope (M11) flow into the bridge; flipping the toggle off tears down every live card immediately.
- **Surface lifecycle integration.** Notifications arriving before a pane mounts are queued and replayed by `flushQueueForSurface` from main.ts; closing a pane runs `forgetSurface` to drop the per-surface stack DOM + timers.
- Surface in `website-doc/src/content/docs/api/system.md` (no API change but bump version) and `cli/system.md` (same). Translate both content blocks into French.

## Pending — M16 web mirror parity pane chrome chips + paneGap (0.2.90)

- **Pane chrome class names match native.** Web mirror's pane DOM renamed from `.pane-bar*` / `.pane-chip*` to `.surface-bar*` / `.surface-chip*`, mirroring native. Same DOM + same class names → CSS rules can be shared without aliases.
- **Shared chip renderer.** `renderSurfaceChips` extracted from `src/views/terminal/surface-manager.ts` to `src/shared/pane-chips.ts`. Both surfaces produce identical DOM (foreground command, cwd, git, port chips) and identical signature-cached re-render skip behaviour. Port-chip click semantics differ between surfaces — handled via an injected `onPortClick(port, event)` callback so native dispatches `ht-open-external` while web opens the user's host (`window.location.hostname`) in a new tab.
- **`paneGap` flows from settings.** `LayoutView.applyLayout` now reads `state.settings.paneGap` on every frame so a host-side settings change re-distributes the panes on the next render. Constructor `gap` is the fallback before the first `settingsSnapshot` envelope lands.
- **Focus ring follows `--ht-border-focus` token.** A theme that wants a different focus tint can override the dedicated token without disturbing accent-driven chrome.
- Surface in `website-doc/src/content/docs/api/system.md` (no API change but bump version) and `cli/system.md` (same). Translate both content blocks into French.

## Pending — M17 web mirror parity plan panel + logs polish (0.3.0 — minor bump, parity feature complete)

- **Plan panel reaches the web mirror sidebar (and stays).** Pre-M17 the `createPlanPanelMirror` was mounted onto `#sidebar` but immediately wiped by `createSidebarView`'s inner-zone rebuild. Plan panel is now a fourth persistent sidebar zone (ordered first: `[plan, notif, main, log]`) owned by `createSidebarView`; the dispatcher routes `plansSnapshot` + `autoContinueAudit` envelopes through `sidebarView.setPlans` / `setAutoContinueAudit`.
- **Auto-continue audit hides when engine is off.** `state.settings.autoContinueEngine` from the M11 broadcast drives a new `setAutoContinueAuditVisible(visible)` setter on the plan-panel mirror. When the user disables auto-continue natively, the audit strip in the web mirror's plan panel hides on the next tick.
- **Logs zone polished.** Each row now carries a coloured level badge (info / warning / error / success), an `HH:MM:SS` timestamp from the entry's `at` field, an optional source label (`pi-bridge`, `ht`, …), and the message body. Click anywhere on the row copies `[HH:MM:SS] [source] [level] message` to the clipboard via `navigator.clipboard.writeText` with a hidden-textarea + `execCommand("copy")` fallback for non-secure origins. Header shows `Logs (count) (showing 10)` so the cap is explicit.
- **Web mirror parity feature is now complete.** Minor bump 0.2.90 → 0.3.0 marks the close of the M11–M17 plan. Tracker entry: `doc/tracking_web_parity_plan.md`.
- Surface in `website-doc/src/content/docs/api/system.md` (note minor bump + plan-panel placement + logs polish) and `cli/system.md` (same). Translate both content blocks into French. Update changelog to call out the parity milestone.

## Pending — M18 terminal sizing parity (0.3.3)

- **Multi-pane terminals fit perfectly.** The 0.3.1 → 0.3.2 series tried to per-pane fit via FitAddon + a deferred rAF, but a race between the per-pane `ResizeObserver` (which fires synchronously on inline-style writes) and the deferred fit closure poisoned xterm's render-service cache for any pane whose `.pane-term` hadn't reached its post-CSS-cascade size when the RO fired. New `src/shared/xterm-fit.ts` ports the native webview's `fitSurfaceTerminal` (`src/views/terminal/surface-manager.ts`): bails on zero parent dimensions, reads cell metrics from `term._core._renderService.dimensions.css.cell`, calls `_renderService.clear()` before `term.resize` so fresh metrics replace cached ones, subtracts `.xterm` CSS padding from the cell-count math.
- **One synchronous fit pipeline.** `src/web-client/layout.ts:applyLayout` now writes inline rects → forces a CSS layout flush via `void termEl.offsetHeight` → calls `fitTerminal(term, termEl)` per pane in the same tick. The deferred `requestAnimationFrame` fit pass in `reconcilePanes` is gone; the per-pane `ResizeObserver` in `createPane` no longer calls `fitAddon.fit()` directly — it routes through `layoutView.applyLayout(store.getState())` so window/sidebar/status-bar geometry changes use the same fitter as initial paint.
- **Re-fit on font/theme change.** `applySettings` now calls `fitTerminal(t, ref.termEl)` after applying `fontSize`/`fontFamily`/`lineHeight` (which invalidate xterm's cell metrics). Previously the cell count drifted until the next geometry change.
- Surface in `website-doc/src/content/docs/api/system.md` (no API change but bump version) and `cli/system.md` (same). Translate both content blocks into French.

## Pending — post-M17 sizing fix: terminals fit each pane + status-bar clearance (0.3.1)

- **Multi-pane terminals now refit per-pane.** Pre-fix, `reconcilePanes` called `term.resize(state.surfaces[sid].cols, .rows)` on every render — forcing every web-client xterm to the SERVER's authoritative size. On a multi-pane workspace (split panes) each pane's container is smaller, so xterm rendered at the wrong cell count and stale rows didn't redraw. The fix runs `fitAddon.fit()` per pane in a `requestAnimationFrame` after `applyLayout` lands the pixel rects, so each xterm matches its actual container. The per-pane `ResizeObserver` also calls `fit()` immediately on geometry change before debouncing the server-side `surfaceResizeRequest` proposal.
- **Status bar no longer clips the last terminal row.** `applyMirrorScale` (used in nativeViewport mirror mode) now subtracts the `STATUS_BAR_HEIGHT = 26` from `availH` so the scaled mirror fits between the toolbar and the bar. Non-mirror mode still relies on the `#pane-container { bottom: 26px }` CSS rule for the initial frame; the layout view writes `container.style.bottom = "26px"` inline so JS-driven layout changes (sidebar toggle, fullscreen) keep the clearance.
- Surface in `website-doc/src/content/docs/api/system.md` (no API change but bump version) and `cli/system.md` (same). Translate both content blocks into French.

## Pending — ht_run_in_split pane readiness

- **`ht_run_in_split` waits for the new pane before typing.** The pi `ht-bridge` extension now snapshots `surface.list`, handles legacy `surface.split` responses that only return `"OK"`, polls until the new surface appears, and only sends the command after `surface.wait_ready` confirms the new terminal metadata is observable. If readiness times out, it reports an error and does not send the command, avoiding lost input.
- **`surface.split` returns the created surface id when available.** The socket RPC now passes the requested source surface/CWD through the internal split dispatch and returns `{ id }` for synchronous split creation, while keeping `"OK"` as a compatibility fallback.
- Surface in website docs only if pi integration/tool semantics are refreshed in the next docs sweep.

## Pending — native sidebar CWD file explorer

- **Native sidebar workspace cards always show CWD.** The webview sidebar now renders a CWD row for every workspace card, including single-CWD cards and metadata-unavailable states.
- **Native-only CWD file explorer.** The webview sidebar gained a collapsible file explorer rooted at the selected workspace CWD, with lazy per-directory listing, refresh, dotfile and max-entry Settings controls, and no HTTP mirror wiring.
- Surface in website docs only if native sidebar settings/UI behaviour is documented in the next docs sweep.
