/**
 * The gutter — the field's channel strip.
 *
 * Everything a lane *is*, as opposed to what it has been doing: the
 * workspace it belongs to, its name, and the satellites that were tree
 * children in the Atlas column — ports, pid, CPU, context, cost, plan
 * progress.
 *
 * Workspaces are brackets here rather than boxes drawn around lanes,
 * because the field has to stay one continuous time space: a box around
 * two lanes would imply those two share an axis the others don't, and
 * they all share the same one.
 *
 * The row is a real `<button role="option">` inside the view's listbox,
 * so the field is navigable by keyboard and legible to assistive tech.
 * The head sits *outside* it — a terminal nested inside a control would
 * put the whole pane in the tab order and swallow its keys.
 */
import type { AtlasBadge } from "../atlas/types";
import { toneVar } from "../atlas/view";
import type { ChronoLane } from "./lanes";

/** Satellites past this stop being a glance and start being a list. */
const MAX_SATELLITES = 5;

export interface ChronoGutterRowCallbacks {
  onSelect(id: string): void;
  onActivate(id: string): void;
  onHover(id: string): void;
}

export class ChronoGutterRow {
  readonly element: HTMLButtonElement;
  private readonly bracket: HTMLSpanElement;
  private readonly workspaceEl: HTMLSpanElement;
  private readonly nameEl: HTMLSpanElement;
  private readonly subEl: HTMLSpanElement;
  private readonly satsEl: HTMLSpanElement;
  private signature = "";

  constructor(
    private readonly id: string,
    callbacks: ChronoGutterRowCallbacks,
  ) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "tau-chrono-gutter";
    this.element.setAttribute("role", "option");
    this.element.dataset["laneId"] = id;

    this.bracket = document.createElement("span");
    this.bracket.className = "tau-chrono-bracket";
    this.bracket.setAttribute("aria-hidden", "true");

    this.workspaceEl = document.createElement("span");
    this.workspaceEl.className = "tau-chrono-workspace tau-mono";

    this.nameEl = document.createElement("span");
    this.nameEl.className = "tau-chrono-name tau-mono";

    this.subEl = document.createElement("span");
    this.subEl.className = "tau-chrono-sub tau-mono";

    this.satsEl = document.createElement("span");
    this.satsEl.className = "tau-chrono-sats";

    const body = document.createElement("span");
    body.className = "tau-chrono-gutter-body";
    body.append(this.workspaceEl, this.nameEl, this.subEl, this.satsEl);
    this.element.append(this.bracket, body);

    this.element.addEventListener("click", () => callbacks.onSelect(this.id));
    this.element.addEventListener("pointerenter", () =>
      callbacks.onHover(this.id),
    );
    this.element.addEventListener("focus", () => callbacks.onHover(this.id));
    this.element.addEventListener("dblclick", () =>
      callbacks.onActivate(this.id),
    );
  }

  destroy(): void {
    this.element.remove();
  }

  render(lane: ChronoLane): void {
    const sats = satelliteChips(lane);
    const next = [
      lane.workspaceHead ? lane.workspaceName : "",
      lane.workspaceTail ? "tail" : "",
      lane.node.label,
      lane.node.sublabel,
      lane.node.tone,
      lane.node.color ?? "",
      lane.node.attention ?? "",
      lane.node.running ? "1" : "0",
      sats.map((s) => `${s.text}:${s.tone}:${s.color ?? ""}`).join("|"),
      planSteps(lane)
        .map((s) => s.state)
        .join(""),
    ].join("§");
    if (next === this.signature) return;
    this.signature = next;

    this.element.classList.toggle("is-workspace-head", lane.workspaceHead);
    this.element.classList.toggle("is-workspace-tail", lane.workspaceTail);
    this.element.classList.toggle("is-running", lane.node.running);
    if (lane.node.attention) {
      this.element.dataset["attention"] = lane.node.attention;
    } else {
      delete this.element.dataset["attention"];
    }

    this.workspaceEl.textContent = lane.workspaceHead ? lane.workspaceName : "";
    this.workspaceEl.classList.toggle("is-empty", !lane.workspaceHead);
    this.nameEl.textContent = lane.node.label;
    this.nameEl.title = lane.node.label;
    this.subEl.textContent = lane.node.sublabel;
    this.subEl.title = lane.node.sublabel;
    this.subEl.classList.toggle("is-empty", lane.node.sublabel === "");

    const steps = planSteps(lane);
    this.satsEl.replaceChildren(
      ...(steps.length > 0 ? [buildPlanBar(steps)] : []),
      ...sats.map(chip),
    );
    this.satsEl.classList.toggle(
      "is-empty",
      sats.length === 0 && steps.length === 0,
    );

    this.element.setAttribute("aria-label", describe(lane, sats));
  }

  setSelected(selected: boolean): void {
    this.element.classList.toggle("is-selected", selected);
    this.element.setAttribute("aria-selected", String(selected));
    this.element.tabIndex = selected ? 0 : -1;
  }
}

