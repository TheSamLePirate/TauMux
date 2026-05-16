# Tracking: aaa_sidebar_file_explorer

## Progress
- Audited current explorer row/icon rendering and CSS.
- Added UI-side file presentation classifier for exact filenames, tests/stories, extensions, folders, symlinks, and fallback categories.
- Updated file rows to use stable twisty cells, semantic icon/badge cells, optional hints, and richer tooltips.
- Added polished category colors and badge styling in the native sidebar CSS.

## Deviations
- Used compact text badges for many file types instead of adding many SVG templates; this gives clearer recognition in the narrow sidebar.
- Kept the change native webview-only; no HTTP mirror changes.

## Issues / risks
- `AGENTS.md` remains modified in the working tree from outside this task.
- Full `bun test` was already run after the previous explorer pass; for this visual-only classifier pass, targeted tests plus typecheck were run.

## Validation
- `bun run typecheck` — passed.
- `bun test tests/sidebar-file-explorer.test.ts tests/workspace-card-settings.test.ts` — passed.
- `bun start` — launched in a τ-mux split labeled “Verify AAA sidebar file icons”.

## Commit
- Committed in `88048c8` (`Add native sidebar CWD file explorer`).


## AAA follow-up polish
- Added directory-listing summary metadata (`totalEntries`, hidden-excluded count, ignored-excluded count) so the native explorer can explain what is shown vs filtered.
- Added an explorer header with shortened root path, filtered-count summary, and a New File action that opens a create-enabled CodeMirror split.
- Improved row accessibility with `role=tree/treeitem`, `aria-level`, directory `aria-expanded`, richer labels, focus-visible styling, and tooltips containing path, type, size, modified time, and errors.
- Replaced the narrow size-only column with compact size + relative modified-time metadata.
- Tightened editor integration so sidebar-created files pass `create: true` into `splitEditorSurface`.

## Validation — AAA follow-up
- `bun run typecheck` — passed.
- `bun test tests/sidebar-file-explorer.test.ts tests/audit-guideline-do-donts.test.ts` — passed as part of combined validation.
- `bun test` — passed (1724 tests).
- `bun start` — launched in a τ-mux split labeled “Verify AAA sidebar file explorer”.
- Follow-up commit: `1de11b9` (`Add native editor and polish file explorer`).
