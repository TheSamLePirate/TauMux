/**
 * The lane model — pure.
 *
 * CHRONO's field is a list of lanes sharing one x axis. This module turns
 * an `AtlasSnapshot` into that list and decides how tall each lane is.
 * Nothing here touches the DOM, so both halves are testable directly and
 * the view stays a rendering pass over a decided layout.
 *
 * Two jobs:
 *
 *  1. **Flatten.** The snapshot is a tree; the field is flat. Workspaces
 *     stop being containers and become brackets in the gutter, so a lane
 *     carries its workspace's identity rather than sitting inside it.
 *     That is deliberate: the field has to stay one continuous time space
 *     or the shared x axis stops meaning anything.
 *
 *  2. **Distribute.** The focused lane expands and the others compress,
 *     down to a floor below which a terminal head shows nothing useful.
 *     Past that floor the field scrolls rather than shrinking further —
 *     twelve unreadable lanes are worse than eight readable ones and a
 *     scrollbar.
 */
import type { SurfaceKind } from "../../../shared/types";
import type { AtlasNode, AtlasSnapshot } from "../atlas/types";

/**
 * What a lane can put at *now*.
 *
 *  - `screen` — an xterm pane. The real container, clipped and
 *    bottom-anchored (see `grid.ts`).
 *  - `pane` — a DOM surface (agent, claude, telegram, editor). Also the
 *    real container, but sized to the lane box: these reflow, so letting
 *    them is both free and more correct than clipping.
 *  - `standby` — a native webview (browser) or an iframe host
 *    (extension). Neither survives being reparented, so the head is a
 *    card with a way back to the pane.
 *  - `session` — a Claude session with no pane at all. There is nothing
 *    to show but the session itself.
 */
export type ChronoHeadKind = "screen" | "pane" | "standby" | "session";

export interface ChronoLane {
  /** Surface id, or the session node's id for an unbound session. */
  id: string;
  node: AtlasNode;
  head: ChronoHeadKind;
  workspaceId: string;
  workspaceName: string;
  workspaceColor: string;
  /** First / last lane of its workspace — the bracket's caps. */
  workspaceHead: boolean;
  workspaceTail: boolean;
  /** Ports, processes, plan steps, subagents — the gutter's satellites. */
  satellites: AtlasNode[];
  /** Ring key for this lane's trace. */
  historyKey: string;
}

/** Surfaces whose DOM cannot be borrowed: a native webview overlay and
 *  an iframe that would reload on reparent. */
const STANDBY_KINDS: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>([
  "browser",
  "extension",
]);

export function headKindFor(kind: SurfaceKind | undefined): ChronoHeadKind {
  if (!kind) return "screen";
  if (STANDBY_KINDS.has(kind)) return "standby";
  return kind === "terminal" ? "screen" : "pane";
}

export interface BuildLanesInput {
  snapshot: AtlasSnapshot;
  /** Per-surface kind, from `getWorkspaceState().workspaces[].surfaceTypes`. */
  surfaceTypes: ReadonlyMap<string, SurfaceKind>;
}

/**
 * Flatten the snapshot into lanes, in graph order: every pane of every
 * workspace, then any Claude session with no pane to hang off.
 */
export function buildLanes(input: BuildLanesInput): ChronoLane[] {
  const { snapshot } = input;
  const lanes: ChronoLane[] = [];
  const root = snapshot.roots[0]
    ? snapshot.nodes.get(snapshot.roots[0])
    : undefined;
  if (!root) return lanes;

  for (const childId of root.children) {
    const child = snapshot.nodes.get(childId);
    if (!child) continue;

    if (child.kind === "session") {
      // An unbound session has no workspace, so it gets its own bracket
      // rather than borrowing someone else's.
      lanes.push({
        id: child.id,
        node: child,
        head: "session",
        workspaceId: child.id,
        workspaceName: "unattached",
        workspaceColor: "var(--tau-agent)",
        workspaceHead: true,
        workspaceTail: true,
        satellites: collectSatellites(snapshot, child),
        historyKey: child.historyKey ?? child.id,
      });
      continue;
    }
    if (child.kind !== "workspace") continue;

    const surfaces = child.children
      .map((id) => snapshot.nodes.get(id))
      .filter((n): n is AtlasNode => !!n && n.kind === "surface");

    // A plan published without an agent id anchors to the *workspace*,
    // not to a pane — that is what `ht plan set` does when a script does
    // not bother with attribution. The workspace is a bracket here, not
    // a row, so its plan has no band of its own; it rides the first lane
    // of the bracket, which is the row the bracket's cap already marks.
    const workspacePlan = collectSatellites(snapshot, child).filter(
      (n) => n.kind === "plan-step",
    );

    surfaces.forEach((node, index) => {
      lanes.push({
        id: node.id,
        node,
        head: headKindFor(input.surfaceTypes.get(node.id)),
        workspaceId: child.id,
        workspaceName: child.label,
        workspaceColor: child.color ?? "var(--tau-text-dim)",
        workspaceHead: index === 0,
        workspaceTail: index === surfaces.length - 1,
        satellites: [
          ...collectSatellites(snapshot, node),
          ...(index === 0 ? workspacePlan : []),
        ],
        historyKey: node.historyKey ?? node.id,
      });
    });
  }

  return lanes;
}

