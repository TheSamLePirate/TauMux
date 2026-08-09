/**
 * CHRONO's header and time ruler.
 *
 * Two rows, both hairlines away from being nothing at all: the name of
 * the instrument, the four filters carried over from the Atlas column,
 * what is waiting on the user, and how to leave. Under it, the axis —
 * `90s · 60s · 30s · now`, aligned to the trace band by the same two CSS
 * variables the field publishes, so a tick and a trace sample at the same
 * moment sit on the same pixel.
 *
 * The exit hint is not decoration. CHRONO lets you type into a real
 * terminal, so Esc sometimes belongs to `vim` and not to the overlay.
 * Rather than leave that to be discovered, the header says which one is
 * live right now.
 */
import type { AtlasFilter } from "../atlas/filter";
import type { ChronoEvent } from "./event-log";
import { WINDOW_MS } from "./field";

const FILTERS: { id: AtlasFilter; label: string; hint: string }[] = [
  { id: "all", label: "all", hint: "Every pane" },
  { id: "agent", label: "agents", hint: "Panes running an agent session" },
  { id: "running", label: "live", hint: "Panes with work in flight" },
  { id: "attention", label: "alert", hint: "Anything waiting on you" },
];

/** Ticks on the axis, in seconds before now. `0` is drawn as `now`. */
const TICKS = [90, 60, 30, 0];

export interface ChronoHeaderCallbacks {
  onFilter(filter: AtlasFilter): void;
  onClose(): void;
}

export class ChronoHeader {
  readonly element: HTMLDivElement;
  readonly ruler: HTMLDivElement;
  private readonly buttons = new Map<AtlasFilter, HTMLButtonElement>();
  private readonly countEl: HTMLSpanElement;
  private readonly hintEl: HTMLButtonElement;
  private lastHint = "";

  constructor(callbacks: ChronoHeaderCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "tau-chrono-header";

    const title = document.createElement("span");
    title.className = "tau-chrono-title tau-mono";
    title.textContent = "chrono";

    const group = document.createElement("div");
    group.className = "tau-chrono-filters";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Filter the field");
    for (const filter of FILTERS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tau-chrono-filter tau-mono";
      btn.textContent = filter.label;
      btn.title = filter.hint;
      btn.setAttribute("aria-pressed", String(filter.id === "all"));
      btn.addEventListener("click", () => {
        this.setFilter(filter.id);
        callbacks.onFilter(filter.id);
      });
      this.buttons.set(filter.id, btn);
      group.appendChild(btn);
    }
    this.buttons.get("all")?.classList.add("is-active");

    this.countEl = document.createElement("span");
    this.countEl.className = "tau-chrono-alert tau-mono";

    this.hintEl = document.createElement("button");
    this.hintEl.type = "button";
    this.hintEl.className = "tau-chrono-hint tau-mono";
    this.hintEl.addEventListener("click", () => callbacks.onClose());

    this.element.append(title, group, this.countEl, this.hintEl);

    this.ruler = document.createElement("div");
    this.ruler.className = "tau-chrono-ruler";
    this.ruler.setAttribute("aria-hidden", "true");
    const band = document.createElement("div");
    band.className = "tau-chrono-ruler-band";
    for (const seconds of TICKS) {
      const tick = document.createElement("span");
      tick.className = "tau-chrono-tick tau-mono";
      tick.textContent = seconds === 0 ? "now" : `${seconds}s`;
      // The axis runs right-to-left: now is pinned at the band's right
      // edge, and 90 s ago is its left edge.
      tick.style.left = `${((90 - seconds) / 90) * 100}%`;
      if (seconds === 0) tick.classList.add("is-now");
      band.appendChild(tick);
    }
    this.ruler.appendChild(band);
  }

