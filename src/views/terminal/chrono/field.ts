/**
 * The field — traces and strikes.
 *
 * Two channels on one canvas, sharing one x axis:
 *
 *  - **The trace** is the pane's own voice. Drawn from the real byte-rate
 *    ring with phosphor persistence: the leading edge blooms near-white
 *    and each sample decays back through the lane's identity colour as it
 *    ages leftward. A pane that has been silent draws a flat hairline; a
 *    pane running `bun test` draws a skyline.
 *  - **The strike** is what happened. Because every lane shares one x
 *    axis, an approval landing at t−40 s is a single rule crossing all
 *    the traces, and you can see which panes went quiet and which woke up
 *    when it did. Causality becomes visible geometry.
 *
 * ## Redraw only when the image would differ
 *
 * "Everything is data" has a sharp consequence for a time axis: time
 * always advances, so a naïve implementation repaints forever. The
 * resolution is `fieldSignature` — every input that can change a pixel,
 * folded into one string. A silent system's trace is a flat line whose
 * shift is indistinguishable from itself, so its signature does not move
 * and nothing repaints.
 *
 * The one subtlety: while there *is* a skyline in the window, the image
 * genuinely does change every frame as it scrolls left, so the signature
 * carries a coarse clock — but only then. Ninety seconds after the last
 * byte, the window is empty again and the field goes completely still.
 */
import { historyFor, isGap, type MetricSample } from "../metrics-history";
import { withAlpha } from "../atlas/river";
import { toneVar } from "../atlas/view";
import type { ChronoEvent, ChronoEventKind } from "./event-log";
import type { ChronoLane } from "./lanes";
import { DEFAULT_SPAN, divisions } from "./timebase";
import type { FieldGeometry } from "./view";

/** The window the field falls back to when nobody has set a timebase.
 *  Kept as `WINDOW_MS` because it is also the event log's horizon. */
export const WINDOW_MS = DEFAULT_SPAN;

/** Bytes/sec at which a trace reaches full height. Log-scaled below it —
 *  a linear scale puts a 2 KB/s log tail and total silence in the same
 *  pixel, which loses the distinction the trace exists to draw. */
const SATURATION = 262_144;

/** Rate below which the scale starts. */
const FLOOR = 512;

/** Vertical inset inside a lane's band, so a full-height trace does not
 *  touch its neighbours. */
const BAND_PAD = 6;

/** Samples this close to `now` are the leading edge and bloom. */
const HOT_MS = 1_600;

/** Coarse clock granularity for the signature while the window has
 *  something in it. 4 Hz is smooth for a trace scrolling at ~8 px/s. */
const CLOCK_MS = 250;

export interface FieldInput {
  lanes: readonly ChronoLane[];
  geometry: FieldGeometry;
  events: readonly ChronoEvent[];
  now: number;
  /** Window length in ms, from the timebase knob. */
  span: number;
  /** Where the cursor is, as a fraction across the field, or null when
   *  the pointer is not over it. */
  cursor: number | null;
}

/**
 * Everything that can change a pixel, as one string.
 *
 * Deliberately *not* including `now` on its own: an idle field's clock
 * advances every frame and the image does not.
 */
export function fieldSignature(input: FieldInput): string {
  const { geometry } = input;
  const parts: string[] = [
    `${Math.round(geometry.left)}x${Math.round(geometry.width)}x${Math.round(geometry.height)}`,
    `span${input.span}`,
    `cur${input.cursor === null ? "-" : Math.round(input.cursor * 1000)}`,
  ];
  let moving = false;
  for (const box of geometry.boxes) {
    parts.push(`${box.id}@${box.top}+${box.height}`);
  }
  for (const lane of input.lanes) {
    const samples = historyFor(lane.historyKey);
    const last = samples[samples.length - 1];
    parts.push(
      `${lane.id}:${lane.node.color ?? lane.node.tone}:${samples.length}:${
        last ? Math.round(last.bytes) : 0
      }`,
    );
    // Something is in the window, so the picture scrolls.
    if (!moving) {
      for (const s of samples) {
        if (s.bytes > 0 && input.now - s.at <= input.span) {
          moving = true;
          break;
        }
      }
    }
  }
  for (const event of input.events) {
    parts.push(`${event.at}:${event.kind}`);
    if (input.now - event.at <= input.span) moving = true;
  }
  parts.push(moving ? String(Math.floor(input.now / CLOCK_MS)) : "still");
  return parts.join("|");
}

/** True when anything inside the window is still moving leftward, and the
 *  field therefore owes the user another frame. */
export function fieldIsMoving(input: FieldInput): boolean {
  return fieldSignature(input).endsWith("|still") === false;
}

