/**
 * τ-mux SVG icon registry.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §6.
 *
 *   "All icons are geometric SVG primitives — rectangles, circles,
 *    short strokes. Never draw illustrated or organic icons."
 *
 * Hard rules from §6:
 *   - sizes: 10 | 11 | 14 px;
 *   - stroke: 0.7–0.9 px, `currentColor`;
 *   - max 12 strokes/rects per icon;
 *   - no curves other than circles or arcs.
 *
 * The τ logo is a hand-tuned 10×10 pixel grid rendered as <rect> elements.
 * Its glow is applied via CSS `drop-shadow`, not an SVG filter, so the
 * same markup can be used without a filter context.
 *
 * Every icon is a pure DOM factory returning an `SVGSVGElement`. No
 * framework. Callers are responsible for mounting + for wiring ARIA
 * if the icon is interactive.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export type TauIconSize = 10 | 11 | 14;

export interface TauIconOptions {
  size?: TauIconSize;
  /** Tailored stroke width (0.7–0.9 valid; default 0.8). */
  strokeWidth?: number;
  /** Screen-reader label. Omit for purely decorative icons. */
  title?: string;
  className?: string;
}

function createSvg(size: number, opts: TauIconOptions): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(opts.strokeWidth ?? 0.8));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", opts.title ? "false" : "true");
  svg.style.display = "inline-block";
  svg.style.verticalAlign = "middle";
  svg.style.flexShrink = "0";
  if (opts.className) svg.setAttribute("class", opts.className);
  if (opts.title) {
    const t = document.createElementNS(SVG_NS, "title");
    t.textContent = opts.title;
    svg.appendChild(t);
  }
  return svg;
}

function rect(
  svg: SVGSVGElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "currentColor",
) {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("fill", fill);
  r.setAttribute("stroke", "none");
  svg.appendChild(r);
}

function stroke(svg: SVGSVGElement, d: string) {
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  svg.appendChild(p);
}

function circle(
  svg: SVGSVGElement,
  cx: number,
  cy: number,
  r: number,
  filled = false,
) {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", String(cx));
  c.setAttribute("cy", String(cy));
  c.setAttribute("r", String(r));
  if (filled) {
    c.setAttribute("fill", "currentColor");
    c.setAttribute("stroke", "none");
  }
  svg.appendChild(c);
}

/** split — square with vertical divider. */
export function IconSplit(opts: TauIconOptions = {}): SVGSVGElement {
  const s = opts.size ?? 14;
  const svg = createSvg(s, opts);
  const pad = 2;
  stroke(svg, `M${pad} ${pad} H${s - pad} V${s - pad} H${pad} Z`);
  stroke(svg, `M${s / 2} ${pad} V${s - pad}`);
  return svg;
}

/** grid — 2×2 squares. */
export function IconGrid(opts: TauIconOptions = {}): SVGSVGElement {
  const s = opts.size ?? 14;
  const svg = createSvg(s, opts);
  const pad = 2;
  const mid = s / 2;
  stroke(svg, `M${pad} ${pad} H${mid - 0.5} V${mid - 0.5} H${pad} Z`);
  stroke(svg, `M${mid + 0.5} ${pad} H${s - pad} V${mid - 0.5} H${mid + 0.5} Z`);
  stroke(svg, `M${pad} ${mid + 0.5} H${mid - 0.5} V${s - pad} H${pad} Z`);
  stroke(
    svg,
    `M${mid + 0.5} ${mid + 0.5} H${s - pad} V${s - pad} H${mid + 0.5} Z`,
  );
  return svg;
}

/** agent — circle with inner dot. */
export function IconAgent(opts: TauIconOptions = {}): SVGSVGElement {
  const s = opts.size ?? 14;
  const svg = createSvg(s, opts);
  const c = s / 2;
  circle(svg, c, c, s / 2 - 1.5, false);
  circle(svg, c, c, s / 7, true);
  return svg;
}

