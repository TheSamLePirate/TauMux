# Tracking: codemirror_editor_pane

## Progress
- Added CodeMirror dependencies.
- Added shared editor surface/file types and native webview RPC messages.
- Added Bun-side editor file read/save helpers with size, binary, and mtime-conflict guardrails.
- Added editor pane UI with CodeMirror, save/reload controls, dirty state, status bar, Cmd+S, and dirty-close confirmation from the pane close button.
- Fixed editor close lifecycle by replacing clone-based listener cleanup with proper `removeEventListener`; the clone cleanup left a visible detached pane after close.

- AAA polish pass: added empty-open form, path/save-state chips, line/column + selection + size + line-ending status, conflict banner with Reload/Overwrite/Dismiss actions, force-save override after mtime conflicts, better error actions, and command-palette entries for editor open/save/reload.
- Wired SurfaceManager lifecycle, layout persistence, restore, sidebar file explorer open action, and ht CLI commands.
- Added `editor.*` socket RPC handlers and `ht edit` / `ht editor ...` CLI mapping.
- Updated `doc/changes_to_document.md` with pending website-doc notes.

## Deviations
- Implemented native webview editor only; no HTTP mirror support.
- CLI `editor.save` / `editor.reload` route through webview state because CodeMirror's current buffer lives in the webview.
- Used a 5 MB text-file cap and binary detection for v1 safety.

## Issues / risks
- Existing unrelated dirty working tree must be preserved if committing later.
- `bun add` updated `bun.lock` and dependency versions recorded by Bun; review package diff before commit.

## Validation
- `bun run typecheck` — passed.
- `bun test tests/editor-files.test.ts tests/sidebar-file-explorer.test.ts` — passed.
- After close fix: `bun run typecheck && bun test tests/editor-files.test.ts` — passed.
- `bun test` — passed (1724 tests).
- AAA pass: `bun run typecheck`, targeted editor/design-audit tests, and full `bun test` passed (1724 tests).
- `bun start` — launched in τ-mux splits labeled “Verify CodeMirror editor pane” and “Verify AAA CodeMirror editor pane”.

## Commit
- Not committed yet.
- No version bump run because no commit was made. For commit, run `bun run bump:minor` (recommended for new editor pane) or `bun run bump:patch` if treating as patch.
- Follow-up commit: `aa181a9` (`Add native editor and polish file explorer`).
