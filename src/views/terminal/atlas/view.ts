/**
 * Atlas scene renderer.
 *
 * ## Two layers, on purpose
 *
 * Wires, markers and telemetry arcs live in one `<svg>`; labels
 * and badges live in absolutely-positioned HTML on top of it. The split
 * is not incidental:
 *
 *  - SVG cannot ellipsize text. A pane called
 *    `bun run dev --filter @tau/web-client` has to truncate cleanly at an
 *    arbitrary pixel width, and `text-overflow: ellipsis` is the only
 *    thing that does that correctly across fonts.
 *  - HTML gives every row a real `<button role="treeitem">`, so the graph
 *    is reachable by keyboard and legible to assistive tech. A graph of
 *    `<circle onclick>` is neither.
 *  - Geometry — the elbows and the telemetry arcs — is exactly what SVG
 *    is for, and none of it needs to be in the tab order.
 *
 * ## Diffed, never rebuilt
 *
 * Atlas v1 called `replaceChildren()` on every animation frame. That
 * destroys element identity, which means no transition can ever run, a
 * hover is lost the instant telemetry ticks, and the GC sees a fresh tree
 * every second. Here every node and edge is keyed by id and reconciled in
 * place: appearing nodes fade in, disappearing nodes fade out, moving
 * nodes animate to their new row.
 */
import type {
  AtlasPlacedEdge,
  AtlasPlacedNode,
  AtlasScene,
  AtlasTone,
} from "./types";

const NS = "http://www.w3.org/2000/svg";

/** Fastest and slowest full cycle of the byte-flow dash, in seconds.
 *  A pane at saturation completes a cycle three times a second; one just
 *  over the quiet floor takes nearly two. */
/** Minimum gap between flashes on one badge. A rate chip changes every
 *  second; without this the "something moved" cue becomes a metronome
 *  and stops meaning anything. */
const TICK_COOLDOWN_MS = 4_000;

const FLOW_FAST_S = 0.34;
const FLOW_SLOW_S = 1.9;

export interface AtlasViewCallbacks {
  onActivate(id: string): void;
  onToggle(id: string): void;
  onHover(id: string | null): void;
  onSelect(id: string): void;
}

interface NodeParts {
  group: SVGGElement;
  shape: SVGElement;
  halo: SVGCircleElement | null;
  ring: SVGCircleElement | null;
  reticle: SVGPathElement | null;
  load: SVGPathElement | null;
  meter: SVGPathElement | null;
  row: HTMLButtonElement;
  caret: HTMLSpanElement;
  label: HTMLSpanElement;
  sub: HTMLSpanElement;
  badges: HTMLSpanElement;
  /** Last drawn signature — skips DOM writes when nothing changed. */
  signature: string;
  kind: string;
}

export class AtlasView {
  readonly element: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly wireLayer: SVGGElement;
  private readonly calloutLayer: SVGGElement;
  private readonly markerLayer: SVGGElement;
  private readonly rowLayer: HTMLDivElement;

  private nodes = new Map<string, NodeParts>();
  private edges = new Map<string, SVGPathElement>();
  private callouts = new Map<string, SVGPathElement>();
  private radius = 4.5;
  private selectedId: string | null = null;
  private focusedRowId: string | null = null;

  constructor(private readonly callbacks: AtlasViewCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "tau-atlas-canvas";

    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("class", "tau-atlas-wires");
    this.svg.setAttribute("aria-hidden", "true");
    this.wireLayer = document.createElementNS(NS, "g");
    this.calloutLayer = document.createElementNS(NS, "g");
    this.markerLayer = document.createElementNS(NS, "g");
    this.svg.append(this.wireLayer, this.calloutLayer, this.markerLayer);

    this.rowLayer = document.createElement("div");
    this.rowLayer.className = "tau-atlas-rows";
    this.rowLayer.setAttribute("role", "tree");
    this.rowLayer.setAttribute("aria-label", "Workspace topology");

    // Rows first, wires on top: a selected row paints an opaque band and
    // would otherwise swallow the marker sitting in its gutter. The SVG
    // is `pointer-events: none`, so putting it above costs no
    // interaction, and the row's padding-left keeps labels clear of the
    // markers drawn over them.
    this.element.append(this.rowLayer, this.svg);
    this.element.addEventListener("pointerleave", () =>
      this.callbacks.onHover(null),
    );
  }

