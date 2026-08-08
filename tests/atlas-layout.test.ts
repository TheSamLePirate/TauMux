// Atlas layout + filtering — the pure half of the topology panel.
//
// Two invariants carry the whole design:
//
//  1. **Determinism.** The same snapshot must produce byte-identical
//     geometry. That is what lets the renderer diff instead of rebuild,
//     and what stops nodes jittering when the poller ticks at 1 Hz.
//  2. **Disjoint trunk segments.** Each child's wire starts where the
//     previous sibling's ended, so no two animated segments overlap.
//     Overlapping runs at different byte rates read as noise.

import { describe, expect, test } from "bun:test";
import {
  COLUMN_LAYOUT,
  EXPANDED_LAYOUT,
  layoutAtlas,
} from "../src/views/terminal/atlas/layout";
import { applyFilter } from "../src/views/terminal/atlas/filter";
import type {
  AtlasFilterTag,
  AtlasNode,
  AtlasSnapshot,
} from "../src/views/terminal/atlas/types";

function node(
  id: string,
  over: Partial<AtlasNode> & { children?: string[] } = {},
): AtlasNode {
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

/** root → (a → a1, a2), b */
function snapshot(): AtlasSnapshot {
  const nodes = new Map<string, AtlasNode>([
    ["root", node("root", { kind: "root", children: ["a", "b"] })],
    [
      "a",
      node("a", { kind: "workspace", parent: "root", children: ["a1", "a2"] }),
    ],
    ["a1", node("a1", { parent: "a", tags: ["agent", "running"] })],
    [
      "a2",
      node("a2", { parent: "a", badges: [{ text: ":3000", tone: "ok" }] }),
    ],
    ["b", node("b", { kind: "workspace", parent: "root" })],
  ]);
  return {
    nodes,
    roots: ["root"],
    totals: {
      workspaces: 2,
      surfaces: 2,
      agents: 1,
      cpu: 0,
      rssKb: 0,
      attention: 0,
      costUsd: 0,
    },
  };
}

const ALL = new Set(["root", "a", "b", "a1", "a2"]);

describe("layoutAtlas", () => {
  test("is deterministic — same input, identical geometry", () => {
    const input = {
      snapshot: snapshot(),
      expanded: ALL,
      options: COLUMN_LAYOUT,
    };
    const a = layoutAtlas(input);
    const b = layoutAtlas(input);
    expect(JSON.stringify(a.nodes.map((n) => [n.node.id, n.x, n.y]))).toBe(
      JSON.stringify(b.nodes.map((n) => [n.node.id, n.x, n.y])),
    );
    expect(a.edges.map((e) => e.d)).toEqual(b.edges.map((e) => e.d));
  });

  test("walks pre-order and indents by depth", () => {
    const scene = layoutAtlas({
      snapshot: snapshot(),
      expanded: ALL,
      options: COLUMN_LAYOUT,
    });
    expect(scene.nodes.map((n) => n.node.id)).toEqual([
      "root",
      "a",
      "a1",
      "a2",
      "b",
    ]);
    const byId = new Map(scene.nodes.map((n) => [n.node.id, n]));
    expect(byId.get("root")!.x).toBe(COLUMN_LAYOUT.originX);
    expect(byId.get("a")!.x).toBe(COLUMN_LAYOUT.originX + COLUMN_LAYOUT.indent);
    expect(byId.get("a1")!.x).toBe(
      COLUMN_LAYOUT.originX + COLUMN_LAYOUT.indent * 2,
    );
    expect(byId.get("a1")!.depth).toBe(2);
  });

  test("a badge row makes the node's row taller but does not move its marker", () => {
    const scene = layoutAtlas({
      snapshot: snapshot(),
      expanded: ALL,
      options: COLUMN_LAYOUT,
    });
    const withBadges = scene.nodes.find((n) => n.node.id === "a2")!;
    const without = scene.nodes.find((n) => n.node.id === "a1")!;
    expect(without.rowHeight).toBe(COLUMN_LAYOUT.rowHeight);
    expect(withBadges.rowHeight).toBe(
      COLUMN_LAYOUT.rowHeight + COLUMN_LAYOUT.badgeHeight,
    );
    // Marker sits on the first line's centre in both cases.
    for (const placed of [withBadges, without]) {
      expect(placed.y - placed.rowTop).toBe(COLUMN_LAYOUT.rowHeight / 2);
    }
  });

  test("a folded node hides its children and their wires", () => {
    const scene = layoutAtlas({
      snapshot: snapshot(),
      expanded: new Set(["root"]),
      options: COLUMN_LAYOUT,
    });
    expect(scene.nodes.map((n) => n.node.id)).toEqual(["root", "a", "b"]);
    expect(scene.edges.some((e) => e.to === "a1")).toBe(false);
  });

  test("sibling wires chain instead of overlapping", () => {
    const scene = layoutAtlas({
      snapshot: snapshot(),
      expanded: ALL,
      options: COLUMN_LAYOUT,
    });
    const first = scene.edges.find((e) => e.to === "a1")!;
    const second = scene.edges.find((e) => e.to === "a2")!;
    // The second child's wire starts at the first child, not the parent —
    // otherwise both would animate over the same vertical run.
    expect(first.from).toBe("a");
    expect(second.from).toBe("a1");
    expect(second.id).not.toBe(first.id);
  });

  test("edges inherit the child's identity, colour and flow", () => {
    const snap = snapshot();
    snap.nodes.get("a1")!.tone = "agent";
    snap.nodes.get("a1")!.flow = 0.42;
    snap.nodes.get("a1")!.color = "#abcdef";
    const scene = layoutAtlas({
      snapshot: snap,
      expanded: ALL,
      options: COLUMN_LAYOUT,
    });
    const edge = scene.edges.find((e) => e.to === "a1")!;
    expect(edge.tone).toBe("agent");
    expect(edge.flow).toBe(0.42);
    expect(edge.color).toBe("#abcdef");
  });

  test("scene height covers every row plus the bottom margin", () => {
    const scene = layoutAtlas({
      snapshot: snapshot(),
      expanded: ALL,
      options: COLUMN_LAYOUT,
    });
    const last = scene.nodes[scene.nodes.length - 1]!;
    expect(scene.height).toBeGreaterThanOrEqual(last.rowTop + last.rowHeight);
  });

  test("an empty snapshot lays out without throwing", () => {
    const scene = layoutAtlas({
      snapshot: {
        nodes: new Map(),
        roots: ["missing"],
        totals: {
          workspaces: 0,
          surfaces: 0,
          agents: 0,
          cpu: 0,
          rssKb: 0,
          attention: 0,
          costUsd: 0,
        },
      },
      expanded: new Set(),
      options: COLUMN_LAYOUT,
    });
    expect(scene.nodes).toHaveLength(0);
    expect(scene.edges).toHaveLength(0);
  });

  test("a deep runaway tree is capped rather than rendered whole", () => {
    const nodes = new Map<string, AtlasNode>();
    const children: string[] = [];
    for (let i = 0; i < 900; i++) {
      children.push(`n${i}`);
      nodes.set(`n${i}`, node(`n${i}`, { parent: "root" }));
    }
    nodes.set("root", node("root", { kind: "root", children }));
    const scene = layoutAtlas({
      snapshot: {
        nodes,
        roots: ["root"],
        totals: {
          workspaces: 0,
          surfaces: 900,
          agents: 0,
          cpu: 0,
          rssKb: 0,
          attention: 0,
          costUsd: 0,
        },
      },
      expanded: new Set(["root"]),
      options: COLUMN_LAYOUT,
    });
    expect(scene.nodes.length).toBeLessThan(901);
    expect(scene.nodes.length).toBeGreaterThan(100);
  });

  test("the expanded overlay uses the same algorithm at a larger scale", () => {
    const column = layoutAtlas({
      snapshot: snapshot(),
      expanded: ALL,
      options: COLUMN_LAYOUT,
    });
    const overlay = layoutAtlas({
      snapshot: snapshot(),
      expanded: ALL,
      options: EXPANDED_LAYOUT,
    });
    expect(overlay.nodes.map((n) => n.node.id)).toEqual(
      column.nodes.map((n) => n.node.id),
    );
    expect(overlay.height).toBeGreaterThan(column.height);
  });
});

describe("applyFilter", () => {
  const run = (tag: AtlasFilterTag) => {
    const filtered = applyFilter(snapshot(), tag);
    return [...filtered.nodes.keys()].sort();
  };

  test("`all` is the identity", () => {
    const snap = snapshot();
    expect(applyFilter(snap, "all")).toBe(snap);
  });

  test("a matching node keeps its ancestors so it stays reachable", () => {
    expect(run("agent")).toEqual(["a", "a1", "root"]);
  });

  test("non-matching siblings and empty branches drop out", () => {
    const filtered = applyFilter(snapshot(), "agent");
    expect(filtered.nodes.has("a2")).toBe(false);
    expect(filtered.nodes.has("b")).toBe(false);
    expect(filtered.nodes.get("a")!.children).toEqual(["a1"]);
  });

  test("the spine head survives even when nothing matches", () => {
    const filtered = applyFilter(snapshot(), "attention");
    expect([...filtered.nodes.keys()]).toEqual(["root"]);
  });

  test("filtering never mutates the source snapshot", () => {
    const snap = snapshot();
    applyFilter(snap, "agent");
    expect(snap.nodes.get("a")!.children).toEqual(["a1", "a2"]);
    expect(snap.nodes.size).toBe(5);
  });
});
