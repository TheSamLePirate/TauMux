/**
 * Single source of truth for pane-tree rect computation (Triple-A F.2 / A5).
 *
 * Previously duplicated in `src/views/terminal/pane-layout.ts` (native,
 * reading a module-level `paneGap` mutable via `setPaneGap`) and
 * `src/web-client/layout.ts` (mirror, gap-as-parameter). Drift there
 * meant panes didn't line up between native and the mirror — exactly
 * the kind of cross-surface bug duplication invites.
 *
 * The mirror's design (parameter-injected gap) is the better one; the
 * shared function adopts it. Native callers pass their module-level
 * gap to the shared function; the module setter stays as the existing
 * mutation API but no longer hides behind closure state inside the
 * walker.
 *
 * Pure: no DOM, no mutation of `node`. Same tree → same Map every call.
 */

import type { PaneNode, PaneRect } from "./types";

/** Walk a pane tree, return rect-per-surfaceId.
 *
 * `gap` is the pixel separation between adjacent panes — half goes to
 * each side of the split so dividers stay centred. Set to 0 for a
 * gap-free layout (used by the persisted layout-restore path).
 */
export function computeRects(
  node: PaneNode,
  bounds: PaneRect,
  gap: number,
): Map<string, PaneRect> {
  const out = new Map<string, PaneRect>();
  walk(node, bounds, gap, out);
  return out;
}

function walk(
  node: PaneNode,
  bounds: PaneRect,
  gap: number,
  out: Map<string, PaneRect>,
): void {
  if (node.type === "leaf") {
    out.set(node.surfaceId, bounds);
    return;
  }
  const half = gap / 2;
  const { direction, ratio, children } = node;
  if (direction === "horizontal") {
    const splitX = bounds.x + bounds.w * ratio;
    walk(
      children[0],
      { x: bounds.x, y: bounds.y, w: splitX - bounds.x - half, h: bounds.h },
      gap,
      out,
    );
    walk(
      children[1],
      {
        x: splitX + half,
        y: bounds.y,
        w: bounds.x + bounds.w - splitX - half,
        h: bounds.h,
      },
      gap,
      out,
    );
  } else {
    const splitY = bounds.y + bounds.h * ratio;
    walk(
      children[0],
      { x: bounds.x, y: bounds.y, w: bounds.w, h: splitY - bounds.y - half },
      gap,
      out,
    );
    walk(
      children[1],
      {
        x: bounds.x,
        y: splitY + half,
        w: bounds.w,
        h: bounds.y + bounds.h - splitY - half,
      },
      gap,
      out,
    );
  }
}
