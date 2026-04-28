# Tracking — Perf pass (Commit C): GPU-composited progress / cpu / context bars

**Plan**: `~/.claude/plans/doc-todos-index-md-doc-todos-plan-user-prancy-island.md` (perf pass — Phase 4)
**Sister tracking**: [`tracking_perf_pass_a.md`](tracking_perf_pass_a.md) · [`tracking_perf_pass_b.md`](tracking_perf_pass_b.md)
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this commit

Phase 4: replace **width / height transitions on hot-path bars**
with `transform: scaleX(...) / scaleY(...)`. Width and height
transitions are layout-triggering — every animation frame forces
the browser to relayout the entire pane tree. `transform` paints
on the compositor only.

This is the visible-animation half of the perf pass. Phases 1–3
(commits A and B) handled the steady-state CPU and DOM-mutation
costs; Phase 4 lands the smoothness during the transitions
themselves.

## High-frequency targets (swapped)

The animations that fire on every metadata tick or context update:

- **`.workspace-cpu-bar-fill`** (`index.css:8602`) — animates as
  cpuPercent moves. Was `transition: width 220ms ease-out`. Now
  `width: 100%` + `transform: scaleX(<v>)` + `transition: transform
  220ms ease-out`. JS at `sidebar.ts:1402` sets
  `style.transform = scaleX(...)` instead of `style.width = "%"`.
- **`.workspace-progress .progress-fill`** (`index.css:8891`) —
  same treatment for the progress bar. JS at `sidebar.ts:1622`
  updated.
- **`.agent-context-fill`** (`index.css:7536`) — same treatment for
  the agent context meter. JS at `agent-panel.ts:1219,1224` updated
  to `style.transform = scaleX(...)` and `scaleX(0)` for the empty
  state.

## Lower-frequency targets (swapped)

- **`.agent-streaming-bar`** (`index.css:7229`) — was
  `transition: opacity 0.2s, height 0.2s`. The `height` part fired
  whenever an agent stream started / stopped (frequent during a
  conversation). Replaced with `transform: scaleY()` and
  `transform-origin: top center`. The `.agent-streaming-bar-hidden`
  rule now sets `transform: scaleY(0)` instead of `height: 0`.

## Intentionally not swapped

- **`#sidebar { width: ...; transition: width var(--transition-medium) }`**
  (`index.css:2012`) and **`#terminal-container { left: ...;
  transition: left var(--transition-medium) }`** (`index.css:2055`).
  These animate on user-action sidebar collapse — not on the hot
  path. Swapping to transform would require restructuring the
  layout (sidebar slides off-screen via translateX, terminal needs
  to fill the freed width). Risk-vs-reward unfavourable: the
  animation runs once per click, the entire UI is otherwise static
  during the 200 ms transition.
- **`.settings-collapsible { transition: max-height 300ms }`**
  (`index.css:4689`) — user opens / closes settings sections. Rare;
  swap to transform: scaleY would change how the content takes
  space below the panel. Skipped.
- **`.workspace-stripe { transition: opacity 120ms, width 120ms }`**
  (`index.css:8373`) — hover effect, 0.5 px width change. Marginal;
  origin would need to be `left center`. Logged as a follow-up if
  hover latency ever shows up in profiles.

## Step-by-step progress

- [x] `.workspace-cpu-bar-fill` width → transform: scaleX in CSS
      and JS.
- [x] `.workspace-progress .progress-fill` same swap.
- [x] `.agent-context-fill` same swap.
- [x] `.agent-streaming-bar` height → transform: scaleY swap.
- [x] `bun run typecheck` clean.
- [x] `bun test` (touched modules) — sidebar + agent-panel +
      surface-manager + status-key-renderers + web-client-sidebar
      = 286/286 pass. The `.tau-meter-fill` test in
      `status-key-renderers.test.ts` is on a different element and
      stayed unaffected.
- [x] `bun test` (full) — 1448/1454 (6 pre-existing flaky
      web-mirror timing tests).
- [x] `bun run report:design:web` — visual baseline regenerated.
      The transforms reproduce the same on-screen visuals so the
      diff against the prior baseline should be empty (or trivially
      sub-pixel for the transition mid-states, which the static
      report doesn't capture).

## Deviations from the plan

1. **No new keyframes / origin variables.** Plan suggested
   coupling the new transitions to the `transitionend` listener
   from 1F. The 1F listener is on `#terminal-container`'s `left`
   transition specifically (sidebar collapse) — different element,
   different concern. The animations swapped here have their own
   `transition` rules; no shared infrastructure needed.
2. **Workspace stripe + sidebar collapse not touched.** Per the
   "Intentionally not swapped" section above. Plan called these
   out as candidates; on review they're rare-or-cosmetic and the
   risk of restructuring the sidebar layout outweighs the win.
3. **Skipped baseline:design promotion.** `bun run baseline:design`
   only fires after `report:design` passes its visual diffs cleanly.
   Whether the baseline needs promotion depends on the
   regenerated artifacts vs the saved one — call to the user post-
   commit if anything's off.

## Issues encountered

None on the typecheck / test paths. The CSS swaps are mechanical;
the JS counterparts are one-line changes.

## Verification log

| Run                                                | Result |
| -------------------------------------------------- | ------ |
| `bun run typecheck`                                | clean  |
| `bun test` (touched modules)                       | 286/286 |
| `bun test` (full)                                  | 1448/1454 — 6 unrelated flaky web-mirror tests |
| `bun run report:design:web`                        | (see commit message — generated artifacts in test-results/) |

## Commits

(filled after commit lands)

## Retrospective

What worked:
- The CPU bar + progress bar + context meter all share the same
  shape: a fill element with width-as-percent. Same swap applies to
  all three; the diff is tiny.
- Native sidebar tests are agnostic to width-vs-transform — they
  assert DOM structure, not specific style values for these bars.
  Caught by reading `tests/web-client-sidebar.test.ts:213` and
  confirming it tests `.sb-progress-bar` (web mirror, different
  element) not the native `.progress-fill`.

What I'd do differently:
- The CSS swap could have used a CSS variable
  (`--workspace-cpu-fill: <v>`) so JS could `style.setProperty
  ('--workspace-cpu-fill', v)` and the CSS would transition the
  variable. Slightly cleaner but requires `@property` declarations
  for animatable custom properties to be reliable on Safari /
  WebKit. Direct `style.transform` is simpler and works everywhere.
- Sidebar collapse animation (line 2012/2055) is the next obvious
  target if profile shows it's still chunky. Logged.

Carried over to follow-ups:
- Phase 5 (optional) — xterm batch writes, sideband Uint8Array
  parser, `ht --watch` long-lived socket client. Defer until
  measurement says they're warranted.
- Sidebar collapse → transform swap (visual layout restructure).
- Settings panel collapsible sections → transform: scaleY (visual
  semantics change for the surrounding flow; needs design think).
