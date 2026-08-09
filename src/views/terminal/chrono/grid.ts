/**
 * The viewport mechanic — a live terminal, clipped to a lane.
 *
 * CHRONO's lane heads are the real `.surface-container`, moved (see
 * `screen-lease.ts`). The lane is `overflow: hidden`, so a lane six rows
 * tall shows six rows and a lane twenty-four rows tall shows
 * twenty-four — of the *same* terminal, with no `fit()`, no second
 * instance, and no PTY involvement. Focus therefore costs nothing:
 * expanding a lane reveals more of a terminal that was already there.
 *
 * The only real decision is **which** rows. "The last ones" is not quite
 * it, because a shell that has printed three lines into a 40-row grid has
 * 37 blank rows below them, and bottom-aligning the *grid* would show a
 * lane full of nothing. So the anchor is the last row that carries
 * content, placed on the lane's bottom edge:
 *
 *   - content shorter than the lane is pushed *down* onto that edge;
 *   - content taller is scrolled *up* past the top of the lane.
 *
 * Every lane's last line therefore lands on the same baseline, which is
 * what makes a column of different-height screens read as one instrument
 * rather than as a stack of unrelated boxes.
 *
 * The alternate buffer is the exception: a full-screen TUI's frame *is*
 * the state, and re-anchoring as its bottom line clears would make `vim`
 * slide by a row every time it redrew its status line. Alt buffers
 * anchor on the grid, not on the content.
 *
 * Everything here is pure. `readTerminalGrid` takes the narrowest slice
 * of xterm's API that answers the question, so the anchor maths can be
 * tested without a webview — and so it stays renderer-independent, which
 * a DOM-measuring implementation would not be (`.xterm-rows` exists for
 * the DOM renderer and not for WebGL).
 */

/** The slice of `Terminal` the anchor needs. Structural so tests can
 *  supply a literal and so `atlas`-style fixtures stay possible. */
export interface TerminalGridSource {
  readonly rows: number;
  readonly buffer: {
    readonly active: {
      readonly type: "normal" | "alternate";
      readonly viewportY: number;
      readonly length: number;
      getLine(
        y: number,
      ): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}

export interface ChronoGrid {
  /** Rows in the terminal's viewport. */
  rows: number;
  /** 1-based row, within the viewport, that the last content sits on.
   *  Always at least 1 — an empty terminal still shows its cursor line. */
  contentRows: number;
  /** A full-screen TUI is on the alternate buffer. */
  alt: boolean;
}

export function readTerminalGrid(
  term: TerminalGridSource | null | undefined,
): ChronoGrid | null {
  if (!term) return null;
  const rows = Math.max(1, term.rows);
  const buf = term.buffer.active;
  const alt = buf.type === "alternate";
  if (alt) return { rows, contentRows: rows, alt };

  // Walk up from the bottom of the viewport to the last row with ink on
  // it. Bounded by `rows` (24–60 in practice), and only run when the
  // field redraws, which itself only happens when something moved.
  for (let i = rows - 1; i >= 0; i--) {
    const line = buf.getLine(buf.viewportY + i);
    if (!line) continue;
    if (line.translateToString(true).trim() !== "") {
      return { rows, contentRows: i + 1, alt };
    }
  }
  return { rows, contentRows: 1, alt };
}

export interface AnchorInput {
  grid: ChronoGrid;
  /** Height of the lane's clipping box, in CSS px. */
  laneHeight: number;
  /** Height of the terminal's own `.xterm-screen`, in CSS px. This is
   *  `rows × cellHeight` for both renderers, which is why it is the one
   *  measurement taken from the DOM. */
  screenHeight: number;
}

/**
 * `translateY`, in CSS px, that puts the anchor row on the lane's bottom
 * edge. Positive pushes the terminal down, negative scrolls it up.
 *
 * Returns 0 for degenerate input rather than a value that would move a
 * pane off screen — a lane that has not been measured yet must show the
 * terminal where it already is, not somewhere else.
 */
export function anchorOffset(input: AnchorInput): number {
  const { grid, laneHeight, screenHeight } = input;
  if (laneHeight <= 0 || screenHeight <= 0 || grid.rows <= 0) return 0;
  const cellHeight = screenHeight / grid.rows;
  const contentHeight = grid.contentRows * cellHeight;
  // Round to whole pixels: a fractional translate puts the character
  // grid on a half-pixel and every glyph in the lane blurs.
  return Math.round(laneHeight - contentHeight);
}
