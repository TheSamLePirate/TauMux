import { describe, expect, test } from "bun:test";
import { fitTerminal, resizePreservingScroll } from "../src/shared/xterm-fit";

/** Hand-rolled stub that mimics the bits of xterm.js the helper
 *  reads (cols/rows/element/_core/_renderService) without dragging
 *  in the real xterm package. */
function makeTerm(
  opts: {
    cols?: number;
    rows?: number;
    cellW?: number;
    cellH?: number;
    ready?: boolean;
  } = {},
) {
  const calls = {
    clear: 0,
    resize: [] as Array<{ cols: number; rows: number }>,
  };
  const cellPresent = opts.ready !== false;
  const term = {
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    element: {
      /* see below */
    } as unknown as HTMLElement,
    resize(cols: number, rows: number) {
      calls.resize.push({ cols, rows });
      term.cols = cols;
      term.rows = rows;
    },
    _core: {
      _renderService: {
        dimensions: cellPresent
          ? {
              css: {
                cell: {
                  width: opts.cellW ?? 8,
                  height: opts.cellH ?? 16,
                },
              },
            }
          : { css: { cell: undefined } },
        clear() {
          calls.clear++;
        },
      },
    },
  };
  return { term, calls };
}

function makeParent(width: number, height: number): HTMLElement {
  // happy-dom isn't loaded for this file (pure unit), so fake the
  // bare minimum: an object with `clientWidth/clientHeight`.
  const el = {
    clientWidth: width,
    clientHeight: height,
  } as unknown as HTMLElement;
  return el;
}

describe("shared fitTerminal", () => {
  test("bails when parent.clientWidth is 0 (the multi-pane race the helper exists to avoid)", () => {
    const { term, calls } = makeTerm({ cols: 40, rows: 12 });
    const parent = makeParent(0, 600);
    const out = fitTerminal(term, parent);
    expect(out.skipped).toBe(true);
    expect(out.cols).toBe(40);
    expect(out.rows).toBe(12);
    // Critically: never call resize(0, n) because that poisons
    // xterm's render-service cache.
    expect(calls.resize.length).toBe(0);
    expect(calls.clear).toBe(0);
  });

  test("bails when render-service has no cell metrics yet", () => {
    const { term, calls } = makeTerm({ ready: false });
    const parent = makeParent(800, 600);
    const out = fitTerminal(term, parent);
    expect(out.skipped).toBe(true);
    expect(calls.resize.length).toBe(0);
  });

  test("computes cols/rows from parent size + cell metrics, calls clear() before resize", () => {
    const { term, calls } = makeTerm({
      cols: 1, // intentionally wrong so we can see the resize land
      rows: 1,
      cellW: 10,
      cellH: 20,
    });
    const parent = makeParent(800, 600);
    const out = fitTerminal(term, parent);
    expect(out.skipped).toBe(false);
    // 800/10 = 80 cols, 600/20 = 30 rows (no padding in the stub
    // because there's no window.getComputedStyle, so padX=padY=0).
    expect(out.cols).toBe(80);
    expect(out.rows).toBe(30);
    // Cache invalidation MUST run before the resize so xterm picks
    // up the new cell metrics.
    expect(calls.clear).toBe(1);
    expect(calls.resize).toEqual([{ cols: 80, rows: 30 }]);
  });

  test("no-ops when the new (cols, rows) match the current grid", () => {
    const { term, calls } = makeTerm({
      cols: 80,
      rows: 30,
      cellW: 10,
      cellH: 20,
    });
    const parent = makeParent(800, 600);
    const out = fitTerminal(term, parent);
    expect(out.skipped).toBe(true);
    expect(calls.clear).toBe(0);
    expect(calls.resize.length).toBe(0);
  });

  test("clamps to a minimum 2 cols × 1 row even on tiny parents", () => {
    const { term, calls } = makeTerm({ cellW: 100, cellH: 100 });
    const parent = makeParent(50, 50); // smaller than one cell
    const out = fitTerminal(term, parent);
    // floor((50 - 0) / 100) = 0, but Math.max clamps cols to 2,
    // rows to 1. The clamp avoids xterm's zero-cell cache poison.
    expect(out.cols).toBe(2);
    expect(out.rows).toBe(1);
    expect(calls.resize).toEqual([{ cols: 2, rows: 1 }]);
  });

  test("safe against null term + null parent — no throw", () => {
    expect(() =>
      fitTerminal(null, null as unknown as HTMLElement),
    ).not.toThrow();
    expect(() => fitTerminal(undefined, undefined)).not.toThrow();
    const { term } = makeTerm();
    expect(() =>
      fitTerminal(term, null as unknown as HTMLElement),
    ).not.toThrow();
  });
});

/** Buffer-aware stub for resizePreservingScroll: models the xterm
 *  buffer geometry the helper reads (viewportY / baseY) and lets each
 *  test script how resize() changes that geometry. */
