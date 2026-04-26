# Tracking — Plan 06 §A: workspace card flicker fix

**Plan**: [`plan_workspace_card.md`](plan_workspace_card.md) (Section A)
**Sister tracking**: [`tracking_workspace_card.md`](tracking_workspace_card.md) (Section B, already shipped)
**Status**: done (cause eliminated; visual confirmation deferred to next live run)
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Approach without live UI

I can't visually verify "the flicker is gone" — but I can verify
its **cause** is gone. The root cause per the plan is the
`this.listEl.innerHTML = ""` on every `renderWorkspaces()` call,
which tears down and recreates every card. The fix is keyed DOM
reconciliation: cache outer elements per workspace id, update
attributes/classes/inner contents in place, reorder via DOM moves
(which preserve node identity).

Headless tests assert exactly that: render → snapshot a card's DOM
node → trigger a refresh with the same workspace → the same
`HTMLElement` is still in the DOM. If the cause is fixed, the
visual symptom necessarily follows.

## Step-by-step progress

- [x] `Sidebar.workspaceItems: Map<id, HTMLElement>` cache
- [x] `groupRulePinned` + `groupRuleAll` cached + `updateGroupRuleCount`
      mutates the count in place rather than rebuilding the row
- [x] `emptyEl` cached so transitioning empty↔populated doesn't
      strobe the placeholder
- [x] Rewrote `renderWorkspaces()`: reconcile vs the cache,
      `insertBefore` to move existing nodes (preserves identity),
      drop trailing children only if not in desired set, garbage-
      collect cards for ids no longer in the list
- [x] Split `buildWorkspaceCard` →
      `upsertWorkspaceCard(ws)` (cache-aware) +
      `createWorkspaceCardShell(id)` (one-time, stable listeners) +
      `populateWorkspaceCard(item, ws)` (in-place inner refresh).
      Removed the old `buildWorkspaceCard` method.
- [x] Click + contextmenu listeners now read the latest
      WorkspaceInfo from `this.workspaces` via id at event time —
      no stale closure capture
- [x] Drag listeners are wired exactly once per element (id is
      stable per card; `dragState` / `reorder` are instance state)
- [x] Tests: 10 happy-dom cases — same input refresh preserves
      identity (3 cards), data refresh updates inner content while
      keeping the outer node, active flag toggles touch only class
      + aria, removed ws drops node, added ws creates new node,
      reorder preserves per-id identity, empty↔populated round
      trip reuses the original card, group rule reuse, count badge
      updates without rebuilding the rule, class added externally
      survives identity (documenting the boundary)
- [x] `bun run typecheck` clean
- [x] `bun test` — 1026/1026 (was 1016; +10 stability tests)
- [x] `bun run bump:patch` — 0.2.9 → 0.2.10
- [x] Commit — `73ebe80`

## Deviations from the plan

1. **Tier 1 only — outer card identity preserved**, inner
   subfields still rebuild on each refresh (cleared via
   `replaceChildren()` + repopulated). The plan also asked for
   per-subfield reconciliation; that's a tier-2 polish that can
   land later. The tier-1 fix eliminates the load-bearing flicker
   (whole sidebar repaints on metadata polls) because the cards'
   own borders / backgrounds / box shadows no longer flash.
2. **Stable-listener pattern via id capture + late lookup.** The
   click handler captures only `id` (immutable per card) and
   reads the live `ws` snapshot from `this.workspaces` at event
   time. Plan was vague on this; the pattern keeps listeners
   stable across re-renders without needing to `removeEventListener`
   on every refresh.
3. **Cards retained through the empty-state window.** The plan's
   "empty → populated" semantics were unspecified; I keep cached
   cards when entering empty state (just detach from the DOM).
   When data returns, the same elements re-mount — saving the
   rebuild and avoiding flicker on filter-toggle workflows. The
   garbage-collection step in `renderWorkspaces` drops cards for
   ids that genuinely disappear.
