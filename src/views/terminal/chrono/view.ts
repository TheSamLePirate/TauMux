/**
 * The field — CHRONO's one screen.
 *
 * Left gutter, time field, heads at *now*. One scroller, one canvas
 * behind the traces, one lane row per pane, reconciled by id so a pane
 * keeps its element (and therefore its borrowed terminal) across every
 * refresh. Rebuilding the list would hand the lease a new slot every
 * tick and rip the user's terminal out of the DOM at 1 Hz.
 *
 * ## Where the live terminals are
 *
 * A lane's head is the pane's own `.surface-container`, borrowed through
 * `screen-lease.ts`. The view is therefore the owner of a resource it did
 * not create, and the single rule that keeps that safe is: **every path
 * out of this class goes through `releaseAll()`** — `destroy()`, a lane
 * that disappeared, a pane whose kind changed, and the error path of the
 * borrow itself.
 *
 * ## Geometry
 *
 * The gutter and the head column are fixed widths, so the trace band
 * between them is the same x range on every lane. That is the whole
 * design: one shared time axis, and an event at t−40 s crossing every
 * lane at the same pixel.
 */
import type { SurfaceKind } from "../../../shared/types";
import { toneVar } from "../atlas/view";
import { ChronoGutterRow, buildEmptyState } from "./gutter";
import { ChronoHead } from "./head";
import type { ChronoGrid } from "./grid";
import { distributeLanes, type ChronoLane, type LaneBox } from "./lanes";
import { ScreenLeases } from "./screen-lease";

/** Width of the channel strip. Wide enough for a pane name plus its
 *  satellites at 10 px mono, narrow enough to leave the field the room. */
const GUTTER_W = 232;

/** The head column. Clamped so a 5K display doesn't give each lane a
 *  terminal wider than anything anyone types, and a 13" one still shows
 *  enough columns to read a log line. */
const HEAD_MIN = 300;
const HEAD_MAX = 760;
const HEAD_SHARE = 0.42;

/** Vertical gap between lanes. The 4 px grid, twice. */
const LANE_GAP = 8;

/** The head's own chrome — the slot's top/bottom inset plus its frame.
 *  Part of what a lane has to ask for to show N rows of text. */
const HEAD_PADDING = 14;

export interface ChronoViewCallbacks {
  /** A gutter click: select the lane, keyboard stays with CHRONO. */
  onSelect(id: string): void;
  /** A head click: select the lane and hand the pane the keyboard. */
  onEnter(id: string): void;
  /** Go to the pane and leave CHRONO. */
  onActivate(id: string): void;
  /** Pointer entered a lane's gutter, or left the field. */
  onHover(id: string | null): void;
}

export interface ChronoViewHost {
  getSurfaceContainer(surfaceId: string): HTMLElement | null;
  getSurfaceGrid(surfaceId: string): ChronoGrid | null;
}

export interface ChronoViewOptions {
  host: ChronoViewHost;
  callbacks: ChronoViewCallbacks;
  /** Where the column widths are published. The ruler and the strike
   *  rail live outside the scroller but must line up with the trace
   *  band, so the two widths are written once, high enough for both. */
  styleTarget: HTMLElement;
}

export interface ChronoRenderInput {
  lanes: readonly ChronoLane[];
  selectedId: string | null;
  /** The user has stepped into the selected lane's head, so its shield is
   *  down and the pane owns the keyboard. */
  entered: boolean;
  surfaceKinds: ReadonlyMap<string, SurfaceKind>;
  /** Per-lane room demand in CSS px, from `measureDemand`. */
  demand: ReadonlyMap<string, number>;
}

interface LaneParts {
  row: HTMLDivElement;
  gutter: ChronoGutterRow;
  head: ChronoHead;
  /** Last written geometry + identity, so a refresh that changed nothing
   *  writes no style at all. */
  layout: string;
  identity: string;
}

export interface FieldGeometry {
  /** Left edge of the trace band, relative to the scroller. */
  left: number;
  /** Width of the trace band. */
  width: number;
  /** Total height of the lane stack. */
  height: number;
  boxes: readonly LaneBox[];
}

export class ChronoView {
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly lanesEl: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly leases = new ScreenLeases();
  private readonly parts = new Map<string, LaneParts>();
  private geometry: FieldGeometry = {
    left: 0,
    width: 0,
    height: 0,
    boxes: [],
  };

  private readonly host: ChronoViewHost;
  private readonly callbacks: ChronoViewCallbacks;
  private readonly styleTarget: HTMLElement;

