// Mouse / touch / wheel routing for interactive panels.
//
// Drag and resize gestures use the unified Pointer Events API plus
// `setPointerCapture` so once the gesture starts the source element
// keeps receiving move/end/cancel events even if the pointer leaves
// the element bounds, lands on a different overlay, or the OS hands
// focus elsewhere mid-drag (D.1). Compared to the previous
// `document.addEventListener('mousemove' | 'touchmove' | …)` scheme,
// this means a stuck-drag bug after a fast off-screen flick is no
// longer possible — the browser guarantees an end event.
//
// Wheel and per-element mouse events still use the legacy listeners;
// migrating those is unrelated to drag stickiness and would fan the
// diff out across surfaces this module isn't responsible for.

export type SendMsg = (type: string, payload: Record<string, unknown>) => void;

interface PointerXY {
  clientX: number;
  clientY: number;
}

/** Begin a drag-style gesture on `source` for the pointer that just
 *  fired `pointerdown`. Captures the pointer so subsequent move / end
 *  events fire on `source` regardless of cursor position; releases
 *  the capture on `pointerup` or `pointercancel`. The end callback
 *  fires for both — distinguishing them isn't useful at the gesture
 *  layer, only that the gesture ended. */
function startPointerDrag(
  source: HTMLElement,
  pointerId: number,
  onMove: (p: PointerXY) => void,
  onEnd: (p: PointerXY) => void,
): void {
  try {
    source.setPointerCapture(pointerId);
  } catch {
    /* Some test environments / older browsers don't implement capture.
     * Fall through — the listeners below still work, they just don't
     * follow the pointer outside the element. */
  }

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    onMove({ clientX: e.clientX, clientY: e.clientY });
  };
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    source.removeEventListener("pointermove", move);
    source.removeEventListener("pointerup", end);
    source.removeEventListener("pointercancel", end);
    try {
      source.releasePointerCapture(pointerId);
    } catch {
      /* already released — captures auto-release on pointerup */
    }
    onEnd({ clientX: e.clientX, clientY: e.clientY });
  };

  source.addEventListener("pointermove", move);
  source.addEventListener("pointerup", end);
  source.addEventListener("pointercancel", end);
}

/** Forward panel mouse/touch/wheel events to the server. */
export function setupPanelMouse(
  el: HTMLElement,
  panelId: string,
  surfaceId: string,
  sendMsg: SendMsg,
): void {
  let lastMoveTime = 0;

  function sendXY(
    evtName: string,
    cx: number,
    cy: number,
    btn: number,
    btns: number,
  ) {
    const rect = el.getBoundingClientRect();
    sendMsg("panelMouseEvent", {
      surfaceId,
      id: panelId,
      event: evtName,
      x: Math.round(cx - rect.left),
      y: Math.round(cy - rect.top),
      button: btn,
      buttons: btns,
    });
  }

  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendXY("mousedown", e.clientX, e.clientY, e.button, e.buttons);
  });
  el.addEventListener("mouseup", (e) => {
    e.stopPropagation();
    sendXY("mouseup", e.clientX, e.clientY, e.button, 0);
  });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    sendXY("click", e.clientX, e.clientY, e.button, 0);
  });
  el.addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - lastMoveTime < 16) return;
    lastMoveTime = now;
    sendXY("mousemove", e.clientX, e.clientY, 0, e.buttons);
  });
  el.addEventListener("mouseenter", (e) => {
    sendXY("mouseenter", e.clientX, e.clientY, 0, e.buttons);
  });
  el.addEventListener("mouseleave", (e) => {
    sendXY("mouseleave", e.clientX, e.clientY, 0, 0);
  });
  el.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.touches[0];
      if (t) sendXY("mousedown", t.clientX, t.clientY, 0, 1);
      function onTouchMove(me: TouchEvent) {
        me.preventDefault();
        const mt = me.touches[0];
        if (mt) sendXY("mousemove", mt.clientX, mt.clientY, 0, 1);
      }
      function onTouchEnd(me: TouchEvent) {
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
        document.removeEventListener("touchcancel", onTouchEnd);
        const ct = me.changedTouches[0];
        if (ct) sendXY("mouseup", ct.clientX, ct.clientY, 0, 0);
      }
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("touchcancel", onTouchEnd);
    },
    { passive: false },
  );
  el.addEventListener(
    "wheel",
    (e) => {
      const rect = el.getBoundingClientRect();
      sendMsg("panelMouseEvent", {
        surfaceId,
        id: panelId,
        event: "wheel",
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top),
        deltaX: Math.round(e.deltaX),
        deltaY: Math.round(e.deltaY),
        buttons: e.buttons,
      });
    },
    { passive: true },
  );
}

/** Make a panel draggable by its handle; emits `dragend` on release. */
export function setupPanelDrag(
  el: HTMLElement,
  handle: HTMLElement,
  panelId: string,
  surfaceId: string,
  sendMsg: SendMsg,
): void {
  handle.addEventListener("pointerdown", (e) => {
    // Only respond to the primary button on mouse pointers; let touch
    // / pen pointers through (pointerType !== "mouse" has no `button`
    // semantics worth filtering on).
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseInt(el.style.left) || 0;
    const startTop = parseInt(el.style.top) || 0;
    startPointerDrag(
      handle,
      e.pointerId,
      (mp) => {
        el.style.left = startLeft + mp.clientX - startX + "px";
        el.style.top = startTop + mp.clientY - startY + "px";
      },
      () => {
        sendMsg("panelMouseEvent", {
          surfaceId,
          id: panelId,
          event: "dragend",
          x: parseInt(el.style.left) || 0,
          y: parseInt(el.style.top) || 0,
        });
      },
    );
  });
}

/** Resize a panel from its handle; emits `resize` on release. */
export function setupPanelResize(
  el: HTMLElement,
  handle: HTMLElement,
  panelId: string,
  surfaceId: string,
  sendMsg: SendMsg,
): void {
  handle.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    startPointerDrag(
      handle,
      e.pointerId,
      (mp) => {
        el.style.width = Math.max(120, startW + mp.clientX - startX) + "px";
        el.style.height = Math.max(72, startH + mp.clientY - startY) + "px";
      },
      () => {
        sendMsg("panelMouseEvent", {
          surfaceId,
          id: panelId,
          event: "resize",
          width: el.offsetWidth,
          height: el.offsetHeight,
        });
      },
    );
  });
}
