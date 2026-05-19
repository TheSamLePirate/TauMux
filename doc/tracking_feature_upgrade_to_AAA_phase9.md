# Phase 9 — Observability + deferred-P8

Closes the deferred P8 items (CI coverage gate) and starts P9
proper (logging improvements + CHANGELOG.md). Phase 7 + headline
P8 already closed in earlier pushes.

## Scope

1. **CI coverage gate** (deferred P8 item) — wire
   `bun run report:coverage:check` into the GitHub workflow so a
   per-file coverage regression fails a PR.
2. **Logging** (A → S) — size-based rotation alongside the existing
   daily rotation; configurable via `HT_LOG_MAX_BYTES` env.
3. **CHANGELOG.md** — populate using the P8 `--changelog` tooling on
   real history (proves the tool round-trips on a 300+ commit range)
   and gives users a first-class release-notes file.

## Sessions

### Session 1 (2026-05-18) — CI coverage gate

`.github/workflows/ci.yml` gains a `coverage-gate` job that runs
`bun run test:coverage` then `bun run report:coverage:check` on
macOS-14. The two jobs (typecheck-and-unit + coverage-gate) run
in parallel — no serial dependency. 4 source-grep tests in
`tests/ci-coverage-gate.test.ts` lock in the job declaration so
the gate can't be silently removed in a future workflow refactor.

### Session 2 (2026-05-18) — logger size rotation

`src/bun/logger.ts` extended with size-based rotation. New:
- `resolveMaxBytes()` reads `HT_LOG_MAX_BYTES` (default 50 MiB,
  ≤ 0 disables).
- `rotateForSize()` renames `app-DATE.log` → `app-DATE.<n>.log`
  (next available index 1, 2, 3, …) and opens a fresh active
  chunk.
- `bytesInActive` tracked across writes; seeded from `fstatSync`
  on open so a same-day restart picks up where we left off.
- `PRUNE_PATTERN` extended to match the numbered rotated chunks
  (`^app-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.log$`) so the 14-day
  retention sweep prunes them too.

4 new tests in `tests/logger.test.ts`: prune-numbered-chunks,
threshold-rotate-via-console.log, env-zero-disables, and same-day-
resume-picks-up-existing-size.

### Session 3 (2026-05-18) — populate CHANGELOG.md

Ran `bun scripts/bump-version.ts patch --changelog` against the
real repo. Generated `CHANGELOG.md` from 312 commits since
v0.2.30 (Phase 6 close), grouped by conventional-commit type
(Features / Bug fixes / Performance / Refactoring / Documentation
/ Tests / Chores / Other). Exercises the P8 S1 tooling on real
history and proves the changelog generator scales to multi-
hundred-commit ranges.

## Exit criteria (P9)

| Criterion | Status |
|---|---|
| CI coverage gate wired into .github/workflows/ci.yml | ✅ |
| Logger size-based rotation (50 MiB default, env override) | ✅ |
| CHANGELOG.md populated from real history | ✅ |
| `bun test` green modulo known pty-timing flakes | ✅ 2868 / 2870 (2 known flakes) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |

Remaining stretch items (still owned by a future phase or live-env
infra):
- Failure-path Playwright cases (network loss, subprocess crash) —
  needs a live Playwright env.
- Mobile-viewport touch-target Playwright assertion (I.5) — same.
- Logger gzip of old rotated chunks — small follow-up; the chunks
  are owner-readable and 50 MiB is already manageable for
  short-term retention.
- Structured log-level filter — would need a logger API change;
  current code is fire-and-forget.

## P9 follow-up (2026-05-18) — three B-grade gap closures

After the headline P9 push, ran a sweep through remaining B-graded
gaps that don't need live-env Playwright infra:

### Workspaces — recover from truncated layout.json (`f41f2484`)

New `src/shared/layout-persistence.ts` module:
- `validatePersistedLayout(raw): raw is PersistedLayout` walks the
  full shape (activeWorkspaceIndex integer in [-1, len], boolean
  sidebarVisible, non-empty workspaces array, each workspace's
  required + optional record fields, every PaneNode subtree).
- `parsePersistedLayout(json): PersistedLayout | null` combines
  JSON.parse + validate; returns null on any failure.

`loadLayout` in `src/bun/index.ts` now calls `parsePersistedLayout`.
Crash-truncated layout.json (fsync interrupted, disk full, partial
backup restore) boots to a clean slate rather than throwing
downstream in `collectLeafIds` / `remapPaneNode`.

26 tests in `tests/layout-persistence.test.ts` cover happy paths
(minimal + nested split + activeWorkspaceIndex=-1 sentinel +
optional records), parse failures (garbage, truncated mid-string,
empty, whitespace, null, top-level array), and shape mismatches
(missing/wrong-type fields, out-of-range index, NaN ratio, single-
child split, leaf without surfaceId, unknown surfaceType, one valid
+ one malformed workspace rejected together).

### Panel-registry — max-panels cap (`b4e2e084`)

