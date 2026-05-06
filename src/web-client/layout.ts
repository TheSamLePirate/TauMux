// Web-mirror layout + geometry.
//
// Two concerns live here:
//
//   1. computeRects — pure tree walker that splits a bounds rectangle
//      according to a binary pane tree. Identical split logic to
//      src/views/terminal/pane-layout.ts in the native app.
//
//   2. createLayoutView — owns the DOM side-effects: positioning
//      pane elements from computed rects, scaling xterm screens when
//      the mirror renders to a fixed native viewport, and applying
//      the outer scale transform to the pane container.

import type { AppState } from "./store";
import { fitTerminal } from "../shared/xterm-fit";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutNode {
  type: "leaf" | "split";
  surfaceId?: string;
  direction?: "horizontal" | "vertical";
  ratio?: number;
  children?: LayoutNode[];
}

/** Pure: walk a pane tree, return rect-per-surfaceId. */
export function computeRects(
  node: LayoutNode | null | undefined,
  bounds: Rect,
  gap: number,
): Record<string, Rect> {
  const result: Record<string, Rect> = {};
  walk(node, bounds, gap, result);
  return result;
}

function walk(
  node: LayoutNode | null | undefined,
  bounds: Rect,
  gap: number,
  out: Record<string, Rect>,
): void {
  if (!node) return;
  if (node.type === "leaf") {
    if (node.surfaceId) out[node.surfaceId] = bounds;
    return;
  }
  const half = gap / 2;
  const ratio = node.ratio ?? 0.5;
  const children = node.children ?? [];
  if (node.direction === "horizontal") {
    const sx = bounds.x + bounds.w * ratio;
    walk(
      children[0],
      { x: bounds.x, y: bounds.y, w: sx - bounds.x - half, h: bounds.h },
      gap,
      out,
    );
    walk(
      children[1],
      {
        x: sx + half,
        y: bounds.y,
        w: bounds.x + bounds.w - sx - half,
        h: bounds.h,
      },
      gap,
      out,
    );
  } else {
    const sy = bounds.y + bounds.h * ratio;
    walk(
      children[0],
      { x: bounds.x, y: bounds.y, w: bounds.w, h: sy - bounds.y - half },
      gap,
      out,
    );
    walk(
      children[1],
      {
        x: bounds.x,
        y: sy + half,
        w: bounds.w,
        h: bounds.y + bounds.h - sy - half,
      },
      gap,
      out,
    );
  }
}

export interface TermRef {
  el: HTMLElement;
  termEl: HTMLElement;
  /** M18 — xterm instance handle, optional so telegram panes (which
   *  set `term: null`) and tests with stub refs still typecheck.
   *  When present, `applyLayout` calls `fitTerminal(term, termEl)`
   *  synchronously after writing the pane's pixel rect. */
  term?: unknown;
}

export interface LayoutDeps {
  container: HTMLElement;
  sidebarEl: HTMLElement;
  terms: Record<string, TermRef>;
  /** Default gap when `state.settings` hasn't loaded yet. Once the
   *  host's settings broadcast lands, `state.settings.paneGap` takes
   *  over (M16). */
  gap: number;
  sidebarWidth: number;
  toolbarHeight: number;
  /** Height (px) of the bottom status bar so the mirror-scale and
   *  pane container know how much vertical room to leave. Added in
   *  the post-M17 sizing fix; defaults to 0 if the caller doesn't
   *  set it (back-compat with tests). */
  statusBarHeight?: number;
}

export interface LayoutView {
  applyLayout(state: AppState): void;
  scaleTerminals(state: AppState): void;
}

