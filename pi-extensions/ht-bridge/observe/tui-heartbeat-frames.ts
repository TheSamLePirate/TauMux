/**
 * K2000 / KITT scanner — pure frame generator. Pi's
 * `ctx.ui.setWorkingIndicator({ frames, intervalMs })` cycles through
 * the strings on its own, so all we have to do is produce the
 * sequence:
 *
 *   ▓░          ░▓
 *    ▓░        ░▓
 *     ▓░      ░▓
 *      ▓█    █▓
 *       ▓█  █▓
 *        ▓██▓
 *           ↓
 *
 * Sequence: head sweeps left-to-right across `ROW_LEN` cells, then
 * back. Each frame applies the supplied theme so the head pops in
 * `accent` (warm), the immediate trail in `warning` (amber), the
 * second trail in `dim`, and idle cells in a muted `─`. When no
 * theme is available (non-TUI context) the glyphs fall through
 * uncolored — still readable in a plain terminal.
 */

export const HEAD = "█";
export const TRAIL1 = "▒";
export const TRAIL2 = "░";
export const EMPTY = "─";

/** Minimal theme surface used by `buildFrames`. Mirrors the shape
 *  of `ctx.ui.theme` so we don't need a structural import. */
export interface ThemeLike {
  fg(color: string, text: string): string;
}

export interface BuildFramesOptions {
  /** Visible cells in the scanner. Default 8. */
  rowLen?: number;
}

/** Build the full back-and-forth sequence. Always returns
 *  `2 * (rowLen - 1)` frames so the cycle joins seamlessly. */
export function buildFrames(
  theme: ThemeLike | null,
  opts: BuildFramesOptions = {},
): string[] {
  const rowLen = Math.max(3, opts.rowLen ?? 8);
  const fg = theme ? theme.fg.bind(theme) : (_c: string, t: string) => t;

  const renderCell = (glyph: string): string => {
    switch (glyph) {
      case HEAD:
        return fg("accent", glyph);
      case TRAIL1:
        return fg("warning", glyph);
      case TRAIL2:
        return fg("dim", glyph);
      default:
        return fg("dim", glyph);
    }
  };

  const frame = (pos: number, dir: "right" | "left"): string => {
    const cells: string[] = [];
    for (let i = 0; i < rowLen; i++) {
      let glyph = EMPTY;
      if (i === pos) glyph = HEAD;
      else if (dir === "right") {
        if (i === pos - 1) glyph = TRAIL1;
        else if (i === pos - 2) glyph = TRAIL2;
      } else {
        if (i === pos + 1) glyph = TRAIL1;
        else if (i === pos + 2) glyph = TRAIL2;
      }
      cells.push(renderCell(glyph));
    }
    return cells.join("");
  };

  const out: string[] = [];
  // Sweep right: positions 0 → rowLen-1.
  for (let p = 0; p < rowLen; p++) out.push(frame(p, "right"));
  // Sweep back: positions rowLen-2 → 1 (don't repeat the endpoints,
  // otherwise the head appears to pause at each edge).
  for (let p = rowLen - 2; p > 0; p--) out.push(frame(p, "left"));
  return out;
}

/** Strip ANSI SGR escapes — used in tests so we can assert on the
 *  underlying glyphs without binding to a specific theme palette. */
export function stripAnsi(s: string): string {
  return s.replace(/\[[0-9;]*m/g, "");
}
