/**
 * The head — what a lane shows at *now*.
 *
 * Four kinds, one element each, all the same width so that "now" is a
 * straight vertical edge down the right of the field. A head is created
 * once per lane and reconciled in place; its slot element in particular
 * must keep its identity, because that is what the screen lease borrows
 * a live pane into.
 *
 * ## The shield
 *
 * A head carries a transparent shield until the user steps into it. It is
 * not decoration — it settles two conflicts that a live terminal embedded
 * in a scrolling list would otherwise lose:
 *
 *  - **The wheel.** Over an unshielded terminal, xterm claims the wheel
 *    (and in the alternate buffer turns it into arrow keys, so scrolling
 *    the field past a `vim` lane would move `vim`'s cursor). Over the
 *    shield, the wheel reaches the field's scroller, where the user
 *    aimed it.
 *  - **The first click.** A click on a readout means "this lane", not
 *    "put the caret between those two characters".
 *
 * Click the head and the shield lifts: that pane is now live to the
 * mouse — selection, links, its own scrollback — and to the keyboard.
 * Selecting the same lane from the gutter does *not* lift it, because at
 * that point CHRONO still owns the arrows and Escape. One rule, stated
 * once: **the gutter is CHRONO's, the head is the pane's.**
 */
import type { AtlasNode } from "../atlas/types";
import { anchorOffset, fitScale, type ChronoGrid } from "./grid";
import type { ChronoHeadKind } from "./lanes";

export interface ChronoHeadCallbacks {
  /** Select this lane *and step into it* — the click landed on the pane,
   *  so the pane gets the keyboard. */
  onEnter(id: string): void;
  /** Leave CHRONO and go to the pane itself. */
  onGoToPane(id: string): void;
}

export class ChronoHead {
  readonly element: HTMLDivElement;
  /** The lease target. Stable for the life of the head. */
  readonly slot: HTMLDivElement;
  private readonly shield: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly cardTitle: HTMLSpanElement;
  private readonly cardSub: HTMLSpanElement;
  private readonly cardKind: HTMLSpanElement;
  private kind: ChronoHeadKind | null = null;
  private lastCard = "";
  private lastAnchor: number | null = null;
  private lastScale: number | null = null;

  constructor(
    private readonly id: string,
    callbacks: ChronoHeadCallbacks,
  ) {
    this.element = document.createElement("div");
    this.element.className = "tau-chrono-head";

    this.slot = document.createElement("div");
    this.slot.className = "tau-chrono-screen";

    this.card = document.createElement("div");
    this.card.className = "tau-chrono-card";
    this.cardKind = document.createElement("span");
    this.cardKind.className = "tau-chrono-card-kind tau-mono";
    this.cardTitle = document.createElement("span");
    this.cardTitle.className = "tau-chrono-card-title";
    this.cardSub = document.createElement("span");
    this.cardSub.className = "tau-chrono-card-sub tau-mono";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "tau-chrono-card-go";
    go.textContent = "go to pane";
    go.addEventListener("click", (e) => {
      e.stopPropagation();
      callbacks.onGoToPane(this.id);
    });
    this.card.append(this.cardKind, this.cardTitle, this.cardSub, go);

    this.shield = document.createElement("div");
    this.shield.className = "tau-chrono-shield";
    this.shield.addEventListener("mousedown", () => callbacks.onEnter(this.id));

    const edge = document.createElement("div");
    edge.className = "tau-chrono-head-edge";
    edge.setAttribute("aria-hidden", "true");

    this.element.append(this.slot, this.card, this.shield, edge);
  }

  destroy(): void {
    this.element.remove();
  }

  /** Switch the head between a live screen and a card. */
  setKind(kind: ChronoHeadKind): void {
    if (this.kind === kind) return;
    this.kind = kind;
    this.element.dataset["kind"] = kind;
  }

  /** Fill the card for the kinds that have one. No-op for live screens,
   *  whose content is the terminal itself. */
  setCard(node: AtlasNode, kindLabel: string): void {
    const signature = `${kindLabel}§${node.label}§${node.sublabel}`;
    if (signature === this.lastCard) return;
    this.lastCard = signature;
    this.cardKind.textContent = kindLabel;
    this.cardTitle.textContent = node.label;
    this.cardSub.textContent = node.sublabel;
    this.cardSub.title = node.sublabel;
  }

  /**
   * Lift the shield.
   *
   * Only for a lane the user has actually stepped into — selecting a lane
   * from the gutter leaves the shield down, because at that point CHRONO
   * still owns the keyboard and the wheel.
   */
  setLive(live: boolean): void {
    this.element.classList.toggle("is-live", live);
  }

  /**
   * Bottom-anchor the borrowed terminal.
   *
   * `.xterm-screen` is `rows × cellHeight` under both renderers, which is
   * why it is the one thing measured from the DOM; everything else comes
   * from the Terminal via `grid`. Writes only when the offset actually
   * moved — this runs on every field tick.
   */
  applyAnchor(grid: ChronoGrid | null): void {
    if (this.kind !== "screen" || !grid) {
      this.clearAnchor();
      return;
    }
    const screen = this.slot.querySelector<HTMLElement>(".xterm-screen");
    const box = this.slot.querySelector<HTMLElement>(".surface-terminal");
    if (!screen || !box) {
      this.clearAnchor();
      return;
    }
    // `offsetWidth/Height` are layout values and ignore transforms — the
    // terminal's *natural* size, which is what both the fit and the
    // anchor have to be computed from. A bounding rect here would feed
    // last frame's scale back into this frame's and converge on nothing.
    const scale = fitScale(screen.offsetWidth, box.clientWidth);
    const offset = anchorOffset({
      grid,
      laneHeight: box.clientHeight,
      screenHeight: screen.offsetHeight,
      scale,
    });
    if (offset === this.lastAnchor && scale === this.lastScale) return;
    this.lastAnchor = offset;
    this.lastScale = scale;
    this.element.style.setProperty("--chrono-anchor", `${offset}px`);
    this.element.style.setProperty("--chrono-scale", String(scale));
  }

  private clearAnchor(): void {
    if (this.lastAnchor === null && this.lastScale === null) return;
    this.lastAnchor = null;
    this.lastScale = null;
    this.element.style.removeProperty("--chrono-anchor");
    this.element.style.removeProperty("--chrono-scale");
  }
}