export function createLayoutView(deps: LayoutDeps): LayoutView {
  const {
    container,
    sidebarEl,
    terms,
    gap: defaultGap,
    sidebarWidth,
    toolbarHeight,
    statusBarHeight = 0,
  } = deps;

  function applyMirrorScale(state: AppState) {
    if (!state.nativeViewport) {
      container.style.transform = "";
      container.style.width = "";
      container.style.height = "";
      container.style.transformOrigin = "";
      container.style.left = "";
      container.style.top = "";
      container.style.right = "0";
      // M17 sizing fix — leave room for the bottom status bar so the
      // last terminal row isn't clipped by the fixed-position bar.
      container.style.bottom = `${statusBarHeight}px`;
      return;
    }
    const sidebarW = state.sidebarVisible
      ? sidebarEl.offsetWidth || sidebarWidth
      : 0;
    const availW = document.documentElement.clientWidth - sidebarW;
    // M17 sizing fix — subtract the status bar so the scaled mirror
    // fits between the toolbar and the bar instead of being half-
    // hidden behind it.
    const availH =
      document.documentElement.clientHeight - toolbarHeight - statusBarHeight;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(
      availW / state.nativeViewport.width,
      availH / state.nativeViewport.height,
    );
    const scaledW = state.nativeViewport.width * scale;
    const scaledH = state.nativeViewport.height * scale;
    container.style.right = "auto";
    container.style.bottom = "auto";
    container.style.width = state.nativeViewport.width + "px";
    container.style.height = state.nativeViewport.height + "px";
    container.style.transformOrigin = "top left";
    container.style.transform = "scale(" + scale + ")";
    container.style.left = Math.round(sidebarW + (availW - scaledW) / 2) + "px";
    container.style.top =
      Math.round(toolbarHeight + (availH - scaledH) / 2) + "px";
  }

  function applyLayout(state: AppState) {
    applyMirrorScale(state);
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (!ws) return;
    const cw = state.nativeViewport?.width ?? container.offsetWidth;
    const ch = state.nativeViewport?.height ?? container.offsetHeight;
    if (!cw || !ch) return;
    // M16 — `paneGap` flows from the host's settings broadcast. Falls
    // back to the constructor's default until the first
    // `settingsSnapshot` envelope lands.
    const gap = state.settings?.paneGap ?? defaultGap;
    const rects = computeRects(
      ws.layout as unknown as LayoutNode,
      { x: 0, y: 0, w: cw, h: ch },
      gap,
    );
    for (const sid in rects) {
      const ref = terms[sid];
      if (!ref) continue;
      const r = rects[sid]!;
      ref.el.style.left = Math.round(r.x) + "px";
      ref.el.style.top = Math.round(r.y) + "px";
      ref.el.style.width = Math.round(r.w) + "px";
      ref.el.style.height = Math.round(r.h) + "px";
      ref.el.classList.toggle("focused", sid === state.focusedSurfaceId);
    }
    // M18 — fit each xterm to its pane container in the SAME tick as
    // the rect write. Forcing one read of `offsetHeight` flushes the
    // CSS layout engine so `fitTerminal` reads the post-write
    // clientWidth/Height (avoids the M17 multi-pane race where pane
    // "b"'s ResizeObserver fired before its `.pane-term` had been
    // measured by CSS, poisoning xterm's render-service cache with
    // a 0-cell resize).
    for (const sid in rects) {
      const ref = terms[sid];
      if (!ref || !ref.term) continue;
      // Read forces CSS layout flush — value is intentionally
      // unused; the side effect is what matters.
      void ref.termEl.offsetHeight;
      fitTerminal(ref.term, ref.termEl);
    }
    scaleTerminals(state);
  }

  // Must run after `applyMirrorScale` has already set the container's
  // outer transform/size for this state. The CSS-pixel measurements
  // below (`offsetWidth` of the xterm screen, `clientWidth` of each
  // term cell) only converge to their post-scale values once the
  // container transform is applied; calling `scaleTerminals` first
  // would read pre-scale values and produce a doubled scale.
  function scaleTerminals(state: AppState) {
    if (!state.nativeViewport) return;
    requestAnimationFrame(() => {
      for (const sid in terms) {
        const ref = terms[sid]!;
        const xtermEl = ref.termEl.querySelector(
          ".xterm",
        ) as HTMLElement | null;
        if (!xtermEl) continue;
        xtermEl.style.transform = "";
        const cw = ref.termEl.clientWidth;
        const ch = ref.termEl.clientHeight;
        const screen = xtermEl.querySelector(
          ".xterm-screen",
        ) as HTMLElement | null;
        if (!screen || cw <= 0 || ch <= 0) continue;
        const sw = screen.offsetWidth;
        const sh = screen.offsetHeight;
        if (sw <= 0 || sh <= 0) continue;
        xtermEl.style.transformOrigin = "top left";
        xtermEl.style.transform = "scale(" + cw / sw + "," + ch / sh + ")";
      }
    });
  }

  return { applyLayout, scaleTerminals };
}