`PanelRegistry` ctor takes an optional `maxPanelsPerSurface`
(default 256, exported as `DEFAULT_MAX_PANELS_PER_SURFACE`). When a
NEW id arrives and the per-surface map is at the cap, the OLDEST
entry (smallest createdAt) is evicted before insertion. Updates to
existing ids never trip the cap. Cap clamped to >= 1 so a bogus 0
/ negative arg degrades gracefully.

13 tests in `tests/panel-registry.test.ts` cover happy paths
(create / update / clear / flush / per-surface isolation /
clearSurface) and the cap (oldest-eviction with ms-spaced
createdAt, update-doesn't-evict, clear-of-evicted-noop, per-
surface independence, cap=1, non-positive arg clamp).

### Sidebar file explorer — symlink-cycle protection (`7ac6ce8e`)

`src/shared/types.ts` `SidebarFileExplorerEntry` gains two optional
fields:
- `linkTarget: string | null` — resolved realpath of a symlink (null
  for dangling links).
- `cycle: true` — set when the link's realpath equals the listed
  directory or any ancestor.

`listSidebarFileExplorerDirectory` resolves every symlink entry via
`realpathSync` (wrapped in try/catch for dangling links) and flags
cycles via the new `isAncestorOrSelf(candidate, root)` helper. The
helper correctly anchors on the path separator so `/foo` is NOT
mistakenly treated as an ancestor of `/foobar`.

9 new tests in `tests/sidebar-file-explorer.test.ts` cover happy-
path linkTarget, self-loop, grandparent-ancestor, sibling negative,
dangling, and the isAncestorOrSelf unit cases.

### Summary

- 3 commits (f41f2484, b4e2e084, 7ac6ce8e) on top of P9 first push
- 48 new tests in 3 new/extended test files
- Three B-graded gaps lose a concrete bullet each (workspaces stays
  B until concurrent-mutation tests land; panel-registry stays B
  until the authoritative-model rework; sidebar-file-explorer stays
  B until the mirror protocol arrives)
- typecheck unchanged (2 pre-existing errors only)
- versions 0.3.146 → 0.3.148

## P9 follow-up (2026-05-19) — command-palette + CLI ergonomics

### Command palette completeness (`31723f12`, v0.3.150)

`buildPaletteCommands()` in `src/views/terminal/index.ts` previously
exposed ~26 verbs — heavy on layout / split / font / browser-open and
light on everything else, so workspace rename, pane rename, browser
navigation, theme switching, and editor open-by-path were only
reachable via memorised keychords or the settings panel.

Added ~30 entries so every UI capability is reachable via ⌘⇧P:
- **Workspace**: Rename Workspace, Close Workspace, Set Workspace Color
  (hex prompt), Set Workspace CWD (path prompt), dynamic "Switch to
  Workspace: <name>" per workspace with ⌘1..⌘9 shortcut hints on the
  first nine.
- **Pane**: Rename Pane, Copy Pane CWD (clipboard), Open Pane CWD in
  Editor (split editor pane rooted at the pane's CWD).
- **Browser** (gated on `getActiveSurfaceType() === "browser"`): Back,
  Forward, Reload, Toggle DevTools, Find in Page, Focus Address Bar,
  Zoom In / Out / Reset.
- **Theme**: one entry per `THEME_PRESETS` row, "✓" suffix on the
  active preset, applies via the same `updateSettings` round-trip the
  settings panel uses.
- **Editor**: Open File in Editor (absolute-path prompt →
  `splitEditorSurface`).
- **View**: Clear Sidebar Logs, Reveal Log File.

All entries route through existing SurfaceManager / RPC paths — no
new bun-side surface needed. Source-level completeness guard added at
`tests/command-palette-completeness.test.ts` (26 tests). Full bun
test: 2936 pass / 0 fail.

### `ht rename-workspace` / `rename-surface` auto-detection (`b1c72cfc`, v0.3.151)

Previously `ht rename-workspace NAME` required `--workspace ws:3`
even when run from inside a τ-mux pane that already exports
`HT_SURFACE`. Closed the ergonomic gap and added the symmetric
`rename-surface` verb:

- `bin/ht`: `rename-workspace` forwards `HT_SURFACE` as `surface_id`
  when `--workspace` is absent; new `rename-surface` case forwards
  `HT_SURFACE` as `surface_id` when `--surface` is absent. Help
  banner enumerates both verbs and the auto-detect rule.
- `src/bun/rpc-handlers/workspace.ts`: `workspace.rename` now uses
  `resolveWorkspaceId` (explicit → surface_id-owner → active
  workspace fallback).
- `src/bun/rpc-handlers/surface.ts`: `surface.rename` now uses
  `resolveSurfaceId` (explicit → focused surface fallback), matching
  every other surface-targeting verb.

5 new tests in `tests/rpc-handler.test.ts` + 1 in
`tests/bin-ht-help.test.ts` cover the new resolution paths. Full
bun test: 2941 pass / 0 fail.

### Summary

- 2 commits (31723f12, b1c72cfc) on top of P9 follow-up
- ~30 new palette verbs + 1 new CLI verb + 2 widened CLI verbs
- 32 new tests across 3 files (26 + 5 + 1)
- typecheck unchanged (2 pre-existing errors only)
- versions 0.3.148 → 0.3.151
