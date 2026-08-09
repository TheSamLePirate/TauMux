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
import { AtlasInspector } from "../atlas/inspector";
import { toneVar } from "../atlas/view";
import type { AtlasNode, AtlasSnapshot } from "../atlas/types";
import {
  getClaudeSessions,
  subscribeClaudeSessions,
} from "../claude-session-store";
import { subscribeAtlasAnnotations } from "../atlas-annotation-store";
import { subscribePlans } from "../plan-store";
import { throughputOf } from "../throughput-meter";
import { variantContext } from "../variants/variant-context";
import { ChronoField, fieldIsMoving, sampleAt } from "./field";
import { eventsSince } from "./event-log";
import { ChronoHeader, ChronoStrikeRail } from "./header";
import { buildLanes, type ChronoLane } from "./lanes";
import { ChronoReadout, buildReadout } from "./readout";
import { ChronoSources } from "./sources";
import {
  defaultTimebase,
  stepTimebase,
  timeAt,
  type Timebase,
} from "./timebase";
import { ChronoView, type ChronoViewHost } from "./view";

/** Follow-up cadence while any pane is still talking. Fast enough that a
 *  build's trace grows smoothly, slow enough to stay free. */
const FLOW_TICK_MS = 220;

/** …and once everything has gone quiet but the window still holds a
 *  skyline, which keeps scrolling leftward until it is ninety seconds
 *  old. Slower, because a trace drifting at ~8 px/s does not need 4 Hz.
 *  When the window is finally empty, no tick is scheduled at all and the
 *  field is completely still. */