export class ChronoField {
  private lastSignature = "";
  private readonly colors = new Map<string, string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Scratch element used to resolve `var(--tau-…)`; canvas cannot. */
    private readonly probeHost: HTMLElement,
  ) {}

  /** Force the next `render` to paint — after a theme change, say. */
  invalidate(): void {
    this.lastSignature = "";
    this.colors.clear();
  }

  /**
   * Draw. Returns true when it painted, false when the image would have
   * been identical to the one already on screen.
   */
  render(input: FieldInput): boolean {
    const signature = fieldSignature(input);
    if (signature === this.lastSignature) return false;
    this.lastSignature = signature;

    const { width, height } = input.geometry;
    if (width <= 0 || height <= 0) return false;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    this.drawGraticule(ctx, width, height, input.span);
    const boxes = new Map(input.geometry.boxes.map((b) => [b.id, b]));
    for (const lane of input.lanes) {
      const box = boxes.get(lane.id);
      if (!box) continue;
      this.drawTrace(ctx, lane, box, width, input.now, input.span);
    }
    this.drawStrikes(ctx, input, width, height);
    this.drawCursor(ctx, input, width, height);
    return true;
  }

  /**
   * The graticule — the calibration grid.
   *
   * Structure, not data: hairlines, never animated, drawn under
   * everything. It re-divides with the timebase, so every line always
   * lands on a round number of seconds and the field stays a *measured*
   * space rather than a picture of one.
   */
  private drawGraticule(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    span: number,
  ): void {
    ctx.strokeStyle = this.resolve("var(--tau-chrono-graticule)");
    ctx.lineWidth = 1;
    for (const seconds of divisions(span)) {
      if (seconds === 0) continue;
      const x = Math.round(width * (1 - (seconds * 1000) / span)) + 0.5;
      if (x < 0 || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  /**
   * One lane's voice, and — for an agent lane — how full its head is.
   *
   * Bars rather than a polyline: at one sample a second a line reads as
   * noise while bars read as a skyline, and a bar can carry its own age
   * as colour, which is what the phosphor *is*.
   *
   * The context ribbon rides over the top of the same band as a thin
   * filled curve in the agent amber. It is a different quantity on a
   * different scale, so it gets a different mark and a different colour
   * — the one thing it must never do is look like output.
   */
  private drawTrace(
    ctx: CanvasRenderingContext2D,
    lane: ChronoLane,
    box: { top: number; height: number },
    width: number,
    now: number,
    span: number,
  ): void {
    const base = box.top + box.height - BAND_PAD;
    const band = Math.max(1, box.height - BAND_PAD * 2);
    const colour = this.resolve(lane.node.color ?? toneVar(lane.node.tone));
    const samples = historyFor(lane.historyKey);

    // A silent pane is a flat hairline — present, and unmistakably at
    // rest. Absence of a lane would be indistinguishable from absence of
    // a pane.
    ctx.beginPath();
    ctx.moveTo(0, base + 0.5);
    ctx.lineTo(width, base + 0.5);
    ctx.strokeStyle = withAlpha(colour, 0.2);
    ctx.lineWidth = 1;
    ctx.stroke();

    if (samples.length === 0) return;

    // One bar per sample, sized from the *window* rather than a fixed
    // count: zoom in and the bars widen, which is what makes zooming
    // feel like a timebase and not like a stretched image.
    const barWidth = Math.max(1.5, width / (span / 1000));
    const hot = this.resolve("var(--tau-chrono-trace-hot)");

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]!;
      const age = now - sample.at;
      if (age < 0 || age > span) continue;
      const level = levelOf(sample.bytes);
      if (level <= 0) continue;

      const x = width * (1 - age / span);
      const barHeight = Math.max(1, level * band);
      // A gap in collection is a gap in the trace, not a bar bridging it.
      const prev = samples[i - 1];
      const leading = age <= HOT_MS && !(prev && isGap(prev, sample));

      // Phosphor: the leading edge blooms near-white, and each sample
      // decays back through the lane's colour as it ages leftward.
      const decay = 1 - age / span;
      if (leading) {
        ctx.fillStyle = withAlpha(hot, 0.92);
        ctx.shadowColor = withAlpha(colour, 0.85);
        ctx.shadowBlur = 9;
      } else {
        ctx.fillStyle = withAlpha(colour, 0.18 + decay * 0.62);
      }
      ctx.fillRect(
        Math.round(x - barWidth),
        Math.round(base - barHeight),
        Math.ceil(barWidth),
        Math.round(barHeight),
      );
      if (leading) ctx.shadowBlur = 0;
    }

    this.drawContext(ctx, samples, base, band, width, now, span);
  }

  /**
   * The context ribbon — how full the agent's window is, over time.
   *
   * Only drawn where the number exists, which is agent lanes. A curve
   * rather than bars, in amber rather than the lane's colour, riding the
   * band's full height: it is a *level*, not a rate, and the two must
   * never be mistaken for each other at a glance.
   */
  private drawContext(
    ctx: CanvasRenderingContext2D,
    samples: readonly { at: number; ctx?: number }[],
    base: number,
    band: number,
    width: number,
    now: number,
    span: number,
  ): void {
    const points: { x: number; y: number }[] = [];
    for (const sample of samples) {
      const pct = sample.ctx;
      if (pct === undefined || pct === null) continue;
      const age = now - sample.at;
      if (age < 0 || age > span) continue;
      points.push({
        x: width * (1 - age / span),
        y: base - Math.min(1, pct / 100) * band,
      });
    }
    if (points.length < 2) return;

    const amber = this.resolve("var(--tau-agent)");
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i]!.x, points[i]!.y);
    }
    ctx.strokeStyle = withAlpha(amber, 0.7);
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // A whisper of fill under it, so the ribbon reads as a level rather
    // than as one more line crossing the field.
    ctx.lineTo(points[points.length - 1]!.x, base);
    ctx.lineTo(points[0]!.x, base);
    ctx.closePath();
    ctx.fillStyle = withAlpha(amber, 0.07);
    ctx.fill();
  }

  /**
   * The vertical rules. Full canvas height by construction — a strike
   * that stopped at its own lane would say "this happened here", and the
   * point is that it happened *to everything*.
   */
  private drawStrikes(
    ctx: CanvasRenderingContext2D,
    input: FieldInput,
    width: number,
    height: number,
  ): void {
    for (const event of input.events) {
      const age = input.now - event.at;
      if (age < 0 || age > input.span) continue;
      const x = Math.round(width * (1 - age / input.span)) + 0.5;
      const colour = this.resolve(strikeTone(event.kind));
      // Fades with age like everything else here, so a rule from the far
      // side of the window does not compete with one from two seconds ago.
      const alpha = 0.24 + (1 - age / input.span) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.strokeStyle = withAlpha(colour, alpha);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * The cursor.
   *
   * A scope's cursor is a hairline you park on the waveform to read a
   * value off it, and that is exactly the gesture this view was missing:
   * the traces show *shape*, and shape without a readable value is a
   * picture. The rule is drawn full height so it can be read against
   * every lane at once — the same reason the strikes are.
   *
   * Brighter than a strike and thinner than a division, so at a glance it
   * is never mistaken for either: it is the one line on this field that
   * the *user* put there.
   */
  private drawCursor(
    ctx: CanvasRenderingContext2D,
    input: FieldInput,
    width: number,
    height: number,
  ): void {
    if (input.cursor === null) return;
    const x = Math.round(width * input.cursor) + 0.5;
    if (x < 0 || x > width) return;
    const colour = this.resolve("var(--tau-chrono-cursor)");

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.strokeStyle = withAlpha(colour, 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();

    // A dot where the cursor crosses each lane's sample, so the readout
    // in the rail has something to point at.
    const boxes = new Map(input.geometry.boxes.map((b) => [b.id, b]));
    for (const lane of input.lanes) {
      const box = boxes.get(lane.id);
      if (!box) continue;
      const sample = sampleAt(lane.historyKey, input.cursor, input.now, input.span);
      if (!sample) continue;
      const base = box.top + box.height - BAND_PAD;
      const band = Math.max(1, box.height - BAND_PAD * 2);
      const y = base - levelOf(sample.bytes) * band;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(colour, 0.9);
      ctx.fill();
    }
  }

  /** Canvas cannot read `var(--tau-…)`. Resolve through a scratch element
   *  once per distinct value and cache — the palette is tiny and stable. */
  private resolve(color: string): string {
    if (!color.startsWith("var(")) return color;
    const cached = this.colors.get(color);
    if (cached) return cached;
    const probe = document.createElement("span");
    probe.style.color = color;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    this.probeHost.appendChild(probe);
    const resolved = getComputedStyle(probe).color || color;
    probe.remove();
    this.colors.set(color, resolved);
    return resolved;
  }
}

/**
 * Bytes/second → 0…1, log-scaled.
 *
 * Exported because the scale is a design decision worth pinning: a
 * linear one puts a 2 KB/s log tail and total silence in the same pixel,
 * and the whole point of the trace is that those are different.
 */
export function levelOf(bytes: number): number {
  if (bytes <= 0) return 0;
  const level = Math.log1p(bytes / FLOOR) / Math.log1p(SATURATION / FLOOR);
  return Math.min(1, Math.max(0, level));
}

/** Colour role for a strike. The state palette, unchanged. */
export function strikeTone(kind: ChronoEventKind): string {
  switch (kind) {
    case "approval":
    case "question":
      return "var(--tau-warn)";
    case "error":
      return "var(--tau-err)";
    case "turn":
      return "var(--tau-agent)";
    case "notify":
      return "var(--tau-cyan)";
    default:
      return "var(--tau-chrono-strike)";
  }
}

/**
 * The sample a point on the field refers to — the nearest one in time,
 * not the one before it. A cursor that snapped backwards would read
 * "nothing here" for the half-second either side of every bar.
 *
 * Returns null when the nearest sample is further away than one
 * division's worth of time, so parking the cursor over a genuinely empty
 * stretch reads as empty rather than as the last thing that happened.
 */
export function sampleAt(
  historyKey: string,
  fraction: number,
  now: number,
  span: number,
): MetricSample | null {
  const target = now - (1 - fraction) * span;
  const samples = historyFor(historyKey);
  let best: MetricSample | null = null;
  let bestDelta = Infinity;
  for (const sample of samples) {
    const delta = Math.abs(sample.at - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = sample;
    }
  }
  // One sample is ~1 s; allow a little either side so the cursor feels
  // magnetic rather than fussy.
  return bestDelta <= 1_500 ? best : null;
}
