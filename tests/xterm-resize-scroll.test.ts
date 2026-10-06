import { describe, expect, test } from "bun:test";
import { resizePreservingScroll } from "../src/shared/xterm-fit";

/** Stub mimicking the xterm public surface `resizePreservingScroll` reads:
 *  buffer.active.{type,viewportY,baseY}, resize(), scrollToLine(). */
function makeTerm(opts: {
  type?: string;
  viewportY: number;
  baseY: number;
  /** new baseY after the (simulated) reflow */
  baseYAfter?: number;
}) {
  const calls = {
    clear: 0,
    resize: [] as Array<{ cols: number; rows: number }>,
    scrollToLine: [] as number[],
  };
  const active = {
    type: opts.type ?? "normal",
    viewportY: opts.viewportY,
    baseY: opts.baseY,
  };
  const term = {
    cols: 80,
    rows: 24,
    buffer: { active },
    resize(cols: number, rows: number) {
      calls.resize.push({ cols, rows });
      term.cols = cols;
      term.rows = rows;
      // Simulate xterm snapping the viewport to the bottom on reflow, and
      // optionally a changed baseY (scrollback grew/shrank).
      if (opts.baseYAfter !== undefined) active.baseY = opts.baseYAfter;
      active.viewportY = active.baseY;
    },
    scrollToLine(line: number) {
      calls.scrollToLine.push(line);
      active.viewportY = line;
    },
  };
  return { term, calls, active };
}

describe("resizePreservingScroll", () => {
  test("restores the reading line when the user was scrolled up", () => {
    // viewport at line 50, bottom at 100. Cols change (80 → 100) but
    // the reflow happens to keep the line count identical; rows stay
    // 24 so the geometry is physically consistent.
    const { term, calls, active } = makeTerm({ viewportY: 50, baseY: 100 });
    resizePreservingScroll(term, 100, 24, () => {});
    expect(calls.resize).toEqual([{ cols: 100, rows: 24 }]);
    // After reflow xterm would have snapped to baseY (100); with zero
    // total-lines delta the content anchor is the unchanged line 50.
    expect(calls.scrollToLine).toEqual([50]);
    expect(active.viewportY).toBe(50);
  });

  test("follows the content when reflow adds lines (rows effect removed)", () => {
    // 20 lines up; heavy wrap on cols 80 → 100 plus rows 24 → 30.
    // baseY 100 → 140 means ΔtotalLines = ΔbaseY + Δrows = 40 + 6 = 46
    // wrapped lines appeared above/around the reader, so the content
    // anchor moves 80 → 126. (The pre-2026-10 anchor preserved the
    // distance-from-bottom gap exactly — 120 — but silently absorbed
    // the 6-row effect into the reader's position.)
    const { term, calls } = makeTerm({
      viewportY: 80,
      baseY: 100,
      baseYAfter: 140,
    });
    resizePreservingScroll(term, 100, 30, () => {});
    expect(calls.scrollToLine).toEqual([126]);
  });

  test("leaves xterm's follow-the-bottom behaviour alone when already at bottom", () => {
    const { term, calls } = makeTerm({ viewportY: 100, baseY: 100 });
    resizePreservingScroll(term, 100, 30, () => {});
    expect(calls.resize.length).toBe(1);
    expect(calls.scrollToLine.length).toBe(0);
  });

  test("never fights an alt-screen / fullscreen TUI (alternate buffer)", () => {
    const { term, calls } = makeTerm({
      type: "alternate",
      viewportY: 0,
      baseY: 0,
    });
    resizePreservingScroll(term, 100, 30, () => {});
    expect(calls.scrollToLine.length).toBe(0);
  });

  test("runs clear() between the scroll snapshot and the resize", () => {
    const order: string[] = [];
    const { term } = makeTerm({ viewportY: 50, baseY: 100 });
    const origResize = term.resize.bind(term);
    term.resize = (c, r) => {
      order.push("resize");
      origResize(c, r);
    };
    resizePreservingScroll(term, 100, 30, () => order.push("clear"));
    expect(order).toEqual(["clear", "resize"]);
  });

  test("no buffer (headless / not-yet-opened) → resizes without throwing", () => {
    const calls = { resize: [] as Array<{ cols: number; rows: number }> };
    const term = {
      cols: 80,
      rows: 24,
      resize(cols: number, rows: number) {
        calls.resize.push({ cols, rows });
      },
      scrollToLine() {
        throw new Error("should not be called");
      },
    };
    expect(() => resizePreservingScroll(term, 100, 30, () => {})).not.toThrow();
    expect(calls.resize).toEqual([{ cols: 100, rows: 30 }]);
  });
});
