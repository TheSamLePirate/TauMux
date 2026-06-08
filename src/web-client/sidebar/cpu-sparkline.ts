// Tiny SVG sparkline for the workspace card.
//
// Rolling CPU% history (length ≤ 32) is computed by the shared
// `buildSidebarWorkspaces` and handed to the card builder via
// `WorkspaceInfo.cpuHistory`. We turn it into a 100×16 px polyline
// scaled so the highest sample fills the height; an empty / single-
// sample history produces a flat baseline. SVG is rebuilt on every
// render but the surrounding card section's signature cache means
// this only happens when the history actually changes (1 Hz at most).

const WIDTH = 100;
const HEIGHT = 16;

/** Pure: polyline `points` for a ≥2-sample history, scaled so the peak
 *  sample fills the height. (<2 samples render a flat baseline instead.)
 *  Shared by the builder and the in-place patch (W1-STATROW) so the two
 *  never drift. */
export function computeCpuSparklinePoints(history: readonly number[]): string {
  let max = 1;
  for (const v of history) if (v > max) max = v;
  const stepX = WIDTH / (history.length - 1);
  const points: string[] = [];
  for (let i = 0; i < history.length; i++) {
    const x = (i * stepX).toFixed(1);
    const y = (HEIGHT - (history[i]! / max) * HEIGHT).toFixed(1);
    points.push(`${x},${y}`);
  }
  return points.join(" ");
}

export function buildCpuSparkline(history: readonly number[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "workspace-sparkline");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");

  if (history.length < 2) {
    // Flat line for the first sample so the card layout doesn't jump
    // when the second sample lands.
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", String(HEIGHT - 1));
    line.setAttribute("x2", String(WIDTH));
    line.setAttribute("y2", String(HEIGHT - 1));
    line.setAttribute("class", "workspace-sparkline-flat");
    svg.appendChild(line);
    return svg;
  }

  // Scale by the highest sample so a workspace doing 5% CPU still
  // fills its sparkline (relative motion matters more than absolute
  // value at this size).
  const polyline = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polyline",
  );
  polyline.setAttribute("points", computeCpuSparklinePoints(history));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("class", "workspace-sparkline-line");
  svg.appendChild(polyline);
  return svg;
}
