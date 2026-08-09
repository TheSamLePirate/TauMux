/**
 * CHRONO — the ⌘G view.
 *
 * A time field. The horizontal axis is the last 90 seconds with *now*
 * pinned at the right edge; every pane is a lane; a lane's live terminal
 * sits at *now* and its output history runs left into the past. Events
 * strike vertically across every lane at once, at the moment they
 * happened, so you can see which panes went quiet and which woke up when
 * an approval landed.
 *
 * This module is the controller: it owns the overlay's lifetime, decides
 * when the field is allowed to redraw, and routes the keyboard. The
 * drawing is `view.ts` and `field.ts`; the model is `lanes.ts`.
 *
 * ## The refresh contract
 *
 * Same discipline as the Atlas column, for the same reason — an idle
 * τ-mux must cost nothing per second, and a time axis makes that harder
 * rather than easier, because time always advances.
 *
 * Three things wake the field:
 *
 *   - structural change (workspaces, focus, notifications, sessions,
 *     plans, annotations) — rare, coalesced to a frame;
 *   - telemetry movement — emitted only when a number actually moved;
 *   - a live wire — a self-terminating follow-up tick that exists only
 *     while some pane is producing output, so traces and the heads'
 *     anchors track it and then stop for good.
 *
 * And the field itself refuses to repaint when the image would be
 * identical, which is what makes a still τ-mux still: a silent system's
 * trace is a flat line whose shift is indistinguishable from itself.
 *
 * ## The one dangerous thing
 *
 * The heads are the panes' real containers, borrowed. Every exit —
 * Escape, ⌘G, the close button, a variant switch, app teardown — lands
 * on `close()`, and `close()` releases before it does anything else.
 */
import { htEvents } from "../../../shared/event-bus";
import type { SurfaceKind } from "../../../shared/types";
import { applyFilter, type AtlasFilter } from "../atlas/filter";
import type { AtlasSnapshot } from "../atlas/types";
import { subscribeClaudeSessions } from "../claude-session-store";
import { subscribeAtlasAnnotations } from "../atlas-annotation-store";
import { subscribePlans } from "../plan-store";
import { throughputOf } from "../throughput-meter";
import { ChronoHeader } from "./header";
import { buildLanes, type ChronoLane } from "./lanes";
import { ChronoView, type ChronoViewHost } from "./view";

/** Follow-up cadence while any pane is still talking. Fast enough that a
 *  build's trace grows smoothly, slow enough to stay free. */
const FLOW_TICK_MS = 220;

export interface ChronoHost extends ChronoViewHost {
  focusSurface(surfaceId: string): void;
  findWorkspaceForSurface(
    surfaceId: string,
  ): { id: string; index: number } | null;
  focusWorkspaceByIndex(index: number): void;
  hideBrowserWebviews(): void;
  showBrowserWebviews(): void;
  resizeAll(): void;
}

export interface ChronoSource {
  /** The deep snapshot and the per-surface kinds behind it. Null when
   *  there is no host yet (a settings change mid-boot). */
  build(): {
    snapshot: AtlasSnapshot;
    surfaceKinds: Map<string, SurfaceKind>;
  } | null;
  host(): ChronoHost | null;
  /** The pane τ-mux considers focused, so CHRONO opens on it. */
  focusedSurfaceId(): string | null;
}

export class Chrono {
  private root: HTMLDivElement | null = null;
  private view: ChronoView | null = null;
  private header: ChronoHeader | null = null;
  private lanes: ChronoLane[] = [];
  private selectedId: string | null = null;
  /** The user stepped into the selected lane's head. Only a click on the
   *  head sets it, which is what keeps Escape predictable. */
  private entered = false;
  private filter: AtlasFilter = "all";
  /** Measured room demand per lane, and its signature — a lane's height
   *  is data, and this is the measurement it comes from. */
  private demand: ReadonlyMap<string, number> = new Map();
  private demandSignature = "";
  private frame: number | null = null;
  private flowTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: (() => void)[] = [];

  constructor(private readonly source: ChronoSource) {}

