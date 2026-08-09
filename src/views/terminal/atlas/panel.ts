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
import {
  pinnedTargets,
  subscribeAtlasAnnotations,
} from "../atlas-annotation-store";
import { applyFilter, type AtlasFilter } from "./filter";
import { AtlasInspector } from "./inspector";
import { COLUMN_LAYOUT, layoutAtlas } from "./layout";
import {
  ATLAS_ROOT_ID,
  buildAtlasSnapshot,
  type AtlasEmitters,
  type AtlasHost,
} from "./snapshot";
import type { AtlasNode, AtlasScene, AtlasSnapshot } from "./types";
import type { AskUserRequest, SurfaceKind } from "../../../shared/types";
import { AtlasView } from "./view";
import { Chrono, type ChronoHost } from "../chrono/chrono";

/** How long after the last byte we keep re-rendering to track the wire
 *  speed down to rest. Matches the meter's decay envelope. */
const FLOW_DECAY_MS = 550;

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
  private readonly chrono: Chrono;
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
    // ⌘G. The column says what is true now; CHRONO says what the last
    // ninety seconds looked like, and lets you type into any of it.
    this.chrono = new Chrono({
      build: () => {
        const host = variantContext.getSurfaceManager() as AtlasHost | null;
        if (!host) return null;
        return {
          snapshot: this.buildDeepSnapshot(),
          surfaceKinds: surfaceKindMap(host),
        };
      },
      host: () =>
        variantContext.getSurfaceManager() as unknown as ChronoHost | null,
      focusedSurfaceId: () => variantContext.getFocusedSurfaceId(),
    });

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
    // Before anything else: CHRONO may be holding live pane containers,
    // and they have to go home while there is still a layout to go to.
    this.chrono.close();
    this.river.destroy();
    this.view.destroy();
    this.element.remove();
  }

  /** ⌘G — the time field. */
  toggleOverlay(): void {
    this.chrono.toggle();
  }

  private attach(): void {
    const wake = () => this.refresh();
    this.disposers.push(
      htEvents.on("ht-workspaces-changed", wake),
      htEvents.on("ht-notify-state-changed", wake),
      htEvents.on("ht-surface-metadata", wake),
      htEvents.on("ht-statuses-changed", wake),
      subscribePlans(() => wake()),
      subscribeAtlasAnnotations(() => wake()),
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
    // A pinned node is one an agent asked to keep visible, so open the
    // path down to it — a pin that leaves the node folded away inside a
    // collapsed workspace has done nothing.
    for (const id of pinnedTargets()) {
      this.expanded.add(id);
      let cursor = snapshot.nodes.get(id)?.parent;
      while (cursor) {
        this.expanded.add(cursor);
        cursor = snapshot.nodes.get(cursor)?.parent ?? null;
      }
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

/**
 * Per-surface kind, flattened out of the workspace state.
 *
 * CHRONO needs it to decide what a lane can put at *now*: a terminal is
 * clipped and bottom-anchored, a DOM pane is sized to the lane, and a
 * native webview gets a standby card because it survives neither.
 */
function surfaceKindMap(host: AtlasHost): Map<string, SurfaceKind> {
  const kinds = new Map<string, SurfaceKind>();
  for (const ws of host.getWorkspaceState().workspaces) {
    for (const sid of ws.surfaceIds) {
      kinds.set(sid, ws.surfaceTypes?.[sid] ?? "terminal");
    }
  }
  return kinds;
}
