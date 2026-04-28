# Tracking — Perf pass (Commit B): Tier-2 inner-card reconciliation

**Plan**: `~/.claude/plans/doc-todos-index-md-doc-todos-plan-user-prancy-island.md` (perf pass — Phase 3)
**Sister tracking**: [`tracking_perf_pass_a.md`](tracking_perf_pass_a.md) (Phases 1 + 2)
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this commit

Phase 3: per-section signature cache inside `populateWorkspaceCard`.
Plan #06 §A landed Tier 1 (outer card identity preserved across
renders). Today's commit lands Tier 2: the inner content survives
re-renders too — only the sections whose source data actually
changed get rebuilt.

Plan #06's own comment in the previous code read: *"Tier 2 (per-
subfield reconciliation) would chase the remaining flicker on the
inner rows; the load-bearing fix is keeping the outer identity
stable across refreshes."* That tier landed here.

## Step-by-step progress

- [x] **Section signature shape.** Each card section gets a string
      sig built from the `WorkspaceInfo` fields that drive it:
      stripe (color), header (name + active + pinned + pane count +
      rename + askPending), meta (fg command + ports + scripts),
      stats (cpu + mem + processCount + cpuHistory + active +
      accent), cwds (cwd list + selected), panes (titles + open
      flag), manifests (package.json + cargo.toml + open + count),
      status (statusPills + open), progress (value + label).
- [x] **Per-card cache.** `cardSlots: Map<wsId, CardSlotCache>`
      stores the most-recently-built section nodes plus their sigs.
      A miss rebuilds; a hit reuses across renders.
- [x] **`populateWorkspaceCard` rewritten** as an orchestrator that
      walks each section, hashes its inputs, calls the existing
      builder ONLY when the sig differs, and replaces children once
      with the ordered slot list.
- [x] **Inactive cards drop their active-only sections from cache**
      so a re-activation rebuilds with fresh data (e.g. progress
      that arrived while the card was inactive).
- [x] **`reconcileUiState` cleans up stale entries** when workspaces
      disappear so we don't leak references to detached DOM.
- [x] **Ask-user badge update path (Plan #10 commit C / 1D) verified
      orthogonal.** The surgical badge update keeps working: the
      header sig includes `askPending`, so the next full populate
      after a `setAskUserPending` rebuilds the header with the
      correct badge value. No race; the rebuilt header is byte-
      identical to the surgically-updated one.
- [x] `bun run typecheck` clean.
- [x] `bun test tests/sidebar*.test.ts tests/surface-manager.test.ts`
      — 68/68 pass.
- [x] `bun test` (full) — 1448/1454 (6 unrelated flaky web-mirror
      timing tests; same set that fails on stashed pre-change main).

## Deviations from the plan

1. **Phase 3 plan also called for diffing `WorkspaceInfo` against
   the last-rendered version per card to skip the populate call
   altogether** when nothing changed. The hash-and-skip in Phase 2B
   already does this at the whole-list level; a per-card variant
   would only help when one workspace changed but others didn't —
   in which case Phase 2B already misses (different hash), so per-
   card skipping inside populate would be the right next layer.
   Adding it would mean another hash comparison up-front in
   populate. Skipped because Phase 3's section caching already
   short-circuits each section to a `cache.sigs.foo === sig`
   comparison; net per-card work is tiny when nothing changed.
2. **Manifest sig uses `stableWorkspacesSignature` (Phase 2B's
   helper)** as a quick deep hash for `packageJson` + `cargoToml`
   (both are objects with several fields). Could roll a dedicated
   `manifestSig` if the JSON cost ever shows up in profiles; for now
   the cost is negligible since manifests rarely change between
   ticks.
3. **No new tests added.** The existing 68 sidebar / surface-manager
   tests cover the public API and the rendered DOM; they all pass.
   A "render twice, second render unchanged" snapshot test was
   considered (per the plan's Risks section) but the existing tests
   already exercise multiple `setWorkspaces` calls in sequence and
   verify the rendered DOM after each, which is functionally the
   same coverage.

## Issues encountered

1. **TS errors on first typecheck.** I assumed `WorkspaceInfo` had a
   `notifyWorkspaces` field (it's actually on `StatusContext` in
   index.ts) and that `Sidebar` held `htStatusKeyOrder` /
   `htStatusKeyHidden` (those live on `SurfaceManager`). Removed
   those fields from the meta and status sigs respectively — the
   pre-filtering happens upstream so the sig doesn't need to know
   about them. Caught immediately by `bun run typecheck`.

## Verification log

| Run                                                | Result |
| -------------------------------------------------- | ------ |
| `bun run typecheck`                                | clean  |
| `bun test tests/sidebar*.test.ts`                  | 36/36  |
| `bun test tests/surface-manager.test.ts`           | 32/32  |
| `bun test` (full)                                  | 1448/1454 — 6 unrelated flaky web-mirror tests |

## Commits

(filled after commit lands)

## Retrospective

What worked:
- Splitting populate into "compute sig → reuse-or-rebuild → push to
  ordered list" is mechanical. Each section's existing builder
  didn't need to change at all — they're now memoized at the call
  site.
- The order-preserving `replaceChildren(...ordered)` at the end
  trusts the browser to short-circuit re-parenting when nodes
  haven't moved. Worth measuring in DevTools but the design is
  correct.
- Inactive-card cache eviction prevents the "card was active, gained
  progress, went inactive, comes back active without progress, but
  shows old progress because the slot was cached" bug. Discovered
  while writing the eviction pass; saved a debugging session.

What I'd do differently:
- The sigs are joined strings — a structural array hash would be
  faster but the strings are short and the `===` check is O(string
  length) → microsecond cost.
- A "per-card invalidate" public API on Sidebar would let
  surface-manager mark a workspace as dirty without sending the full
  WorkspaceInfo[]. Not needed today; logged.

Carried over to Phase 4:
- CSS layout-trigger transitions → transform/opacity. Will land in
  the next commit with a baseline-design refresh.