function makeScrollTerm(before: { viewportY: number; baseY: number }) {
  const state = {
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        type: "normal" as string,
        viewportY: before.viewportY,
        baseY: before.baseY,
      },
    },
    scrolledTo: [] as number[],
    resize(cols: number, rows: number) {
      state.cols = cols;
      state.rows = rows;
      // Tests mutate state.buffer.active via the onResize hook below.
      state.onResize?.();
    },
    onResize: null as null | (() => void),
    scrollToLine(line: number) {
      state.scrolledTo.push(line);
      state.buffer.active.viewportY = line;
    },
  };
  return state;
}

describe("resizePreservingScroll — the scroll-to-top regression", () => {
  // The reported bug: scrolled up reading history, a refit (sidebar
  // resize, sideband panel) slammed the viewport to scrollback line 0.
  // Root cause was clamping `after.baseY - distFromBottom` with
  // Math.max(0, …) once baseY shrank below the distance.
  test("pane GROWS while scrolled up: viewport stays on its line (never slams to top)", () => {
    // User at line 10 of baseY 100; growing rows shrinks baseY to 80
    // (same content, more rows visible). Old code: target
    // max(0, 80 - 90) = 0 → top. New: stay at 10.
    const t = makeScrollTerm({ viewportY: 10, baseY: 100 });
    t.onResize = () => {
      t.buffer.active.baseY = 80;
    };
    resizePreservingScroll(t, 80, 40);
    expect(t.scrolledTo).toEqual([]); // no correction needed — xterm kept the line
    expect(t.buffer.active.viewportY).toBe(10);
  });

  test("baseY shrinks below the viewport with cols unchanged: clamp to the bottom, NEVER line 0", () => {
    // Rows 24 → 60 explains baseY 100 → 64 on its own; the simulated
    // drop to 40 means lines also vanished (trim-like). Cols are the
    // same, so no re-wrap happened and the absolute anchor clamps to
    // the new bottom (40) — the old code computed max(0, 40 - 50) = 0
    // and showed the OLDEST scrollback line instead of the newest.
    const t = makeScrollTerm({ viewportY: 50, baseY: 100 });
    t.onResize = () => {
      t.buffer.active.baseY = 40;
      t.buffer.active.viewportY = 0; // xterm's own recompute got it wrong
    };
    resizePreservingScroll(t, 80, 60);
    expect(t.scrolledTo).toEqual([40]);
  });

  test("cols CHANGED (re-wrap): follow the total-lines delta, minus the rows effect", () => {
    // Widening 80 → 120 cols unwraps 30 lines (baseY 100 → 64 with
    // rows 24 → 30: ΔbaseY = −36 = Δlines − Δrows ⇒ Δlines = −30).
    // The reader's content moved up 30 lines: 50 → 20. The old
    // distance-from-bottom anchor would say 14 (gap 50 preserved,
    // content lost by the 6-row effect); the estimate tracks content.
    const t = makeScrollTerm({ viewportY: 50, baseY: 100 });
    t.onResize = () => {
      t.buffer.active.baseY = 64;
      t.buffer.active.viewportY = 64; // xterm snapped to bottom
    };
    resizePreservingScroll(t, 120, 30);
    expect(t.scrolledTo).toEqual([20]);
  });

  test("output appended while scrolled up: the text under the reader does not move", () => {
    // User reading line 50; 5 new lines arrive (baseY 100 → 105).
    // The old distance-from-bottom anchor dragged the viewport down
    // to 55, shifting the text being read. Absolute anchor: stay.
    const t = makeScrollTerm({ viewportY: 50, baseY: 100 });
    t.onResize = () => {
      t.buffer.active.baseY = 105;
      // xterm keeps the absolute viewport on append — nothing to do.
    };
    resizePreservingScroll(t, 80, 24);
    expect(t.scrolledTo).toEqual([]);
    expect(t.buffer.active.viewportY).toBe(50);
  });

  test("user AT bottom: no interference with xterm's follow-the-bottom", () => {
    const t = makeScrollTerm({ viewportY: 100, baseY: 100 });
    t.onResize = () => {
      t.buffer.active.baseY = 120;
      t.buffer.active.viewportY = 120;
    };
    resizePreservingScroll(t, 80, 24);
    expect(t.scrolledTo).toEqual([]);
  });

  test("alt-screen buffer (vim/htop) is never fought", () => {
    const t = makeScrollTerm({ viewportY: 10, baseY: 100 });
    t.buffer.active.type = "alternate";
    t.onResize = () => {
      t.buffer.active.baseY = 0;
    };
    resizePreservingScroll(t, 80, 24);
    expect(t.scrolledTo).toEqual([]);
  });

  test("no scrollback after resize (baseY 0): no forced scroll", () => {
    const t = makeScrollTerm({ viewportY: 5, baseY: 100 });
    t.onResize = () => {
      t.buffer.active.baseY = 0;
      t.buffer.active.viewportY = 0;
    };
    resizePreservingScroll(t, 80, 60);
    expect(t.scrolledTo).toEqual([]);
  });

  test("missing buffer (headless / not-yet-opened) is a safe no-op", () => {
    const t = { resize() {}, scrolledTo: [] as number[] };
    expect(() => resizePreservingScroll(t, 80, 24)).not.toThrow();
  });
});
