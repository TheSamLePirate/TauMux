/**
 * Atlas panel — orchestration.
 *
 * Owns the refresh loop, expansion and selection state, keyboard
 * navigation, the filter, and the expanded overlay. Everything visual is
 * delegated: `snapshot.ts` gathers, `layout.ts` places, `view.ts` draws,
 * `inspector.ts` explains.
 *
 * ## The refresh contract
 *
 * Three things wake the panel, and nothing else:
 *
 *   - structural change (`ht-workspaces-changed`, `ht-surface-focused`,
 *     `ht-notify-state-changed`) — rare, coalesced to a frame;
 *   - telemetry movement (`ht-surface-metadata`) — emitted by
 *     SurfaceManager only when a number actually moved, so an idle
 *     τ-mux never fires it;
 *   - a live wire (`scheduleFlowDecay`) — a self-terminating follow-up
 *     tick that exists only while some pane is producing output, so the
 *     dash speed tracks the decaying rate and then stops for good.
 *
 * That is what keeps a quiet Atlas at zero work per second, which is the
 * project's first priority and the reason the byte-flow animation is
 * allowed to exist at all.
 */
import { htEvents } from "../../../shared/event-bus";
import { subscribeClaudeSessions } from "../claude-session-store";
import { variantContext } from "../variants/variant-context";
import { AtlasHeader, buildLegend } from "./header";
import { AtlasRiver } from "./river";
import { pruneMetrics } from "../metrics-history";
import { subscribePlans } from "../plan-store";
import { applyFilter, type AtlasFilter } from "./filter";
import { AtlasInspector } from "./inspector";
import { COLUMN_LAYOUT, EXPANDED_LAYOUT, layoutAtlas } from "./layout";
import {
  ATLAS_ROOT_ID,
  buildAtlasSnapshot,
  type AtlasEmitters,
  type AtlasHost,
} from "./snapshot";
import type { AtlasNode, AtlasScene, AtlasSnapshot } from "./types";
import type { AskUserRequest } from "../../../shared/types";
import { AtlasView } from "./view";

/** How long after the last byte we keep re-rendering to track the wire
 *  speed down to rest. Matches the meter's decay envelope. */
const FLOW_DECAY_MS = 550;

/** Widest the expanded topology's rows get, however big the window is. */
const OVERLAY_MAX_WIDTH = 860;

export interface AtlasPanelOptions {
  emit: AtlasEmitters;
  /** Questions currently addressed to the human (`ht ask`, agent
   *  ask-user queue). Injected so `atlas/` never imports the modal. */
  pendingQuestions?: () => readonly AskUserRequest[];
  /** Subscribe to question arrivals / resolutions. */
  onQuestionsChanged?: (fn: () => void) => () => void;
}

export class AtlasPanel {
  readonly element: HTMLDivElement;
  private readonly header: AtlasHeader;
  private readonly view: AtlasView;
  private readonly inspector: AtlasInspector;
  private readonly overlay: AtlasOverlay;
  private readonly river: AtlasRiver;
  private readonly legend: HTMLDivElement;
  private readonly emit: AtlasEmitters;

  private expanded = new Set<string>([ATLAS_ROOT_ID]);
  private snapshot: AtlasSnapshot | null = null;
  private filter: AtlasFilter = "all";
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private order: string[] = [];

  private frame: number | null = null;
  private decayTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: (() => void)[] = [];
  /** Set once the user collapses or expands anything by hand. Until then
   *  the panel keeps auto-following the active workspace; after, it
   *  respects what the user arranged. */
  private userArranged = false;

  private readonly options: AtlasPanelOptions;

