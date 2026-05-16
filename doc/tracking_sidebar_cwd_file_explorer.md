# Tracking: sidebar_cwd_file_explorer

## Progress
- Analysed native sidebar card rendering, settings flow, Electrobun RPC typing, and web mirror settings boundaries.
- Added native webview-only filesystem listing RPC (`sidebarFileExplorerList` → `sidebarFileExplorerListing`).
- Added `src/bun/sidebar-file-explorer.ts` with safe lazy directory listing, sorting, caps, dotfile option, and ignored heavy folders.
- Updated native sidebar cards to always render CWD, including single-CWD and unavailable states.
- Added collapsible CWD-rooted file explorer with lazy directory expansion and refresh action.
- Added Settings controls for showing the explorer, showing hidden files, and max entries.
- Added styling in `src/views/terminal/index.css` and tests for settings validation + file listing.
- Updated `doc/changes_to_document.md` with pending documentation notes.

## Deviations
- The explorer is rendered only through the native Electrobun webview RPC path. No HTTP mirror UI/protocol changes were added.
- The explorer defaults to collapsed per workspace to protect sidebar density and filesystem performance.
- Heavy folders (`.git`, `node_modules`, build/cache outputs) remain ignored even when dotfiles are enabled to keep expansion predictable.

## Issues / risks
- `AGENTS.md` is already modified in the working tree, but this task did not edit it.
- `bun start` was launched in a τ-mux split for verification; because it is long-running, output is visible in that split rather than captured here.

## Validation
- `bun run typecheck` — passed.
- `bun test` — passed (1717 tests).
- `bun start` — launched in split to verify the app starts after UI changes.
- Design report not run; change is native webview sidebar work and the requested required checks passed. It can be run next if visual snapshots are desired.

## Commit
- Not committed yet.
- No `bun run bum:patch` run because no commit was made. Run it before committing these changes.
