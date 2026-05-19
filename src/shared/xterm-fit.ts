// Robust xterm fit — port of native `fitSurfaceTerminal` from
// `src/views/terminal/surface-manager.ts`.
//
// The default `@xterm/addon-fit` has two issues that caused the
// post-M17 web mirror to mis-size multi-pane workspaces:
//
//   1. It hard-codes a 14 px scrollbar-gutter shave even when the
//      scrollbar is hidden via CSS, so it under-counts the columns
//      the user can actually see.
//   2. It calls `term.resize(0, n)` (or `n, 0`) when the parent
//      element has zero pixel width / height — typically because
//      `applyLayout` writes inline rects in the SAME synchronous tick
//      as the per-pane `ResizeObserver` fires, racing CSS layout.
//      A zero-cell resize poisons xterm's render-service cache so
//      subsequent fits don't recover.
//
// This helper:
//   - Reads `parent.clientWidth/clientHeight` and bails when either
//     is `<= 0`. The caller is expected to call again once the
//     parent has a stable size (e.g. inside `applyLayout` after a
//     forced layout flush).
//   - Reads cell dimensions directly from
//     `term._core._renderService.dimensions.css.cell`.
//   - Subtracts the `.xterm` element's own CSS padding (web client
//     uses `padding: 6px 8px 8px;`) so the math reflects what the
//     user sees.
//   - Calls `_renderService.clear()` BEFORE `term.resize(...)` so
//     fresh cell metrics replace cached ones (xterm 5.x otherwise
//     refuses to update its grid when cell metrics drift).
//   - No-ops when the new (cols, rows) match the current grid — the
//     1 Hz metadata tick triggers many redundant fits per render.
//
// Returns `{ cols, rows }` describing the cell count after the
// resize attempt (or the unchanged grid if early-exit fired). Tests
// use the return value to assert on what would be sent over the wire.

/** Internal xterm 5.x shape we read from. The fields are private
 *  API; we narrow the cast here so call-sites don't have to. */
interface XtermInternals {
  cols: number;
  rows: number;
  element?: HTMLElement | null;
  resize(cols: number, rows: number): void;
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: { cell?: { width: number; height: number } };
      };
      clear(): void;
    };
  };
}

export interface FitResult {
  cols: number;
  rows: number;
  /** True when the resize was skipped (zero parent, no metrics, no
   *  change). Useful for tests + diagnostics. */
  skipped: boolean;
}

export function fitTerminal(
  term: unknown,
  parent: HTMLElement | null | undefined,
): FitResult {
  const t = term as XtermInternals | null | undefined;
  if (!t || !parent) return { cols: 0, rows: 0, skipped: true };

  const w = parent.clientWidth;
  const h = parent.clientHeight;
  // Bail on zero-sized parent. This is the key fix for the M18
  // multi-pane race — never call `term.resize(0, n)` because the
  // render-service caches the broken metric and later fits don't
  // recover.
  if (w <= 0 || h <= 0) {
    return { cols: t.cols, rows: t.rows, skipped: true };
  }

  const core = t._core;
  const cell = core?._renderService?.dimensions?.css?.cell;
  if (!cell || !cell.width || !cell.height) {
    // Render service not ready (term.open ran while parent was
    // 0×0 and xterm hasn't measured a font yet). Bail; the next
    // call after a real paint will succeed.
    return { cols: t.cols, rows: t.rows, skipped: true };
  }

  // Subtract `.xterm` padding so cols/rows match the visible cells.
  // Read once via getComputedStyle — falls back to 0 in non-DOM
  // test environments (happy-dom returns "" for unset values).
  let padX = 0;
  let padY = 0;
  if (t.element && typeof window !== "undefined" && window.getComputedStyle) {
    const cs = window.getComputedStyle(t.element);
    padX = (parseInt(cs.paddingLeft) || 0) + (parseInt(cs.paddingRight) || 0);
    padY = (parseInt(cs.paddingTop) || 0) + (parseInt(cs.paddingBottom) || 0);
  }

  // +0.5 epsilon: DOM measurements can land at e.g. 1199.6 instead of
  // 1200, which `floor` would silently shave by a whole column. Matches
  // xterm's own FitAddon and keeps native/web byte-identical.
  const cols = Math.max(2, Math.floor((w - padX + 0.5) / cell.width));
  const rows = Math.max(1, Math.floor((h - padY + 0.5) / cell.height));
  if (t.cols === cols && t.rows === rows) {
    return { cols, rows, skipped: true };
  }
  // Clear render-service cache so freshly computed metrics replace
  // cached ones. Without this, xterm 5.x silently keeps its old
  // grid even after `term.resize` returns successfully.
  try {
    core?._renderService?.clear();
  } catch {
    /* internal API — best-effort */
  }
  try {
    t.resize(cols, rows);
  } catch {
    return { cols: t.cols, rows: t.rows, skipped: true };
  }
  return { cols, rows, skipped: false };
}
