// CHRONO's pure half: the viewport mechanic and the lane model.
//
// Two things carry the whole view and neither needs a DOM:
//
//  1. **The anchor.** A lane is a clipped window onto a live terminal,
//     and where that window sits decides whether the head shows the
//     user's last command or forty rows of nothing. The rule is *last
//     line on the lane's bottom edge*, in both directions.
//  2. **The distribution.** The focused lane expands and the others
//     compress — down to a floor, past which the field scrolls rather
//     than rendering lanes too short to read.

import { describe, expect, test } from "bun:test";
import {
  anchorOffset,
  readTerminalGrid,
  type TerminalGridSource,
} from "../src/views/terminal/chrono/grid";
import {
  buildLanes,
  distributeLanes,
  headKindFor,
  MIN_LANE_H,
} from "../src/views/terminal/chrono/lanes";
import type {
  AtlasNode,
  AtlasSnapshot,
} from "../src/views/terminal/atlas/types";
import type { SurfaceKind } from "../src/shared/types";

// ── fixtures ─────────────────────────────────────────────────────────

/** A terminal whose viewport rows are the given strings. */
function term(
  lines: string[],
  options: { rows?: number; alt?: boolean; viewportY?: number } = {},
): TerminalGridSource {
  const rows = options.rows ?? lines.length;
  const viewportY = options.viewportY ?? 0;
  return {
    rows,
    buffer: {
      active: {
        type: options.alt ? "alternate" : "normal",
        viewportY,
        length: viewportY + rows,
        getLine(y: number) {
          const text = lines[y - viewportY];
          if (text === undefined) return undefined;
          return { translateToString: () => text };
        },
      },
    },
  };
}

function node(id: string, over: Partial<AtlasNode> = {}): AtlasNode {
  return {
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
  };
}

function snapshot(nodes: AtlasNode[]): AtlasSnapshot {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    roots: ["__root__"],
    totals: {
      workspaces: 0,
      surfaces: 0,
      agents: 0,
      cpu: 0,
      rssKb: 0,
      attention: 0,
      costUsd: 0,
      fiveHourPct: null,
      sevenDayPct: null,
    },
    river: [],
  };
}

// ── the viewport mechanic ────────────────────────────────────────────

describe("readTerminalGrid", () => {
  test("finds the last row carrying content", () => {
    const grid = readTerminalGrid(term(["$ ls", "a  b  c", "$ ", "", ""]));
    expect(grid).toEqual({ rows: 5, contentRows: 3, alt: false });
  });

  test("an empty terminal still anchors on its first row", () => {
    // Zero would put the cursor line below the lane's bottom edge.
    expect(readTerminalGrid(term(["", "", ""]))?.contentRows).toBe(1);
  });

  test("treats whitespace-only rows as blank", () => {
    expect(readTerminalGrid(term(["hi", "   ", "\t"]))?.contentRows).toBe(1);
  });

  test("reads through the viewport offset when scrolled back", () => {
    const grid = readTerminalGrid(
      term(["one", "two", ""], { viewportY: 400, rows: 3 }),
    );
    expect(grid?.contentRows).toBe(2);
  });

  test("an alternate buffer anchors on the grid, not on its content", () => {
    // A TUI's frame *is* the state. Re-anchoring as its status line
    // cleared would make `vim` slide by a row on every redraw.
    const grid = readTerminalGrid(term(["~", "~", ""], { alt: true }));
    expect(grid).toEqual({ rows: 3, contentRows: 3, alt: true });
  });

  test("returns null for a pane with no terminal", () => {
    expect(readTerminalGrid(null)).toBeNull();
    expect(readTerminalGrid(undefined)).toBeNull();
  });
});

describe("anchorOffset", () => {
  const grid = (rows: number, contentRows: number) => ({
    rows,
    contentRows,
    alt: false,
  });

  test("pushes short content down onto the lane's bottom edge", () => {
    // 24 rows at 10 px; three of them have ink; the lane is 120 px.
    // 120 − 30 = 90 px down, so the last line lands on the edge.
    expect(
      anchorOffset({ grid: grid(24, 3), laneHeight: 120, screenHeight: 240 }),
    ).toBe(90);
  });

  test("scrolls tall content up past the top of the lane", () => {
    expect(
      anchorOffset({ grid: grid(24, 24), laneHeight: 120, screenHeight: 240 }),
    ).toBe(-120);
  });

  test("is zero when the content exactly fills the lane", () => {
    expect(
      anchorOffset({ grid: grid(24, 12), laneHeight: 120, screenHeight: 240 }),
    ).toBe(0);
  });

  test("rounds to whole pixels", () => {
    // A fractional translate puts the character grid on a half-pixel and
    // every glyph in the lane blurs.
    const offset = anchorOffset({
      grid: grid(24, 7),
      laneHeight: 100,
      screenHeight: 241,
    });
    expect(Number.isInteger(offset)).toBe(true);
  });

  test("degrades to no movement on unmeasured geometry", () => {
    // A lane that has not been laid out yet must show the terminal where
    // it already is, not somewhere invented.
    expect(
      anchorOffset({ grid: grid(24, 3), laneHeight: 0, screenHeight: 240 }),
    ).toBe(0);
    expect(
      anchorOffset({ grid: grid(24, 3), laneHeight: 120, screenHeight: 0 }),
    ).toBe(0);
  });
});

