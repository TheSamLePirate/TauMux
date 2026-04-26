# Tracking — Plan 06: workspace card (modular settings half)

**Plan**: [`plan_workspace_card.md`](plan_workspace_card.md) (Section B only)
**Status**: section B done; section A deferred
**Status changed**: 2026-04-26
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Section B (modular settings) only. Section A (flicker fix via keyed
DOM reconciliation) needs visual reproduction to verify that the
flicker is gone — deferring until live UI is available.

## Step-by-step progress

- [x] AppSettings: `workspaceCardDensity` + 6 boolean show toggles
      (flat fields per the existing convention)
- [x] DEFAULT_SETTINGS: density "comfortable", every show toggle
      true so legacy installs render the same as before
- [x] validateSettings: density falls back to comfortable on
      unknown values; missing toggles default true; non-boolean
      values coerce to true (corrupted JSON safety)
- [x] Sidebar honors toggles: build branches gated on
      `cardOptions.show.*`; header always visible
- [x] Density: `data-ws-card-density` attribute on the sidebar root
      driven by `Sidebar.setWorkspaceCardOptions`
- [x] CSS rules: `[data-ws-card-density="compact"]` tightens
      padding/gap and shrinks the workspace name; `="spacious"`
      loosens both. Comfortable is the unmodified baseline.
- [x] Settings UI: "Workspace card" subsection under Layout with
      density segmented control + 6 toggles (each carries a short
      "what does this section show" note)
- [x] Tests: `tests/workspace-card-settings.test.ts` — defaults
      shape, valid value preservation, spacious accepted, invalid
      density falls back, missing-fields back-compat, non-boolean
      show coercion
- [x] `bun run typecheck` clean
- [x] `bun test` — 998/998 (was 992; +6 settings tests)
- [x] `bun run bump:patch` — 0.2.7 → 0.2.8
- [ ] Commit — next

## Deferred

- **Flicker fix (Section A)** — keyed reconciliation refactor.
  Visual verification needed.
- **Drag-reorder for `statusPillOrder`** — already shipped as part
  of Plan #02 commit B (Settings → Layout → Discovered ht keys).
- **Per-key log tail line count slider** — small follow-up.
- **Notification badge toggle** — currently rendered inline; clean
  up only after the badge UI itself is reviewable.

## Deviations from the plan

1. **Flat AppSettings fields** instead of the plan's nested
   `workspaceCard: {density, show: {…}, logTailLines, …}`. The
   existing settings shape is uniformly flat (`terminalBloom`,
   `terminalOsc94Enabled`, `htStatusKeyOrder`, …); a single nested
   object would have been the only one and would have complicated
   validation. Documented as a deliberate choice.
2. **No `logTailLines` slider.** The plan listed it; in the current
   sidebar the log tail is a global section, not per-card, so the
   per-card slider is moot until/unless a per-card log-tail lands.
   Deferred.
3. **No drag-reorder for `statusPillOrder`.** Already shipped as
   part of Plan #02 commit B (Settings → Layout → Discovered ht
   keys, with ↑/↓ buttons). The plan's Section B item is therefore
   already complete from the user's perspective.
4. **Header (name + pin + close) always renders.** The plan
   implicitly allowed toggling everything; in practice hiding the
   header would orphan the workspace card visually. Treating header
   as essential chrome.
5. **Density fixed-padding values picked by feel** — compact 6/10,
   comfortable 12 (existing baseline), spacious 18. No CSS variable
   for fine-tuning yet. If the user wants intermediate values, a
   slider replacing the 3-segment radio is a one-line follow-up.

## Issues encountered

(none — typecheck and tests passed first try after each edit)

## Open questions

- Plan suggested a nested `workspaceCard: {...}` object on
  `AppSettings`. Existing code uses only flat fields
  (`terminalBloom`, `terminalOsc94Enabled`, `htStatusKeyOrder`,
  `auditsGitUserNameExpected`). Going flat to match conventions —
  six new boolean fields plus one enum. Documented as a deviation.

## Verification log

(empty)

## Commits

(empty)
