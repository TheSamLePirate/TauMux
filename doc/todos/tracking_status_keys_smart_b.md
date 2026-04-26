# Tracking — Plan 02 commit B: discovery + Settings UI for ht keys

**Plan**: [`plan_status_keys_smart.md`](plan_status_keys_smart.md) (commit B)
**Sister tracking**: [`tracking_status_keys_smart.md`](tracking_status_keys_smart.md) (commit A)
**Status**: done
**Status changed**: 2026-04-26
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Step-by-step progress

- [x] Bun: `htKeysSeen: Set<string>` on AppContext, populated from the dispatch `setStatus` case (only adds first-time keys; preserves insertion order)
- [x] Bun: debounced broadcast (200 ms coalesce) as `restoreHtKeysSeen` message to webview and `htKeysSeen` web-mirror broadcast
- [x] Webview: handles `restoreHtKeysSeen`, calls new `SettingsPanel.setHtKeysSeen`
- [x] AppSettings: `htStatusKeyHidden: string[]` and `htStatusKeyOrder: string[]` with `validateSettings` + `[]` defaults
- [x] Settings → Layout: renders a "Discovered ht keys" subsection — visibility toggle (●/○), reorder ↑/↓, "(not seen this session)" suffix + dim styling for stale legacy entries; informational note when no keys yet
- [x] Pure resolver `applyHtStatusKeySettings(seen, order, hidden)` shared between bottom-bar `ht-all` renderer and sidebar workspace card
- [x] Bottom-bar `ht-all` honors settings (filter + reorder via the resolver, with workspace-local fallback for keys that fired before bun's debounced broadcast landed)
- [x] Sidebar workspace card status grid honors settings (via `buildStatusPillsForWorkspace` in `sidebar-state.ts`)
- [x] Tests: 9 cases for `applyHtStatusKeySettings` (custom order, hidden, stale-order entries dropped, dedup, full-overlap-empty, newly-seen-keys-appended)
- [x] `bun run typecheck` clean
- [x] `bun test` — 952/952 pass (was 943; +9 resolver tests)
- [x] `bun run bump:patch` — 0.2.3 → 0.2.4
- [ ] Commit B — next

## Deviations from the plan

1. **Two settings fields (`htStatusKeyHidden` + `htStatusKeyOrder`)**
   instead of the plan's single `htStatusKeyOrder`. The hidden list
   is a negative — newly seen keys default to *visible* without
   touching settings. A single field would have required the order
   to be the source of visibility too, which is more confusing for
   the user (do I need to add every key I want visible?).
2. **Settings UI rendered in the existing Layout section** rather
   than a new "Status Bar" section. The plan said "two sections in
   the Status Bar settings"; in practice the layout section already
   houses the `statusBarKeys` picker, and adding a sister block under
   it kept all status-key configuration in one place.
3. **Sidebar honors the settings via `buildSidebarWorkspaces`** (a
   pure transformer) rather than the sidebar reading settings
   directly. Keeps `sidebar.ts` settings-free; surface-manager owns
   the cached settings and threads them in. Matches the existing
   pattern where `ws.statusPills` arrives pre-shaped at the sidebar.
4. **`SidebarStateInput.htStatusKey*` made optional** (`?:`) after
   the first test run revealed legacy `tests/sidebar-state.test.ts`
   fixtures don't pass them. Defensive default to `[]` inside the
   resolver call.

## Issues encountered

1. **Initial CSS edit broke the existing `statusBarKeys` reorder
   list** because I changed the shared `.status-key-order-row` grid
   template to support the new visibility-toggle column. Caught
   visually before commit; fixed by introducing a dedicated
   `.status-key-order-row.ht-key` modifier with its own
   grid-template-columns. Lesson logged in the commit-A
   retrospective applies equally here: when adding a column /
   variant, prefer a modifier class over mutating the base.
2. **`tests/sidebar-state.test.ts` 13 failures** after wiring the
   new fields into `SidebarStateInput`. Root cause: the resolver
   threw on `undefined` `htStatusKeyOrder`. Fixed by making the new
   fields optional with `[]` fallbacks rather than touching every
   test fixture.

## Open questions for the user

- The plan's spec says "Selection persists keyed by `key` name. New
  keys default to visible/end". I'm storing the negative — a
  `htStatusKeyHidden` list — so newly-seen keys are visible by
  default without requiring a write. `htStatusKeyOrder` is a
  positive list (custom order); keys not in it fall back to
  insertion order from `htKeysSeen`.

## Verification log

(empty)

## Commits

(empty)