// ── head kinds ───────────────────────────────────────────────────────

describe("headKindFor", () => {
  test("terminals get a clipped screen", () => {
    expect(headKindFor("terminal")).toBe("screen");
  });

  test("DOM panes are sized to the lane instead of clipped", () => {
    for (const kind of ["agent", "claude", "telegram", "editor"] as const) {
      expect(headKindFor(kind)).toBe("pane");
    }
  });

  test("native webviews cannot be borrowed at all", () => {
    // A browser pane is an OOPIF overlay and an extension pane is an
    // iframe that reloads when reparented. Both get a standby card.
    expect(headKindFor("browser")).toBe("standby");
    expect(headKindFor("extension")).toBe("standby");
  });
});

// ── flattening ───────────────────────────────────────────────────────

describe("buildLanes", () => {
  const kinds = new Map<string, SurfaceKind>([
    ["s1", "terminal"],
    ["s2", "browser"],
    ["s3", "claude"],
  ]);

  const tree = () =>
    snapshot([
      node("__root__", { kind: "root", children: ["w1", "w2", "sess"] }),
      node("w1", {
        kind: "workspace",
        label: "crazyShell",
        color: "#6fe9ff",
        children: ["s1", "s2"],
      }),
      node("s1", { parent: "w1", children: ["s1:port:3000"] }),
      node("s1:port:3000", { kind: "port", parent: "s1", label: ":3000" }),
      node("s2", { parent: "w1" }),
      node("w2", { kind: "workspace", label: "agents", children: ["s3"] }),
      node("s3", { parent: "w2", tone: "agent" }),
      node("sess", { kind: "session", label: "claude" }),
    ]);

  test("flattens every pane of every workspace, in graph order", () => {
    const lanes = buildLanes({ snapshot: tree(), surfaceTypes: kinds });
    expect(lanes.map((l) => l.id)).toEqual(["s1", "s2", "s3", "sess"]);
  });

  test("carries the workspace identity onto each lane", () => {
    const lanes = buildLanes({ snapshot: tree(), surfaceTypes: kinds });
    expect(lanes[0]!.workspaceName).toBe("crazyShell");
    expect(lanes[0]!.workspaceColor).toBe("#6fe9ff");
    expect(lanes[2]!.workspaceName).toBe("agents");
  });

  test("marks the caps of each workspace's bracket", () => {
    const lanes = buildLanes({ snapshot: tree(), surfaceTypes: kinds });
    expect(lanes.map((l) => [l.workspaceHead, l.workspaceTail])).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [true, true],
    ]);
  });

  test("resolves each lane's head from the surface kind", () => {
    const lanes = buildLanes({ snapshot: tree(), surfaceTypes: kinds });
    expect(lanes.map((l) => l.head)).toEqual([
      "screen",
      "standby",
      "pane",
      "session",
    ]);
  });

  test("hangs deep children on their lane as satellites", () => {
    const lanes = buildLanes({ snapshot: tree(), surfaceTypes: kinds });
    expect(lanes[0]!.satellites.map((s) => s.id)).toEqual(["s1:port:3000"]);
    expect(lanes[1]!.satellites).toEqual([]);
  });

  test("survives an empty field", () => {
    expect(
      buildLanes({
        snapshot: snapshot([node("__root__", { kind: "root" })]),
        surfaceTypes: new Map(),
      }),
    ).toEqual([]);
  });
});

// ── distribution ─────────────────────────────────────────────────────