  constructor(options: ChronoViewOptions) {
    this.host = options.host;
    this.callbacks = options.callbacks;
    this.styleTarget = options.styleTarget;
    this.element = document.createElement("div");
    this.element.className = "tau-chrono-field";

    this.scroller = document.createElement("div");
    this.scroller.className = "tau-chrono-scroll";

    this.content = document.createElement("div");
    this.content.className = "tau-chrono-content";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "tau-chrono-canvas";
    this.canvas.setAttribute("aria-hidden", "true");

    this.lanesEl = document.createElement("div");
    this.lanesEl.className = "tau-chrono-lanes";
    this.lanesEl.setAttribute("role", "listbox");
    this.lanesEl.setAttribute("aria-label", "Panes, by time");

    this.empty = buildEmptyState();

    this.content.append(this.lanesEl, this.canvas);
    this.scroller.appendChild(this.content);
    this.element.append(this.scroller, this.empty);
    this.element.addEventListener("pointerleave", () =>
      this.callbacks.onHover(null),
    );
  }

  /**
   * Hand every borrowed pane back and drop the DOM.
   *
   * Ordered: leases first, so a pane is returned to a live layout rather
   * than to one whose parent has already gone.
   */
  destroy(): void {
    this.leases.releaseAll();
    for (const parts of this.parts.values()) {
      parts.gutter.destroy();
      parts.head.destroy();
      parts.row.remove();
    }
    this.parts.clear();
    this.element.remove();
  }

  /** Geometry of the last render, for the field renderer. */
  getGeometry(): FieldGeometry {
    return this.geometry;
  }

  getScroller(): HTMLElement {
    return this.scroller;
  }

  /** The lane row element, for scroll-into-view on keyboard navigation. */
  rowFor(id: string): HTMLElement | null {
    return this.parts.get(id)?.row ?? null;
  }

  /** The lane's gutter button — where CHRONO parks the keyboard when the
   *  user is navigating the field rather than typing into a pane. */
  gutterFor(id: string): HTMLElement | null {
    return this.parts.get(id)?.gutter.element ?? null;
  }

  render(input: ChronoRenderInput): void {
    const { lanes } = input;
    this.empty.classList.toggle("is-visible", lanes.length === 0);

    this.reconcile(lanes);

    const width = this.scroller.clientWidth;
    const headW = Math.round(
      Math.min(HEAD_MAX, Math.max(HEAD_MIN, width * HEAD_SHARE)),
    );
    const gutterW = Math.min(GUTTER_W, Math.max(0, width - headW - 80));
    const { boxes, contentHeight } = distributeLanes({
      ids: lanes.map((l) => l.id),
      height: this.scroller.clientHeight,
      gap: LANE_GAP,
      focusedId: input.selectedId,
      demand: input.demand,
    });

    this.styleTarget.style.setProperty("--chrono-gutter", `${gutterW}px`);
    this.styleTarget.style.setProperty("--chrono-head", `${headW}px`);
    this.content.style.height = `${contentHeight}px`;

    const byId = new Map(boxes.map((b) => [b.id, b]));
    for (const lane of lanes) {
      const parts = this.parts.get(lane.id);
      const box = byId.get(lane.id);
      if (!parts || !box) continue;
      const selected = lane.id === input.selectedId;

      const layout = `${box.top}:${box.height}`;
      if (layout !== parts.layout) {
        parts.layout = layout;
        parts.row.style.transform = `translateY(${box.top}px)`;
        parts.row.style.height = `${box.height}px`;
      }
      // Identity lives on the row rather than on the gutter: both the
      // channel strip and the head's frame are drawn in the lane's
      // colour, and inheriting it is one write instead of two.
      const identity = `${lane.node.color ?? toneVar(lane.node.tone)}§${lane.workspaceColor}`;
      if (identity !== parts.identity) {
        parts.identity = identity;
        parts.row.style.setProperty(
          "--lane",
          lane.node.color ?? toneVar(lane.node.tone),
        );
        parts.row.style.setProperty("--workspace", lane.workspaceColor);
      }
      parts.row.classList.toggle("is-selected", selected);
      // §4/§11: `is-focused` is the one selector the guideline lets glow.
      parts.row.classList.toggle("is-focused", selected);

      parts.gutter.render(lane);
      parts.gutter.setSelected(selected);
      parts.head.setKind(lane.head);
      parts.head.setLive(selected && input.entered);
      this.mountHead(lane, parts, input.surfaceKinds.get(lane.id));
    }

    this.geometry = {
      left: gutterW,
      width: Math.max(0, width - gutterW - headW),
      height: contentHeight,
      boxes,
    };
  }