/**
 * The lane's satellites, flattened to chips.
 *
 * The pane's own badges come first — they are the answer to "what is
 * this doing" — then the ports it listens on and the shape of the work
 * hanging off it. Anything beyond the cap is summarised rather than
 * dropped silently, so a lane never lies about how much it is carrying.
 */
export function satelliteChips(lane: ChronoLane): AtlasBadge[] {
  const out: AtlasBadge[] = [...lane.node.badges];
  let subagents = 0;
  let processes = 0;

  for (const sat of lane.satellites) {
    switch (sat.kind) {
      case "port":
        out.push({
          text: sat.label,
          tone: "ok",
          title: `Listening — ${sat.sublabel}`,
        });
        break;
      case "subagent":
        subagents += 1;
        break;
      case "process":
        processes += 1;
        break;
      default:
        break;
    }
  }

  if (subagents > 0) {
    out.push({
      text: `${subagents}·sub`,
      tone: "agent",
      title: `${subagents} live subagent${subagents === 1 ? "" : "s"}`,
    });
  }
  if (processes > 0) {
    out.push({
      text: `${processes}·proc`,
      tone: "dim",
      title: `${processes} child process${processes === 1 ? "" : "es"}`,
    });
  }

  if (out.length <= MAX_SATELLITES) return out;
  const shown = out.slice(0, MAX_SATELLITES - 1);
  shown.push({
    text: `+${out.length - shown.length}`,
    tone: "dim",
    title: "More detail in the inspector",
  });
  return shown;
}

/**
 * The lane's plan, as a segmented bar.
 *
 * `plan 3/5` is a *count* of a thing that has a shape, and the shape is
 * the part worth seeing: which steps are done, which one is running, and
 * whether anything failed. Five cells say all three at a glance and take
 * less room than the words did.
 *
 * No time axis here on purpose. A plan step carries no timestamp of its
 * own — only the plan does — so placing steps along the field would be
 * inventing moments, which is the one thing this view must never do.
 */
export function planSteps(lane: ChronoLane): { state: string; title: string }[] {
  const out: { state: string; title: string }[] = [];
  for (const sat of lane.satellites) {
    if (sat.kind !== "plan-step" && sat.kind !== "task") continue;
    out.push({
      state:
        sat.tone === "ok"
          ? "done"
          : sat.tone === "err"
            ? "err"
            : sat.running
              ? "active"
              : "waiting",
      title: sat.label,
    });
  }
  return out;
}

function buildPlanBar(
  steps: readonly { state: string; title: string }[],
): HTMLSpanElement {
  const bar = document.createElement("span");
  bar.className = "tau-chrono-plan";
  const done = steps.filter((s) => s.state === "done").length;
  bar.title = `${done} of ${steps.length} steps done`;
  bar.setAttribute("aria-label", bar.title);
  // Past a dozen the cells stop being distinguishable and the bar starts
  // lying about proportion; the count in the title stays honest.
  for (const step of steps.slice(0, 12)) {
    const cell = document.createElement("span");
    cell.className = `tau-chrono-plan-step is-${step.state}`;
    cell.title = step.title;
    bar.appendChild(cell);
  }
  return bar;
}

function chip(badge: AtlasBadge): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "tau-chrono-sat tau-mono";
  el.textContent = badge.text;
  if (badge.color) el.style.color = badge.color;
  else el.style.color = toneVar(badge.tone);
  if (badge.title) el.title = badge.title;
  return el;
}

/** One sentence a screen reader can read instead of a row of glyphs. */
function describe(lane: ChronoLane, sats: readonly AtlasBadge[]): string {
  const state = lane.node.attention
    ? lane.node.attention
    : lane.node.running
      ? "running"
      : "idle";
  const parts = [
    lane.node.label,
    `in ${lane.workspaceName}`,
    state,
    ...sats.map((s) => s.title ?? s.text),
  ];
  return parts.filter(Boolean).join(", ");
}

/** Nothing at all in the field — no workspaces, no sessions. */
export function buildEmptyState(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "tau-chrono-empty tau-mono";
  el.textContent = "no panes";
  return el;
}
