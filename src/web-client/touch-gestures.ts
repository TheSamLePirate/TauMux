// τ-mux web mirror — touch-gesture router.
//
// Three gestures matter for parity with native UX on a phone or tablet:
//
//   1. Horizontal swipe in the pane area — switches to the previous /
//      next workspace. Hysteresis: 60 px or 30% of viewport width
//      (whichever smaller) and the dominant axis must be horizontal
//      (|dx| > |dy| × 1.4) so vertical scrolls don't trip it.
//   2. Edge-swipe right from x < 24 px — opens the sidebar drawer.
//      Edge-swipe left when the drawer is open closes it.
//   3. Two-finger pinch on a terminal pane — steps the xterm font
//      size in 1-px increments, clamped to [10, 22].
//
// The pure decision functions (`resolveSwipeIntent`, `resolveEdgeIntent`,
// `resolvePinchStep`) are exported for hermetic tests. The DOM-attaching
// `attachTouchGestures` wires them to TouchEvent listeners and asks the
// caller-provided callbacks to perform the actual workspace switch /
// drawer toggle / font-size step.
//
// The router is mobile-first by default but stays out of the way on
// desktop: gestures only fire when the pointer reports `touch`.

/** Outcome of a horizontal swipe over the pane area. */
export type SwipeIntent = "prev" | "next" | "none";

/** Pure: classify a finished swipe given start/end coordinates and the
 *  viewport width. Hysteresis keeps slow finger drift from triggering
 *  workspace switches; the axis-dominance check rejects long vertical
 *  swipes that happen to drift horizontally a few pixels. */
export function resolveSwipeIntent(
  dx: number,
  dy: number,
  viewportWidth: number,
): SwipeIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // Threshold: 60 px or 30% of viewport (whichever is smaller).
  const threshold = Math.min(60, viewportWidth * 0.3);
  if (ax < threshold) return "none";
  // Axis dominance — dx must clearly outweigh dy.
  if (ax < ay * 1.4) return "none";
  return dx < 0 ? "next" : "prev";
}

/** Outcome of an edge-swipe — drawer commands, separate from workspace switching. */
export type EdgeIntent = "open" | "close" | "none";

/** Pure: classify an edge-swipe. The start x decides which edge; the
 *  delta has to be >= 40 px to count. Right-swipe from the left edge
 *  opens the drawer; left-swipe anywhere when the drawer is already
 *  open closes it. */
export function resolveEdgeIntent(
  startX: number,
  dx: number,
  drawerOpen: boolean,
): EdgeIntent {
  const EDGE_GUTTER = 24;
  const MIN_DELTA = 40;
  if (Math.abs(dx) < MIN_DELTA) return "none";
  // Closing always wins — even if the start wasn't near the edge,
  // a left-swipe on an open drawer should retract it.
  if (drawerOpen && dx < -MIN_DELTA) return "close";
  // Opening requires a right-swipe starting in the left gutter.
  if (!drawerOpen && startX <= EDGE_GUTTER && dx > MIN_DELTA) return "open";
  return "none";
}

/** Pure: given the starting pinch distance and the current distance,
 *  return the integer font-size delta to apply to the previous size.
 *  One step per 12% relative change, capped to ±4 per gesture so a
 *  rough pinch doesn't blow past the target. */
export function resolvePinchStep(
  startDistance: number,
  currentDistance: number,
): number {
  if (startDistance <= 0 || currentDistance <= 0) return 0;
  const ratio = currentDistance / startDistance;
  // Each 12% step = ±1 font px. Bias by a tiny epsilon in the
  // direction of motion so float drift on `1/1.12 ≈ -0.99999` rounds
  // to -1 instead of -0.
  const raw = Math.log(ratio) / Math.log(1.12);
  const sign = raw < 0 ? -1 : 1;
  const stepped = sign * Math.floor(Math.abs(raw) + 1e-9);
  if (stepped > 4) return 4;
  if (stepped < -4) return -4;
  return stepped;
}

/** Compute the new font size, honouring the [min, max] clamp. */
export function applyPinchStep(
  baseSize: number,
  step: number,
  min = 10,
  max = 22,
): number {
  const next = baseSize + step;
  if (next < min) return min;
  if (next > max) return max;
  return next;
}

// ── DOM wiring ───────────────────────────────────────────────

export interface TouchGestureCallbacks {
  /** Called when the user swipes horizontally over the pane area. */
  onWorkspaceStep: (direction: "prev" | "next") => void;
  /** Called when an edge-swipe should open / close the sidebar drawer. */
  onDrawerToggle: (next: "open" | "close") => void;
  /** Called when a two-finger pinch should bump the font size. */
  onFontStep: (step: number) => void;
  /** Reads the current drawer state so resolveEdgeIntent gets fresh
   *  context (sidebar can also be opened by tapping the toggle). */
  isDrawerOpen: () => boolean;
}

export interface AttachTouchGesturesDeps extends TouchGestureCallbacks {
  /** Element that scoping horizontal swipes (typically pane container). */
  paneArea: HTMLElement;
  /** Body / document element for edge-swipe + pinch. */
  rootEl: HTMLElement;
  /** Returns the element under the pinch start so we only fire pinch
   *  when the user is actually on a terminal pane (not a sideband
   *  panel that wants its own pinch / scroll behaviour). */
  isTerminalElement?: (el: Element | null) => boolean;
}

/** Attach the gesture router. Returns a teardown function that removes
 *  every listener registered during attach (caller can detach for
 *  layout swaps or before disposing the page). */
