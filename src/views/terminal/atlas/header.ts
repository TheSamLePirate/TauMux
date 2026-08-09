/**
 * Atlas header — scope control for the graph.
 *
 * Four filters, no search box. At column scale the whole graph is ~25
 * rows; a text field would be chrome you never use. The filters, by
 * contrast, answer questions you actually ask several times an hour:
 * *which of these are agents*, *what is actually busy*, *what needs me*.
 *
 * A node survives a filter if it matches, or if any descendant matches —
 * hiding a workspace whose pane matched would hide the pane too.
 */
import type { AtlasFilter } from "./filter";
import type { AtlasSnapshot } from "./types";
import { formatCost } from "./format";

const FILTERS: { id: AtlasFilter; label: string; hint: string }[] = [
  { id: "all", label: "all", hint: "Every workspace and pane" },
  { id: "agent", label: "agents", hint: "Panes running an agent session" },
  { id: "running", label: "live", hint: "Panes with work in flight" },
  { id: "attention", label: "alert", hint: "Anything waiting on you" },
];

export interface AtlasHeaderCallbacks {
  onFilter(filter: AtlasFilter): void;
  onExpand(): void;
  onToggleLegend(): void;
}

export class AtlasHeader {
  readonly element: HTMLDivElement;
  private readonly buttons = new Map<AtlasFilter, HTMLButtonElement>();
  private readonly countEl: HTMLSpanElement;
  private readonly metersEl: HTMLDivElement;
  private active: AtlasFilter = "all";
  private lastMeters = "";

  constructor(callbacks: AtlasHeaderCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "tau-atlas-header";

    const eyebrow = document.createElement("span");
    eyebrow.className = "tau-atlas-eyebrow";
    eyebrow.textContent = "atlas";

    const group = document.createElement("div");
    group.className = "tau-atlas-filters";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Filter the topology");
    for (const filter of FILTERS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tau-atlas-filter";
      btn.textContent = filter.label;
      btn.title = filter.hint;
      btn.setAttribute("aria-pressed", String(filter.id === this.active));
      btn.addEventListener("click", () => {
        this.setFilter(filter.id);
        callbacks.onFilter(filter.id);
      });
      this.buttons.set(filter.id, btn);
      group.appendChild(btn);
    }
    this.buttons.get("all")?.classList.add("is-active");

    this.countEl = document.createElement("span");
    this.countEl.className = "tau-atlas-alert-count";

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "tau-atlas-expand";
    expand.title = "Chrono — the last 90 seconds (⌘G)";
    expand.setAttribute("aria-label", "Open Chrono");
    expand.appendChild(expandGlyph());
    expand.addEventListener("click", () => callbacks.onExpand());

    const legend = document.createElement("button");
    legend.type = "button";
    legend.className = "tau-atlas-legend-btn";
    legend.title = "What the shapes and rings mean";
    legend.setAttribute("aria-label", "Toggle legend");
    legend.textContent = "?";
    legend.addEventListener("click", () => callbacks.onToggleLegend());

    const bar = document.createElement("div");
    bar.className = "tau-atlas-header-bar";
    bar.append(eyebrow, group, this.countEl, legend, expand);

    // Second row: what the account is spending, and how close it is to a
    // wall. Only rendered once a Claude session has actually reported —
    // an empty meter strip would be chrome that never carries anything.
    this.metersEl = document.createElement("div");
    this.metersEl.className = "tau-atlas-meters";

    this.element.append(bar, this.metersEl);
  }

  /** Cost + rate-limit readout. Hidden entirely when nothing reports. */
  setMeters(totals: AtlasSnapshot["totals"]): void {
    const cost = formatCost(totals.costUsd);
    const five = totals.fiveHourPct;
    const seven = totals.sevenDayPct;
    const signature = `${cost}|${five}|${seven}`;
    if (signature === this.lastMeters) return;
    this.lastMeters = signature;

    const parts: HTMLElement[] = [];
    if (cost) parts.push(readout("spend", cost, null, "accent"));
    if (typeof five === "number") {
      parts.push(readout("5h", `${Math.round(five)}%`, five / 100, limitTone(five)));
    }
    if (typeof seven === "number") {
      parts.push(
        readout("7d", `${Math.round(seven)}%`, seven / 100, limitTone(seven)),
      );
    }
    this.metersEl.replaceChildren(...parts);
    this.metersEl.classList.toggle("is-empty", parts.length === 0);
  }

  setFilter(filter: AtlasFilter): void {
    this.active = filter;
    for (const [id, btn] of this.buttons) {
      const on = id === filter;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  getFilter(): AtlasFilter {
    return this.active;
  }

  /** Badge on the `alert` filter — the count of nodes flying a flag.
   *  Zero renders nothing at all rather than a `0`. */
  setAttentionCount(count: number): void {
    const text = count > 0 ? String(count) : "";
    if (this.countEl.textContent === text) return;
    this.countEl.textContent = text;
    this.countEl.classList.toggle("is-visible", count > 0);
    this.buttons.get("attention")?.classList.toggle("has-alert", count > 0);
  }
}

function expandGlyph(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.1");
  svg.setAttribute("stroke-linecap", "round");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M7 1.5h3.5V5M5 10.5H1.5V7M10.5 1.5 7 5M1.5 10.5 5 7");
  svg.appendChild(path);
  return svg;
}

function limitTone(pct: number): "ok" | "warn" | "err" {
  if (pct >= 85) return "err";
  if (pct >= 60) return "warn";
  return "ok";
}

/** One `label value [bar]` cell in the meters strip. */
function readout(
  label: string,
  value: string,
  fill: number | null,
  tone: string,
): HTMLElement {
  const el = document.createElement("span");
  el.className = `tau-atlas-readout is-${tone}`;
  const l = document.createElement("span");
  l.className = "tau-atlas-readout-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "tau-atlas-readout-value";
  v.textContent = value;
  el.append(l, v);
  if (fill !== null) {
    const bar = document.createElement("span");
    bar.className = "tau-atlas-readout-bar";
    const inner = document.createElement("span");
    inner.style.width = `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%`;
    bar.appendChild(inner);
    el.appendChild(bar);
  }
  return el;
}

/** The key to the encoding. Rich graphs need one; it lives behind a
 *  toggle so it costs nothing until asked for. */
export function buildLegend(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "tau-atlas-legend";
  const rows: [string, string][] = [
    ["shape", "square workspace · circle pane · hexagon agent"],
    ["fill", "active workspace / focused pane"],
    ["inner arc", "cpu — green, amber >50%, red >85%"],
    ["outer arc", "context used · build or plan progress"],
    ["halo", "work in flight"],
    ["dashed ring", "waiting on you"],
    ["wire speed", "live output rate of that pane"],
    ["river", "last 90 s of output, per workspace"],
  ];
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "tau-atlas-legend-row";
    const key = document.createElement("span");
    key.className = "tau-atlas-legend-key";
    key.textContent = k;
    const val = document.createElement("span");
    val.className = "tau-atlas-legend-value";
    val.textContent = v;
    row.append(key, val);
    el.appendChild(row);
  }
  return el;
}