  constructor(options: AtlasPanelOptions) {
    this.options = options;
    this.emit = options.emit;
    this.element = document.createElement("div");
    this.element.className = "tau-atlas-panel";

    this.header = new AtlasHeader({
      onFilter: (filter) => {
        this.filter = filter;
        this.refresh();
      },
      onExpand: () => this.toggleOverlay(),
      onToggleLegend: () => {
        const on = this.element.classList.toggle("is-legend-open");
        this.legend.setAttribute("aria-hidden", String(!on));
      },
    });

    this.river = new AtlasRiver({
      onPick: (workspaceId) => {
        this.select(workspaceId);
        this.activate(workspaceId);
      },
    });
    this.legend = buildLegend();
    this.legend.setAttribute("aria-hidden", "true");

    this.view = new AtlasView({
      onActivate: (id) => this.activate(id),
      onSelect: (id) => this.select(id),
      onToggle: (id) => this.toggle(id),
      onHover: (id) => this.hover(id),
    });

    this.inspector = new AtlasInspector();
    this.overlay = new AtlasOverlay();

    const scroller = document.createElement("div");
    scroller.className = "tau-atlas-scroller";
    scroller.appendChild(this.view.element);

    this.element.append(
      this.header.element,
      this.river.element,
      scroller,
      this.legend,
      this.inspector.element,
    );
    this.element.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  mount(host: HTMLElement): void {
    host.prepend(this.element);
    this.attach();
    this.refresh();
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.decayTimer !== null) clearTimeout(this.decayTimer);
    this.frame = null;
    this.decayTimer = null;
    this.overlay.close();
    this.river.destroy();
    this.view.destroy();
    this.element.remove();
  }

  /** ⌘G — full-window topology. */
  toggleOverlay(): void {
    if (this.overlay.isOpen()) this.overlay.close();
    else if (this.snapshot) this.overlay.open(this.buildDeepSnapshot());
  }

  private attach(): void {
    const wake = () => this.refresh();
    this.disposers.push(
      htEvents.on("ht-workspaces-changed", wake),
      htEvents.on("ht-notify-state-changed", wake),
      htEvents.on("ht-surface-metadata", wake),
      htEvents.on("ht-statuses-changed", wake),
      subscribePlans(() => wake()),
      htEvents.on("ht-surface-focused", (payload) => {
        if (payload?.surfaceId) {
          variantContext.setFocusedSurfaceId(payload.surfaceId);
          // Follow the focus unless the user has arranged the tree
          // themselves — auto-expanding over a deliberate collapse is
          // the kind of "helpful" that makes a panel feel hostile.
          if (!this.userArranged) this.revealSurface(payload.surfaceId);
        }
        wake();
      }),
      subscribeClaudeSessions(() => wake()),
      ...(this.options.onQuestionsChanged
        ? [this.options.onQuestionsChanged(wake)]
        : []),
    );
  }

