# Tracking — fix_xterm_composition_todo

- Start commit: `dd7468b3`
- Date: 2026-05-19
- Release bump: `bun run bump:patch` → `0.3.153`
- Commit: `52005c7e`

## Progress

- Found the only in-tree TODO at `src/views/terminal/xterm.css:80`.
- Inspected xterm 5.3.0 composition handling: `CompositionHelper.updateCompositionElements()` dynamically positions both `.composition-view` and `.xterm-helper-textarea` at the cursor during IME composition.
- Identified local CSS overrides in native and web mirror styles that forced `.xterm-helper-textarea` off-screen with `!important`, preventing xterm from syncing IME candidate window position.
- Removed those local overrides from:
  - `src/views/terminal/index.css`
  - `src/web-client/client.css`
- Replaced the upstream TODO comment in `src/views/terminal/xterm.css` with an explanatory note that the runtime helper owns cursor-relative positioning.
- Fixed an unrelated pre-existing TypeScript cast warning in `src/bun/index.ts` that blocked the required `bun run typecheck` validation.

## Deviations

- The τ-mux plan proposal was dismissed before sidebar publication, so progress is tracked here only.

## Issues / Risks

- Full IME visual validation still benefits from manual Japanese/Chinese/Korean input testing in the native app and web mirror.
- Focus-scroll regressions should be mitigated by the existing `focusXtermPreservingScroll()` helper rather than CSS `!important` off-screen positioning.

## Validation

- Passed: `bun test` (2941 pass)
- Passed: `bun run typecheck`
- Passed after version bump: `bun run typecheck`
- Passed: `bun start` launch check (app built, launcher started, session spawned; terminated with SIGTERM after verification)
