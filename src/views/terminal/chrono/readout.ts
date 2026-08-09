/**
 * The readout — what the cursor is pointing at.
 *
 * A scope's cursor is worth nothing without the box that says what it
 * has landed on. This is that box: park the pointer anywhere on the
 * field and it prints the moment under the crosshair and, for each lane,
 * what that lane was doing then.
 *
 * It replaces the ruler while the cursor is live rather than sitting
 * beside it, because both answer the same question — *where on the time
 * axis am I looking* — and two answers to one question is how a HUD
 * turns into noise. Let go of the field and the ruler comes back.
 *
 * Numbers are tabular and one size up from the labels around them. This
 * is the only place in CHRONO where a number is meant to be *read* rather
 * than scanned, and it should look like it.
 */
import { formatCpu } from "../atlas/format";
import type { MetricSample } from "../metrics-history";
import type { ChronoLane } from "./lanes";

export interface ReadoutRow {
  laneId: string;
  label: string;
  /** Identity colour, so a row is findable by the lane it belongs to. */
  color: string;
  /** Output rate at the cursor, already formatted. Empty when the lane
   *  was silent — silence is a reading, and `0 B/s` overstates it. */
  rate: string;
  cpu: string;
  /** Context percent, when the lane is an agent and reported one. */
  context: string;
}

/** `t−34.2s`, or `now` at the right edge. Signed and relative because
 *  the axis is: a wall-clock time here would make the reader do the
 *  subtraction the whole view exists to have already done. */
export function formatOffset(msBeforeNow: number): string {
  if (msBeforeNow < 250) return "now";
  const seconds = msBeforeNow / 1000;
  if (seconds < 10) return `t−${seconds.toFixed(1)}s`;
  if (seconds < 90) return `t−${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `t−${minutes}m${String(rest).padStart(2, "0")}s`;
}

/** Bytes/second, in the shortest honest form. Empty for silence. */
export function formatRate(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function buildReadout(
  lanes: readonly ChronoLane[],
  sampleFor: (lane: ChronoLane) => MetricSample | null,
  resolveColor: (lane: ChronoLane) => string,
): ReadoutRow[] {
  const rows: ReadoutRow[] = [];
  for (const lane of lanes) {
    const sample = sampleFor(lane);
    if (!sample) continue;
    rows.push({
      laneId: lane.id,
      label: lane.node.label,
      color: resolveColor(lane),
      rate: formatRate(sample.bytes),
      cpu: sample.cpu >= 1 ? formatCpu(sample.cpu) : "",
      context: sample.ctx === undefined ? "" : `${Math.round(sample.ctx)}% ctx`,
    });
  }
  return rows;
}

export class ChronoReadout {
  readonly element: HTMLDivElement;
  private readonly timeEl: HTMLSpanElement;
  private readonly rowsEl: HTMLDivElement;
  private signature = "";

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tau-chrono-readout";
    this.element.setAttribute("aria-live", "off");

    this.timeEl = document.createElement("span");
    this.timeEl.className = "tau-chrono-readout-time tau-mono";

    this.rowsEl = document.createElement("div");
    this.rowsEl.className = "tau-chrono-readout-rows";

    this.element.append(this.timeEl, this.rowsEl);
  }

  /** `null` puts the readout away and hands the ruler back. */
  render(offsetMs: number | null, rows: readonly ReadoutRow[]): void {
    const next =
      offsetMs === null
        ? "off"
        : `${Math.round(offsetMs / 100)}|` +
          rows
            .map((r) => `${r.laneId}:${r.rate}:${r.cpu}:${r.context}`)
            .join("|");
    if (next === this.signature) return;
    this.signature = next;

    this.element.classList.toggle("is-live", offsetMs !== null);
    if (offsetMs === null) {
      this.rowsEl.replaceChildren();
      this.timeEl.textContent = "";
      return;
    }

    this.timeEl.textContent = formatOffset(offsetMs);
    this.rowsEl.replaceChildren(
      ...rows.map((row) => {
        const el = document.createElement("span");
        el.className = "tau-chrono-readout-row tau-mono";
        el.style.setProperty("--lane", row.color);

        const dot = document.createElement("span");
        dot.className = "tau-chrono-readout-dot";
        const name = document.createElement("span");
        name.className = "tau-chrono-readout-name";
        name.textContent = row.label;
        el.append(dot, name);

        for (const value of [row.rate, row.cpu, row.context]) {
          if (!value) continue;
          const v = document.createElement("span");
          v.className = "tau-chrono-readout-value";
          v.textContent = value;
          el.appendChild(v);
        }
        return el;
      }),
    );
  }
}
