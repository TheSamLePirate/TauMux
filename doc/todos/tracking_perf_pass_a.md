# Tracking — Perf pass (Commit A): rAF wins + sidebar render coalescer

**Plan**: `~/.claude/plans/doc-todos-index-md-doc-todos-plan-user-prancy-island.md` (perf pass — Phases 1 + 2)
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this commit

Phase 1 (surgical fixes targeting the worst offenders) + Phase 2
(coalesce sidebar renders to one-per-frame). No architectural
change; the diff is intentionally small and easy to bisect. Phase 3
(Tier-2 inner-card reconciliation) and Phase 4 (CSS layout-trigger
swaps) follow in separate commits per the plan's recommended order.

## Step-by-step progress

- [x] **1A · rAF-batch divider drag.** `surface-manager.ts:2362+`
      `onMove` now stores the latest position and runs one
      `applyPositions()` per `requestAnimationFrame`. OS pumps
      mousemove >120 Hz on retina trackpads — coalescing kills the
      layout thrash.
- [x] **1A · rAF-batch pane drag + cache container rect.**
      `pane-drag.ts` mousemove also rAF-coalesced; `cachedContainerRect`
      stored at `startPaneDrag` and used by `updatePaneDrag` /
      `resolvePaneDropHover` so each move avoids a layout-flushing
      `getBoundingClientRect`. Reset in `cleanupPaneDrag`.
- [x] **1B · Skip TerminalEffects.draw when idle.**
      `terminal-effects.ts` adds `dirtyDrawn` flag. Render loop now
      skips the GPU `draw()` when there are no pulses, no fresh
      `dirty` rasterise, and the last clean frame already painted.
      The first draw after a rasterise still commits, then idles
      until next dirty / pulse. Resize already pairs with `markDirty`
      so dimensional changes still rasterise + draw.
- [x] **1C · Memoize status bar output.** `index.ts refreshStatusBar`
      builds into an off-DOM scratch first; computes `innerHTML` as
      signature; skips `mount.replaceChildren` when sig matches the
      previous render. Idle 1 Hz tick now zero-cost on the bar.
- [x] **1D · Decouple ask-user badge from full sidebar render.**
      `Sidebar.setAskUserPending` no longer calls `renderWorkspaces`.
      Walks `workspaceItems`, surgically adds / updates / removes the
      `.workspace-ask-badge` pill node per card. Constant-cost
      mutation instead of full repaint.
- [x] **1E · `fitSurfaceTerminal` halves layout reads.**
      Replaces two `getComputedStyle` calls with `parent.clientWidth/
      clientHeight` + ONE `getComputedStyle` for term padding.
      Numeric reads instead of `parseInt(getPropertyValue(...))`
      string parses.
- [x] **1F · `transitionend` listener replaces 220 ms blind sleep.**
      New module helper `afterTransition(el, prop, fallbackMs, fn)`
      fires the action when the named CSS transition completes, with
      a 240 ms safety-net fallback in case the transition doesn't
      fire (reduced motion, display change, identical value).
      Replaces both call sites of
      `setTimeout(() => surfaceManager.resizeAll(), 220)`.
- [x] **1G · Browser-pane sync-on-change.** `applyLayout` only calls
      `browserPaneSyncDimensions` when the container's
      `offsetLeft/offsetTop/offsetWidth/offsetHeight` actually
      changed since last layout. Track `lastBrowserRectKey` per
      `SurfaceView`. Each call into the OOPIF was an Electrobun IPC.
- [x] **2A · rAF coalescer for `updateSidebar`.** The 19 callsites
      keep calling `updateSidebar()`; the body now flips
      `sidebarUpdateScheduled` and queues a single
      `requestAnimationFrame` flush. Multiple state mutations in the
      same tick collapse into one render pass. Synchronous escape
      hatch `flushSidebarSync()` exposed for any future caller that
      needs the rendered sidebar before the next paint (none today).