  /** Re-measure every borrowed screen's anchor. Separate from `render`
   *  because it must run *after* layout has settled — the lane's height
   *  is a style write in the same frame. */
  applyAnchors(lanes: readonly ChronoLane[]): void {
    for (const lane of lanes) {
      const parts = this.parts.get(lane.id);
      if (!parts || lane.head !== "screen") continue;
      parts.head.applyAnchor(this.host.getSurfaceGrid(lane.id));
    }
  }

  /**
   * How much room each lane could actually use, in CSS px.
   *
   * `contentRows` comes from the Terminal; the cell height is measured
   * off whichever borrowed screen is already laid out — they all share
   * one font, so one measurement serves the field. Lanes with nothing to
   * measure are simply absent from the map, which `distributeLanes`
   * reads as "no claim" rather than as "wants nothing".
   */
  measureDemand(lanes: readonly ChronoLane[]): Map<string, number> {
    const demand = new Map<string, number>();
    const cell = this.measureCellHeight();
    if (cell <= 0) return demand;
    for (const lane of lanes) {
      if (lane.head !== "screen") continue;
      const grid = this.host.getSurfaceGrid(lane.id);
      if (!grid) continue;
      // One row of headroom above the content, plus the slot's own inset,
      // so the top line never sits flush against the frame.
      demand.set(lane.id, (grid.contentRows + 1) * cell + HEAD_PADDING);
    }
    return demand;
  }

  private measureCellHeight(): number {
    for (const [id, parts] of this.parts) {
      const screen =
        parts.head.slot.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) continue;
      const rows = this.host.getSurfaceGrid(id)?.rows ?? 0;
      const height = screen.getBoundingClientRect().height;
      if (rows > 0 && height > 0) return height / rows;
    }
    return 0;
  }

  // ── reconciliation ─────────────────────────────────────────────────

  private reconcile(lanes: readonly ChronoLane[]): void {
    const live = new Set(lanes.map((l) => l.id));
    for (const [id, parts] of [...this.parts]) {
      if (live.has(id)) continue;
      // The pane is gone from the field: give its terminal back before
      // its slot leaves the DOM, or the container goes with it.
      this.leases.release(id);
      parts.gutter.destroy();
      parts.head.destroy();
      parts.row.remove();
      this.parts.delete(id);
    }

    for (const lane of lanes) {
      if (this.parts.has(lane.id)) continue;
      const row = document.createElement("div");
      row.className = "tau-chrono-lane";
      // The lane row is layout, not structure: `role="option"` has to be
      // a child of the listbox, and this div sits between them. Marking
      // it presentational flattens it out of the accessibility tree so
      // the relationship the roles claim is the one that exists.
      row.setAttribute("role", "presentation");
      const gutter = new ChronoGutterRow(lane.id, {
        onSelect: (id) => this.callbacks.onSelect(id),
        onActivate: (id) => this.callbacks.onActivate(id),
        onHover: (id) => this.callbacks.onHover(id),
      });
      const head = new ChronoHead(lane.id, {
        onEnter: (id) => this.callbacks.onEnter(id),
        onGoToPane: (id) => this.callbacks.onActivate(id),
      });
      // The trace band sits between the two, drawn on the canvas above.
      const track = document.createElement("div");
      track.className = "tau-chrono-track";
      track.setAttribute("aria-hidden", "true");
      row.append(gutter.element, track, head.element);
      this.lanesEl.appendChild(row);
      this.parts.set(lane.id, {
        row,
        gutter,
        head,
        layout: "",
        identity: "",
      });
    }

    // Keep DOM order in step with lane order so the tab sequence and the
    // accessibility tree read top-to-bottom like the field does.
    lanes.forEach((lane, index) => {
      const parts = this.parts.get(lane.id);
      if (!parts) return;
      const at = this.lanesEl.children[index];
      if (at !== parts.row) this.lanesEl.insertBefore(parts.row, at ?? null);
    });
  }

  /**
   * Put the right thing in a lane's head.
   *
   * A `screen` or `pane` lane borrows the real container. Anything else
   * releases whatever it was holding first — a pane that turned into a
   * browser must give its terminal back before the card replaces it.
   */
  private mountHead(
    lane: ChronoLane,
    parts: LaneParts,
    kind: SurfaceKind | undefined,
  ): void {
    if (lane.head === "screen" || lane.head === "pane") {
      const container = this.host.getSurfaceContainer(lane.id);
      if (
        container &&
        this.leases.borrow(lane.id, container, parts.head.slot)
      ) {
        return;
      }
      // No container, or nothing to give it back to. Fall through to the
      // card rather than leaving an empty frame: a lane with no head at
      // all reads as a bug, and a pane we could not borrow is a fact
      // worth stating.
      parts.head.setKind("standby");
    }
    this.leases.release(lane.id);
    parts.head.setCard(lane.node, kind ?? lane.head);
  }
}
