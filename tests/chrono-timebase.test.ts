// The timebase knob and the cursor's readout.
//
// CHRONO's window is adjustable, and the thing that keeps an adjustable
// window from becoming a smear is detents: a fixed ladder of spans, each
// with a division count chosen so every graticule line lands on a round
// number of seconds. "30 seconds" has to look like 30 seconds every
// time, or two screenshots of the same field are not comparable.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SPAN,
  SPANS,
  defaultTimebase,
  divisionTicks,
  divisions,
  inWindow,
  spanLabel,
  stepTimebase,
  timeAt,
  xFraction,
} from "../src/views/terminal/chrono/timebase";
import {
  formatOffset,
  formatRate,
  buildReadout,
} from "../src/views/terminal/chrono/readout";
import { HISTORY_CAPACITY } from "../src/views/terminal/metrics-history";
import type { ChronoLane } from "../src/views/terminal/chrono/lanes";
import type { AtlasNode } from "../src/views/terminal/atlas/types";
import type { MetricSample } from "../src/views/terminal/metrics-history";

describe("the span ladder", () => {
  test("never asks for more history than the rings hold", () => {
    // A rung that shows an empty field is a rung that lies about what
    // τ-mux remembers.
    const widest = SPANS[SPANS.length - 1]!;
    expect(widest / 1000).toBeLessThanOrEqual(HISTORY_CAPACITY);
  });

  test("is sorted and starts at the default", () => {
    expect([...SPANS]).toEqual([...SPANS].sort((a, b) => a - b));
    expect(SPANS).toContain(DEFAULT_SPAN);
    expect(defaultTimebase().span).toBe(DEFAULT_SPAN);
  });
});

describe("stepTimebase", () => {
  test("zooming in shortens the window, out lengthens it", () => {
    const start = { span: 60_000 };
    expect(stepTimebase(start, 1).span).toBeLessThan(60_000);
    expect(stepTimebase(start, -1).span).toBeGreaterThan(60_000);
  });

  test("clamps at both ends rather than wrapping", () => {
    // A knob that jumps from 10 s to five minutes because you nudged it
    // once more is a knob you stop trusting.
    const tightest = { span: SPANS[0]! };
    const widest = { span: SPANS[SPANS.length - 1]! };
    expect(stepTimebase(tightest, 1)).toEqual(tightest);
    expect(stepTimebase(widest, -1)).toEqual(widest);
  });

  test("recovers from a span that is not on the ladder", () => {
    expect(SPANS).toContain(stepTimebase({ span: 12_345 }, 1).span);
  });
});

describe("divisions", () => {
  test("every line lands on a whole number of seconds", () => {
    // The point of detents: no reader should ever be asked to interpret
    // a graticule line at 12.857 s.
    for (const span of SPANS) {
      for (const seconds of divisions(span)) {
        expect(Number.isInteger(seconds)).toBe(true);
      }
    }
  });

  test("runs from the window's far end down to now", () => {
    const marks = divisions(60_000);
    expect(marks[0]).toBe(60);
    expect(marks[marks.length - 1]).toBe(0);
  });

  test("descends without repeats", () => {
    for (const span of SPANS) {
      const marks = divisions(span);
      for (let i = 1; i < marks.length; i++) {
        expect(marks[i]!).toBeLessThan(marks[i - 1]!);
      }
    }
  });
});

describe("divisionTicks", () => {
  test("the present is named, not numbered", () => {
    const ticks = divisionTicks(90_000);
    expect(ticks[ticks.length - 1]!.label).toBe("now");
  });

  test("uses one unit for the whole ruler", () => {
    // Deciding per mark gives `90s 75s 1m 45s` — every label
    // individually shortest, the row as a whole unreadable.
    expect(divisionTicks(90_000).map((t) => t.label)).toEqual([
      "90s",
      "75s",
      "60s",
      "45s",
      "30s",
      "15s",
      "now",
    ]);
  });

  test("switches to minutes only when the step is whole minutes", () => {
    expect(divisionTicks(300_000).map((t) => t.label)).toEqual([
      "5m",
      "4m",
      "3m",
      "2m",
      "1m",
      "now",
    ]);
  });

  test("the knob reads the same way", () => {
    expect(spanLabel(90_000)).toBe("90s");
    expect(spanLabel(300_000)).toBe("5m");
  });
});

