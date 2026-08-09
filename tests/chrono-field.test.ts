// The field's discipline: a bounded event log, and a redraw rule that
// lets an honest time axis cost nothing when nothing is happening.
//
// The assertion this file exists for is the last one in it: **an idle
// field advances its clock and does not repaint.** Time always moves, so
// a naïve time axis repaints forever; CHRONO is only affordable because
// a silent system's trace is a flat line whose shift is indistinguishable
// from itself, and the signature says so.

import { beforeEach, describe, expect, test } from "bun:test";
import {
  allEvents,
  eventsSince,
  noteEvent,
  resetEvents,
} from "../src/views/terminal/chrono/event-log";
import {
  fieldIsMoving,
  fieldSignature,
  levelOf,
  strikeTone,
  WINDOW_MS,
  type FieldInput,
} from "../src/views/terminal/chrono/field";
import {
  recordMetrics,
  resetMetrics,
} from "../src/views/terminal/metrics-history";
import type { ChronoLane } from "../src/views/terminal/chrono/lanes";
import type { AtlasNode } from "../src/views/terminal/atlas/types";

// ── the event log ────────────────────────────────────────────────────

describe("event-log", () => {
  beforeEach(() => resetEvents());

  test("records an event and reads it back inside the window", () => {
    const now = 1_000_000;
    noteEvent("approval", "s1", "Bash(rm -rf)", now);
    const events = eventsSince(WINDOW_MS, now);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "approval",
      surfaceId: "s1",
      text: "Bash(rm -rf)",
      at: now,
    });
  });

  test("drops a duplicate arriving inside the dedupe window", () => {
    // The session store re-pushes whole snapshots, so the same
    // transition arrives several times. Four rules a pixel apart is not
    // four approvals.
    const now = 1_000_000;
    expect(noteEvent("approval", "s1", "same", now)).toBe(true);
    expect(noteEvent("approval", "s1", "same", now + 200)).toBe(false);
    expect(allEvents()).toHaveLength(1);
  });

  test("the same event later is a new event", () => {
    const now = 1_000_000;
    noteEvent("approval", "s1", "same", now);
    expect(noteEvent("approval", "s1", "same", now + 5_000)).toBe(true);
    expect(allEvents()).toHaveLength(2);
  });

  test("different surfaces are never the same event", () => {
    const now = 1_000_000;
    noteEvent("turn", "s1", "turn", now);
    expect(noteEvent("turn", "s2", "turn", now + 10)).toBe(true);
  });

  test("stays bounded under a flood", () => {
    // Bounded by construction, like metrics-history: a week-long session
    // cannot grow this.
    for (let i = 0; i < 5_000; i++) {
      noteEvent("turn", `s${i}`, `t${i}`, 1_000_000 + i * 1_000);
    }
    expect(allEvents().length).toBeLessThanOrEqual(256);
  });

  test("expires events past the TTL", () => {
    noteEvent("mark", null, "old", 1_000_000);
    noteEvent("mark", null, "new", 1_000_000 + 200_000);
    expect(allEvents().map((e) => e.text)).toEqual(["new"]);
  });

  test("the window excludes what falls out of it", () => {
    const now = 1_000_000;
    noteEvent("mark", null, "just-outside", now - WINDOW_MS - 1);
    noteEvent("mark", null, "just-inside", now - WINDOW_MS + 1);
    expect(eventsSince(WINDOW_MS, now).map((e) => e.text)).toEqual([
      "just-inside",
    ]);
  });
});

// ── the byte scale ───────────────────────────────────────────────────

describe("levelOf", () => {
  test("silence is exactly zero", () => {
    // Consumers branch on `=== 0` to skip drawing a bar at all.
    expect(levelOf(0)).toBe(0);
    expect(levelOf(-1)).toBe(0);
  });

  test("saturates at the ceiling and never exceeds it", () => {
    expect(levelOf(262_144)).toBeCloseTo(1, 5);
    expect(levelOf(10_000_000)).toBe(1);
  });

  test("a slow log tail is visibly above silence", () => {
    // The point of a log scale here: linear would put 2 KB/s and total
    // silence in the same pixel, and the trace exists to tell them apart.
    expect(levelOf(2_048)).toBeGreaterThan(0.15);
  });

  test("is monotonic", () => {
    let previous = 0;
    for (const bytes of [1, 100, 512, 4_096, 65_536, 262_144]) {
      const level = levelOf(bytes);
      expect(level).toBeGreaterThan(previous);
      previous = level;
    }
  });
});

