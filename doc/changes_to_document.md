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
