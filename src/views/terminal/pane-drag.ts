/**
 * Pane drag-and-drop controller.
 *
 * Owns the full drag state machine: mousedown on a pane bar,
 * threshold-based drag start, ghost rendering, drop-target resolution
 * (left/right/top/bottom/swap based on pointer angle), overlay
 * rendering, commit via layout.moveSurface.
 *
 * The controller is self-contained: it owns its DOM (ghost, overlay,
 * label) and its transient state (activeDrag, highlighted target). It
 * talks back to SurfaceManager via a narrow `PaneDragHost` interface
 * so tests can drive it without mounting a real manager.
 */

import type { PaneDropPosition, PaneRect } from "./pane-layout";

const PANE_DRAG_THRESHOLD = 8;

interface PaneDragHover {
  targetId: string;
  position: PaneDropPosition;
  bounds: PaneRect;
}

interface PaneDragState {
  surfaceId: string;
  offsetX: number;
  offsetY: number;
  ghostEl: HTMLDivElement;
  hover: PaneDragHover | null;
}

/** Narrow projection of `SurfaceView` that the drag controller
 *  reads. Kept tight so tests can fake a surface with just a
 *  container and a title. */
export interface PaneDragSurface {
  container: HTMLDivElement;
  title: string;
}

/** Narrow projection of a `Workspace` — only the surfaceIds set and
 *  a `moveSurface` hook on the pane tree are needed. */
export interface PaneDragWorkspace {
  surfaceIds: Set<string>;
  layout: {
    moveSurface(
      sourceId: string,
      targetId: string,
      position: PaneDropPosition,
    ): boolean;
  };
}

/** Hooks the controller needs from its host (SurfaceManager). Kept
 *  in one bundle so wiring is explicit. */
export interface PaneDragHost {
  terminalContainer: HTMLElement;
  getActiveWorkspace: () => PaneDragWorkspace | null;
  getSurface: (surfaceId: string) => PaneDragSurface | undefined;
  focusSurface: (surfaceId: string) => void;
  /** Invoked after a successful drop moves a surface so the host can
   *  re-layout, refocus, and refresh the sidebar. */
  onDropCommitted: () => void;
}

export class PaneDragController {
  private activeDrag: PaneDragState | null = null;
  private dropOverlayEl: HTMLDivElement | null = null;
  private dropOverlayLabelEl: HTMLSpanElement | null = null;
  private highlightedDropTargetId: string | null = null;

  constructor(private host: PaneDragHost) {}

  /** True while the user is actively dragging a surface. */
  get isDragging(): boolean {
    return this.activeDrag !== null;
  }

