/**
 * Atlas inspector — the panel's answer surface.
 *
 * Atlas v1 pinned a passive info card to the bottom of the graph: you
 * could *see* that a session needed approval and could do nothing about
 * it without leaving the panel. The inspector replaces that card with a
 * readout plus the actions that belong to whatever is selected, so the
 * loop "spot it → understand it → clear it" closes inside the column.
 *
 * Selection follows hover for preview and click for commit — hover
 * restores to the committed selection on leave, so the card never
 * strands you on something you merely passed over.
 */
import type { AtlasAction, AtlasDetailRow, AtlasNode } from "./types";
import { toneVar } from "./view";
import { historyFor, isGap, peakCpu } from "../metrics-history";
import { formatCpu } from "./format";

/** Rows past this are folded away in the column; the expanded overlay
 *  lifts the cap. A card taller than a third of the panel stops being a
 *  detail view and starts being a second list. */
const COLUMN_ROW_CAP = 7;

export class AtlasInspector {
  readonly element: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly glyphEl: HTMLSpanElement;
  private readonly nameEl: HTMLSpanElement;
  private readonly stateEl: HTMLSpanElement;
  private readonly leadEl: HTMLDivElement;
  private readonly rowsEl: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;
  private readonly sparkEl: HTMLDivElement;
  private rowCap = COLUMN_ROW_CAP;
  private lastSignature = "";

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tau-atlas-inspector";
    this.element.setAttribute("aria-live", "polite");

    this.titleEl = document.createElement("div");
    this.titleEl.className = "tau-atlas-inspector-title";
    this.glyphEl = document.createElement("span");
    this.glyphEl.className = "tau-atlas-inspector-glyph";
    this.glyphEl.setAttribute("aria-hidden", "true");
    this.nameEl = document.createElement("span");
    this.nameEl.className = "tau-atlas-inspector-name";
    this.stateEl = document.createElement("span");
    this.stateEl.className = "tau-atlas-inspector-state";
    this.titleEl.append(this.glyphEl, this.nameEl, this.stateEl);

    this.leadEl = document.createElement("div");
    this.leadEl.className = "tau-atlas-inspector-lead";

    this.rowsEl = document.createElement("div");
    this.rowsEl.className = "tau-atlas-inspector-rows";

    this.actionsEl = document.createElement("div");
    this.actionsEl.className = "tau-atlas-inspector-actions";

    this.sparkEl = document.createElement("div");
    this.sparkEl.className = "tau-atlas-spark";

