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
- Not committed yet.
- No `bun run bum:patch` run because no commit was made. Run it before committing these changes.
