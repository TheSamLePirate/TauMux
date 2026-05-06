import { describe, expect, test } from "bun:test";
import { fitTerminal } from "../src/shared/xterm-fit";

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
