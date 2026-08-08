/**
 * Atlas data model.
 *
 * The Atlas panel is built as three pure stages plus one impure one:
 *
 *     host state ──build──▶ AtlasSnapshot ──layout──▶ AtlasScene ──draw──▶ SVG
 *                  (impure)               (pure)              (diffed)
 *
 * Everything in this file is presentation-ready: the snapshot builder is
 * the only place that knows about `SurfaceManager`, `SurfaceMetadata` or
 * `ClaudeSessionState`. Layout and rendering see nothing but these
 * types, which is what makes both testable without a webview and
 * previewable against fixtures.
 */

/** Colour role. Resolved to a CSS variable by the renderer — never a
 *  literal, so themes and the theming audit both hold. */
export type AtlasTone =
  | "neutral"
  | "dim"
  | "accent" // cyan — human / system / focus
  | "agent" // amber — agent identity
  | "ok"
  | "warn"
  | "err";

export type AtlasNodeKind =
  /** τ-mux itself. Exactly one, always the spine's head. */
  | "root"
  /** A workspace. */
  | "workspace"
  /** A pane of any surface kind. */
  | "surface"
  /** A Claude Code session with no live pane to attach to. */
  | "session"
  /** A process inside a pane's tree (expanded view only). */
  | "process"
  /** A TCP listener owned by a pane (expanded view only). */
  | "port"
  /** One task from a session's mirrored task list (expanded view only). */
  | "task";

/** Why a node is asking for the user. Drives the dashed attention ring
 *  and the arc drawn from the root to the node. */
export type AtlasAttention =
  | "approval" // a tool needs consent
  | "question" // AskUserQuestion / ExitPlanMode is on screen
  | "input" // session is idle waiting for a prompt
  | "error" // the turn ended on an API error
  | "notify"; // an unread τ-mux notification points here

/** A short mono chip rendered under a node's label. This is where the
 *  "more data in the graph" ask actually lands: ports, git, context,
 *  cost, progress. Cap enforced at build time, not at render time. */
export interface AtlasBadge {
  text: string;
  tone: AtlasTone;
  /** Native tooltip / accessible expansion of the abbreviation. */
  title?: string;
}

/** One labelled row in the inspector. */
export interface AtlasDetailRow {
  label: string;
  value: string;
  tone?: AtlasTone;
  /** Renders as a 0…1 filled bar instead of text when present. */
  meter?: number;
}

/** A button the inspector offers for the selected node. */
export interface AtlasAction {
  id: string;
  label: string;
  kind: "primary" | "danger" | "ghost";
  run: () => void;
}

export interface AtlasNode {
  id: string;
  kind: AtlasNodeKind;
  label: string;
  /** Second line under the label — fg command, model, path fragment.
   *  Empty string renders nothing. */
  sublabel: string;
  parent: string | null;
  children: string[];

  /** Identity colour role. `color` overrides it with the workspace's
   *  own accent when one is set. */
  tone: AtlasTone;
  color?: string;

  /** 0…1 — CPU load, drawn as an arc around the node. */
  load: number;
  /** 0…1 — the node's headline proportion: context used for a session,
   *  build progress for a pane. Drawn as a second, inner arc. */
  meter?: { value: number; tone: AtlasTone };
  /** 0…1 — throughput on the edge coming into this node. 0 means the
   *  wire is at rest and must not animate. */
  flow: number;

  /** This node is the active workspace / the focused pane. */
  active: boolean;
  /** A turn is in flight, a build is running, a shell is busy. */
  running: boolean;
  attention: AtlasAttention | null;

  badges: AtlasBadge[];
  detail: AtlasDetailRow[];
  actions: AtlasAction[];

  /** Children exist and may be folded away. Leaves are never
   *  expandable even when `children` is empty for another reason. */
  expandable: boolean;

  /** Invoked on click / Enter. Navigation, not selection — selection is
   *  handled by the panel. */
  activate?: () => void;

  /** Free-form tags the header filters match against. */
  tags: readonly AtlasFilterTag[];
}

/** Filters offered in the panel header. A node survives a filter when it
 *  carries the tag, or when one of its descendants does. */
export type AtlasFilterTag = "agent" | "running" | "attention";

export interface AtlasSnapshot {
  /** Pre-order. `roots` are the spine heads (normally just `__root__`). */
  nodes: Map<string, AtlasNode>;
  roots: string[];
  /** Aggregates for the header readout. */
  totals: {
    workspaces: number;
    surfaces: number;
    agents: number;
    cpu: number;
    /** Sum of resident set across every tracked process, in KB. */
    rssKb: number;
    attention: number;
    costUsd: number;
  };
}

// ── Layout output ────────────────────────────────────────────────────

export interface AtlasPlacedNode {
  node: AtlasNode;
  /** Spine coordinate of the node marker. */
  x: number;
  y: number;
  /** Row band, used for hit-testing and the hover highlight. */
  rowTop: number;
  rowHeight: number;
  depth: number;
}

export interface AtlasPlacedEdge {
  id: string;
  from: string;
  to: string;
  /** Elbow path: down the parent's spine, then right into the child. */
  d: string;
  tone: AtlasTone;
  color?: string;
  flow: number;
  active: boolean;
}

export interface AtlasScene {
  nodes: AtlasPlacedNode[];
  edges: AtlasPlacedEdge[];
  width: number;
  height: number;
}

/** Tunables the layout reads. Column mode and the expanded overlay pass
 *  different values into the same function. */
export interface AtlasLayoutOptions {
  width: number;
  /** Horizontal indent per depth level. */
  indent: number;
  /** Left margin of the depth-0 spine. */
  originX: number;
  /** Top margin. */
  originY: number;
  /** Row height for a node with no badge row. */
  rowHeight: number;
  /** Extra height added when a node has badges. */
  badgeHeight: number;
  /** Node marker radius. */
  radius: number;
}