  setFilter(filter: AtlasFilter): void {
    for (const [id, btn] of this.buttons) {
      const on = id === filter;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  /** Count of lanes flying a flag. Zero renders nothing at all. */
  setAttentionCount(count: number): void {
    const text = count > 0 ? String(count) : "";
    if (this.countEl.textContent === text) return;
    this.countEl.textContent = text;
    this.countEl.classList.toggle("is-visible", count > 0);
    this.buttons.get("attention")?.classList.toggle("has-alert", count > 0);
  }

  /**
   * Which key closes, right now.
   *
   * While a head has keyboard focus every keystroke belongs to that
   * terminal — including Esc, which is the single most load-bearing key
   * in half the programs anyone runs in one.
   */
  setExit(typingInto: string | null): void {
    const text = typingInto ? `⌘G to close` : "esc to close";
    const label = typingInto ? `typing into ${typingInto}` : "";
    const signature = `${text}§${label}`;
    if (signature === this.lastHint) return;
    this.lastHint = signature;
    this.hintEl.replaceChildren();
    if (label) {
      const into = document.createElement("span");
      into.className = "tau-chrono-hint-typing";
      into.textContent = label;
      this.hintEl.appendChild(into);
    }
    const key = document.createElement("span");
    key.className = "tau-chrono-hint-key";
    key.textContent = text;
    this.hintEl.appendChild(key);
    this.hintEl.classList.toggle("is-typing", !!typingInto);
  }
}

/**
 * The strike rail — the event legend, laid out on the time axis.
 *
 * The rules themselves are drawn on the canvas, inside a scroller that
 * can be taller than the window. Their names cannot live there: a label
 * that scrolls off is a label that is not there when you need it. So the
 * rail is a fixed strip below the field, sharing the same right-hand
 * column width, and every rule in the window gets its name printed under
 * the x where it struck.
 *
 * Labels are **stacked, not thinned**. Four approvals in eight seconds
 * draw four rules — that is the truth, and it is legible — but four
 * overlapping words is a smudge, so a label that would collide drops to
 * the next row. Past the last row there is genuinely no room, and the
 * remainder is dropped newest-first-wins.
 */

/** Rows the rail can stack into before it gives up. */
const MAX_ROWS = 4;

/** Row pitch, in px. Matches the 10 px mono line box plus air. */
const ROW_H = 15;

/** Rough label width as a share of the band, used for collision. A real
 *  measurement would need layout; this is deliberately generous, because
 *  a label pushed to the next row costs nothing and an overlap costs
 *  legibility. */
const LABEL_PCT = 13;

export class ChronoStrikeRail {
  readonly element: HTMLDivElement;
  private readonly band: HTMLDivElement;
  private signature = "";

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tau-chrono-rail";
    this.band = document.createElement("div");
    this.band.className = "tau-chrono-rail-band";
    this.element.appendChild(this.band);
  }

  render(events: readonly ChronoEvent[], now: number): void {
    const placed: { pct: number; row: number; event: ChronoEvent }[] = [];
    const rows: number[][] = Array.from({ length: MAX_ROWS }, () => []);

    // Newest first: when the rail runs out of rows, the events you are
    // most likely to still care about are the ones that keep their name.
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      const age = now - event.at;
      if (age < 0 || age > WINDOW_MS) continue;
      const pct = (1 - age / WINDOW_MS) * 100;
      const row = rows.findIndex((taken) =>
        taken.every((other) => Math.abs(other - pct) >= LABEL_PCT),
      );
      if (row === -1) continue;
      rows[row]!.push(pct);
      placed.push({ pct, row, event });
    }

    const next = placed
      .map((p) => `${p.event.kind}@${Math.round(p.pct)}#${p.row}`)
      .join("|");
    if (next === this.signature) return;
    this.signature = next;

    this.band.replaceChildren(
      ...placed.map(({ pct, row, event }) => {
        const el = document.createElement("span");
        el.className = `tau-chrono-strike-label tau-mono is-${event.kind}`;
        el.style.left = `${pct}%`;
        el.style.top = `${row * ROW_H}px`;
        el.title = event.text;

        const kind = document.createElement("span");
        kind.className = "tau-chrono-strike-kind";
        kind.textContent = event.kind;
        const text = document.createElement("span");
        text.className = "tau-chrono-strike-text";
        text.textContent = event.text;
        el.append(kind, text);
        return el;
      }),
    );
    this.element.classList.toggle("is-empty", placed.length === 0);
  }
}