  destroy(): void {
    this.element.remove();
    this.nodes.clear();
    this.edges.clear();
    this.callouts.clear();
  }

  /** Id of the row that currently owns the roving tabindex. */
  getFocusedRowId(): string | null {
    return this.focusedRowId;
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    const prev = this.selectedId ? this.nodes.get(this.selectedId) : null;
    if (prev) {
      prev.row.classList.remove("is-selected");
      prev.group.classList.remove("is-selected");
      prev.row.setAttribute("aria-selected", "false");
    }
    this.selectedId = id;
    const next = id ? this.nodes.get(id) : null;
    if (next) {
      next.row.classList.add("is-selected");
      next.group.classList.add("is-selected");
      next.row.setAttribute("aria-selected", "true");
    }
  }

  /** Move DOM focus to a row and give it the roving tabindex. */
  focusRow(id: string): void {
    const parts = this.nodes.get(id);
    if (!parts) return;
    this.setRovingTabindex(id);
    parts.row.focus();
  }

  private setRovingTabindex(id: string): void {
    if (this.focusedRowId && this.focusedRowId !== id) {
      this.nodes.get(this.focusedRowId)?.row.setAttribute("tabindex", "-1");
    }
    this.focusedRowId = id;
    this.nodes.get(id)?.row.setAttribute("tabindex", "0");
  }

  render(
    scene: AtlasScene,
    expanded: ReadonlySet<string>,
    radius: number,
    rowLineHeight: number,
  ): void {
    this.radius = radius;
    this.svg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
    // Width and height must be pinned in CSS pixels, not left to a
    // percentage: a stretched viewBox rescales every marker's x while
    // the HTML rows stay put, and the two layers silently drift apart.
    this.element.style.setProperty("--atlas-width", `${scene.width}px`);
    this.element.style.setProperty("--atlas-height", `${scene.height}px`);
    this.element.style.setProperty("--row-line-h", `${rowLineHeight}px`);

    this.renderEdges(scene.edges);
    this.renderCallouts(scene.callouts);
    this.renderNodes(scene, expanded);
  }

  // ── wires ──────────────────────────────────────────────────────────

  private renderEdges(edges: AtlasPlacedEdge[]): void {
    const seen = new Set<string>();
    for (const edge of edges) {
      seen.add(edge.id);
      let path = this.edges.get(edge.id);
      if (!path) {
        path = document.createElementNS(NS, "path");
        path.setAttribute("class", "tau-atlas-wire");
        path.setAttribute("fill", "none");
        this.wireLayer.appendChild(path);
        this.edges.set(edge.id, path);
      }
      path.setAttribute("d", edge.d);
      path.style.setProperty("--wire", edge.color ?? toneVar(edge.tone));
      path.classList.toggle("is-active", edge.active);
      // The signature moment: a wire only animates when its pane is
      // actually producing output. Below the quiet floor `flow` is
      // exactly 0 and this branch leaves a still hairline, so an idle
      // τ-mux runs no animation at all.
      const flowing = edge.flow > 0;
      path.classList.toggle("is-flowing", flowing);
      if (flowing) {
        const seconds = FLOW_SLOW_S - (FLOW_SLOW_S - FLOW_FAST_S) * edge.flow;
        path.style.animationDuration = `${seconds.toFixed(2)}s`;
        path.style.setProperty("--flow", edge.flow.toFixed(2));
      } else {
        path.style.removeProperty("animation-duration");
        path.style.removeProperty("--flow");
      }
    }
    for (const [id, path] of this.edges) {
      if (seen.has(id)) continue;
      path.remove();
      this.edges.delete(id);
    }
  }

