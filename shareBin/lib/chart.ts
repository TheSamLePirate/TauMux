/**
 * Pure SVG chart renderer for shareBin's `show_chart`.
 *
 * Renders three chart kinds — `line`, `bar`, `scatter` — over a
 * shared coordinate system. Inputs:
 *
 *   - rows:   string[][]              parsed CSV / TSV
 *   - xCol:   number                  column index for the x axis
 *   - yCols:  number[]                column indices for series y values
 *   - kind:   "line" | "bar" | "scatter"
 *   - width / height in pixels
 *   - hasHeader: when true, row[0] supplies axis + legend labels
 *
 * Output: a single SVG string with axes, ticks, legend, and the
 * series geometry. Pure: no DOM, no animation, deterministic.
 *
 * The point of the lib being pure is hermetic tests — `renderChart`
 * is unit-tested for axis math, tick selection, and series
 * placement without spinning a renderer.
 */

import { escapeHtml } from "./escape";

export type ChartKind = "line" | "bar" | "scatter";

export interface ChartOptions {
  kind: ChartKind;
  xCol: number;
  yCols: number[];
  hasHeader?: boolean;
  width?: number;
  height?: number;
  /** Plotted background (under axes). */
  background?: string;
  /** Series colours; cycles when more series than colours. */
  palette?: string[];
  /** Optional title rendered above the plot area. */
  title?: string;
}

interface Series {
  label: string;
  values: number[];
  color: string;
}

const DEFAULT_PALETTE = [
  "#66c0f4",
  "#a6e3a1",
  "#fab387",
  "#f5c2e7",
  "#cba6f7",
  "#94e2d5",
  "#f9e2af",
  "#eba0ac",
];

const PADDING = { top: 28, right: 24, bottom: 36, left: 56 };

