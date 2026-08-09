/**
 * Activity river — the last 90 seconds, under the header.
 *
 * The graph is a snapshot: it says what is true *now* and nothing about
 * how it got there. A pane that pinned a core three seconds ago and is
 * idle again is drawn exactly like one that has slept all morning. The
 * river is the missing axis — a stacked area of per-workspace output
 * over the recent past, with the aggregate CPU traced over it.
 *
 * It reads the same `metrics-history` rings the inspector's sparklines
 * use, so it costs one extra pass over data already collected. Drawn to
 * a `<canvas>` rather than SVG: this is ~90 samples × N workspaces of
 * pure fill, redrawn on every telemetry tick, and it carries no text,
 * no hit-testing beyond a band lookup, and nothing that needs to be in
 * the tab order.
 */
import { historyFor, isGap, type MetricSample } from "../metrics-history";
import { atlasMarks } from "../atlas-annotation-store";
import type { AtlasRiverSeries } from "./types";

const HEIGHT = 34;

/** The river's window, in samples (~seconds). Pinned rather than taken
 *  from the ring's capacity: the ring grew to five minutes for CHRONO's
 *  adjustable timebase, and 300 s of history squeezed into a 34 px strip
 *  under the header would be a different, worse instrument. The river's
 *  caption says 90 s and the river shows 90 s. */
const RIVER_SPAN = 90;
/** Bytes/sec that fills the band. Above this the area saturates — the
 *  point is the shape of the activity, not an exact reading. */
const SATURATION = 262_144;

/** Colour of a lane with nothing in it. Structure, not data — see the
 *  note where it is drawn. */
const REST_LANE = "rgba(255, 255, 255, 0.07)";

/** Milestone tick colours. Resolved literals rather than tokens because
 *  canvas cannot read CSS variables; they mirror the TAU state palette. */
function markColour(tone: string | undefined): string {
  if (tone === "ok") return "rgba(140, 233, 154, 0.75)";
  if (tone === "warn") return "rgba(255, 197, 107, 0.75)";
  if (tone === "err") return "rgba(255, 138, 138, 0.8)";
  return "rgba(111, 233, 255, 0.6)";
}

export interface AtlasRiverCallbacks {
  onPick(seriesId: string): void;
}

export class AtlasRiver {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLSpanElement;
  private series: AtlasRiverSeries[] = [];
  private lastSignature = "";

  constructor(callbacks: AtlasRiverCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "tau-atlas-river";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "tau-atlas-river-canvas";
    this.canvas.setAttribute("aria-hidden", "true");

    this.caption = document.createElement("span");
    this.caption.className = "tau-atlas-river-caption";

    this.element.append(this.canvas, this.caption);

    // Clicking a band goes to the workspace that produced it. The x axis
    // is time, so the meaningful pick is which *stripe* you clicked, and
    // the stripes are ordered exactly like the graph's workspaces.
    this.element.addEventListener("click", (e) => {
      if (this.series.length === 0) return;
      const rect = this.element.getBoundingClientRect();
      const frac = (e.clientY - rect.top) / Math.max(rect.height, 1);
      const idx = Math.min(
        this.series.length - 1,
        Math.max(0, Math.floor(frac * this.series.length)),
      );
      const picked = this.series[idx];
      if (picked) callbacks.onPick(picked.id);
    });
  }

  destroy(): void {
    this.element.remove();
  }

