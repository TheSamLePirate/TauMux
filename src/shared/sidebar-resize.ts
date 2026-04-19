// Shared sidebar drag-to-resize behavior for the native webview and the
// web mirror. Callers supply the handle element, bounds, the current
// origin (the sidebar's left edge so we can derive width from
// pointer.clientX), and two callbacks:
//
//   onLive   — fired on every pointer-move frame, throttled to rAF.
//              Hosts should update their --*-sidebar-width CSS variable
//              and re-apply whatever downstream layout (xterm fit, pane
//              reflow) depends on that variable.
//   onCommit — fired once on pointer-up. Hosts persist the final width
//              (settings store on native, localStorage on web).
//
// Double-click restores the configured default width.
//
// The pointer-down path uses `setPointerCapture` so drags still track
// even if the cursor leaves the handle. We toggle a `sidebar-resizing`
// class on <body> so the host's CSS can disable its own width/left
// transitions for the duration — otherwise the reflow fights with
// ongoing CSS transitions and feels laggy.

export interface SidebarResizeOptions {
  /** The DOM element the user grabs. Usually a 4–8 px vertical strip
   *  pinned to the sidebar's right edge. */
  handle: HTMLElement;
  /** Smallest width the sidebar is allowed to collapse to while
   *  staying usable. Values below this clamp to `min`. */
  min: number;
  /** Largest width, past which the sidebar eats too much of the
   *  terminal area. Values above clamp to `max`. */
  max: number;
  /** Width restored on handle double-click. */
  defaultWidth: number;
  /** Returns the sidebar's left edge in viewport pixels at drag-start.
   *  Usually 0, but hosts with a window chrome frame (Electrobun's
   *  window-frame-width) pass the offset they already know. */
  getSidebarLeft(): number;
  /** Live callback fired at most once per animation frame while the
   *  user drags. Receives the new clamped width. */
  onLive?(width: number): void;
  /** Final callback fired on pointer-up with the committed width. */
  onCommit(width: number): void;
}

/** Attach the behavior. Returns a teardown that removes every listener
 *  the module installed — useful for tests and hot-reload. */
export function attachSidebarResize(opts: SidebarResizeOptions): () => void {
  const { handle, min, max, defaultWidth, getSidebarLeft, onLive, onCommit } =
    opts;

  let dragPointerId: number | null = null;
  let pendingFrame = 0;
  let pendingWidth = 0;

  function clamp(w: number): number {
    if (!Number.isFinite(w)) return min;
    if (w < min) return min;
    if (w > max) return max;
    return Math.round(w);
  }

  function computeWidth(clientX: number): number {
    return clamp(clientX - getSidebarLeft());
  }

  function flushLive(): void {
    pendingFrame = 0;
    onLive?.(pendingWidth);
  }

  function onPointerDown(e: PointerEvent): void {
    // Left button only. Touch and stylus both report `isPrimary`.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragPointerId = e.pointerId;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("sidebar-resizing");
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragPointerId !== e.pointerId) return;
    pendingWidth = computeWidth(e.clientX);
    if (!pendingFrame) {
      pendingFrame = requestAnimationFrame(flushLive);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragPointerId !== e.pointerId) return;
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
    }
    const finalWidth = computeWidth(e.clientX);
    onLive?.(finalWidth);
    onCommit(finalWidth);
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released (e.g. element removed) */
    }
    dragPointerId = null;
    document.body.classList.remove("sidebar-resizing");
  }

  function onDoubleClick(): void {
    onLive?.(defaultWidth);
    onCommit(defaultWidth);
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
  handle.addEventListener("dblclick", onDoubleClick);
  // Keyboard nudge: arrow keys on a focused handle tweak by 8 px,
  // shift-arrow by 32 px. Accessibility affordance for users without
  // fine pointer control.
  handle.addEventListener("keydown", onKeyDown);

  function onKeyDown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 32 : 8;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -step;
    else if (e.key === "ArrowRight") delta = step;
    else if (e.key === "Home") {
      onLive?.(min);
      onCommit(min);
      e.preventDefault();
      return;
    } else if (e.key === "End") {
      onLive?.(max);
      onCommit(max);
      e.preventDefault();
      return;
    } else return;
    // Keyboard nudges from the current width — the host computes it
    // against the DOM, so we reuse getSidebarLeft + handle's position.
    const current =
      handle.getBoundingClientRect().left -
      getSidebarLeft() +
      handle.offsetWidth / 2;
    const next = clamp(current + delta);
    onLive?.(next);
    onCommit(next);
    e.preventDefault();
  }

  return () => {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", onPointerUp);
    handle.removeEventListener("pointercancel", onPointerUp);
    handle.removeEventListener("dblclick", onDoubleClick);
    handle.removeEventListener("keydown", onKeyDown);
    document.body.classList.remove("sidebar-resizing");
  };
}
