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
import { divisionTicks, spanLabel } from "./timebase";

const FILTERS: { id: AtlasFilter; label: string; hint: string }[] = [
  { id: "all", label: "all", hint: "Every pane" },
  { id: "agent", label: "agents", hint: "Panes running an agent session" },
  { id: "running", label: "live", hint: "Panes with work in flight" },
  { id: "attention", label: "alert", hint: "Anything waiting on you" },
];

export interface ChronoHeaderCallbacks {
  onFilter(filter: AtlasFilter): void;
  onClose(): void;
  /** +1 zooms in (shorter window), −1 zooms out. */
  onZoom(direction: number): void;
}

export class ChronoHeader {
  readonly element: HTMLDivElement;
  readonly ruler: HTMLDivElement;
  private readonly buttons = new Map<AtlasFilter, HTMLButtonElement>();
  private readonly countEl: HTMLSpanElement;
  private readonly hintEl: HTMLButtonElement;
  private readonly spanEl: HTMLSpanElement;
  private readonly band: HTMLDivElement;
  private lastHint = "";
  private lastSpan = -1;

  constructor(callbacks: ChronoHeaderCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "tau-chrono-header";

    const title = document.createElement("span");
    title.className = "tau-chrono-title tau-mono";
    title.id = "tau-chrono-title";
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

    // The timebase knob. A scope puts this on the front panel with its
    // current setting printed next to it, and so does this: the window
    // is the single most load-bearing number on screen and it should
    // never have to be inferred from the tick labels.
    const timebase = document.createElement("div");
    timebase.className = "tau-chrono-timebase";
    const knobLabel = document.createElement("span");
    knobLabel.className = "tau-chrono-timebase-label tau-mono";
    knobLabel.textContent = "window";
    this.spanEl = document.createElement("span");
    this.spanEl.className = "tau-chrono-timebase-value tau-mono";
    const out = knob("−", "Widen the window", () => callbacks.onZoom(-1));
    const inn = knob("+", "Narrow the window", () => callbacks.onZoom(1));
    timebase.append(knobLabel, out, this.spanEl, inn);

    this.element.append(title, group, this.countEl, timebase, this.hintEl);

    this.ruler = document.createElement("div");
    this.ruler.className = "tau-chrono-ruler";
    this.ruler.setAttribute("aria-hidden", "true");
    this.band = document.createElement("div");
    this.band.className = "tau-chrono-ruler-band";
    this.ruler.appendChild(this.band);
  }

  /**
   * Redraw the axis for a new window.
   *
   * The ticks are the graticule's divisions, so a line on the field and
   * a label above it are the same measurement — which is the whole point
   * of drawing a graticule rather than a decorative grid.
   */
  setSpan(span: number): void {
    if (span === this.lastSpan) return;
    this.lastSpan = span;
    this.spanEl.textContent = spanLabel(span);
    this.band.replaceChildren(
      ...divisionTicks(span).map(({ seconds, label }) => {
        const tick = document.createElement("span");
        tick.className = "tau-chrono-tick tau-mono";
        tick.textContent = label;
        // The axis runs right to left: now is pinned at the band's right
        // edge and the window's far end is its left edge.
        tick.style.left = `${(1 - (seconds * 1000) / span) * 100}%`;
        if (seconds === 0) tick.classList.add("is-now");
        return tick;
      }),
    );
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
 * the next row.
 *
 * Past the last row there is genuinely no room, and what gets dropped is
 * decided by **weight, then recency** — never recency alone. A turn is a
 * prompt followed by a dozen tool calls in as many seconds; ordering by
 * time alone means the tools label themselves and the prompt that caused
 * them does not, which is precisely backwards.
 */

/**
 * What each kind is called on the axis.
 *
 * Verbs and nouns from the user's side of the screen, not the hook names
 * that produced them: a person recognises "asked" and "ran", not
 * `user-text` and `tool-start`. Short enough that four can stack without
 * the rail becoming a paragraph.
 */
const KIND_LABEL: Record<string, string> = {
  prompt: "asked",
  reply: "replied",
  tool: "ran",
  turn: "turn",
  task: "task",
  approval: "approval",
  question: "asking",
  error: "error",
  notify: "notify",
  mark: "mark",
};

/**
 * Which labels win the last row.
 *
 * Not a severity scale — a ranking of *what you came here to find*. You
 * open a timeline to see what you asked for and what stopped, not to
 * count the reads in between.
 */
const LABEL_RANK: Record<string, number> = {
  error: 6,
  approval: 6,
  question: 6,
  prompt: 5,
  mark: 4,
  reply: 3,
  turn: 3,
  task: 2,
  notify: 2,
  tool: 1,
};

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

  render(events: readonly ChronoEvent[], now: number, span: number): void {
    const placed: { pct: number; row: number; event: ChronoEvent }[] = [];
    const rows: number[][] = Array.from({ length: MAX_ROWS }, () => []);

    // Loudest first, then newest. When the rail runs out of rows the
    // labels that survive are the ones you would have looked for.
    const candidates = events
      .filter((event) => {
        const age = now - event.at;
        return age >= 0 && age <= span;
      })
      .sort(
        (a, b) => LABEL_RANK[b.kind] - LABEL_RANK[a.kind] || b.at - a.at,
      );

    for (const event of candidates) {
      const pct = (1 - (now - event.at) / span) * 100;
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
        kind.textContent = KIND_LABEL[event.kind] ?? event.kind;
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

/** One end of the timebase knob. A button, not a scroll target: the
 *  wheel is claimed by the field, and a control you can only reach by
 *  hovering the right pixels is a control most people never find. */
function knob(
  glyph: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tau-chrono-timebase-knob tau-mono";
  btn.textContent = glyph;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.addEventListener("click", onClick);
  return btn;
}
