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
