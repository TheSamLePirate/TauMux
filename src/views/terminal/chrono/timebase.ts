/**
 * The timebase.
 *
 * An oscilloscope does not have a zoom slider; it has a **timebase
 * knob** with detented stops — 1 s/div, 500 ms/div, 200 ms/div — and the
 * graticule re-divides to match. That is the right model here too, and
 * for the same reason: a continuously-variable window makes every
 * screenshot a different scale and every reading incomparable. Detents
 * mean "30 seconds" always looks like 30 seconds.
 *
 * So: a fixed ladder of spans, wheel and keyboard step between rungs,
 * and the division count is chosen per span so the graticule lines land
 * on numbers a human reads without arithmetic (5 s, 10 s, 30 s — never
 * 12.857 s).
 *
 * Everything here is pure. The window always ends at *now*: CHRONO is a
 * live instrument, not a log viewer, and a window that can drift off the
 * present would need a "return to now" affordance to undo a gesture
 * nobody asked for.
 */

/** The detents, in ms. Bounded above by what `metrics-history` holds —
 *  a rung that shows an empty field is a rung that lies. */
export const SPANS = [
  10_000, 20_000, 30_000, 60_000, 90_000, 180_000, 300_000,
] as const;

/** Where the knob sits on a fresh open. 90 s is the span the traces were
 *  designed against and the one the ruler was drawn for. */
export const DEFAULT_SPAN = 90_000;

/** Divisions drawn for each span, chosen so every graticule line lands
 *  on a round number of seconds. */
const DIVISIONS: Record<number, number> = {
  10_000: 5, // 2 s
  20_000: 4, // 5 s
  30_000: 6, // 5 s
  60_000: 6, // 10 s
  90_000: 6, // 15 s
  180_000: 6, // 30 s
  300_000: 5, // 60 s
};

export interface Timebase {
  /** Window length in ms. Always one of `SPANS`. */
  span: number;
}

export function defaultTimebase(): Timebase {
  return { span: DEFAULT_SPAN };
}

/**
 * Step the knob. `direction` is +1 to zoom *in* (a shorter window, more
 * detail) and −1 to zoom out. Clamps at both ends rather than wrapping:
 * a knob that jumps from 10 s to 5 minutes because you nudged it once
 * more is a knob you stop trusting.
 */
export function stepTimebase(current: Timebase, direction: number): Timebase {
  const index = SPANS.indexOf(current.span as (typeof SPANS)[number]);
  const from = index === -1 ? SPANS.indexOf(DEFAULT_SPAN) : index;
  const next = Math.max(
    0,
    Math.min(SPANS.length - 1, from - Math.sign(direction)),
  );
  return { span: SPANS[next] ?? DEFAULT_SPAN };
}

/** Division marks for a span, as seconds-before-now, largest first. The
 *  last entry is always 0 — *now*, the edge everything is measured from. */
export function divisions(span: number): number[] {
  const count = DIVISIONS[span] ?? 6;
  const step = span / count / 1000;
  const out: number[] = [];
  for (let i = count; i >= 0; i--) out.push(Math.round(i * step));
  return out;
}

export interface DivisionTick {
  /** Seconds before now. */
  seconds: number;
  label: string;
}

/**
 * The axis, labelled.
 *
 * One unit for the whole ruler, chosen from the *step* rather than from
 * each mark. Deciding per mark is what produces `90s 75s 1m 45s` — every
 * label individually shortest, the row as a whole unreadable. A ruler is
 * a sequence, and a sequence has one unit.
 */
export function divisionTicks(span: number): DivisionTick[] {
  const marks = divisions(span);
  const step = marks.length > 1 ? (marks[0] ?? 0) - (marks[1] ?? 0) : 0;
  const inMinutes = step > 0 && step % 60 === 0;
  return marks.map((seconds) => ({
    seconds,
    // The present is named, not numbered: `0m` is a coordinate, `now` is
    // the thing everything else on this axis is measured from.
    label:
      seconds === 0
        ? "now"
        : inMinutes
          ? `${seconds / 60}m`
          : `${seconds}s`,
  }));
}

/** How the knob's own readout is written — `90s`, `3m`. */
export function spanLabel(span: number): string {
  const seconds = Math.round(span / 1000);
  return seconds >= 60 && seconds % 60 === 0
    ? `${seconds / 60}m`
    : `${seconds}s`;
}

/** Fraction across the field (0 = left edge, 1 = *now*) for a moment. */
export function xFraction(at: number, now: number, span: number): number {
  if (span <= 0) return 1;
  return 1 - (now - at) / span;
}

/** Inverse of `xFraction` — the moment a point on the field refers to.
 *  This is what the cursor reads. */
export function timeAt(fraction: number, now: number, span: number): number {
  return now - (1 - fraction) * span;
}

/** True when `at` falls inside the window. */
export function inWindow(at: number, now: number, span: number): boolean {
  const age = now - at;
  return age >= 0 && age <= span;
}