export function renderChart(rows: string[][], opts: ChartOptions): string {
  const width = opts.width ?? 720;
  const height = opts.height ?? 360;
  const hasHeader = opts.hasHeader ?? true;
  const palette = opts.palette ?? DEFAULT_PALETTE;
  const background = opts.background ?? "transparent";
  const titleHeight = opts.title ? 18 : 0;

  const headerRow = hasHeader ? (rows[0] ?? []) : [];
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  // X axis: numeric if every cell parses, else categorical.
  const rawX = bodyRows.map((r) => (r[opts.xCol] ?? "").trim());
  const numericX = rawX.every(
    (v) => v.length > 0 && Number.isFinite(Number(v)),
  );
  const xValuesNumeric = numericX ? rawX.map((v) => Number(v)) : null;
  const xLabel = headerRow[opts.xCol] ?? "";

  // Series.
  const series: Series[] = opts.yCols.map((col, i) => ({
    label: headerRow[col] ?? `series ${i + 1}`,
    color: palette[i % palette.length]!,
    values: bodyRows.map((r) => Number((r[col] ?? "").trim())),
  }));

  const yAll = series.flatMap((s) => s.values).filter(Number.isFinite);
  const yMin = yAll.length ? Math.min(...yAll) : 0;
  const yMax = yAll.length ? Math.max(...yAll) : 1;
  const [yLo, yHi] = niceRange(yMin, yMax);

  const plotLeft = PADDING.left;
  const plotTop = PADDING.top + titleHeight;
  const plotRight = width - PADDING.right;
  const plotBottom = height - PADDING.bottom;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  // X projection.
  const xMin = xValuesNumeric ? Math.min(...xValuesNumeric) : 0;
  const xMax = xValuesNumeric
    ? Math.max(...xValuesNumeric)
    : Math.max(0, bodyRows.length - 1);
  const [xLo, xHi] = xValuesNumeric
    ? niceRange(xMin, xMax)
    : [0, bodyRows.length - 1];

  function xToPx(idx: number, value: number | null): number {
    if (xValuesNumeric && value !== null) {
      const t = (value - xLo) / Math.max(1e-9, xHi - xLo);
      return plotLeft + t * plotWidth;
    }
    if (bodyRows.length <= 1) return plotLeft + plotWidth / 2;
    return plotLeft + (idx / (bodyRows.length - 1)) * plotWidth;
  }

  function yToPx(value: number): number {
    if (!Number.isFinite(value)) return plotBottom;
    const t = (value - yLo) / Math.max(1e-9, yHi - yLo);
    return plotBottom - t * plotHeight;
  }

  const yTicks = niceTicks(yLo, yHi, 5);
  const xTicks = xValuesNumeric
    ? niceTicks(xLo, xHi, Math.min(8, Math.max(2, bodyRows.length)))
    : null;

  // ── SVG body ─────────────────────────────────────────────

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, SF Mono, monospace" font-size="11">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${background}"/>`);

  if (opts.title) {
    parts.push(
      `<text x="${plotLeft}" y="${PADDING.top - 6}" fill="#ecedef" font-size="13">${escapeHtml(opts.title)}</text>`,
    );
  }

  // Y grid + ticks.
  for (const t of yTicks) {
    const py = yToPx(t);
    parts.push(
      `<line x1="${plotLeft}" y1="${py}" x2="${plotRight}" y2="${py}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${plotLeft - 8}" y="${py + 3}" text-anchor="end" fill="#9aa0a6">${formatTick(t)}</text>`,
    );
  }

  // Axes.
  parts.push(
    `<line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"/>`,
  );
  parts.push(
    `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"/>`,
  );

  // X tick labels.
  if (xTicks) {
    for (const t of xTicks) {
      const px = plotLeft + ((t - xLo) / Math.max(1e-9, xHi - xLo)) * plotWidth;
      parts.push(
        `<line x1="${px}" y1="${plotBottom}" x2="${px}" y2="${plotBottom + 4}" stroke="rgba(255,255,255,0.2)"/>`,
      );
      parts.push(
        `<text x="${px}" y="${plotBottom + 16}" text-anchor="middle" fill="#9aa0a6">${formatTick(t)}</text>`,
      );
    }
  } else {
    // Categorical labels — show every nth so they don't collide.
    const stride = Math.max(1, Math.ceil(bodyRows.length / 10));
    for (let i = 0; i < bodyRows.length; i += stride) {
      const px = xToPx(i, null);
      const label = (rawX[i] ?? "").slice(0, 12);
      parts.push(
        `<text x="${px}" y="${plotBottom + 16}" text-anchor="middle" fill="#9aa0a6">${escapeHtml(label)}</text>`,
      );
    }
  }

  // Axis titles.
  if (xLabel) {
    parts.push(
      `<text x="${(plotLeft + plotRight) / 2}" y="${height - 4}" text-anchor="middle" fill="#bdc1c6" font-size="11">${escapeHtml(xLabel)}</text>`,
    );
  }

  // ── Series ───────────────────────────────────────────────

  if (opts.kind === "bar") {
    const groupCount = bodyRows.length;
    const groupWidth = plotWidth / Math.max(1, groupCount);
    const innerWidth = Math.max(1, groupWidth * 0.78);
    const barWidth = Math.max(1, innerWidth / Math.max(1, series.length));
    for (let g = 0; g < groupCount; g++) {
      const groupX = plotLeft + g * groupWidth + (groupWidth - innerWidth) / 2;
      for (let s = 0; s < series.length; s++) {
        const v = series[s]!.values[g];
        if (!Number.isFinite(v ?? NaN)) continue;
        const py = yToPx(v!);
        const baseline = yToPx(Math.max(0, yLo));
        const top = Math.min(py, baseline);
        const h = Math.max(1, Math.abs(baseline - py));
        parts.push(
          `<rect x="${groupX + s * barWidth}" y="${top}" width="${barWidth - 1}" height="${h}" fill="${series[s]!.color}" opacity="0.85"/>`,
        );
      }
    }
  } else {
    for (const s of series) {
      const points: string[] = [];
      for (let i = 0; i < bodyRows.length; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v ?? NaN)) continue;
        const xVal = xValuesNumeric ? xValuesNumeric[i]! : null;
        const px = xToPx(i, xVal);
        const py = yToPx(v!);
        points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
        if (opts.kind === "scatter") {
          parts.push(
            `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${s.color}" opacity="0.9"/>`,
          );
        }
      }
      if (opts.kind === "line" && points.length > 0) {
        parts.push(
          `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${points.join(" ")}"/>`,
        );
      }
    }
  }

  // Legend (top-right of plot area).
  const legendY = plotTop - 14;
  let legendX = plotRight;
  for (let i = series.length - 1; i >= 0; i--) {
    const s = series[i]!;
    const labelWidth = Math.max(40, s.label.length * 6 + 18);
    legendX -= labelWidth;
    parts.push(
      `<rect x="${legendX}" y="${legendY - 8}" width="10" height="10" fill="${s.color}" rx="2"/>`,
    );
    parts.push(
      `<text x="${legendX + 14}" y="${legendY}" fill="#cdd0d3">${escapeHtml(s.label)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

// ── Tick selection (Wilkinson-flavoured nice numbers) ────────

/** Round `[lo, hi]` outward to a "nice" range for ticks. */
export function niceRange(lo: number, hi: number): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) {
    if (lo === 0) return [0, 1];
    const pad = Math.abs(lo) * 0.1;
    return [lo - pad, hi + pad];
  }
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / 5, true);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  return [niceLo, niceHi];
}

/** Compute up to `count` round-numbered ticks across `[lo, hi]`. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (lo === hi) return [lo];
  const range = hi - lo;
  const step = niceNum(range / Math.max(1, count - 1), true);
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step / 2; v += step) {
    // Round to suppress -0 and float drift.
    out.push(Math.round(v / step) * step);
    if (out.length > count + 2) break;
  }
  return out;
}

function niceNum(range: number, round: boolean): number {
  if (range === 0) return 1;
  const exp = Math.floor(Math.log10(Math.abs(range)));
  const fraction = Math.abs(range) / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else {
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

function formatTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) {
    return v.toExponential(1);
  }
  // Strip trailing zeroes / dot.
  const s = Number(v.toFixed(4)).toString();
  return s;
}