  /** Wire mousedown on a surface's bar to start a drag. Called once
   *  per surface at surface-view construction time. */
  setupSurfaceDrag(surfaceId: string, bar: HTMLDivElement): void {
    bar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".surface-bar-btn")) return;

      const ws = this.host.getActiveWorkspace();
      if (!ws || !ws.surfaceIds.has(surfaceId)) return;

      this.host.focusSurface(surfaceId);

      if (ws.surfaceIds.size < 2) return;

      const view = this.host.getSurface(surfaceId);
      if (!view) return;

      e.preventDefault();

      const rect = view.container.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      let dragStarted = false;

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragStarted) {
          const distance = Math.hypot(
            moveEvent.clientX - e.clientX,
            moveEvent.clientY - e.clientY,
          );
          if (distance < PANE_DRAG_THRESHOLD) return;
          dragStarted = true;
          this.startPaneDrag(surfaceId, offsetX, offsetY);
        }

        this.updatePaneDrag(moveEvent.clientX, moveEvent.clientY);
      };

      const onUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (!dragStarted) return;
        this.finishPaneDrag(upEvent.clientX, upEvent.clientY);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  /** Cancel an in-flight drag if the removed surface is the source
   *  or the current drop target. Called by SurfaceManager.removeSurface. */
  cancelIfInvolves(surfaceId: string): void {
    if (
      this.activeDrag?.surfaceId === surfaceId ||
      this.highlightedDropTargetId === surfaceId
    ) {
      this.cleanupPaneDrag();
    }
  }

  /** Unconditionally abort any in-flight drag. Used by workspace
   *  switching, where the current drag is always stale. */
  cancel(): void {
    this.cleanupPaneDrag();
  }

  private startPaneDrag(
    surfaceId: string,
    offsetX: number,
    offsetY: number,
  ): void {
    this.cleanupPaneDrag();

    const view = this.host.getSurface(surfaceId);
    if (!view) return;

    const ghostEl = document.createElement("div");
    ghostEl.className = "surface-drag-ghost";
    ghostEl.style.width = `${view.container.offsetWidth}px`;
    ghostEl.style.height = `${view.container.offsetHeight}px`;

    const header = document.createElement("div");
    header.className = "surface-drag-ghost-header";

    const title = document.createElement("span");
    title.className = "surface-drag-ghost-title";
    title.textContent = view.title;
    header.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "surface-drag-ghost-badge";
    badge.textContent = "Move pane";
    header.appendChild(badge);

    ghostEl.appendChild(header);
    this.host.terminalContainer.appendChild(ghostEl);
    view.container.classList.add("drag-origin");
    this.host.terminalContainer.classList.add("pane-drag-active");
    document.body.classList.add("pane-dragging");

    this.activeDrag = {
      surfaceId,
      offsetX,
      offsetY,
      ghostEl,
      hover: null,
    };
  }

  private updatePaneDrag(clientX: number, clientY: number): void {
    const drag = this.activeDrag;
    if (!drag) return;

    const containerRect = this.host.terminalContainer.getBoundingClientRect();
    const maxX = Math.max(0, containerRect.width - drag.ghostEl.offsetWidth);
    const maxY = Math.max(0, containerRect.height - drag.ghostEl.offsetHeight);
    const nextX = clientX - containerRect.left - drag.offsetX;
    const nextY = clientY - containerRect.top - drag.offsetY;

    drag.ghostEl.style.left = `${Math.max(-24, Math.min(maxX + 24, nextX))}px`;
    drag.ghostEl.style.top = `${Math.max(-24, Math.min(maxY + 24, nextY))}px`;

    drag.hover = this.resolvePaneDropHover(drag.surfaceId, clientX, clientY);
    this.renderPaneDropOverlay(drag.hover);
  }

  private finishPaneDrag(clientX: number, clientY: number): void {
    if (!this.activeDrag) return;

    this.updatePaneDrag(clientX, clientY);

    const drag = this.activeDrag;
    const ws = this.host.getActiveWorkspace();
    const hover = drag.hover;

    this.cleanupPaneDrag();

    if (!ws || !hover) return;

    const changed = ws.layout.moveSurface(
      drag.surfaceId,
      hover.targetId,
      hover.position,
    );

    if (!changed) return;

    this.host.onDropCommitted();
    this.host.focusSurface(drag.surfaceId);
  }

  private cleanupPaneDrag(): void {
    if (this.activeDrag) {
      this.host
        .getSurface(this.activeDrag.surfaceId)
        ?.container.classList.remove("drag-origin");
      this.activeDrag.ghostEl.remove();
      this.activeDrag = null;
    }

    this.host.terminalContainer.classList.remove("pane-drag-active");
    document.body.classList.remove("pane-dragging");
    this.renderPaneDropOverlay(null);
  }

  private resolvePaneDropHover(
    sourceId: string,
    clientX: number,
    clientY: number,
  ): PaneDragHover | null {
    const ws = this.host.getActiveWorkspace();
    if (!ws || !ws.surfaceIds.has(sourceId)) return null;

    const targetEl = document
      .elementFromPoint(clientX, clientY)
      ?.closest(".surface-container") as HTMLDivElement | null;
    const targetId = targetEl?.dataset["surfaceId"];

    if (!targetEl || !targetId || targetId === sourceId) {
      return null;
    }

    if (!ws.surfaceIds.has(targetId)) {
      return null;
    }

    const containerRect = this.host.terminalContainer.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    return {
      targetId,
      position: resolvePaneDropPosition(
        clientX - targetRect.left,
        clientY - targetRect.top,
        targetRect.width,
        targetRect.height,
      ),
      bounds: {
        x: targetRect.left - containerRect.left,
        y: targetRect.top - containerRect.top,
        w: targetRect.width,
        h: targetRect.height,
      },
    };
  }

  private renderPaneDropOverlay(hover: PaneDragHover | null): void {
    if (!hover) {
      this.dropOverlayEl?.classList.remove("visible");
      this.clearDropTargetHighlight();
      return;
    }

    const overlay = this.ensurePaneDropOverlay();
    const bounds = getPaneDropOverlayBounds(hover.bounds, hover.position);

    overlay.dataset["dropPosition"] = hover.position;
    overlay.style.left = `${bounds.x}px`;
    overlay.style.top = `${bounds.y}px`;
    overlay.style.width = `${bounds.w}px`;
    overlay.style.height = `${bounds.h}px`;
    overlay.classList.add("visible");

    if (this.dropOverlayLabelEl) {
      this.dropOverlayLabelEl.textContent = getPaneDropOverlayLabel(
        hover.position,
      );
    }

    if (this.highlightedDropTargetId !== hover.targetId) {
      this.clearDropTargetHighlight();
      this.host
        .getSurface(hover.targetId)
        ?.container.classList.add("drop-target");
      this.highlightedDropTargetId = hover.targetId;
    }
  }

  private ensurePaneDropOverlay(): HTMLDivElement {
    if (this.dropOverlayEl) {
      return this.dropOverlayEl;
    }

    const overlay = document.createElement("div");
    overlay.className = "surface-drop-overlay";

    const label = document.createElement("span");
    label.className = "surface-drop-label";
    overlay.appendChild(label);

    this.host.terminalContainer.appendChild(overlay);
    this.dropOverlayEl = overlay;
    this.dropOverlayLabelEl = label;
    return overlay;
  }

  private clearDropTargetHighlight(): void {
    if (!this.highlightedDropTargetId) return;
    this.host
      .getSurface(this.highlightedDropTargetId)
      ?.container.classList.remove("drop-target");
    this.highlightedDropTargetId = null;
  }
}

