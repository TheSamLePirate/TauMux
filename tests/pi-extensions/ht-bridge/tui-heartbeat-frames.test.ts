/**
 * tui-heartbeat-frames — pin the K2000 sweep shape so future tweaks
 * can't quietly break the animation. We compare against the un-themed
 * (plain glyph) form so the test isn't bound to a specific palette.
 */

import { describe, expect, test } from "bun:test";
import {
  EMPTY,
  HEAD,
  TRAIL1,
  TRAIL2,
  buildFrames,
} from "../../../pi-extensions/ht-bridge/observe/tui-heartbeat-frames";

describe("buildFrames", () => {
  test("produces 2*(rowLen-1) frames for a seamless cycle", () => {
    expect(buildFrames(null, { rowLen: 8 }).length).toBe(14);
    expect(buildFrames(null, { rowLen: 6 }).length).toBe(10);
  });

  test("each frame is exactly rowLen visible cells", () => {
    const frames = buildFrames(null, { rowLen: 8 });
    for (const f of frames) {
      // No theme => glyphs only, no ANSI to strip.
      expect([...f].length).toBe(8);
    }
  });

  test("first frame puts the head at position 0 with no trail", () => {
    const [first] = buildFrames(null, { rowLen: 8 });
    expect(first?.[0]).toBe(HEAD);
    // Cells 1..7 are empty.
    for (let i = 1; i < 8; i++) expect(first?.[i]).toBe(EMPTY);
  });

  test("third frame (head at pos 2, going right) shows trail-1 / trail-2 to the left", () => {
    const frames = buildFrames(null, { rowLen: 8 });
    const f = frames[2]!;
    expect(f[0]).toBe(TRAIL2);
    expect(f[1]).toBe(TRAIL1);
    expect(f[2]).toBe(HEAD);
    expect(f[3]).toBe(EMPTY);
  });

  test("last frame is the head returning toward 0 with trail to the right", () => {
    const frames = buildFrames(null, { rowLen: 8 });
    const last = frames[frames.length - 1]!;
    expect(last[1]).toBe(HEAD);
    expect(last[2]).toBe(TRAIL1);
    expect(last[3]).toBe(TRAIL2);
    expect(last[0]).toBe(EMPTY);
  });

  test("rightmost endpoint frame has the head at rowLen-1", () => {
    const frames = buildFrames(null, { rowLen: 8 });
    const right = frames[7]!;
    expect(right[7]).toBe(HEAD);
    expect(right[6]).toBe(TRAIL1);
    expect(right[5]).toBe(TRAIL2);
  });

  test("clamps pathological rowLen to 3 minimum", () => {
    expect(buildFrames(null, { rowLen: 1 }).length).toBe(2 * (3 - 1));
  });

  test("applies theme colors when supplied (head=accent, empties=dim)", () => {
    const fakeTheme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    };
    const frames = buildFrames(fakeTheme, { rowLen: 4 });
    // First frame: head at 0, three empty cells dimmed.
    const first = frames[0]!;
    expect(first).toContain(`<accent>${HEAD}</accent>`);
    expect(first).toContain(`<dim>${EMPTY}</dim>`);
    // Mid-sweep (head at pos 2 going right) carries both trails.
    const mid = frames[2]!;
    expect(mid).toContain(`<accent>${HEAD}</accent>`);
    expect(mid).toContain(`<warning>${TRAIL1}</warning>`);
    expect(mid).toContain(`<dim>${TRAIL2}</dim>`);
  });

  test("trail glyphs use warning + dim colors", () => {
    const seen = new Set<string>();
    const fakeTheme = {
      fg: (color: string, text: string) => {
        seen.add(color);
        return text;
      },
    };
    buildFrames(fakeTheme, { rowLen: 8 });
    expect(seen.has("accent")).toBe(true);
    expect(seen.has("warning")).toBe(true);
    expect(seen.has("dim")).toBe(true);
  });
});
