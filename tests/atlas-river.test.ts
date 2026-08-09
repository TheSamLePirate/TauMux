// The activity river's colour helper.
//
// Canvas cannot read `var(--tau-…)`, so the panel resolves each series
// colour through computed style and the river applies its own alpha. The
// helper has to survive every form that resolution can hand back — and,
// critically, degrade to an opaque band rather than an invisible one
// when it meets something it doesn't understand.

import { describe, expect, test } from "bun:test";
import { withAlpha } from "../src/views/terminal/atlas/river";

describe("withAlpha", () => {
  test("expands 3-digit hex", () => {
    expect(withAlpha("#f0a", 0.5)).toBe("rgba(255, 0, 170, 0.5)");
  });

  test("handles 6-digit hex", () => {
    expect(withAlpha("#6fe9ff", 0.25)).toBe("rgba(111, 233, 255, 0.25)");
  });

  test("ignores an 8-digit hex's own alpha rather than mangling it", () => {
    expect(withAlpha("#6fe9ff80", 0.4)).toBe("rgba(111, 233, 255, 0.4)");
  });

  test("rewrites rgb() and rgba() from computed style", () => {
    expect(withAlpha("rgb(111, 233, 255)", 0.3)).toBe(
      "rgba(111, 233, 255, 0.3)",
    );
    expect(withAlpha("rgba(1, 2, 3, 0.9)", 0.1)).toBe("rgba(1, 2, 3, 0.1)");
  });

  test("tolerates whitespace", () => {
    expect(withAlpha("  #6fe9ff  ", 1)).toBe("rgba(111, 233, 255, 1)");
  });

  test("passes through anything it cannot parse", () => {
    // Opaque is the safe failure: an unreadable colour must still draw a
    // visible band, never an invisible one.
    for (const input of ["currentColor", "oklch(70% 0.1 200)", "", "#12"]) {
      expect(withAlpha(input, 0.5)).toBe(input.trim());
    }
  });

  test("a malformed hex is not silently turned into black", () => {
    expect(withAlpha("#zzzzzz", 0.5)).toBe("#zzzzzz");
  });
});
