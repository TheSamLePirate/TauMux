# Plan 12 — Terminal scroll-to-top regression

## Source quote

> # Issue with scrolling.
> Sometimes (more on pi than on claude)
> the terminal scroll to the top... Very boring

## Symptom

Mid-session, the xterm.js viewport occasionally jumps to the top of
the scrollback (offset 0). User loses their place. Happens more often
in pi's pane than in Claude Code's pane, suggesting a frequency-of-
output trigger (pi prints more / faster bursts than Claude does).

## Hypotheses

### H1 — `viewport.scrollTo(0)` called on resize

`PaneLayout` recomputes splits on workspace resize / chip change /
sidebar resize. If the terminal's `fit()` addon triggers a scroll
reset on resize beyond a threshold, every layout pass scrolls.

### H2 — Webgl renderer reset

xterm-addon-webgl recreates the texture on size change. Some forks
inadvertently reset `viewport.scrollTop` after recreation.

### H3 — A subprocess emits `\x1bc` (RIS — full reset) inside its
output. RIS clears scrollback and homes the cursor. pi's stream
processor or formatter could be guilty.

### H4 — `ScrollToBottom` followed by a stale `ScrollTo(top)` when
user is below the bottom and the viewport is recomputed.

### H5 — Sidebar resize triggers a layout that fires a programmatic
scroll. The user explicitly mentions sidebar resize causes a
line-height issue (see Plan #14), suggesting the layout pipeline
isn't idempotent w.r.t. terminal viewport state.

## Diagnostic plan

1. Reproduce with pi running. Specifically: have pi emit a long
   summary, scroll back ~50 lines, then trigger a sidebar resize or
   workspace switch. Note whether the jump happens.
2. Add temporary instrumentation in `surface-manager.ts`:
   ```ts
   const origScrollTo = term.scrollTo.bind(term);
   term.scrollTo = (line) => {
     console.trace(`[scroll-debug] surface=${id} → line=${line}`);
     origScrollTo(line);
   };
   ```
3. Reproduce; capture stack traces.
4. Decide based on stack:
   - If `fit()` is in the trace → patch the layout pipeline.
   - If RIS → strip RIS at the parser before xterm receives it
     (offer a `terminal.stripFullReset` setting), or accept it as
     intended program behaviour.
   - If addon-webgl → upstream issue; switch to canvas renderer for
     affected surfaces.

## Likely fixes

### If layout-driven (H1/H5)

Change `applyLayout` (`src/views/terminal/index.ts` /
`pane-layout.ts`) to:

1. Snapshot `term.buffer.active.viewportY` and the user's "follow
   bottom" preference before resize.
2. Call fit/resize.
3. Restore the viewportY (or scroll to bottom if user was at bottom).

This is the canonical pattern for embedding xterm into a resizable
container. We may already do this; verify.

### If RIS-driven (H3)

Two options:
- Accept it: legitimate behaviour from `clear`-equivalent commands.
- Filter it: optional `terminal.suppressRIS` setting. **Do not** make
  this default — could break legitimate `clear`/`reset` usage.

### If webgl-driven (H2)

Pin renderer to `canvas` for now; document. Re-evaluate on next
xterm-addon-webgl release.

## Files (predicted)

- `src/views/terminal/surface-manager.ts` — viewport snapshot/restore
  during resize.
- `src/views/terminal/pane-layout.ts` — verify resize trigger.
- `src/views/terminal/index.ts` — sidebar-resize handler.
- `src/shared/settings.ts` — possible new toggle.

## Tests

- `tests/terminal-scroll-on-resize.test.ts` — load 1000-line buffer;
  scroll up 100; trigger fit; assert viewportY is preserved.
- `tests/terminal-ris-passthrough.test.ts` — RIS clears as expected
  (regression guard if we add a suppression toggle).

## Effort

S — most of the work is reproduction + diagnostic. Fix is usually
small. ~1 day with tests.

## Risks

- Scrolling fixes are easy to over-correct. A resize that legitimately
  needs to scroll to bottom (e.g. content arrived while resizing)
  shouldn't be pinned to the old viewport.
- "Follow bottom" UX: if user was at bottom before resize, stay at
  bottom; if user was scrolled up, preserve absolute line position.