/** human — head + shoulders abstract. */
export function IconHuman(opts: TauIconOptions = {}): SVGSVGElement {
  const s = opts.size ?? 14;
  const svg = createSvg(s, opts);
  const c = s / 2;
  // Head
  circle(svg, c, s * 0.35, s * 0.18, false);
  // Shoulders arc — a circular arc, not a freeform curve, per §6.
  const shoulderR = s * 0.42;
  const y = s * 0.72;
  stroke(
    svg,
    `M${c - shoulderR} ${y + shoulderR} A ${shoulderR} ${shoulderR} 0 0 1 ${c + shoulderR} ${y + shoulderR}`,
  );
  return svg;
}

/** plus — `+` stroke. */
export function IconPlus(opts: TauIconOptions = {}): SVGSVGElement {
  const s = opts.size ?? 14;
  const svg = createSvg(s, opts);
  const c = s / 2;
  const arm = s * 0.32;
  stroke(svg, `M${c} ${c - arm} V${c + arm}`);
  stroke(svg, `M${c - arm} ${c} H${c + arm}`);
  return svg;
}

/** git — three nodes + connecting strokes. */
export function IconGit(opts: TauIconOptions = {}): SVGSVGElement {
  const s = opts.size ?? 14;
  const svg = createSvg(s, opts);
  const r = s * 0.11;
  const xL = s * 0.28;
  const xR = s * 0.72;
  const yT = s * 0.25;
  const yM = s * 0.55;
  const yB = s * 0.82;
  stroke(svg, `M${xL} ${yT + r} V${yB - r}`);
  stroke(svg, `M${xL + r} ${yM} H${xR - r}`);
  circle(svg, xL, yT, r, true);
  circle(svg, xR, yM, r, true);
  circle(svg, xL, yB, r, true);
  return svg;
}

/** spark — 4-point star. */
export function IconSpark(opts: TauIconOptions = {}): SVGSVGElement {
  const s = opts.size ?? 14;
  const svg = createSvg(s, opts);
  const c = s / 2;
  const arm = s * 0.42;
  stroke(
    svg,
    `M${c} ${c - arm} L${c + arm * 0.18} ${c - arm * 0.18} L${c + arm} ${c} L${c + arm * 0.18} ${c + arm * 0.18} L${c} ${c + arm} L${c - arm * 0.18} ${c + arm * 0.18} L${c - arm} ${c} L${c - arm * 0.18} ${c - arm * 0.18} Z`,
  );
  return svg;
}

/**
 * tau — the pixel-τ logo.
 *
 * Hand-tuned 10×10 pixel grid, rendered as <rect> elements. Viewbox is
 * 10×10; the outer svg scales to the requested `size`. The glow is the
 * caller's job via CSS `drop-shadow` on the mount point — the guideline
 * recipe is
 *   `filter: drop-shadow(0 0 6px var(--tau-cyan-glow))
 *            drop-shadow(0 0 2px var(--tau-cyan));`
 */
export function IconTau(opts: TauIconOptions = {}): SVGSVGElement {
  const size = opts.size ?? 14;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "inline-block";
  svg.style.verticalAlign = "middle";
  if (opts.className) svg.setAttribute("class", opts.className);
  // Top bar (row 1, cols 1..8)
  for (let x = 1; x <= 8; x++) rect(svg, x, 1, 1, 1);
  // Stem (col 4 for rows 2..7, col 5 mirrored for visual balance)
  for (let y = 2; y <= 7; y++) {
    rect(svg, 4, y, 1, 1);
    rect(svg, 5, y, 1, 1);
  }
  // Hook at the base of the stem (rows 7..8, col 6)
  rect(svg, 6, 7, 1, 1);
  rect(svg, 6, 8, 1, 1);
  return svg;
}

/** Convenience: icon factory by name. Keeps the §6 registry enumerable. */
export const TAU_ICONS = {
  split: IconSplit,
  grid: IconGrid,
  agent: IconAgent,
  human: IconHuman,
  plus: IconPlus,
  git: IconGit,
  spark: IconSpark,
  tau: IconTau,
} as const;

export type TauIconName = keyof typeof TAU_ICONS;

export function tauIcon(
  name: TauIconName,
  opts: TauIconOptions = {},
): SVGSVGElement {
  return TAU_ICONS[name](opts);
}
