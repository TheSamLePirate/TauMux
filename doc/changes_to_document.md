# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-05-18 — full sweep folded every M11–M18 web-mirror parity entry, the native sidebar CWD file explorer, the CodeMirror editor pane, all of Phase 7 (Cluster H token vocabulary + Cluster F.10 webview-handler extraction), Phase 8 (release-tooling C → A + post-package cross-platform + tau-focus-audit in `bun test`), Phase 9 first push (CI coverage gate, logger size rotation A → S, project `CHANGELOG.md`), and Phase 9 follow-up (layout.json validator + panel-registry cap + sidebar file-explorer symlink protection) into:_

- `website-doc/src/content/docs/changelog.md` (en + fr) — comprehensive entries for v0.2.83 → v0.3.148.
- `website-doc/src/content/docs/api/system.md` + `cli/system.md` (en + fr) — version 0.3.148 + cross-link to the new release-process page.
- `website-doc/src/content/docs/web-mirror/protocol-v2.md` (en + fr) — new envelopes documented (`settingsSnapshot`, `htKeysSeen`, `plansSnapshot`, `autoContinueAudit`, `selectWorkspaceCwd`).
- `website-doc/src/content/docs/features/web-mirror.md` (en + fr) — M11–M18 parity work folded into the "what's mirrored" table.
- `website-doc/src/content/docs/features/file-explorer-and-editor.md` (en + fr) — new dedicated feature page covering the native sidebar CWD file explorer + CodeMirror editor pane.
- `website-doc/src/content/docs/configuration/themes.md` (en + fr) — added the `--ht-*` chrome token vocabulary section with cross-component reuse rules.
- `website-doc/src/content/docs/development/release-process.md` (en + fr) — NEW page documenting `bump-version` flags, two-tier rollback, `post-package` platform branching, test sandboxing via `BUMP_VERSION_ROOT`.
- `website-doc/src/content/docs/development/observability.md` (en + fr) — NEW page documenting logger date+size rotation, `HT_LOG_MAX_BYTES` env, CI coverage gate, `audit:theming`, `tau-focus-audit`, health registry.

_(Always add new items below the cleared line above. When folding into the website, bump the version notes in api/system.md + cli/system.md + their French mirrors, and clear the backlog by overwriting the "Pending —" entries with a fresh "Backlog cleared <date> — …" line.)_

## Pending — 2026-05-19

- **Opaque ask/plan prompt chrome (v0.3.155)** — `ht_ask_user` / `ht_plan_set` prompt chrome now uses a much darker scrim and a fully opaque sheet background so prompts do not look transparent over terminal/browser content.
  - Add a changelog note (en + fr) when updating `website-doc`.
- **Pi ht-bridge workspace id footer fix (v0.3.155)** — ht-bridge now reads the current snake_case `system.identify` payload and falls back through `system.tree`, so the pi footer status line upgrades from `τ-mux surface:N` to `τ-mux ws:N surface:N` reliably after enrichment.
  - Add a changelog note (en + fr) when updating `website-doc`.
- **Ask/plan prompt top-layer reliability (v0.3.154)** — `ht_ask_user` and `ht_plan_set` approval prompts now render as global blocking prompts instead of being scoped to the currently focused pane. Native browser panes are hidden while the prompt is mounted, the prompt tier sits above settings/palette/notification rings, and the overlay is visible synchronously to avoid transparent rAF races.
  - Add a changelog note (en + fr) when updating `website-doc`.
- **IME candidate positioning fix (v0.3.153)** — native terminal and web mirror no longer override xterm's helper textarea with off-screen `!important` positioning. xterm 5.3.0's `CompositionHelper` can now keep the hidden helper textarea aligned with `.composition-view` at the cursor so IME candidate windows appear in the right place.
  - Add a changelog note (en + fr) when updating `website-doc`.
- **CLI rename verbs auto-detect target (v0.3.151)** — `ht rename-workspace NAME` no longer requires `--workspace W` when run from inside a τ-mux pane: the CLI now forwards `HT_SURFACE` as `surface_id`, the backend resolves the workspace from it (or falls back to the active workspace), so the bare `ht rename-workspace "build"` form works. New `ht rename-surface [--surface S] NAME` verb mirrors `surface.rename` over the CLI, defaulting to `HT_SURFACE` / focused surface. Help banner documents both auto-detect paths.
  - Update `website-doc/src/content/docs/cli/overview.md` (en + fr) — rename-workspace / rename-surface rows in the verb table, note the HT_SURFACE auto-detect rule.
  - Update `website-doc/src/content/docs/api/workspace.md` + `api/surface.md` (en + fr) — document the new `surface_id` param on `workspace.rename` and the active-workspace fallback; note `surface.rename` now honors the focused surface.
  - Add a v0.3.151 entry to `changelog.md` (en + fr).
- **Command palette completeness sweep (v0.3.150)** — `buildPaletteCommands()` now exposes ~30 additional verbs so every UI capability is reachable via ⌘⇧P. New entries cover workspace ops (Rename, Close, Set Color, Set CWD, dynamic "Switch to Workspace: <name>" per workspace with ⌘1..⌘9 hints), pane ops (Rename, Copy CWD, Open CWD in Editor), the full browser action set (Back / Forward / Reload / Toggle DevTools / Find in Page / Focus Address Bar / Zoom In / Out / Reset, gated on `getActiveSurfaceType() === "browser"`), one entry per `THEME_PRESETS` row with a ✓ on the active preset, an "Open File in Editor" prompt routed through `splitEditorSurface`, and view utilities (Clear Sidebar Logs, Reveal Log File). Source-level completeness guard added at `tests/command-palette-completeness.test.ts`.
  - Update `website-doc/src/content/docs/features/command-palette.md` (en + fr) to enumerate the new categories.
  - Add a one-line entry to `website-doc/src/content/docs/changelog.md` (en + fr) under v0.3.150: "Command palette: workspace/pane/browser/theme/editor verbs added so every UI capability is reachable via ⌘⇧P."
