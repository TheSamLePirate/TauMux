# Tracking — Perf pass merge (Commit F): TerminalEffects budget + panel drag + agent stream

**Plan**: `~/.claude/plans/doc-todos-index-md-doc-todos-plan-user-prancy-island.md`
**Sister tracking**: A · B · C · D · E
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this commit

Final commit of the codex merge. Three medium-sized
optimizations on layers I hadn't touched, layered onto my
existing Phase 1B / Phase 4 work where they overlap.

## TerminalEffects budget (`terminal-effects.ts`)

- **30 fps cap on `rasterise()`**. The CPU-side 2D-canvas blit
  was rebuilding every rAF tick for any focused pane with
  output. `RASTER_MIN_INTERVAL_MS = 33` gates the rebuild
  while the GPU `draw()` still runs every rAF so pulses stay
  smooth. Layered AFTER my Phase 1B `dirtyDrawn` skip —
  rasterise is now gated by both "dirty AND budget elapsed";
  draw is gated by "dirty just rasterised OR pulses active".
- **Cached host bounds + xterm geometry**. New private fields
  `hostLeft`, `hostTop`, `offsetX`, `offsetY`, `cellW`,
  `cellH`, `geometryCols`, `geometryRows`. Refreshed by
  `resize()` and on-demand by `updateGeometry()` when
  `cursorCanvasPos` notices the term grid changed. mousemove
  now reads the cached `hostLeft/hostTop` instead of calling
  `getBoundingClientRect()` per event.
- **Pulse rate-limit**. `pulseInput`: max 1 per 16 ms. `pulseOutput`:
  max 1 per 35 ms. A fast-output burst (cat large file) used
  to flood the canvas with overlapping rings; rate-limited the
  visual is identical at the cap.

## Panel drag + resize (`panel.ts`)

- **Drag uses `transform: translate3d(...)` during the drag**,
  commits final `left`/`top` on `mouseup`. Drag is GPU-
  composited; only the commit pays layout. Previously every
  mousemove wrote `left` / `top` and forced a layout reflow.
- **Resize is rAF-batched**. `pendingW` / `pendingH` capture
  the latest size; one DOM write per frame. Mouseup commits
  the final size + cancels any pending frame.
- **`contentRect` cached on Panel**. Set on
  `mouseenter` / `mousedown` / `wheel`; cleared on
  `mouseleave`. The pointer-event handlers read the cached
  rect instead of re-reading layout per event.
- File copied wholesale from codex worktree; no overlap with
  prior work.

## Agent stream rAF batching (`agent-panel.ts`)

- **`scheduleStreamRender` / `scheduleThinkingRender`** wrap
  `renderStream` / `renderThinkingStream` in
  `requestAnimationFrame`. Multiple deltas in the same tick
  collapse into one render. `streamRenderFrame` /
  `thinkingRenderFrame` track in-flight frame ids on
  `AgentPanelState`.
- **`cancelScheduledStreamRender`** called from
  `flushStreaming` so a `done` / `error` event doesn't race a
  pending rAF render.
- My Phase 4 `transform: scaleX` on `.agent-context-fill` is
  preserved (different code path; no overlap).

## Step-by-step progress

- [x] Add codex's `RASTER_MIN_INTERVAL_MS`,
      `INPUT_PULSE_MIN_INTERVAL_MS`,
      `OUTPUT_PULSE_MIN_INTERVAL_MS` constants.
- [x] Add cached host bounds + geometry fields to
      `TerminalEffects`.
- [x] mousemove reads cached `hostLeft/hostTop`.
- [x] `pulseInput` / `pulseOutput` rate-limited.
- [x] `cursorCanvasPos` uses cached geometry; refreshes via
      `updateGeometry` on cols/rows change.
- [x] `render()` rasterise gated by `RASTER_MIN_INTERVAL_MS`;
      kept my Phase 1B `dirtyDrawn` skip.
- [x] `resize()` updates cached host bounds + calls
      `updateGeometry()`.
- [x] New `updateGeometry()` private method.
- [x] `panel.ts` copied wholesale from codex (drag
      translate3d + resize rAF + contentRect cache).
- [x] `agent-panel.ts` gains `streamRenderFrame` /
      `thinkingRenderFrame` state, `scheduleStreamRender` /
      `scheduleThinkingRender` /
      `cancelScheduledStreamRender` helpers, deltas wired to
      schedule functions, `flushStreaming` cancels pending.
- [x] `bun run typecheck` clean.
- [x] `bun test tests/agent-panel*.test.ts tests/sidebar*.test.ts
      tests/surface-manager.test.ts tests/notification-overlay.test.ts`
      — 237/237.
- [x] `bun test` (full) — 1457/1457.

## Deviations from the plan

None. Codex's diffs apply cleanly on top of my work; the only
manual integration point was the TerminalEffects render loop
(my Phase 1B `dirtyDrawn` flag + codex's rasterise budget gate
co-exist as orthogonal guards).

## Verification log

| Run                                          | Result |
| -------------------------------------------- | ------ |
| `bun run typecheck`                          | clean  |
| `bun test` (touched modules)                 | 237/237 |
| `bun test` (full)                            | 1457/1457 |

## Commits

(filled after commit lands)

## Final state of the merge

Three commits this session: D (`f5fbb7a`), E (`edb928d`), F.
Combined with the original perf pass commits A (`35ccf62`), B
(`85de15c`), C (`50af9e2`), the app now ships:

- Idle CPU near zero (mine — sidebar Phases 2A/2B/3)
- 1 Hz tick rebuilds zero DOM nodes when nothing changed
- Sidebar bars GPU-composited (mine — Phase 4)
- Native stdout RPC coalesced 8 ms / 8 KB (codex)
- Layout coalescer batches all `applyLayout` callsites (codex)
- Browser-pane OOPIF sync skips when rect unchanged (codex
  location, my caching idea)
- Terminal effects: 30 fps rasterise + cached bounds + pulse
  rate-limit + my idle-skip + GPU-layer compositor hint (both)
- Panel drag uses transform: translate3d (codex)
- Agent streaming render batched per rAF (codex)
- CSS containment + will-change on surface / panel / effects
  layer (codex)
- Test suite stable at 1457/1457 (codex's flaky-test fixes)

The two parallel efforts ended up complementary; the merge
took ~1 hour and the result is strictly better than either
branch alone.