describe("the axis mapping", () => {
  const now = 1_000_000;

  test("now is the right edge and the window's start is the left", () => {
    expect(xFraction(now, now, 90_000)).toBe(1);
    expect(xFraction(now - 90_000, now, 90_000)).toBe(0);
    expect(xFraction(now - 45_000, now, 90_000)).toBeCloseTo(0.5, 6);
  });

  test("round-trips through timeAt", () => {
    for (const fraction of [0, 0.25, 0.5, 1]) {
      const at = timeAt(fraction, now, 90_000);
      expect(xFraction(at, now, 90_000)).toBeCloseTo(fraction, 6);
    }
  });

  test("the window excludes the future and the far past", () => {
    expect(inWindow(now, now, 90_000)).toBe(true);
    expect(inWindow(now + 1, now, 90_000)).toBe(false);
    expect(inWindow(now - 90_001, now, 90_000)).toBe(false);
  });
});

// ── the readout ──────────────────────────────────────────────────────

describe("formatOffset", () => {
  test("the right edge is the present, not t−0.0s", () => {
    expect(formatOffset(0)).toBe("now");
    expect(formatOffset(120)).toBe("now");
  });

  test("gains precision where the eye needs it", () => {
    // Close to now, a tenth of a second is the difference between two
    // events; a minute back it is noise.
    expect(formatOffset(3_400)).toBe("t−3.4s");
    expect(formatOffset(34_000)).toBe("t−34s");
    expect(formatOffset(125_000)).toBe("t−2m05s");
  });
});

describe("formatRate", () => {
  test("silence prints nothing at all", () => {
    // `0 B/s` overstates it: silence is a reading, and an empty cell is
    // the honest way to show one.
    expect(formatRate(0)).toBe("");
    expect(formatRate(-5)).toBe("");
  });

  test("steps units at the right thresholds", () => {
    expect(formatRate(512)).toBe("512 B/s");
    expect(formatRate(2_048)).toBe("2.0 KB/s");
    expect(formatRate(2 * 1024 * 1024)).toBe("2.0 MB/s");
  });
});

describe("buildReadout", () => {
  function lane(id: string, over: Partial<AtlasNode> = {}): ChronoLane {
    return {
      id,
      node: {
        id,
        kind: "surface",
        label: id,
        sublabel: "",
        parent: null,
        children: [],
        tone: "accent",
        load: 0,
        flow: 0,
        active: false,
        running: false,
        attention: null,
        badges: [],
        detail: [],
        actions: [],
        expandable: false,
        tags: [],
        ...over,
      } as AtlasNode,
      head: "screen",
      workspaceId: "w",
      workspaceName: "w",
      workspaceColor: "#6fe9ff",
      workspaceHead: true,
      workspaceTail: true,
      satellites: [],
      historyKey: id,
    };
  }

  const sample = (over: Partial<MetricSample> = {}): MetricSample => ({
    at: 1_000_000,
    cpu: 0,
    bytes: 0,
    ...over,
  });

  test("reads rate, cpu and context off the sample under the cursor", () => {
    const rows = buildReadout(
      [lane("a")],
      () => sample({ bytes: 4_096, cpu: 62, ctx: 41 }),
      () => "#6fe9ff",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rate).toBe("4.0 KB/s");
    expect(rows[0]!.cpu).not.toBe("");
    expect(rows[0]!.context).toBe("41% ctx");
  });

  test("omits what the lane did not report", () => {
    // A non-agent lane has no context to show, and inventing `0% ctx`
    // for it would claim a full, empty window.
    const rows = buildReadout(
      [lane("a")],
      () => sample(),
      () => "#6fe9ff",
    );
    expect(rows[0]!.context).toBe("");
    expect(rows[0]!.rate).toBe("");
    expect(rows[0]!.cpu).toBe("");
  });

  test("drops lanes with nothing under the cursor", () => {
    // Parking on an empty stretch reads as empty, not as the last thing
    // that happened to be nearby.
    expect(
      buildReadout(
        [lane("a")],
        () => null,
        () => "#6fe9ff",
      ),
    ).toEqual([]);
  });
});
