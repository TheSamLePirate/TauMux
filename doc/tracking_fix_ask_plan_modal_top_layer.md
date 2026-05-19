# Tracking — fix_ask_plan_modal_top_layer

- Start commit: `9fd08277`
- Date: 2026-05-19
- Release bump: `bun run bump:patch` → `0.3.154`
- Implementation commit: pending

## Progress

- A1 — Global ask selection: done.
  - Added `AskUserState.getGlobalHead()`.
  - Updated `AskUserModal` to render the global oldest pending prompt instead of only the active surface's head.
  - Removed the `ht-surface-focused` dependency for modal visibility; focus changes no longer hide/show human prompts.
- A2 — Hide browsers during prompts: done.
  - Added ask-modal lifecycle callbacks.
  - Wired native webview to hide browser OOPIF panes while ask/plan prompts are mounted.
  - Restore is guarded so browser panes are not shown under settings, palette, process manager, surface details, or keyboard cheatsheet overlays.
- A3 — Promote top z-index tier: done.
  - Raised `.ask-user-overlay` above app chrome, notification rings, and normal overlays.
  - Documented that ask-user also powers `ht_plan_set` approval.
  - Made ask overlay visible synchronously to avoid a transparent `requestAnimationFrame` race.
- A4 — Regression tests: done.
  - Non-focused-surface prompts now appear immediately.
  - Attribution confirms the source pane remains visible.
  - Lifecycle callbacks are covered.
  - CSS z-index and initial opacity are covered.

## Deviations

- The implementation uses the existing `AskUserState` insertion-order index (`byId`) as the authoritative global FIFO rather than adding a separate queue.
- Manual browser-pane smoke was not run interactively; automated launch verified the app starts and unit/CSS regressions cover the modal ordering behavior.

## Issues / Risks

- `z-index: 2147483600` intentionally sits above pane notification rings (`2147483000`). Future top-layer overlays should document their ordering relative to ask/plan prompts.
- Browser restore is DOM-query guarded; if future overlays hide browser webviews, they should add their visible selector to `shouldRestoreBrowserWebviewsAfterAskModal()`.

## Validation

- Passed: `bun test tests/ask-user-state.test.ts tests/ask-user-modal-dom.test.ts tests/theme-tokens-ask.test.ts`
- Passed: `bun test` (2945 pass)
- Passed: `bun run typecheck`
- Passed before commit: `bun run typecheck`
- Passed: `bun start` launch check (app built, launcher started, session spawned; terminated with SIGTERM after verification)