  /** The root→node link for whatever is blocking on the user. */
  private renderCallouts(callouts: AtlasScene["callouts"]): void {
    const seen = new Set<string>();
    for (const callout of callouts) {
      seen.add(callout.id);
      let path = this.callouts.get(callout.id);
      if (!path) {
        path = document.createElementNS(NS, "path");
        path.setAttribute("class", "tau-atlas-callout");
        path.setAttribute("fill", "none");
        this.calloutLayer.appendChild(path);
        this.callouts.set(callout.id, path);
      }
      path.setAttribute("d", callout.d);
      path.style.setProperty("--wire", toneVar(callout.tone));
      path.dataset["attention"] = callout.attention;
    }
    for (const [id, path] of this.callouts) {
      if (seen.has(id)) continue;
      path.remove();
      this.callouts.delete(id);
    }
  }

  // ── markers + rows ─────────────────────────────────────────────────

  private renderNodes(scene: AtlasScene, expanded: ReadonlySet<string>): void {
    const seen = new Set<string>();
    for (const placed of scene.nodes) {
      const id = placed.node.id;
      seen.add(id);
      let parts = this.nodes.get(id);
      if (!parts) {
        parts = this.createNode(placed);
        this.nodes.set(id, parts);
      } else if (parts.kind !== markerKind(placed)) {
        // A pane that gains a Claude session changes shape. Swap the
        // marker rather than the whole node so its position transition
        // and its row identity survive.
        parts.shape.remove();
        parts.shape = makeShape(placed, this.radius);
        parts.group.appendChild(parts.shape);
        parts.kind = markerKind(placed);
      }
      this.updateNode(parts, placed, expanded, scene.nodes.length);
    }

    for (const [id, parts] of this.nodes) {
      if (seen.has(id)) continue;
      parts.group.classList.add("is-leaving");
      parts.row.classList.add("is-leaving");
      const group = parts.group;
      const row = parts.row;
      window.setTimeout(() => {
        group.remove();
        row.remove();
      }, 160);
      this.nodes.delete(id);
      if (this.focusedRowId === id) this.focusedRowId = null;
      if (this.selectedId === id) this.selectedId = null;
    }
  }

  private createNode(placed: AtlasPlacedNode): NodeParts {
    const id = placed.node.id;
    const group = document.createElementNS(NS, "g");
    group.setAttribute("class", "tau-atlas-marker is-entering");
    const shape = makeShape(placed, this.radius);
    group.appendChild(shape);
    this.markerLayer.appendChild(group);
    // Drop the entrance class on the next frame so the transition runs.
    window.requestAnimationFrame(() => group.classList.remove("is-entering"));

    const row = document.createElement("button");
    row.type = "button";
    row.className = "tau-atlas-row is-entering";
    row.setAttribute("role", "treeitem");
    row.setAttribute("tabindex", "-1");
    row.dataset["id"] = id;

    const caret = document.createElement("span");
    caret.className = "tau-atlas-caret";
    caret.setAttribute("aria-hidden", "true");

    const line = document.createElement("span");
    line.className = "tau-atlas-row-line";
    const label = document.createElement("span");
    label.className = "tau-atlas-row-label";
    const sub = document.createElement("span");
    sub.className = "tau-atlas-row-sub";
    line.append(label, sub);

    const badges = document.createElement("span");
    badges.className = "tau-atlas-row-badges";

    // The caret lives in the spine gutter, left of the marker, the way a
    // file tree's disclosure triangle does. Keeping it out of the text
    // flow is what lets the badge row start at exactly the same x as the
    // label above it.
    row.append(caret, line, badges);
    this.rowLayer.appendChild(row);
    window.requestAnimationFrame(() => row.classList.remove("is-entering"));

    row.addEventListener("click", (e) => {
      // The caret is a hit zone inside the row rather than a nested
      // button — nesting interactive elements breaks the treeitem role.
      if (e.target === caret) {
        this.callbacks.onToggle(id);
        return;
      }
      this.setRovingTabindex(id);
      this.callbacks.onSelect(id);
      this.callbacks.onActivate(id);
    });
    row.addEventListener("dblclick", () => this.callbacks.onToggle(id));
    row.addEventListener("pointerenter", () => this.callbacks.onHover(id));
    row.addEventListener("focus", () => {
      this.setRovingTabindex(id);
      this.callbacks.onHover(id);
    });

    return {
      group,
      shape,
      halo: null,
      ring: null,
      reticle: null,
      load: null,
      meter: null,
      row,
      caret,
      label,
      sub,
      badges,
      signature: "",
      kind: markerKind(placed),
    };
  }