  /**
   * Redraw. `resolve` turns a CSS custom property or var() reference
   * into a concrete colour — canvas cannot read `var(--tau-…)`, so the
   * caller supplies a resolver bound to the live computed style.
   */
  render(
    series: AtlasRiverSeries[],
    resolve: (color: string) => string,
    totalCpu: number,
  ): void {
    this.series = series;
    const width = this.element.clientWidth;
    if (width <= 0) return;

    const signature =
      series.map((s) => s.id).join("|") +
      `#${width}#${Math.round(totalCpu)}#` +
      series.map((s) => historyFor(s.id).length).join(",");
    // The newest sample changes on every tick, so a pure structural
    // signature would never invalidate. Include the leading edge.
    const edge = series
      .map((s) => {
        const h = historyFor(s.id);
        const last = h[h.length - 1];
        return last ? Math.round(last.bytes) : 0;
      })
      .join(",");
    if (this.lastSignature === signature + edge) return;
    this.lastSignature = signature + edge;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${HEIGHT}px`;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const band = HEIGHT / Math.max(series.length, 1);

    // Adaptive window: until the rings fill, scale to the history we
    // actually have. Pinning to the full 90-sample capacity leaves three
    // quarters of the strip empty on a fresh launch, which reads as a
    // broken widget rather than as a young one. "Now" stays at the right
    // edge either way.
    let span = 2;
    for (const s of series) {
      span = Math.max(span, historyFor(s.id).length);
    }
    span = Math.min(span, RIVER_SPAN);
    const colX = (i: number) => (i / (span - 1)) * width;

    let anyActivity = false;
    series.forEach((s, bandIndex) => {
      const top = bandIndex * band;
      const colour = resolve(s.color);

      // Every workspace gets a lane, drawn at rest even with no data — a
      // missing lane is indistinguishable from a missing workspace.
      //
      // The lane is deliberately NEUTRAL, not the workspace's colour.
      // Colour here means "this workspace produced output"; that a
      // workspace *exists* is already the graph's job to say. Painting
      // three saturated rules for three idle workspaces made an empty
      // river the loudest thing in the panel.
      ctx.beginPath();
      // Inset so the bottom lane isn't clipped by the canvas edge.
      const laneY = Math.min(HEIGHT - 0.5, top + band - 0.5);
      ctx.moveTo(0, laneY);
      ctx.lineTo(width, laneY);
      ctx.strokeStyle = REST_LANE;
      ctx.lineWidth = 1;
      ctx.stroke();

      const samples = historyFor(s.id);
      if (samples.length < 2) return;
      // Offset so the newest sample sits flush against the right edge —
      // a partially-filled ring must not read as "activity stopped".
      const offset = span - samples.length;

      ctx.beginPath();
      let open = false;
      let peakLevel = 0;
      samples.forEach((sample: MetricSample, i) => {
        const x = colX(offset + i);
        const level = Math.min(1, sample.bytes / SATURATION);
        if (level > peakLevel) peakLevel = level;
        if (level > 0.002) anyActivity = true;
        const y = top + band - level * (band - 1);
        const prev = samples[i - 1];
        if (!open || (prev && isGap(prev, sample))) {
          // A collection gap is drawn as a gap, not bridged by a line
          // that implies data nobody recorded.
          if (open) {
            ctx.lineTo(colX(offset + i - 1), top + band);
            ctx.closePath();
          }
          ctx.moveTo(x, top + band);
          open = true;
        }
        ctx.lineTo(x, y);
      });
      if (open) {
        ctx.lineTo(colX(offset + samples.length - 1), top + band);
        ctx.closePath();
      }
      const grad = ctx.createLinearGradient(0, top, 0, top + band);
      grad.addColorStop(0, withAlpha(colour, 0.55));
      grad.addColorStop(1, withAlpha(colour, 0.06));
      ctx.fillStyle = grad;
      ctx.fill();

      // A silent series' area collapses flat onto its own lane, so a
      // fixed-alpha outline would paint a saturated rule exactly where
      // the quiet hairline belongs — louder than the thing it sits on.
      // Fade the outline with the window's peak instead.
      if (peakLevel > 0.01) {
        ctx.strokeStyle = withAlpha(colour, 0.2 + peakLevel * 0.55);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    });

    // Agent-authored milestones (`ht atlas mark`) as ticks on the time
    // axis. The river already carries "how loud"; these carry "and this
    // is when the thing you cared about happened".
    const now = Date.now();
    const windowMs = span * 1000;
    for (const mark of atlasMarks()) {
      const age = now - mark.at;
      if (age < 0 || age > windowMs) continue;
      const x = Math.round(width * (1 - age / windowMs)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
      ctx.strokeStyle = markColour(mark.tone);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    this.caption.textContent = anyActivity ? "" : "quiet";
    this.element.classList.toggle("is-quiet", !anyActivity);
  }
}

/**
 * Apply alpha to a resolved colour. Handles `#rgb` / `#rrggbb` and
 * `rgb()/rgba()`; anything else is returned untouched, which degrades to
 * a fully-opaque band rather than an invisible one.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : hex.slice(0, 6);
    if (full.length !== 6) return c;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return c;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1]!.split(",").map((x) => x.trim());
    const [r, g, b] = parts;
    if (r && g && b) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return c;
}