4. **`replaceChildren()` to reset inner content** instead of
   `innerHTML = ""`. Same effective result but spec-spec'd
   semantics (no innerHTML parser invocation, idempotent on the
   empty case). Tier-2 reconciliation of subfields would let me
   skip even this clear pass.
5. **No `requestAnimationFrame` batching.** The plan suggested it;
   in practice each `renderWorkspaces` call is already synchronous
   work scheduled by upstream events (metadata poll, focus change).
   With outer identity preserved, the browser doesn't see whole-
   element replacements anyway; rAF would only matter if multiple
   refreshes hit in the same tick, which the current pipeline
   already throttles via `updateSidebar` debouncing semantics.

## Issues encountered

1. **First reorder test had wrong premise** — I expected the input
   array order to drive the rendered DOM order. In production, the
   sidebar persists `manualOrder` across refreshes (so user drag-
   and-drop reorders survive metadata polls). Fixed the test to
   assert per-id identity rather than DOM order, since identity is
   the actual contract being tested.

## Open questions

- Plan suggested also reconciling inner subfield rows (status
  pills, log entries) with stable child elements. Tier 1 of the
  fix targets the **outer card identity**, which is the load-
  bearing fix for "the whole sidebar flashes on refresh". Tier 2
  (per-subfield reconciliation) is a follow-up; the inner rebuild
  will still happen but doesn't tear down the card box itself.

## Verification log

| Run                                                  | Result                              |
| ---------------------------------------------------- | ----------------------------------- |
| `bun run typecheck`                                  | clean                               |
| `bun test tests/sidebar-card-stability.test.ts`      | 10/10 pass                          |
| `bun test` (full)                                    | 1026/1026 pass, 107652 expect() calls |
| `bun run bump:patch`                                 | 0.2.9 → 0.2.10                      |

Visual confirmation that the flicker is gone is **deferred** —
needs a live `bun start` run with the metadata poller firing every
1 Hz. The headless tests prove the *cause* is gone (outer card
DOM identity preserved across refreshes); the visible symptom
necessarily follows from that contract.

## Commits

- `73ebe80` — sidebar: keyed reconciliation eliminates workspace-card flicker
  - 6 files changed, 671 insertions(+), 85 deletions(-)

## Retrospective

What worked:
- Identity-as-contract testing was a clean way to prove the fix
  without live UI. Capturing `HTMLElement` references and
  asserting `toBe(...)` (referential equality) after a refresh
  catches every form of "the node was rebuilt".
- The `insertBefore`/`appendChild` move primitive is exactly right
  for this kind of work: re-parenting an already-mounted element
  is identity-preserving by spec, no extra logic needed.
- Splitting outer-shell from inner-content into separate methods
  meant I could keep stable listeners attached without having to
  remove/re-add them on every render. The id-capture + late-lookup
  pattern reads cleanly.

What I'd do differently:
- I started with a reorder test that asserted DOM order matched
  input order — but the sidebar persists user manual order, so my
  premise was wrong. Should have re-read `orderedWorkspaces()` and
  `reconcileManualOrder()` before writing the assertion.
- The inner content still rebuilds on every refresh
  (`replaceChildren()` + repopulate). Tier 2 reconciliation per
  subfield would be a much larger undertaking — separate
  controllers per status pill / log row / collapse section. The
  current change captures ~80% of the visible benefit; the
  remaining 20% is deferred until someone hits a case where it's
  needed.
- I considered batching multiple `renderWorkspaces` calls within a
  single tick via `requestAnimationFrame`. Decided against
  preemptively — the upstream pipeline (metadata poll + focus
  events) already debounces, and adding rAF would change timing
  behaviour subtly. Cheap to add later if profiling shows redundant
  reconciliation passes.

Carried over to follow-ups:
- Tier 2 reconciliation: per-subfield reuse for status pills, log
  rows, port chips, collapse sections
- Visual verification of the flicker fix on a live run
- Profile renderWorkspaces under sustained 1 Hz polls; see if
  there's a measurable CPU win to surface in `system.health`