  private updateNode(
    parts: NodeParts,
    placed: AtlasPlacedNode,
    expanded: ReadonlySet<string>,
    total: number,
  ): void {
    const node = placed.node;
    const isExpanded = expanded.has(node.id);
    const signature = [
      placed.x,
      placed.y,
      placed.rowTop,
      placed.rowHeight,
      placed.depth,
      node.label,
      node.sublabel,
      node.tone,
      node.color ?? "",
      node.load.toFixed(2),
      node.meter ? `${node.meter.tone}:${node.meter.value.toFixed(2)}` : "",
      node.active ? "1" : "0",
      node.running ? "1" : "0",
      node.attention ?? "",
      node.expandable ? (isExpanded ? "e" : "c") : "-",
      node.badges.map((b) => `${b.tone}/${b.text}`).join("|"),
      total,
    ].join("");
    if (parts.signature === signature) return;
    parts.signature = signature;

    const colour = node.color ?? toneVar(node.tone);
    parts.group.style.setProperty("--node", colour);
    // Glow scales with load, so a hot pane is visibly hotter rather than
    // merely differently-coloured. Capped well below a bloom.
    parts.group.style.setProperty("--glow", (0.15 + node.load * 0.85).toFixed(2));
    parts.group.setAttribute("transform", `translate(${placed.x} ${placed.y})`);
    parts.group.classList.toggle("is-active", node.active);
    parts.group.classList.toggle("is-running", node.running);
    parts.group.dataset["attention"] = node.attention ?? "";

    parts.shape.classList.toggle("is-filled", node.active);

    // Reticle marks navigable focus only. `active` also means "done" on
    // a plan step, and a checklist of completed items should not read as
    // four things being targeted at once.
    const targetable =
      node.kind === "surface" || node.kind === "workspace" || node.kind === "root";
    if (node.active && targetable) {
      if (!parts.reticle) {
        parts.reticle = makeReticle(this.radius);
        parts.group.appendChild(parts.reticle);
      }
    } else if (parts.reticle) {
      parts.reticle.remove();
      parts.reticle = null;
    }

    // Halo — a running node breathes. Created lazily so a quiet graph
    // holds no animated elements at all.
    if (node.running) {
      if (!parts.halo) {
        parts.halo = document.createElementNS(NS, "circle");
        parts.halo.setAttribute("class", "tau-atlas-halo");
        parts.halo.setAttribute("r", String(this.radius * 2.6));
        parts.group.insertBefore(parts.halo, parts.group.firstChild);
      }
    } else if (parts.halo) {
      parts.halo.remove();
      parts.halo = null;
    }

    // Attention ring — dashed, pulsing, the one thing allowed to shout.
    if (node.attention) {
      if (!parts.ring) {
        parts.ring = document.createElementNS(NS, "circle");
        parts.ring.setAttribute("class", "tau-atlas-attention");
        parts.ring.setAttribute("r", String(this.radius * 2.1));
        parts.ring.setAttribute("fill", "none");
        parts.group.appendChild(parts.ring);
      }
    } else if (parts.ring) {
      parts.ring.remove();
      parts.ring = null;
    }

    parts.load = this.applyArc(
      parts.group,
      parts.load,
      "tau-atlas-load",
      node.load,
      this.radius + 3.5,
      node.load >= 0.85 ? "err" : node.load >= 0.5 ? "warn" : "ok",
    );
    parts.meter = this.applyArc(
      parts.group,
      parts.meter,
      "tau-atlas-meter",
      node.meter?.value ?? 0,
      this.radius + 6,
      node.meter?.tone ?? "dim",
    );

    // ── row ──
    parts.row.style.transform = `translateY(${placed.rowTop}px)`;
    parts.row.style.height = `${placed.rowHeight}px`;
    // Clear of the marker *and* both telemetry arcs (the outer one sits
    // at radius + 6), plus air.
    parts.row.style.paddingLeft = `${placed.x + this.radius + 13}px`;
    parts.row.style.setProperty(
      "--caret-x",
      `${Math.max(0, placed.x - this.radius - 8)}px`,
    );
    parts.row.style.setProperty("--node", colour);
    parts.row.setAttribute("aria-level", String(placed.depth + 1));
    parts.row.setAttribute("aria-setsize", String(total));
    parts.row.classList.toggle("is-active", node.active);
    parts.row.classList.toggle("has-attention", !!node.attention);
    parts.row.dataset["kind"] = node.kind;

    if (node.expandable) {
      parts.row.setAttribute("aria-expanded", String(isExpanded));
      parts.caret.classList.add("is-visible");
      parts.caret.classList.toggle("is-open", isExpanded);
    } else {
      parts.row.removeAttribute("aria-expanded");
      parts.caret.classList.remove("is-visible", "is-open");
    }

    parts.label.textContent = node.label;
    parts.sub.textContent = node.sublabel;
    parts.sub.classList.toggle("is-empty", node.sublabel === "");
    parts.row.title = node.sublabel
      ? `${node.label} — ${node.sublabel}`
      : node.label;

    renderBadges(parts.badges, node.badges);
    if (this.focusedRowId === null) this.setRovingTabindex(node.id);
  }