const DRAIN_TICK_MS = 900;

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
  private field: ChronoField | null = null;
  private rail: ChronoStrikeRail | null = null;
  private inspector: AtlasInspector | null = null;
  private readout: ChronoReadout | null = null;
  /** The timebase knob. Survives a close/open within a session, because
   *  a user who zoomed to 20 s meant it. */
  private timebase: Timebase = defaultTimebase();
  /** Cursor position as a fraction across the field, or null when the
   *  pointer is not over it. */
  private cursor: number | null = null;
  /** Lane under the pointer. The inspector previews it and falls back to
   *  the committed selection on leave, so the card never strands you on
   *  something you merely passed over. */
  private hoverId: string | null = null;
  private snapshot: AtlasSnapshot | null = null;
  private readonly sources = new ChronoSources();
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
    root.setAttribute("aria-labelledby", "tau-chrono-title");
    root.setAttribute("aria-description", "The last 90 seconds, one lane per pane");

    const header = new ChronoHeader({
      onFilter: (filter) => {
        this.filter = filter;
        this.refresh();
      },
      onClose: () => this.close(),
      onZoom: (direction) => this.zoom(direction),
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
        onHover: (id) => this.hover(id),
      },
      styleTarget: root,
    });

    const rail = new ChronoStrikeRail();
    const readout = new ChronoReadout();
    // The inspector is the Atlas column's, unchanged. It docks bottom
    // left, over the gutter and never over a head: covering a live
    // terminal to explain it would be the wrong trade in this view.
    const inspector = new AtlasInspector();
    inspector.setRowCap(5);
    const dock = document.createElement("div");
    dock.className = "tau-chrono-dock";
    dock.appendChild(inspector.element);

    // One footer row, split on the same two column boundaries as
    // everything else: the inspector under the gutter, the strike labels
    // under the field they name. Floating the inspector over the lanes
    // was the first cut and it covered the bottom lane's channel strip —
    // hiding a lane's identity to explain another one is the wrong trade.
    const foot = document.createElement("div");
    foot.className = "tau-chrono-foot";
    foot.append(dock, rail.element);

    const axis = document.createElement("div");
    axis.className = "tau-chrono-axis";
    axis.append(header.ruler, readout.element);

    root.append(header.element, axis, view.element, foot);
    document.body.appendChild(root);

    this.root = root;
    this.header = header;
    this.view = view;
    this.rail = rail;
    this.readout = readout;
    this.inspector = inspector;
    this.field = new ChronoField(view.canvas, root);
    this.selectedId = this.source.focusedSurfaceId();
    // Prime the transition watcher before the first draw: opening during
    // a long turn must not strike a rule at *now* for a turn that started
    // four minutes ago.
    this.sources.seed(getClaudeSessions(), variantContext.getNotifyWorkspaces());
    this.sources.ingestMarks();

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
    this.field = null;
    this.rail = null;
    this.inspector = null;
    this.readout = null;
    this.snapshot = null;
    this.hoverId = null;
    this.cursor = null;
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
      htEvents.on("ht-notify-state-changed", () => {
        this.sources.ingestNotifications(variantContext.getNotifyWorkspaces());
        wake();
      }),
      htEvents.on("ht-statuses-changed", wake),
      htEvents.on("ht-surface-focused", wake),
      // The stores carry *what is true*; the strikes need *when it
      // changed*. `sources` is the diff that turns one into the other,
      // and it runs before the wake so the event is in the log by the
      // time the field draws.
      subscribeClaudeSessions((sessions) => {
        this.sources.ingestSessions(sessions);
        wake();
      }),
      subscribePlans(() => wake()),
      subscribeAtlasAnnotations(() => {
        this.sources.ingestMarks();
        wake();
      }),
    );

    const onResize = () => this.refresh();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));

    const onKey = (e: KeyboardEvent) => this.onKeyDown(e);
    window.addEventListener("keydown", onKey, true);
    this.disposers.push(() =>
      window.removeEventListener("keydown", onKey, true),
    );

    // The field is the instrument's face: the pointer over it is a
    // cursor, and the wheel over it is the timebase knob. Both are
    // scoped to the trace band — over the gutter or a head the pointer
    // means what it means everywhere else.
    const field = this.view?.element;
    if (field) {
      const onMove = (e: PointerEvent) => this.onFieldPointer(e);
      const onLeave = () => this.setCursor(null);
      const onWheel = (e: WheelEvent) => this.onFieldWheel(e);
      field.addEventListener("pointermove", onMove);
      field.addEventListener("pointerleave", onLeave);
      field.addEventListener("wheel", onWheel, { passive: false });
      this.disposers.push(() => {
        field.removeEventListener("pointermove", onMove);
        field.removeEventListener("pointerleave", onLeave);
        field.removeEventListener("wheel", onWheel);
      });
    }

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
    this.snapshot = snapshot;
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

    // The field goes on last: it draws against the geometry the lanes
    // just settled on, and it is the one thing here allowed to decide
    // that the picture has not changed and skip itself entirely.
    const now = Date.now();
    const span = this.timebase.span;
    const events = eventsSince(span, now);
    const fieldInput = {
      lanes: this.lanes,
      geometry: view.getGeometry(),
      events,
      now,
      span,
      cursor: this.cursor,
    };
    this.field?.render(fieldInput);
    this.rail?.render(events, now, span);
    header.setSpan(span);
    this.renderReadout(now, span);

    header.setAttentionCount(built?.snapshot.totals.attention ?? 0);
    this.showInspected();
    this.reclaimKeyboard();
    this.syncExitHint();
    this.scheduleTick(fieldIsMoving(fieldInput));
  }

  /**
   * Where the pointer is, in trace-band coordinates.
   *
   * Returns null outside the band — the gutter and the heads are not
   * part of the time axis, and a cursor that kept reading while the
   * pointer was over a terminal would be answering a question nobody
   * asked.
   */
  private bandFraction(clientX: number): number | null {
    const view = this.view;
    if (!view) return null;
    const geometry = view.getGeometry();
    if (geometry.width <= 0) return null;
    const rect = view.getScroller().getBoundingClientRect();
    const x = clientX - rect.left - geometry.left;
    if (x < 0 || x > geometry.width) return null;
    return x / geometry.width;
  }

  private onFieldPointer(e: PointerEvent): void {
    this.setCursor(this.bandFraction(e.clientX));
  }

  /**
   * The wheel over the field is the timebase.
   *
   * Only over the band, and only when the field has nothing to scroll: a
   * user with ten lanes needs the wheel to reach the tenth, and stealing
   * it for zoom would be the more annoying of the two losses. ⌥ forces
   * zoom either way, so the gesture is always available.
   */
  private onFieldWheel(e: WheelEvent): void {
    if (this.bandFraction(e.clientX) === null) return;
    const scroller = this.view?.getScroller();
    const scrollable =
      !!scroller && scroller.scrollHeight - scroller.clientHeight > 2;
    if (scrollable && !e.altKey) return;
    e.preventDefault();
    this.zoom(e.deltaY < 0 ? 1 : -1);
  }

  /** Step the timebase knob and repaint against the new window. */
  private zoom(direction: number): void {
    const next = stepTimebase(this.timebase, direction);
    if (next.span === this.timebase.span) return;
    this.timebase = next;
    this.refresh();
  }

  /** Move the cursor, or put it away. A fraction rather than a pixel, so
   *  it survives a resize and a zoom without meaning something else. */
  private setCursor(fraction: number | null): void {
    const next =
      fraction === null ? null : Math.max(0, Math.min(1, fraction));
    if (next === this.cursor) return;
    this.cursor = next;
    this.refresh();
  }

  /** What the cursor is pointing at, per lane. */
  private renderReadout(now: number, span: number): void {
    if (!this.readout) return;
    if (this.cursor === null) {
      this.readout.render(null, []);
      return;
    }
    const rows = buildReadout(
      this.lanes,
      (lane) => sampleAt(lane.historyKey, this.cursor ?? 1, now, span),
      (lane) => lane.node.color ?? toneVar(lane.node.tone),
    );
    this.readout.render(now - timeAt(this.cursor, now, span), rows);
  }

  /**
   * Keep ticking while the picture is still changing, and stop dead when
   * it is not.
   *
   * Two reasons it can still be changing, and they want different
   * cadences. A pane producing output moves its trace's leading edge and
   * its head's anchor several times a second. A window that merely still
   * *holds* a skyline changes only because that skyline scrolls leftward,
   * which at ~8 px/s does not need 4 Hz.
   *
   * When neither holds — no output, and nothing inside the window — no
   * timer is scheduled at all. That is the whole "an idle τ-mux is
   * completely still" rule, and it is why a time axis is affordable here.
   */
  private scheduleTick(moving: boolean): void {
    const flowing = this.lanes.some((lane) => throughputOf(lane.id) > 0);
    if (!flowing && !moving) {
      if (this.flowTimer !== null) {
        clearTimeout(this.flowTimer);
        this.flowTimer = null;
      }
      return;
    }
    if (this.flowTimer !== null) return;
    this.flowTimer = setTimeout(
      () => {
        this.flowTimer = null;
        this.refresh();
      },
      flowing ? FLOW_TICK_MS : DRAIN_TICK_MS,
    );
  }

  // ── selection ──────────────────────────────────────────────────────

  /**
   * What the inspector is explaining.
   *
   * Hover previews, click commits — the Atlas column's rule, for the same
   * reason: a card that only followed clicks would make you commit to a
   * lane to find out what it is. Resolved against the live snapshot on
   * every draw, so a pane that closes stops being explained rather than
   * freezing mid-sentence.
   */
  private showInspected(): void {
    const id = this.hoverId ?? this.selectedId;
    const node: AtlasNode | null = id
      ? (this.snapshot?.nodes.get(id) ?? null)
      : null;
    this.inspector?.show(node);
  }

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

  private hover(id: string | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.showInspected();
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
      case "+":
      case "=":
        this.zoom(1);
        break;
      case "-":
      case "_":
        this.zoom(-1);
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
