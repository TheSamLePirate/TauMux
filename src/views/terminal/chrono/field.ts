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
import { historyFor, isGap } from "../metrics-history";
import { withAlpha } from "../atlas/river";
import { toneVar } from "../atlas/view";
import type { ChronoEvent, ChronoEventKind } from "./event-log";
import type { ChronoLane } from "./lanes";
import type { FieldGeometry } from "./view";

/** The window, in ms. 90 s is what the rings hold. */
export const WINDOW_MS = 90_000;

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
        if (s.bytes > 0 && input.now - s.at <= WINDOW_MS) {
          moving = true;
          break;
        }
      }
    }
  }
  for (const event of input.events) {
    parts.push(`${event.at}:${event.kind}`);
    if (input.now - event.at <= WINDOW_MS) moving = true;
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

    this.drawAxis(ctx, width, height);
    const boxes = new Map(input.geometry.boxes.map((b) => [b.id, b]));
    for (const lane of input.lanes) {
      const box = boxes.get(lane.id);
      if (!box) continue;
      this.drawTrace(ctx, lane, box.top, box.height, width, input.now);
    }
    this.drawStrikes(ctx, input, width, height);
    return true;
  }

  /** The 30 s / 60 s rules. Structure, not data: hairlines, never
   *  animated, and drawn under everything. */
  private drawAxis(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.strokeStyle = this.resolve("var(--tau-edge-soft)");
    ctx.lineWidth = 1;
    for (const seconds of [30, 60]) {
      const x = Math.round(width * (1 - seconds / 90)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  /**
   * One lane's voice.
   *
   * Bars rather than a line: at one sample a second across ninety
   * seconds, a polyline reads as noise while bars read as a skyline —
   * and bars are what lets each sample carry its own age as colour,
   * which is the phosphor.
   */
  private drawTrace(
    ctx: CanvasRenderingContext2D,
    lane: ChronoLane,
    top: number,
    laneHeight: number,
    width: number,
    now: number,
  ): void {
    const base = top + laneHeight - BAND_PAD;
    const span = Math.max(1, laneHeight - BAND_PAD * 2);
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

    const barWidth = Math.max(2, width / (WINDOW_MS / 1000));
    const hot = this.resolve("var(--tau-chrono-trace-hot)");

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]!;
      const age = now - sample.at;
      if (age < 0 || age > WINDOW_MS) continue;
      const level = levelOf(sample.bytes);
      if (level <= 0) continue;

      const x = width * (1 - age / WINDOW_MS);
      const barHeight = Math.max(1, level * span);
      // A gap in collection is a gap in the trace, not a bar bridging it.
      const prev = samples[i - 1];
      const leading = age <= HOT_MS && !(prev && isGap(prev, sample));

      // Phosphor: the leading edge blooms near-white, and each sample
      // decays back through the lane's colour as it ages leftward.
      const decay = 1 - age / WINDOW_MS;
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
      if (leading) {
        ctx.shadowBlur = 0;
      }
    }
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
      if (age < 0 || age > WINDOW_MS) continue;
      const x = Math.round(width * (1 - age / WINDOW_MS)) + 0.5;
      const colour = this.resolve(strikeTone(event.kind));
      // Fades with age like everything else here, so a rule from eighty
      // seconds ago does not compete with one from two.
      const alpha = 0.24 + (1 - age / WINDOW_MS) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.strokeStyle = withAlpha(colour, alpha);
      ctx.lineWidth = 1;
      ctx.stroke();
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
