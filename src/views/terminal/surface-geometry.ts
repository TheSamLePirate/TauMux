/**
 * Screen-space rectangles for panes and workspaces.
 *
 * Both feed `ht screenshot`, which needs a CSS-pixel crop plus the
 * device pixel ratio to hand to the native capture. Extracted from
 * `SurfaceManager` because neither touches its state: given the pane
 * elements, they are pure DOM measurement.
 */

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

function dpr(): number {
  return window.devicePixelRatio || 1;
}

/** Bounding box of one pane's container, or null when it isn't mounted. */
export function elementCaptureRect(el: HTMLElement | null): CaptureRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: r.left,
    y: r.top,
    width: r.width,
    height: r.height,
    devicePixelRatio: dpr(),
  };
}

/**
 * Union of every *visible* pane box in `elements`.
 *
 * Panes in a background workspace are `display: none` and measure zero,
 * so they are skipped and an entirely hidden workspace yields null —
 * the caller then falls back to a raw window grab rather than cropping
 * to a degenerate rectangle.
 */
export function unionCaptureRect(
  elements: Iterable<HTMLElement | null | undefined>,
): CaptureRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const el of elements) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.right);
    maxY = Math.max(maxY, r.bottom);
    any = true;
  }
  if (!any) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    devicePixelRatio: dpr(),
  };
}