describe("strikeTone", () => {
  test("uses the state palette, never a literal", () => {
    for (const kind of [
      "turn",
      "approval",
      "question",
      "error",
      "notify",
      "mark",
    ] as const) {
      expect(strikeTone(kind)).toMatch(/^var\(--tau-/);
    }
  });

  test("an error reads as an error and an approval as a warning", () => {
    expect(strikeTone("error")).toBe("var(--tau-err)");
    expect(strikeTone("approval")).toBe("var(--tau-warn)");
  });
});

// ── the redraw rule ──────────────────────────────────────────────────

function lane(id: string): ChronoLane {
  const node = {
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
  } as AtlasNode;
  return {
    id,
    node,
    head: "screen",
    workspaceId: "w1",
    workspaceName: "w",
    workspaceColor: "#6fe9ff",
    workspaceHead: true,
    workspaceTail: true,
    satellites: [],
    historyKey: id,
  };
}

function input(now: number, ids = ["a"]): FieldInput {
  return {
    lanes: ids.map(lane),
    geometry: {
      left: 232,
      width: 800,
      height: 600,
      boxes: ids.map((id, i) => ({ id, top: i * 200, height: 200 })),
    },
    events: [],
    now,
    span: WINDOW_MS,
    cursor: null,
  };
}

describe("fieldSignature", () => {
  beforeEach(() => {
    resetMetrics();
    resetEvents();
  });

  test("an idle field advances its clock and does not repaint", () => {
    // THE rule. A silent system records no samples, so the picture is a
    // flat hairline whose shift is indistinguishable from itself. If this
    // ever fails, CHRONO burns CPU forever on an idle machine.
    const start = 5_000_000;
    const before = fieldSignature(input(start));
    const after = fieldSignature(input(start + 30_000));
    expect(after).toBe(before);
    expect(fieldIsMoving(input(start))).toBe(false);
  });

  test("a non-zero sample entering the window invalidates it", () => {
    const now = 5_000_000;
    const before = fieldSignature(input(now));
    recordMetrics("a", 0, 4_096, now);
    expect(fieldSignature(input(now))).not.toBe(before);
  });

  test("a skyline in the window keeps the field moving", () => {
    // It genuinely does change every frame — it scrolls leftward — so
    // this one has to keep repainting until the window drains.
    const now = 5_000_000;
    recordMetrics("a", 0, 4_096, now);
    expect(fieldIsMoving(input(now))).toBe(true);
    expect(fieldSignature(input(now))).not.toBe(
      fieldSignature(input(now + 1_000)),
    );
  });

  test("and goes still again once that skyline has drained", () => {
    const now = 5_000_000;
    recordMetrics("a", 0, 4_096, now);
    const later = now + WINDOW_MS + 1_000;
    expect(fieldIsMoving(input(later))).toBe(false);
    expect(fieldSignature(input(later))).toBe(
      fieldSignature(input(later + 30_000)),
    );
  });

  test("a sample of exactly zero does not wake the field", () => {
    // The poller records a sample every tick while *anything* is
    // happening elsewhere; a quiet pane's zeros must not count as motion.
    const now = 5_000_000;
    recordMetrics("a", 12, 0, now);
    expect(fieldIsMoving(input(now))).toBe(false);
  });

  test("a strike in the window invalidates it and keeps it moving", () => {
    const now = 5_000_000;
    const base = input(now);
    const withStrike: FieldInput = {
      ...base,
      events: [
        { at: now - 5_000, kind: "approval", surfaceId: "a", text: "x" },
      ],
    };
    expect(fieldSignature(withStrike)).not.toBe(fieldSignature(base));
    expect(fieldIsMoving(withStrike)).toBe(true);
  });

  test("geometry changes invalidate it", () => {
    // A lane changing height is one of the three things allowed to
    // invalidate, per the plan.
    const now = 5_000_000;
    const before = fieldSignature(input(now));
    const taller: FieldInput = {
      ...input(now),
      geometry: {
        left: 232,
        width: 800,
        height: 600,
        boxes: [{ id: "a", top: 0, height: 320 }],
      },
    };
    expect(fieldSignature(taller)).not.toBe(before);
  });

  test("a new lane invalidates it", () => {
    const now = 5_000_000;
    expect(fieldSignature(input(now, ["a", "b"]))).not.toBe(
      fieldSignature(input(now, ["a"])),
    );
  });
});
