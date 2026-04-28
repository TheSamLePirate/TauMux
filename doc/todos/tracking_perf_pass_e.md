# Tracking — Perf pass merge (Commit E): layout coalescer + browser-pane cache relocation

**Plan**: `~/.claude/plans/doc-todos-index-md-doc-todos-plan-user-prancy-island.md`
**Sister tracking**: [`tracking_perf_pass_a.md`](tracking_perf_pass_a.md) ·
[`tracking_perf_pass_b.md`](tracking_perf_pass_b.md) ·
[`tracking_perf_pass_c.md`](tracking_perf_pass_c.md) ·
[`tracking_perf_pass_d.md`](tracking_perf_pass_d.md)
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this commit

The architectural piece of the codex merge. Replaces the
ad-hoc `applyLayout()` callsites with a single rAF-coalesced
`requestLayout(mode)` queue, and relocates browser-pane sync
caching to the place that owns the IPC.

## Step-by-step progress

- [x] **`requestLayout("positions" | "full")` coalescer**
      added on `SurfaceManager`. Multiple callers in the same
      frame collapse into one rAF flush; "full" upgrades any
      pending "positions". Optional `after` callback invoked
      after the layout completes — used by
      `scheduleLayoutForNewSurface`.
- [x] **`applyPositions` returns the rects map** so callers
      (specifically `applyLayout`) can pass per-surface rects
      into downstream calls without re-reading layout. New
      `renderDividers=true` parameter; positions-only updates
      can opt out of the divider rebuild.
- [x] **`applyPositions` skips style writes** when the rect
      signature (stored on `container.dataset["layoutSig"]`)
      matches the previous applied value. No-op layouts no
      longer dirty the DOM.
- [x] **`applyLayout` uses the rects map** to pass the freshly-
      computed rect to `browserPaneSyncDimensions` so the
      browser pane doesn't re-read layout itself.
- [x] **Direct `applyLayout()` callsites converted to
      `requestLayout("full")`**: pane-drop commit handler,
      sidebar resize live + commit, scheduleLayoutAfterTransition,
      removeSurface fallback, resizeAll, setFontSize follow-up,
      workspace switch.
- [x] **Divider drag** drops my Phase 1A direct rAF batch in
      favor of `requestLayout("positions")` per drag mousemove
      + `requestLayout("full")` on mouseup. Cleaner — coalescing
      lives in one place now.
- [x] **`scheduleLayoutForNewSurface` flush via the coalescer**:
      passes the `after` callback through `requestLayout("full",
      after)` so focus follow-ups fire after the full pass lands.
- [x] **Browser-pane `_lastSyncedRectSig` cache moved onto the
      `BrowserPaneView`**. The `browserPaneSyncDimensions(view,
      rect?, force?)` API now takes the optional rect (avoids a
      second `getBoundingClientRect`) and a force flag. Used by
      `showBrowserWebviews` after `setHidden(false)` to force a
      fresh sync (the cache was cleared by setHidden anyway,
      but `force=true` makes the intent explicit).
- [x] **`browserPaneSetHidden` short-circuits** when the
      desired-hidden value didn't change; clears
      `_lastSyncedRectSig` on transitioning to visible so the
      next sync repaints.
- [x] **Removed my obsolete `SurfaceView.lastBrowserRectKey`
      field + the inline cache in `applyLayout`** (now lives on
      the BrowserPaneView itself).
- [x] **Kept my Phase 2A sidebar coalescer + Phase 2B
      hash-and-skip + Phase 3 Tier-2 reconciliation
      untouched** — these are orthogonal to the layout
      coalescer.
- [x] **Kept my Phase 1E `fitSurfaceTerminal` halving** —
      orthogonal.
- [x] `bun run typecheck` clean.
- [x] `bun test tests/sidebar*.test.ts tests/surface-manager.test.ts
      tests/notification-overlay.test.ts` — 86/86.
- [x] `bun test` (full) — 1457/1457.

## Deviations from the plan

1. **Sidebar resize `onLive` uses `requestLayout("full")` not
   "positions"**. Plan and codex both pick "full" here so xterm
   re-fits during the live drag (matching previous behavior); a
   "positions" choice would mean xterm shows wrong cols/rows
   until commit, which user-visibly differs. Conservative
   choice — coalescing still collapses multiple per-frame calls.
2. **Divider drag DOES use "positions"** (not "full") during
   mousemove, then "full" on mouseup. xterm doesn't refit live;
   but the dividers ARE in continuous motion so the user sees
   immediate visual response. xterm catches up on mouseup.
   Matches codex's intent.

## Issues encountered

None. Typecheck clean; touched-module tests stayed green; full
suite 1457/1457 across the entire merge.

## Verification log

| Run                                                | Result |
| -------------------------------------------------- | ------ |
| `bun run typecheck`                                | clean  |
| `bun test` (touched modules)                       | 86/86  |
| `bun test` (full)                                  | 1457/1457 |

## Commits

(filled after commit lands)

## Carried over

- Commit F: TerminalEffects budget + panel.ts translate3d +
  agent-panel rAF stream batch.
