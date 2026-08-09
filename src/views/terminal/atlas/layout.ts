/**
 * Atlas layout — snapshot → placed scene.
 *
 * Pure and deterministic. Given the same snapshot and the same expansion
 * set it returns byte-identical geometry, which is what lets the renderer
 * diff instead of rebuild, and what keeps nodes from jittering when the
 * metadata poller ticks at 1 Hz.
 *
 * ## Why a spine and not a force layout
 *
 * The obvious "graph view" reflex is force-directed physics. It is wrong
 * here twice over. It jitters — every 1 Hz telemetry tick perturbs the
 * simulation, so the picture never settles and node positions carry no
 * memory between glances. And it burns CPU continuously in an app whose
 * first stated priority is idle CPU at ~0.
 *
 * So Atlas draws the shape this data actually has: a tree, rendered as a
 * **spine** — depth is a small horizontal indent, siblings stack
 * vertically, and edges are elbows that drop down the parent's spine and
 * turn right into the child. That is the idiom of `git log --graph`, of
 * `pstree`, of every pipe diagram — the vernacular of the thing being
 * drawn. It also gives the byte-flow animation long straight runs of wire
 * to travel along, which a node cloud would not.
 */
import type {
  AtlasAttention,
  AtlasCallout,
  AtlasLayoutOptions,
  AtlasPlacedEdge,
  AtlasPlacedNode,
  AtlasScene,
  AtlasSnapshot,
} from "./types";

export const COLUMN_LAYOUT: AtlasLayoutOptions = {
  width: 320,
  indent: 17,
  originX: 18,
  originY: 16,
  rowHeight: 25,
  badgeHeight: 15,
  radius: 4.5,
};

export const EXPANDED_LAYOUT: AtlasLayoutOptions = {
  width: 560,
  indent: 24,
  originX: 26,
  originY: 24,
  rowHeight: 28,
  badgeHeight: 17,
  radius: 6,
};

/** Rows below this are folded away entirely. Keeps a runaway process
 *  tree from turning the column into an unscrollable wall. */
const MAX_ROWS = 400;

export interface AtlasLayoutInput {
  snapshot: AtlasSnapshot;
  /** Ids whose children are shown. A node absent from the set is folded. */
  expanded: ReadonlySet<string>;
  options: AtlasLayoutOptions;
}

export function layoutAtlas(input: AtlasLayoutInput): AtlasScene {
  const { snapshot, expanded, options } = input;
  const nodes: AtlasPlacedNode[] = [];
  const edges: AtlasPlacedEdge[] = [];
  const placedById = new Map<string, AtlasPlacedNode>();

  let y = options.originY;

  const walk = (id: string, depth: number): void => {
    if (nodes.length >= MAX_ROWS) return;
    const node = snapshot.nodes.get(id);
    if (!node) return;

    const height =
      options.rowHeight + (node.badges.length > 0 ? options.badgeHeight : 0);
    const placed: AtlasPlacedNode = {
      node,
      x: options.originX + depth * options.indent,
      // Marker sits on the label's optical centre, not the row's — the
      // badge row hangs below the label and must not drag the dot down.
      y: y + options.rowHeight / 2,
      rowTop: y,
      rowHeight: height,
      depth,
    };
    nodes.push(placed);
    placedById.set(id, placed);
    y += height;

    if (!expanded.has(id)) return;
    // Each child's wire starts where the previous sibling's ended, so the
    // trunk is a chain of disjoint segments rather than N overlapping
    // runs from the parent. That matters here: every segment animates at
    // its own child's byte rate, and stacked segments at different
    // speeds would read as noise instead of as flow.
    let anchor: AtlasPlacedNode = placed;
    for (const childId of node.children) {
      const before = nodes.length;
      walk(childId, depth + 1);
      if (nodes.length === before) continue;
      const child = placedById.get(childId);
      if (!child) continue;
      edges.push(elbow(anchor, placed.x, child, options));
      anchor = child;
    }
  };

  for (const rootId of snapshot.roots) walk(rootId, 0);

  return {
    nodes,
    edges,
    callouts: buildCallouts(nodes, options),
    width: options.width,
    height: y + options.originY,
  };
}

/** Attention states a callout is drawn for. `notify` and `input` are
 *  informational — they get the node's dashed ring and nothing more. */
const ACTIONABLE: ReadonlySet<AtlasAttention> = new Set([
  "approval",
  "question",
  "error",
]);

/** At most this many arcs. A system with more than two things blocking
 *  on you needs the notification centre, not more lines. */
const MAX_CALLOUTS = 2;

/**
 * Arc from the spine's head to whatever is blocking on the user. Bows
 * out to the left of the trunk so it never crosses a label, with the
 * bow scaled by the drop — a near neighbour gets a gentle curve, a
 * distant one a wide sweep.
 */
function buildCallouts(
  nodes: AtlasPlacedNode[],
  options: AtlasLayoutOptions,
): AtlasCallout[] {
  const root = nodes[0];
  if (!root) return [];
  const out: AtlasCallout[] = [];
  for (const placed of nodes) {
    const attention = placed.node.attention;
    if (!attention || !ACTIONABLE.has(attention)) continue;
    if (placed.node.id === root.node.id) continue;
    if (out.length >= MAX_CALLOUTS) break;
    const dy = placed.y - root.y;
    if (dy <= 0) continue;
    const bow = Math.min(options.originX - 3, 5 + dy * 0.14);
    out.push({
      id: `callout:${placed.node.id}`,
      to: placed.node.id,
      d:
        `M ${root.x} ${root.y + options.radius + 1} ` +
        `C ${root.x - bow} ${root.y + dy * 0.35}, ` +
        `${placed.x - bow} ${placed.y - dy * 0.28}, ` +
        `${placed.x - options.radius - 1.5} ${placed.y}`,
      attention,
      tone: attention === "error" ? "err" : "warn",
    });
  }
  return out;
}

/**
 * The elbow wire: down the trunk from `from` (the parent for a first
 * child, the previous sibling after that) to the child's row, then a
 * small quadratic turn right into the child marker. The corner
 * radius is deliberately generous relative to the indent — a hard right
 * angle at this scale renders as an aliased notch, and the curve reads
 * as a conduit rather than a schematic.
 */
function elbow(
  from: AtlasPlacedNode,
  trunkX: number,
  child: AtlasPlacedNode,
  options: AtlasLayoutOptions,
): AtlasPlacedEdge {
  const x = trunkX;
  const topY = from.y + options.radius + 1.5;
  const turnY = child.y;
  const r = Math.min(7, options.indent - 4, Math.max(0, turnY - topY));
  const endX = child.x - options.radius - 1.5;
  const d =
    `M ${x} ${topY} V ${turnY - r} ` +
    `Q ${x} ${turnY} ${x + r} ${turnY} ` +
    `H ${endX}`;
  return {
    id: `${from.node.id}→${child.node.id}`,
    from: from.node.id,
    to: child.node.id,
    d,
    tone: child.node.tone,
    ...(child.node.color !== undefined ? { color: child.node.color } : {}),
    flow: child.node.flow,
    active: child.node.active,
  };
}
