# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-05-05 — pi-extensions/ht-bridge "follow the pi session model" + the new claude-integration `tau-mux` skill are documented in website-doc/integrations/pi.md and website-doc/integrations/claude-code.md (en + fr), changelog (en + fr), and the system version docs were bumped to 0.2.82._

## Pending — M11 web mirror parity (0.2.85)

- **Web mirror gains theme + settings broadcast.** New `settingsSnapshot` and `htKeysSeen` envelopes on the v2 protocol carry the user's chosen theme preset, ANSI palette, font, density, status-bar key order, and `ht set-status` discovery list to every connected web client. Sensitive fields (auth token, telegram bot token, allowed user ids) are intentionally dropped by `pickWebSettings` and never reach the wire. The browser mirror now switches palette without reload when the user picks a different theme in the native settings panel.
- Surface in `website-doc/src/content/docs/api/system.md` (envelope additions) and `cli/system.md` (no CLI change but bump the version note). Translate both content blocks into French.