  isOpen(): boolean {
    return this.root !== null;
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    if (this.root) return;
    const root = document.createElement("div");
    root.className = "tau-chrono";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Chrono — the last 90 seconds");

    const header = new ChronoHeader({
      onFilter: (filter) => {
        this.filter = filter;
        this.refresh();
      },
      onClose: () => this.close(),
    });
    const view = new ChronoView({
      host: {
        getSurfaceContainer: (id) =>
          this.source.host()?.getSurfaceContainer(id) ?? null,
        getSurfaceGrid: (id) => this.source.host()?.getSurfaceGrid(id) ?? null,
      },
      callbacks: {
        onSelect: (id) => this.select(id),
        onEnter: (id) => this.enter(id),
        onActivate: (id) => this.activate(id),
      },
      styleTarget: root,
    });

    root.append(header.element, header.ruler, view.element);
    document.body.appendChild(root);

    this.root = root;
    this.header = header;
    this.view = view;
    this.selectedId = this.source.focusedSurfaceId();

    // Native webviews cannot be reparented or covered reliably, so they
    // are hidden for the duration — the same move the command palette
    // already makes. Their lanes render a standby card instead.
    this.source.host()?.hideBrowserWebviews();

    this.attach();
    this.refresh();
    // The open transition is a class flip so it survives
    // prefers-reduced-motion without a second code path. Taking the
    // keyboard in the same frame is what makes ↑/↓ and Escape work the
    // instant the field appears, rather than after a click.
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      this.focusGutter(this.selectedId);
    });
  }

  /**
   * Close, releasing every borrowed pane first.
   *
   * Then put the user where they were typing: if the pane they last
   * touched lives in another workspace, go there. Closing onto a
   * workspace that does not contain the focused pane would leave the
   * keyboard pointing at a hidden terminal.
   */
  close(): void {
    const root = this.root;
    if (!root) return;
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.flowTimer !== null) clearTimeout(this.flowTimer);
    this.frame = null;
    this.flowTimer = null;

    this.view?.destroy();
    this.view = null;
    this.header = null;
    this.root = null;
    this.lanes = [];
    root.remove();

    const host = this.source.host();
    host?.showBrowserWebviews();
    const selected = this.selectedId;
    if (selected) {
      const ws = host?.findWorkspaceForSurface(selected);
      if (ws) host?.focusWorkspaceByIndex(ws.index);
      host?.focusSurface(selected);
    }
    host?.resizeAll();
  }

  // ── wake sources ───────────────────────────────────────────────────

  private attach(): void {
    const wake = () => this.refresh();
    this.disposers.push(
      htEvents.on("ht-workspaces-changed", wake),
      htEvents.on("ht-surface-metadata", wake),
      htEvents.on("ht-notify-state-changed", wake),
      htEvents.on("ht-statuses-changed", wake),
      htEvents.on("ht-surface-focused", wake),
      subscribeClaudeSessions(() => wake()),
      subscribePlans(() => wake()),
      subscribeAtlasAnnotations(() => wake()),
    );

    const onResize = () => this.refresh();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));

    const onKey = (e: KeyboardEvent) => this.onKeyDown(e);
    window.addEventListener("keydown", onKey, true);
    this.disposers.push(() =>
      window.removeEventListener("keydown", onKey, true),
    );

    const onFocus = () => this.syncExitHint();
    this.root?.addEventListener("focusin", onFocus);
    this.root?.addEventListener("focusout", onFocus);
  }

  private refresh(): void {
    if (!this.root || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private draw(): void {
    const view = this.view;
    const header = this.header;
    if (!view || !header) return;

    const built = this.source.build();
    const snapshot = built ? applyFilter(built.snapshot, this.filter) : null;
    this.lanes = snapshot
      ? buildLanes({
          snapshot,
          surfaceTypes: built?.surfaceKinds ?? new Map(),
        })
      : [];

    // A filter that hides the selected lane must not leave the field
    // with a selection nobody can see; fall to the first lane instead.
    if (!this.lanes.some((l) => l.id === this.selectedId)) {
      this.selectedId = this.lanes[0]?.id ?? null;
    }

    const kinds = built?.surfaceKinds ?? new Map<string, SurfaceKind>();
    const paint = () => {
      view.render({
        lanes: this.lanes,
        selectedId: this.selectedId,
        entered: this.entered,
        surfaceKinds: kinds,
        demand: this.demand,
      });
      // Anchors read laid-out heights, so they run after the style writes
      // above have been flushed by the browser's own layout pass.
      view.applyAnchors(this.lanes);
    };

    paint();
    // A lane's height depends on how much its terminal has to show, and
    // that can only be measured once the lane exists. So: lay out, look,
    // and lay out again if what we saw disagrees with what we assumed.
    // Bounded to one extra pass by the signature check, and both passes
    // land in the same frame, so nothing flashes.
    const demand = view.measureDemand(this.lanes);
    const signature = [...demand]
      .map(([id, px]) => `${id}:${Math.round(px)}`)
      .join("|");
    if (signature !== this.demandSignature) {
      this.demandSignature = signature;
      this.demand = demand;
      paint();
    }

    header.setAttentionCount(built?.snapshot.totals.attention ?? 0);
    this.reclaimKeyboard();
    this.syncExitHint();
    this.scheduleFlowTick();
  }

  /**
   * Keep ticking while any pane is still producing output, so its trace
   * and its head's anchor track it down to rest. The moment every pane is
   * quiet the timer is not rescheduled — no polling, no idle cost.
   */
  private scheduleFlowTick(): void {
    const flowing = this.lanes.some((lane) => throughputOf(lane.id) > 0);
    if (!flowing) {
      if (this.flowTimer !== null) {
        clearTimeout(this.flowTimer);
        this.flowTimer = null;
      }
      return;
    }
    if (this.flowTimer !== null) return;
    this.flowTimer = setTimeout(() => {
      this.flowTimer = null;
      this.refresh();
    }, FLOW_TICK_MS);
  }

  // ── selection ──────────────────────────────────────────────────────

  /** Gutter click / arrow key. CHRONO keeps the keyboard. */
  private select(id: string): void {
    const changed = this.selectedId !== id;
    this.selectedId = id;
    this.entered = false;
    if (changed) this.refresh();
    this.focusGutter(id);
  }

  /**
   * Head click. The pane gets the keyboard from here on, Escape
   * included — a terminal that cannot receive Escape is not a terminal.
   */
  private enter(id: string): void {
    const changed = this.selectedId !== id;
    this.selectedId = id;
    this.entered = true;
    if (changed) this.refresh();
    else this.syncExitHint();
    this.source.host()?.focusSurface(id);
  }

  /** Go to the pane itself. CHRONO's job is done at that point. */
  private activate(id: string): void {
    this.selectedId = id;
    this.close();
  }

  /** Put the keyboard back on the field. Used on open, and whenever
   *  something *other than the user* pushed focus into a head — closing a
   *  pane makes SurfaceManager focus its neighbour, and CHRONO must not
   *  read that as "the user is typing in here now". */
  private focusGutter(id: string | null): void {
    if (!id) return;
    const row = this.view?.gutterFor(id);
    if (row && document.activeElement !== row)
      row.focus({ preventScroll: true });
  }

  // ── keyboard ───────────────────────────────────────────────────────

  /**
   * ↑/↓ walk the lanes, Enter goes to the pane, Escape closes.
   *
   * Unless a head has keyboard focus — then every key belongs to that
   * terminal, Escape most of all, and CHRONO gets out of the way. ⌘G
   * still closes, because it is the key that opened it and no terminal
   * program claims it.
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (!this.root) return;
    if (this.isTyping()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const index = this.lanes.findIndex((l) => l.id === this.selectedId);
    switch (e.key) {
      case "Escape":
        this.close();
        break;
      case "ArrowDown":
        this.moveTo(index + 1);
        break;
      case "ArrowUp":
        this.moveTo(index - 1);
        break;
      case "Home":
        this.moveTo(0);
        break;
      case "End":
        this.moveTo(this.lanes.length - 1);
        break;
      case "Enter":
        if (this.selectedId) this.activate(this.selectedId);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private moveTo(index: number): void {
    if (this.lanes.length === 0) return;
    const clamped = Math.max(0, Math.min(this.lanes.length - 1, index));
    const lane = this.lanes[clamped];
    if (!lane) return;
    this.select(lane.id);
    this.view?.rowFor(lane.id)?.scrollIntoView({ block: "nearest" });
  }

  /**
   * True while the pane owns the keyboard.
   *
   * Both halves are required. Focus alone is not enough: closing a pane
   * makes `SurfaceManager` focus its neighbour, which lands inside a
   * head without the user having gone there — and if that counted, Escape
   * would silently stop working after every ⌘W. `entered` alone is not
   * enough either, because the terminal can lose focus underneath us.
   */
  private isTyping(): boolean {
    if (!this.entered) return false;
    const active = document.activeElement;
    if (!active || !this.root?.contains(active)) return false;
    return !!active.closest(".tau-chrono-head");
  }

  /** Focus pushed into a head by something other than the user is not a
   *  decision to type there — take the keyboard back to the field. */
  private reclaimKeyboard(): void {
    if (this.entered || !this.root) return;
    const active = document.activeElement;
    if (!active || !this.root.contains(active)) return;
    if (!active.closest(".tau-chrono-head")) return;
    this.focusGutter(this.selectedId);
  }

  private syncExitHint(): void {
    if (!this.header) return;
    const typing = this.isTyping();
    const lane = this.lanes.find((l) => l.id === this.selectedId);
    this.header.setExit(typing ? (lane?.node.label ?? "a pane") : null);
  }
}