/** A pane's deep children — processes, ports, plan steps, subagents,
 *  tasks. They were tree rows in the column; here they are the gutter's
 *  satellites, which is the same information at a glance instead of
 *  behind a caret. */
function collectSatellites(
  snapshot: AtlasSnapshot,
  node: AtlasNode,
): AtlasNode[] {
  const out: AtlasNode[] = [];
  for (const id of node.children) {
    const child = snapshot.nodes.get(id);
    if (child) out.push(child);
  }
  return out;
}

// ── height distribution ──────────────────────────────────────────────

/** Below this a head shows two rows of text and a frame — not enough to
 *  be worth the pixels. The field scrolls instead of going smaller. */
export const MIN_LANE_H = 84;

/** How much of the surplus the focused lane pulls, relative to a lane
 *  that wants the same amount of room. */
const FOCUS_GAIN = 2.2;

export interface LaneBox {
  id: string;
  top: number;
  height: number;
}

export interface DistributeInput {
  ids: readonly string[];
  /** Field height available, in CSS px. */
  height: number;
  /** Gap between lanes. */
  gap: number;
  focusedId: string | null;
  /**
   * How much room each lane could actually use, in CSS px — its live
   * terminal's content, measured. A lane's height is *data* like
   * everything else here: a shell showing two lines does not earn the
   * same band as a build printing forty, and giving it one produces a
   * screen that is mostly empty frame. Missing entries fall back to the
   * floor, which is what an unmeasured lane deserves.
   */
  demand?: ReadonlyMap<string, number>;
}

export interface Distribution {
  boxes: LaneBox[];
  /** Total height of the stack. Greater than `height` when the field had
   *  to fall back to the floor and scroll. */
  contentHeight: number;
}

/**
 * Place every lane.
 *
 * Water-filling: everyone gets the floor, then the surplus is shared out
 * in proportion to what each lane has to show — with the focused lane
 * pulling harder, so the pane you are looking at wins ties. When every
 * lane's demand is met and there is still room left, it is spread evenly
 * rather than dumped on the focused lane: a tall empty band around two
 * lines of prompt is worse than a calm one.
 *
 * Deterministic — the same input yields byte-identical boxes, which is
 * what lets the field skip a redraw when nothing moved.
 */
export function distributeLanes(input: DistributeInput): Distribution {
  const { ids, gap } = input;
  const n = ids.length;
  if (n === 0) return { boxes: [], contentHeight: 0 };

  const gaps = gap * (n - 1);
  const available = Math.max(0, input.height - gaps);
  const heights = new Array<number>(n).fill(MIN_LANE_H);
  const surplus = available - n * MIN_LANE_H;

  if (surplus > 0) {
    const focusedIndex = input.focusedId ? ids.indexOf(input.focusedId) : -1;
    const want = ids.map((id, i) => {
      const demand = input.demand?.get(id);
      // No measurement yet: treat every lane as wanting an equal share,
      // so the first frame is calm rather than arbitrary.
      const raw =
        demand === undefined ? available / n : Math.min(demand, available);
      const extra = Math.max(0, raw - MIN_LANE_H);
      return extra * (i === focusedIndex ? FOCUS_GAIN : 1);
    });
    const totalWant = want.reduce((a, b) => a + b, 0);

    if (totalWant <= 0) {
      // Nothing has anything to show. Even shares.
      for (let i = 0; i < n; i++) heights[i] = MIN_LANE_H + surplus / n;
    } else {
      const scale = Math.min(1, surplus / totalWant);
      for (let i = 0; i < n; i++) {
        heights[i] = MIN_LANE_H + (want[i] ?? 0) * scale;
      }
      // Demand satisfied with room to spare — share the remainder out.
      const leftover = available - heights.reduce((a, b) => a + b, 0);
      if (leftover > 0.5) {
        for (let i = 0; i < n; i++)
          heights[i] = (heights[i] ?? 0) + leftover / n;
      }
    }
  }

  // Integer boxes, with the rounding drift absorbed by the tallest lane
  // so the stack lands exactly on `available` and the now-edge stays a
  // single unbroken rule.
  const rounded = heights.map((h) => Math.floor(h));
  if (surplus > 0) {
    const drift = Math.round(available - rounded.reduce((a, b) => a + b, 0));
    if (drift !== 0) {
      let tallest = 0;
      for (let i = 1; i < n; i++) {
        if ((rounded[i] ?? 0) > (rounded[tallest] ?? 0)) tallest = i;
      }
      rounded[tallest] = (rounded[tallest] ?? 0) + drift;
    }
  }

  const boxes: LaneBox[] = [];
  let top = 0;
  ids.forEach((id, i) => {
    const height = Math.max(MIN_LANE_H, rounded[i] ?? MIN_LANE_H);
    boxes.push({ id, top: Math.round(top), height });
    top += height + gap;
  });
  return { boxes, contentHeight: Math.round(top - gap) };
}