  /** Create / update / drop one telemetry arc on a marker group. */
  private applyArc(
    group: SVGGElement,
    current: SVGPathElement | null,
    className: string,
    value: number,
    r: number,
    tone: AtlasTone,
  ): SVGPathElement | null {
    if (value <= 0.005) {
      current?.remove();
      return null;
    }
    let path = current;
    if (!path) {
      path = document.createElementNS(NS, "path");
      path.setAttribute("class", className);
      path.setAttribute("fill", "none");
      group.appendChild(path);
    }
    path.setAttribute("d", arcPath(r, Math.min(value, 0.999)));
    path.style.setProperty("--arc", toneVar(tone));
    return path;
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Arc from 12 o'clock, clockwise, covering `fraction` of the circle.
 * Centred on the origin because the marker group is already translated
 * to the node — keeps every marker's internal geometry identical, which
 * is what lets the group transform be the only thing that animates.
 */
export function arcPath(r: number, fraction: number): string {
  const angle = fraction * Math.PI * 2;
  const x = Math.sin(angle) * r;
  const y = -Math.cos(angle) * r;
  const large = fraction > 0.5 ? 1 : 0;
  return `M 0 ${-r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

function markerKind(placed: AtlasPlacedNode): string {
  const { kind, tone } = placed.node;
  if (kind === "surface") return tone === "agent" ? "agent" : "surface";
  return kind;
}

/** Selection reticle — four corner ticks around the focused marker.
 *  Targeting brackets rather than a box: they read as "locked on" at
 *  4 px without adding a closed shape that competes with the node. */
function makeReticle(r: number): SVGPathElement {
  const o = r * 2.6;
  const t = r * 1.1;
  const path = document.createElementNS(NS, "path");
  path.setAttribute(
    "d",
    `M ${-o} ${-o + t} V ${-o} H ${-o + t} ` +
      `M ${o - t} ${-o} H ${o} V ${-o + t} ` +
      `M ${o} ${o - t} V ${o} H ${o - t} ` +
      `M ${-o + t} ${o} H ${-o} V ${o - t}`,
  );
  path.setAttribute("class", "tau-atlas-reticle");
  path.setAttribute("fill", "none");
  return path;
}

/**
 * Node silhouettes. Three primary shapes carry the three things a reader
 * has to tell apart at a glance — a place (square), a pane (circle), an
 * agent (hexagon) — and the secondary kinds borrow from them rather than
 * inventing more vocabulary.
 */
function makeShape(placed: AtlasPlacedNode, r: number): SVGElement {
  const kind = markerKind(placed);
  switch (kind) {
    case "root":
    case "workspace": {
      const rect = document.createElementNS(NS, "rect");
      const size = r * 1.85;
      rect.setAttribute("x", String(-size / 2));
      rect.setAttribute("y", String(-size / 2));
      rect.setAttribute("width", String(size));
      rect.setAttribute("height", String(size));
      rect.setAttribute("rx", "1.5");
      rect.setAttribute("class", "tau-atlas-shape");
      if (kind === "root") rect.classList.add("is-filled");
      return rect;
    }
    case "agent":
    case "session": {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", hexagonPath(r * 1.15));
      path.setAttribute("class", "tau-atlas-shape");
      return path;
    }
    case "port": {
      const path = document.createElementNS(NS, "path");
      const d = r * 1.15;
      path.setAttribute("d", `M 0 ${-d} L ${d} 0 L 0 ${d} L ${-d} 0 Z`);
      path.setAttribute("class", "tau-atlas-shape");
      return path;
    }
    case "plan-step": {
      const size = r * 1.25;
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", String(-size / 2));
      rect.setAttribute("y", String(-size / 2));
      rect.setAttribute("width", String(size));
      rect.setAttribute("height", String(size));
      rect.setAttribute("rx", "0.5");
      rect.setAttribute("class", "tau-atlas-shape");
      // A completed step is a filled box — the checklist idiom, and the
      // one place `active` legitimately means "done".
      if (placed.node.active) rect.classList.add("is-filled");
      return rect;
    }
    case "subagent": {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", hexagonPath(r * 0.8));
      path.setAttribute("class", "tau-atlas-shape");
      return path;
    }
    case "task": {
      const rect = document.createElementNS(NS, "rect");
      const size = r * 1.3;
      rect.setAttribute("x", String(-size / 2));
      rect.setAttribute("y", String(-size / 2));
      rect.setAttribute("width", String(size));
      rect.setAttribute("height", String(size));
      rect.setAttribute("class", "tau-atlas-shape");
      return rect;
    }
    case "process": {
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("r", String(r * 0.62));
      circle.setAttribute("class", "tau-atlas-shape");
      return circle;
    }
    default: {
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("r", String(r));
      circle.setAttribute("class", "tau-atlas-shape");
      return circle;
    }
  }
}

function hexagonPath(r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    points.push(
      `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`,
    );
  }
  return `M ${points.join(" L ")} Z`;
}

function renderBadges(
  host: HTMLSpanElement,
  badges: readonly {
    text: string;
    tone: AtlasTone;
    color?: string;
    title?: string;
  }[],
): void {
  if (badges.length === 0) {
    if (host.childElementCount > 0) host.replaceChildren();
    return;
  }
  // Reconcile in place: badge sets are tiny and churn every second, so
  // recreating them would leave the row flickering under the cursor.
  while (host.childElementCount > badges.length)
    host.lastElementChild?.remove();
  badges.forEach((badge, i) => {
    let el = host.children[i] as HTMLSpanElement | undefined;
    if (!el) {
      el = document.createElement("span");
      host.appendChild(el);
    }
    el.className = `tau-atlas-badge is-${badge.tone}`;
    if (badge.color) el.style.color = badge.color;
    else el.style.removeProperty("color");
    if (el.textContent !== badge.text) {
      // A value that just moved gets a one-shot flash. At 1 Hz across a
      // dozen chips, "what changed" is otherwise invisible.
      const had = el.textContent !== "" && el.textContent !== null;
      el.textContent = badge.text;
      const now = Date.now();
      const last = Number(el.dataset["tickedAt"] ?? 0);
      if (had && now - last > TICK_COOLDOWN_MS) {
        el.dataset["tickedAt"] = String(now);
        el.classList.remove("is-ticked");
        // Force a reflow so removing and re-adding restarts the
        // animation even when two ticks land back to back.
        void el.offsetWidth;
        el.classList.add("is-ticked");
      }
    }
    if (badge.title) el.title = badge.title;
    else el.removeAttribute("title");
  });
}

export function toneVar(tone: AtlasTone): string {
  switch (tone) {
    case "accent":
      return "var(--tau-cyan)";
    case "agent":
      return "var(--tau-agent)";
    case "ok":
      return "var(--tau-ok)";
    case "warn":
      return "var(--tau-warn)";
    case "err":
      return "var(--tau-err)";
    case "dim":
      return "var(--tau-text-mute)";
    default:
      return "var(--tau-text-dim)";
  }
}