  private refresh(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private draw(): void {
    const host = variantContext.getSurfaceManager() as AtlasHost | null;
    const snapshot = buildAtlasSnapshot({
      host,
      focusedSurfaceId: variantContext.getFocusedSurfaceId(),
      notifyWorkspaces: variantContext.getNotifyWorkspaces(),
      deep: false,
      pendingQuestions: this.options.pendingQuestions?.() ?? [],
      emit: this.emit,
    });
    this.snapshot = snapshot;
    this.autoExpand(snapshot);

    const filtered = applyFilter(snapshot, this.filter);
    const scene = layoutAtlas({
      snapshot: filtered,
      expanded: this.expanded,
      options: {
        ...COLUMN_LAYOUT,
        width: this.element.clientWidth || COLUMN_LAYOUT.width,
      },
    });
    this.order = scene.nodes.map((n) => n.node.id);
    this.view.render(
      scene,
      this.expanded,
      COLUMN_LAYOUT.radius,
      COLUMN_LAYOUT.rowHeight,
    );
    this.header.setAttentionCount(snapshot.totals.attention);

    if (this.selectedId && !filtered.nodes.has(this.selectedId)) {
      this.selectedId = null;
    }
    // The spine head always exists, so the inspector always has
    // something true to say. An "empty" state here would be a dead
    // panel by construction.
    if (!this.selectedId) this.selectedId = ATLAS_ROOT_ID;
    this.view.setSelected(this.selectedId);
    this.inspector.show(this.currentNode());
    this.header.setMeters(snapshot.totals);

    // Drop history for panes and workspaces that no longer exist, so a
    // long session cannot accumulate rings for things that are gone.
    pruneMetrics(new Set(snapshot.nodes.keys()));
    this.river.render(
      snapshot.river,
      (color) => this.resolveColor(color),
      snapshot.totals.cpu,
    );

    if (this.overlay.isOpen()) this.overlay.update(this.buildDeepSnapshot());
    this.scheduleFlowDecay(scene);
  }

  /**
   * While any wire is flowing, keep ticking so its speed tracks the
   * decaying byte rate down to rest. The moment every wire is quiet the
   * timer is not rescheduled — no polling, no idle cost.
   */
  private scheduleFlowDecay(scene: AtlasScene): void {
    const flowing = scene.edges.some((e) => e.flow > 0);
    if (!flowing) {
      if (this.decayTimer !== null) {
        clearTimeout(this.decayTimer);
        this.decayTimer = null;
      }
      return;
    }
    if (this.decayTimer !== null) return;
    this.decayTimer = setTimeout(() => {
      this.decayTimer = null;
      this.refresh();
    }, FLOW_DECAY_MS);
  }

  private buildDeepSnapshot(): AtlasSnapshot {
    const host = variantContext.getSurfaceManager() as AtlasHost | null;
    return buildAtlasSnapshot({
      host,
      focusedSurfaceId: variantContext.getFocusedSurfaceId(),
      notifyWorkspaces: variantContext.getNotifyWorkspaces(),
      deep: true,
      pendingQuestions: this.options.pendingQuestions?.() ?? [],
      emit: this.emit,
    });
  }

  /** Root and the active workspace start open; a workspace flying an
   *  attention flag opens itself so the reason is visible without a
   *  click. Both defer to a user who has arranged the tree by hand. */
  private autoExpand(snapshot: AtlasSnapshot): void {
    this.expanded.add(ATLAS_ROOT_ID);
    if (this.userArranged) return;
    for (const node of snapshot.nodes.values()) {
      if (node.kind === "workspace") {
        if (node.active || node.attention) this.expanded.add(node.id);
        else this.expanded.delete(node.id);
        continue;
      }
      // A pane carrying a plan or a live subagent opens itself. Those
      // used to live in the sidebar panel that Atlas hides, so leaving
      // them folded behind a caret would be a net loss of information.
      if (node.kind !== "surface") continue;
      const carriesWork = node.children.some((id) => {
        const child = snapshot.nodes.get(id);
        return child?.kind === "plan-step" || child?.kind === "subagent";
      });
      if (carriesWork) this.expanded.add(node.id);
    }
  }

  private revealSurface(surfaceId: string): void {
    const parent = this.snapshot?.nodes.get(surfaceId)?.parent;
    if (parent) this.expanded.add(parent);
  }

  /** Canvas cannot read `var(--tau-…)`. Resolve through a scratch element
   *  once per distinct value and cache — the workspace palette is tiny
   *  and stable, so this is a handful of lookups per session. */
  private colorCache = new Map<string, string>();
  private resolveColor(color: string): string {
    if (!color.startsWith("var(")) return color;
    const cached = this.colorCache.get(color);
    if (cached) return cached;
    const probe = document.createElement("span");
    probe.style.color = color;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    this.element.appendChild(probe);
    const resolved = getComputedStyle(probe).color || color;
    probe.remove();
    this.colorCache.set(color, resolved);
    return resolved;
  }

  private currentNode(): AtlasNode | null {
    const id = this.hoverId ?? this.selectedId;
    if (!id) return null;
    return this.snapshot?.nodes.get(id) ?? null;
  }

  private select(id: string): void {
    this.selectedId = id;
    this.view.setSelected(id);
    this.inspector.show(this.currentNode());
  }

  private hover(id: string | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.element.classList.toggle("is-previewing", id !== null);
    this.inspector.show(this.currentNode());
  }

  private activate(id: string): void {
    this.snapshot?.nodes.get(id)?.activate?.();
  }

  private toggle(id: string): void {
    const node = this.snapshot?.nodes.get(id);
    if (!node?.expandable) return;
    this.userArranged = true;
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.refresh();
  }

  // ── keyboard ───────────────────────────────────────────────────────

  /**
   * Standard tree semantics: up/down walk visible rows, right opens a
   * folded node then descends, left closes an open node then ascends,
   * Enter navigates. Home/End jump the ends. The graph is a tree
   * widget, so it behaves like every other tree the user has met.
   */
  private onKeyDown(e: KeyboardEvent): void {
    const current = this.view.getFocusedRowId();
    if (!current) return;
    const index = this.order.indexOf(current);
    const node = this.snapshot?.nodes.get(current);

    switch (e.key) {
      case "ArrowDown":
        this.focusIndex(index + 1);
        break;
      case "ArrowUp":
        this.focusIndex(index - 1);
        break;
      case "Home":
        this.focusIndex(0);
        break;
      case "End":
        this.focusIndex(this.order.length - 1);
        break;
      case "ArrowRight":
        if (node?.expandable && !this.expanded.has(current)) {
          this.toggle(current);
        } else {
          this.focusIndex(index + 1);
        }
        break;
      case "ArrowLeft":
        if (node?.expandable && this.expanded.has(current)) {
          this.toggle(current);
        } else if (node?.parent) {
          this.focusId(node.parent);
        }
        break;
      case "Enter":
      case " ":
        this.select(current);
        this.activate(current);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private focusIndex(index: number): void {
    const id = this.order[Math.max(0, Math.min(this.order.length - 1, index))];
    if (id) this.focusId(id);
  }

  private focusId(id: string): void {
    this.view.focusRow(id);
    this.select(id);
  }
}

// ── expanded overlay ─────────────────────────────────────────────────

/**
 * The same scene at full-window scale, with per-pane processes, ports
 * and mirrored tasks revealed. The column is the glanceable instrument;
 * this is the one you explore. Sharing the snapshot builder, the layout
 * and the renderer means the two modes can never drift apart — the only
 * differences are the depth flag and the layout constants.
 */
class AtlasOverlay {
  private root: HTMLDivElement | null = null;
  private view: AtlasView | null = null;
  private snapshot: AtlasSnapshot | null = null;
  private expanded = new Set<string>();
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  isOpen(): boolean {
    return this.root !== null;
  }

  open(snapshot: AtlasSnapshot): void {
    if (this.root) return;
    this.snapshot = snapshot;
    // Everything opens: the point of the overlay is the whole picture.
    this.expanded = new Set(
      [...snapshot.nodes.values()]
        .filter((n) => n.children.length > 0)
        .map((n) => n.id),
    );

    const root = document.createElement("div");
    root.className = "tau-atlas-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Topology");

    const head = document.createElement("div");
    head.className = "tau-atlas-overlay-head";
    const title = document.createElement("span");
    title.className = "tau-atlas-eyebrow";
    title.textContent = "topology";
    const hint = document.createElement("span");
    hint.className = "tau-atlas-overlay-hint";
    hint.textContent = "esc to close";
    head.append(title, hint);

    const body = document.createElement("div");
    body.className = "tau-atlas-overlay-body";

    const inspector = new AtlasInspector();
    inspector.setRowCap(40);
    const view = new AtlasView({
      onActivate: (id) => this.snapshot?.nodes.get(id)?.activate?.(),
      onSelect: (id) => inspector.show(this.snapshot?.nodes.get(id) ?? null),
      onHover: (id) =>
        inspector.show(id ? (this.snapshot?.nodes.get(id) ?? null) : null),
      onToggle: (id) => {
        if (this.expanded.has(id)) this.expanded.delete(id);
        else this.expanded.add(id);
        this.draw();
      },
    });

    const scroller = document.createElement("div");
    scroller.className = "tau-atlas-overlay-scroller";
    scroller.appendChild(view.element);

    body.append(scroller, inspector.element);
    root.append(head, body);
    document.body.appendChild(root);

    this.root = root;
    this.view = view;
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    window.addEventListener("keydown", this.escHandler, true);
    root.addEventListener("click", (e) => {
      if (e.target === root) this.close();
    });
    this.draw();
  }

  update(snapshot: AtlasSnapshot): void {
    if (!this.root) return;
    this.snapshot = snapshot;
    for (const node of snapshot.nodes.values()) {
      if (node.children.length > 0 && !this.expanded.has(node.id)) {
        // New subtrees appear open — a pane that spawns a build should
        // show it, not hide it behind a caret you have to find.
        this.expanded.add(node.id);
      }
    }
    this.draw();
  }

  private draw(): void {
    if (!this.view || !this.snapshot) return;
    // Bounded measure: a row spanning 1600 px of a wide display puts the
    // badges a screen away from the label they describe.
    const available = this.view.element.parentElement?.clientWidth ?? 0;
    const width = Math.max(
      EXPANDED_LAYOUT.width,
      Math.min(available - 32, OVERLAY_MAX_WIDTH),
    );
    const scene = layoutAtlas({
      snapshot: this.snapshot,
      expanded: this.expanded,
      options: { ...EXPANDED_LAYOUT, width },
    });
    this.view.render(
      scene,
      this.expanded,
      EXPANDED_LAYOUT.radius,
      EXPANDED_LAYOUT.rowHeight,
    );
  }

  close(): void {
    if (this.escHandler) {
      window.removeEventListener("keydown", this.escHandler, true);
      this.escHandler = null;
    }
    this.view?.destroy();
    this.root?.remove();
    this.root = null;
    this.view = null;
    this.snapshot = null;
  }
}