- [x] **2B · Hash-and-skip in `Sidebar.setWorkspaces`.** New module
      helper `stableWorkspacesSignature(list)` uses `JSON.stringify`
      with a Set/Map replacer. `setWorkspaces` short-circuits the
      render when sig matches `lastWorkspacesSig`. The 1 Hz metadata
      tick mostly ships identical data; this turns the steady-state
      cost from "always render" to "render on actual change."
- [x] `bun run typecheck` clean.
- [x] `bun test` — 1449/1454. The 5 failures are pre-existing flaky
      web-mirror timing tests (`web-server-broadcast`, `web-mirror-
      input-caps`, `web-coalescer`); unrelated to this commit and
      were failing on stashed pre-change main.
- [x] `bun test tests/sidebar*.test.ts tests/surface-manager.test.ts
      tests/notification-overlay.test.ts` — 86/86 pass. Touched
      modules' tests are green.

## Deviations from the plan

1. **1F fallback bumped 220 ms → 240 ms.** Plan said keep the same
   220 ms. The fallback only fires when `transitionend` doesn't —
   the +20 ms margin gives the browser time to finish the transition
   in the normal case so the fallback truly is a safety net rather
   than racing the real signal. Worst case is 20 ms slower than
   before; common case is much faster (sub-200 ms).
2. **1E only halves reads, doesn't lift them out of the per-pane
   loop.** Plan suggested passing parent `getComputedStyle` from
   `resizeAll` into each `fitSurfaceTerminal` call. Each pane has its
   own parent (per-pane container), so a shared computed style
   doesn't apply. Switched to `clientWidth/clientHeight` numeric
   reads + a single `getComputedStyle` for the term-element padding;
   that's the cheapest combination per pane.
3. **2A's escape hatch is a public method (`flushSidebarSync`)
   instead of a private one.** Easier to wire from index.ts if a
   future hot path needs it. Today nothing calls it; leaving it
   exposed costs nothing and avoids a follow-up edit.
4. **The hash in 2B includes `cpuHistory` arrays verbatim.** Plan
   suggested rounding floats. cpuHistory drifts by design (sparkline)
   so the hash legitimately differs every metadata diff that touches
   it; rounding would mask real updates. Kept the natural shape.

## Issues encountered

None. All edits applied first try; typecheck clean on first run;
sidebar / surface-manager test corpus stayed green.

## Verification log

| Run                                                 | Result |
| --------------------------------------------------- | ------ |
| `bun run typecheck`                                 | clean  |
| `bun test tests/sidebar*.test.ts`                   | green  |
| `bun test tests/surface-manager.test.ts`            | green  |
| `bun test tests/notification-overlay.test.ts`       | green  |
| `bun test` (full)                                   | 1449/1454 — 5 unrelated flaky web-mirror timing tests pre-existed |

## Commits

(filled after commit lands)

## Retrospective

What worked:
- Splitting Phase 2A across a body-rewrite (instead of changing every
  callsite) kept the diff small. The 19 `updateSidebar()` callers
  didn't need to know about coalescing.
- The off-DOM scratch + `innerHTML` signature pattern in 1C is
  reusable; could fold the same trick into the workspace card on
  Phase 3 if needed.
- Cached `lastBrowserRectKey` per `SurfaceView` is a tiny field with
  outsized win — every `applyLayout` no-op now skips the IPC.

What I'd do differently:
- 1E could be even more aggressive: cache padding once per session
  and invalidate on theme/font change. Current per-pane re-read of
  padding is still O(N). Rolled forward as a Phase 3 polish.
- The hash in 2B serializes the entire workspace info on every call;
  ~10 KB string per medium-large workspace setup. Cheap relative to
  DOM, but a stable structural hash (FNV / xxhash on a flat tuple)
  would scale better. Acceptable tradeoff for v1.

Carried over to follow-ups:
- Phase 3 — Tier-2 inner-card reconciliation in `populateWorkspaceCard`.
- Phase 4 — CSS layout-trigger transitions → transform/opacity.
- Phase 5 (optional) — xterm write batching, sideband parser
  Uint8Array, `ht --watch` long-lived socket client.