describe("distributeLanes", () => {
  const ids = ["a", "b", "c", "d"];

  test("one lane takes the whole field", () => {
    const { boxes } = distributeLanes({
      ids: ["a"],
      height: 600,
      gap: 8,
      focusedId: "a",
    });
    expect(boxes).toEqual([{ id: "a", top: 0, height: 600 }]);
  });

  test("a lane's height is what it has to show", () => {
    // The whole reason this takes a demand map: a shell showing two lines
    // must not get the same band as a build printing forty, or the field
    // is mostly empty frame.
    const { boxes } = distributeLanes({
      ids: ["quiet", "loud"],
      height: 800,
      gap: 8,
      focusedId: null,
      demand: new Map([
        ["quiet", 100],
        ["loud", 600],
      ]),
    });
    const quiet = boxes.find((b) => b.id === "quiet")!;
    const loud = boxes.find((b) => b.id === "loud")!;
    expect(loud.height).toBeGreaterThan(quiet.height * 2);
    expect(quiet.height).toBeGreaterThanOrEqual(MIN_LANE_H);
  });

  test("the focused lane wins ties for the surplus", () => {
    const demand = new Map(ids.map((id) => [id, 400]));
    const { boxes } = distributeLanes({
      ids,
      height: 800,
      gap: 8,
      focusedId: "b",
      demand,
    });
    const focused = boxes.find((b) => b.id === "b")!;
    for (const other of boxes.filter((b) => b.id !== "b")) {
      expect(focused.height).toBeGreaterThan(other.height);
      expect(other.height).toBeGreaterThanOrEqual(MIN_LANE_H);
    }
  });

  test("spare room is shared out, not dumped on the focused lane", () => {
    // Everyone's demand met and room left over. The focused lane keeps a
    // gentle edge, but handing it the whole surplus would wrap two lines
    // of prompt in 400 px of empty frame.
    const { boxes } = distributeLanes({
      ids: ["a", "b"],
      height: 900,
      gap: 8,
      focusedId: "a",
      demand: new Map([
        ["a", 120],
        ["b", 120],
      ]),
    });
    const a = boxes.find((b) => b.id === "a")!;
    const b = boxes.find((x) => x.id === "b")!;
    expect(a.height).toBeGreaterThan(b.height);
    expect(a.height).toBeLessThan(b.height * 1.25);
  });

  test("fills the field exactly", () => {
    const height = 800;
    const gap = 8;
    const { boxes, contentHeight } = distributeLanes({
      ids,
      height,
      gap,
      focusedId: "c",
      demand: new Map([
        ["a", 300],
        ["b", 120],
        ["c", 500],
        ["d", 200],
      ]),
    });
    // No pixel left over and none borrowed: the last lane's bottom is
    // the field's bottom, which is what makes the now-edge look solid.
    const last = boxes[boxes.length - 1]!;
    expect(last.top + last.height).toBe(height);
    expect(contentHeight).toBe(height);
  });

  test("lanes never overlap and stay in order", () => {
    const { boxes } = distributeLanes({
      ids,
      height: 700,
      gap: 8,
      focusedId: "a",
    });
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1]!;
      expect(boxes[i]!.top).toBe(prev.top + prev.height + 8);
    }
  });

  test("falls to the floor and scrolls rather than shrinking further", () => {
    // Ten lanes in 300 px: every one at the floor, and a field taller
    // than its viewport.
    const many = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const { boxes, contentHeight } = distributeLanes({
      ids: many,
      height: 300,
      gap: 8,
      focusedId: "s4",
    });
    expect(new Set(boxes.map((b) => b.height))).toEqual(new Set([MIN_LANE_H]));
    expect(contentHeight).toBeGreaterThan(300);
  });

  test("shares evenly before anything has been measured", () => {
    // The first frame of an open has no measurements. Picking a lane to
    // favour on no evidence would be an invention.
    const { boxes } = distributeLanes({
      ids,
      height: 800,
      gap: 8,
      focusedId: null,
    });
    expect(new Set(boxes.map((b) => b.height)).size).toBe(1);
  });

  test("a lane nobody measured still gets the floor", () => {
    const { boxes } = distributeLanes({
      ids: ["a", "b"],
      height: 800,
      gap: 8,
      focusedId: null,
      demand: new Map([["a", 700]]),
    });
    expect(boxes.find((b) => b.id === "b")!.height).toBeGreaterThanOrEqual(
      MIN_LANE_H,
    );
  });

  test("is deterministic", () => {
    // Byte-identical geometry from identical input is what lets the
    // field skip a redraw when nothing moved.
    const demand = new Map([["d", 300]]);
    const once = distributeLanes({
      ids,
      height: 733,
      gap: 8,
      focusedId: "d",
      demand,
    });
    const twice = distributeLanes({
      ids,
      height: 733,
      gap: 8,
      focusedId: "d",
      demand,
    });
    expect(once).toEqual(twice);
  });

  test("an empty field has no boxes", () => {
    expect(
      distributeLanes({ ids: [], height: 600, gap: 8, focusedId: null }),
    ).toEqual({ boxes: [], contentHeight: 0 });
  });
});
