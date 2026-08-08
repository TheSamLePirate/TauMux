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

const FILTERS: { id: AtlasFilter; label: string; hint: string }[] = [
  { id: "all", label: "all", hint: "Every workspace and pane" },
  { id: "agent", label: "agents", hint: "Panes running an agent session" },
  { id: "running", label: "live", hint: "Panes with work in flight" },
  { id: "attention", label: "alert", hint: "Anything waiting on you" },
];

export interface AtlasHeaderCallbacks {
  onFilter(filter: AtlasFilter): void;
  onExpand(): void;
}

export class AtlasHeader {
  readonly element: HTMLDivElement;
  private readonly buttons = new Map<AtlasFilter, HTMLButtonElement>();
  private readonly countEl: HTMLSpanElement;
  private active: AtlasFilter = "all";

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
    expand.title = "Expand the topology to the full window (⌘G)";
    expand.setAttribute("aria-label", "Expand topology");
    expand.appendChild(expandGlyph());
    expand.addEventListener("click", () => callbacks.onExpand());

    this.element.append(eyebrow, group, this.countEl, expand);
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