    this.element.append(
      this.titleEl,
      this.leadEl,
      this.sparkEl,
      this.rowsEl,
      this.actionsEl,
    );
  }

  setRowCap(cap: number): void {
    if (this.rowCap === cap) return;
    this.rowCap = cap;
    this.lastSignature = "";
  }

  /** Render `node`, or the empty state when null. */
  show(node: AtlasNode | null): void {
    const signature = node
      ? [
          node.id,
          node.label,
          node.sublabel,
          node.attention ?? "",
          node.tone,
          this.rowCap,
          node.detail
            .map((r) => `${r.label}${r.value}${r.meter ?? ""}`)
            .join("|"),
          node.actions.map((a) => a.id).join("|"),
          node.historyKey ? historyFor(node.historyKey).length : 0,
        ].join("§")
      : "§empty";
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    if (!node) {
      this.element.classList.add("is-empty");
      this.nameEl.textContent = "Nothing selected";
      this.stateEl.textContent = "";
      this.stateEl.className = "tau-atlas-inspector-state";
      this.leadEl.textContent = "Pick a node to inspect it.";
      this.rowsEl.replaceChildren();
      this.actionsEl.replaceChildren();
      return;
    }

    this.element.classList.remove("is-empty");
    this.element.style.setProperty("--node", node.color ?? toneVar(node.tone));
    this.glyphEl.dataset["kind"] =
      node.kind === "surface" && node.tone === "agent" ? "agent" : node.kind;
    this.nameEl.textContent = node.label;

    const state = stateLabel(node);
    this.stateEl.textContent = state.text;
    this.stateEl.className = `tau-atlas-inspector-state is-${state.tone}`;

    // The lead line is whatever the node is *doing* — the first detail
    // row is almost always the sentence a reader wants, and repeating it
    // in the table below would be dead weight.
    const [lead, ...rest] = node.detail;
    const leadIsSentence = !!lead && !lead.meter && lead.value.length > 18;
    this.leadEl.textContent = leadIsSentence ? lead.value : node.sublabel || "";
    this.leadEl.classList.toggle(
      "is-empty",
      this.leadEl.textContent.trim() === "",
    );

    this.renderSparkline(node);
    this.renderRows(leadIsSentence ? rest : node.detail);
    this.renderActions(node.actions);
  }

  /**
   * Last 90 seconds of CPU for this node.
   *
   * A live reading cannot distinguish "idle all morning" from "spiked
   * two seconds ago and finished". The trace can, and the peak label
   * says how high it went — which is usually the question you actually
   * had when you clicked.
   */
  private renderSparkline(node: AtlasNode): void {
    const key = node.historyKey;
    const samples = key ? historyFor(key) : [];
    if (!key || samples.length < 3) {
      this.sparkEl.replaceChildren();
      this.sparkEl.classList.add("is-empty");
      return;
    }
    this.sparkEl.classList.remove("is-empty");
    const peak = Math.max(peakCpu(key), 1);
    const W = 100;
    const H = 18;
    let d = "";
    samples.forEach((sample, i) => {
      const x = (i / (samples.length - 1)) * W;
      const y = H - Math.min(1, sample.cpu / peak) * (H - 1);
      const prev = samples[i - 1];
      d +=
        (i === 0 || (prev && isGap(prev, sample)) ? "M" : "L") +
        `${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "tau-atlas-spark-svg");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d.trim());
    path.setAttribute("fill", "none");
    svg.appendChild(path);

    const label = document.createElement("span");
    label.className = "tau-atlas-spark-label";
    label.textContent = `peak ${formatCpu(peak)}`;
    label.title = "Highest CPU seen in the last 90 seconds";

    this.sparkEl.replaceChildren(svg, label);
  }

  private renderRows(rows: AtlasDetailRow[]): void {
    const shown = rows.slice(0, this.rowCap);
    this.rowsEl.replaceChildren(
      ...shown.map((row) => {
        const el = document.createElement("div");
        el.className = "tau-atlas-inspector-row";
        const label = document.createElement("span");
        label.className = "tau-atlas-inspector-label";
        label.textContent = row.label;
        const value = document.createElement("span");
        value.className = "tau-atlas-inspector-value";
        if (row.tone) value.style.color = toneVar(row.tone);
        if (typeof row.meter === "number") {
          const bar = document.createElement("span");
          bar.className = "tau-atlas-inspector-bar";
          const fill = document.createElement("span");
          fill.style.width = `${Math.round(row.meter * 100)}%`;
          if (row.tone) fill.style.background = toneVar(row.tone);
          bar.appendChild(fill);
          value.append(bar, document.createTextNode(row.value));
        } else {
          value.textContent = row.value;
          value.title = row.value;
        }
        el.append(label, value);
        return el;
      }),
    );
    if (rows.length > shown.length) {
      const more = document.createElement("div");
      more.className = "tau-atlas-inspector-more";
      more.textContent = `+${rows.length - shown.length} more`;
      this.rowsEl.appendChild(more);
    }
  }

  private renderActions(actions: readonly AtlasAction[]): void {
    this.actionsEl.replaceChildren(
      ...actions.map((action) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `tau-atlas-action is-${action.kind}`;
        btn.textContent = action.label;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          action.run();
        });
        return btn;
      }),
    );
    this.actionsEl.classList.toggle("is-empty", actions.length === 0);
  }
}

function stateLabel(node: AtlasNode): {
  text: string;
  tone: "accent" | "agent" | "warn" | "err" | "ok" | "dim";
} {
  switch (node.attention) {
    case "approval":
      return { text: "needs approval", tone: "warn" };
    case "question":
      return { text: "asking you", tone: "warn" };
    case "input":
      return { text: "waiting for you", tone: "warn" };
    case "error":
      return { text: "error", tone: "err" };
    case "notify":
      return { text: "unread", tone: "accent" };
    default:
      break;
  }
  if (node.running) return { text: "running", tone: "ok" };
  if (node.active) return { text: "focused", tone: "accent" };
  return { text: node.kind, tone: "dim" };
}