export function attachTouchGestures(deps: AttachTouchGesturesDeps): () => void {
  const {
    paneArea,
    rootEl,
    onWorkspaceStep,
    onDrawerToggle,
    onFontStep,
    isDrawerOpen,
    isTerminalElement = () => true,
  } = deps;

  let swipeStart: { x: number; y: number; t: number } | null = null;
  let edgeStart: { x: number; t: number } | null = null;
  let pinchStartDistance = 0;
  let pinchActive = false;
  let lastFontStep = 0;

  // ── Swipe (single finger) on paneArea ─────────────────────

  function onSwipeStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    swipeStart = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onSwipeEnd(e: TouchEvent) {
    if (!swipeStart) return;
    const ct = e.changedTouches[0];
    if (!ct) {
      swipeStart = null;
      return;
    }
    const dx = ct.clientX - swipeStart.x;
    const dy = ct.clientY - swipeStart.y;
    const elapsed = Date.now() - swipeStart.t;
    swipeStart = null;
    // Reject very slow drags — they're scrolls, not swipes.
    if (elapsed > 800) return;
    const intent = resolveSwipeIntent(
      dx,
      dy,
      window.innerWidth || document.documentElement.clientWidth || 320,
    );
    if (intent !== "none") onWorkspaceStep(intent);
  }

  // ── Edge swipe (single finger) on rootEl ──────────────────

  function onEdgeStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    edgeStart = { x: t.clientX, t: Date.now() };
  }
  function onEdgeEnd(e: TouchEvent) {
    if (!edgeStart) return;
    const ct = e.changedTouches[0];
    if (!ct) {
      edgeStart = null;
      return;
    }
    const dx = ct.clientX - edgeStart.x;
    const startX = edgeStart.x;
    edgeStart = null;
    const intent = resolveEdgeIntent(startX, dx, isDrawerOpen());
    if (intent !== "none") onDrawerToggle(intent);
  }

  // ── Pinch (two fingers) on terminal panes ─────────────────

  function onPinchStart(e: TouchEvent) {
    if (e.touches.length !== 2) return;
    const t0 = e.touches[0]!;
    const t1 = e.touches[1]!;
    const target = e.target as Element | null;
    if (!isTerminalElement(target)) return;
    const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    if (dist <= 0) return;
    pinchStartDistance = dist;
    pinchActive = true;
    lastFontStep = 0;
    if (e.cancelable) e.preventDefault();
  }
  function onPinchMove(e: TouchEvent) {
    if (!pinchActive || e.touches.length !== 2) return;
    const t0 = e.touches[0]!;
    const t1 = e.touches[1]!;
    const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    const step = resolvePinchStep(pinchStartDistance, dist);
    if (step === lastFontStep) return;
    const delta = step - lastFontStep;
    lastFontStep = step;
    onFontStep(delta);
    if (e.cancelable) e.preventDefault();
  }
  function onPinchEnd() {
    pinchActive = false;
    pinchStartDistance = 0;
    lastFontStep = 0;
  }

  // ── Listener install ──────────────────────────────────────

  const passive: AddEventListenerOptions = { passive: true };
  const active: AddEventListenerOptions = { passive: false };

  paneArea.addEventListener("touchstart", onSwipeStart, passive);
  paneArea.addEventListener("touchend", onSwipeEnd, passive);
  paneArea.addEventListener("touchcancel", onSwipeEnd, passive);

  rootEl.addEventListener("touchstart", onEdgeStart, passive);
  rootEl.addEventListener("touchend", onEdgeEnd, passive);
  rootEl.addEventListener("touchcancel", onEdgeEnd, passive);

  // Pinch is `passive: false` so we can preventDefault the scroll /
  // page-zoom that two-finger gestures normally trigger.
  rootEl.addEventListener("touchstart", onPinchStart, active);
  rootEl.addEventListener("touchmove", onPinchMove, active);
  rootEl.addEventListener("touchend", onPinchEnd, passive);
  rootEl.addEventListener("touchcancel", onPinchEnd, passive);

  return () => {
    paneArea.removeEventListener("touchstart", onSwipeStart);
    paneArea.removeEventListener("touchend", onSwipeEnd);
    paneArea.removeEventListener("touchcancel", onSwipeEnd);
    rootEl.removeEventListener("touchstart", onEdgeStart);
    rootEl.removeEventListener("touchend", onEdgeEnd);
    rootEl.removeEventListener("touchcancel", onEdgeEnd);
    rootEl.removeEventListener("touchstart", onPinchStart);
    rootEl.removeEventListener("touchmove", onPinchMove);
    rootEl.removeEventListener("touchend", onPinchEnd);
    rootEl.removeEventListener("touchcancel", onPinchEnd);
  };
}

// ── Workspace navigation helpers (pure) ──────────────────────

/** Pure: pick the workspace id one step away from `currentId` in
 *  `workspaces`. Wraps at the ends. Returns the same id (no change)
 *  when fewer than two workspaces exist. */
export function pickWorkspaceStep(
  workspaces: { id: string }[],
  currentId: string | null,
  direction: "prev" | "next",
): string | null {
  if (workspaces.length === 0) return null;
  if (workspaces.length === 1) return workspaces[0]!.id;
  let idx = workspaces.findIndex((w) => w.id === currentId);
  if (idx === -1) idx = 0;
  const delta = direction === "next" ? 1 : -1;
  const nextIdx = (idx + delta + workspaces.length) % workspaces.length;
  return workspaces[nextIdx]!.id;
}