// ── Pure helpers (exported for tests) ─────────────────────────────

/** Decide which quadrant of a target pane a pointer is over: left,
 *  right, top, bottom, or swap (center). The threshold grows with
 *  the pane size but is clamped so tiny panes still have a usable
 *  center, and huge panes don't have absurd split bands. */
export function resolvePaneDropPosition(
  localX: number,
  localY: number,
  width: number,
  height: number,
): PaneDropPosition {
  const thresholdForSize = (size: number) =>
    Math.min(Math.max(size * 0.24, 24), Math.max(16, size / 2 - 16));

  const xThreshold = thresholdForSize(width);
  const yThreshold = thresholdForSize(height);
  const candidates: { position: PaneDropPosition; distance: number }[] = [];

  if (localX <= xThreshold) {
    candidates.push({ position: "left", distance: localX });
  }
  if (width - localX <= xThreshold) {
    candidates.push({ position: "right", distance: width - localX });
  }
  if (localY <= yThreshold) {
    candidates.push({ position: "top", distance: localY });
  }
  if (height - localY <= yThreshold) {
    candidates.push({ position: "bottom", distance: height - localY });
  }

  if (candidates.length === 0) {
    return "swap";
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].position;
}

/** Inset the target rect and compute the preview bounds for the
 *  drop overlay given a drop position. */
export function getPaneDropOverlayBounds(
  rect: PaneRect,
  position: PaneDropPosition,
): PaneRect {
  const padding = 12;
  const inner = {
    x: rect.x + padding,
    y: rect.y + padding,
    w: Math.max(28, rect.w - padding * 2),
    h: Math.max(28, rect.h - padding * 2),
  };

  if (position === "swap") {
    return inner;
  }

  const splitWidth = Math.min(inner.w, Math.max(24, inner.w * 0.38));
  const splitHeight = Math.min(inner.h, Math.max(24, inner.h * 0.38));

  switch (position) {
    case "left":
      return { ...inner, w: splitWidth };
    case "right":
      return {
        ...inner,
        x: inner.x + inner.w - splitWidth,
        w: splitWidth,
      };
    case "top":
      return { ...inner, h: splitHeight };
    case "bottom":
      return {
        ...inner,
        y: inner.y + inner.h - splitHeight,
        h: splitHeight,
      };
    default:
      return inner;
  }
}

export function getPaneDropOverlayLabel(position: PaneDropPosition): string {
  switch (position) {
    case "left":
      return "Split left";
    case "right":
      return "Split right";
    case "top":
      return "Split up";
    case "bottom":
      return "Split down";
    case "swap":
    default:
      return "Move here";
  }
}
