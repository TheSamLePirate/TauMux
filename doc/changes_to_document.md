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
