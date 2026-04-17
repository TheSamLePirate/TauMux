// Mouse / touch / wheel routing for interactive panels.
//
// Three gestures share one pattern (grab a pointer, install document
// listeners for move + end, tear them down on release). We factor out:
//
//   - pointerXY: unify mouse and touch event coordinate reads
//   - sendPanelMouseEvent: build + forward the JSON envelope
//   - startPointerDrag: document listener install/remove for
//     mousemove/mouseup/touchmove/touchend/touchcancel
//
// The three entry points then become thin wrappers with slightly
// different state capture and release behavior.

export type SendMsg = (type: string, payload: Record<string, unknown>) => void;

interface PointerXY {
  clientX: number;
  clientY: number;
}

function pointerXY(e: MouseEvent | TouchEvent): PointerXY {
  if ("touches" in e) {
    const t = e.touches[0] || e.changedTouches[0];
    if (t) return { clientX: t.clientX, clientY: t.clientY };
    return { clientX: 0, clientY: 0 };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

function startPointerDrag(
  onMove: (p: PointerXY, e: MouseEvent | TouchEvent) => void,
  onEnd: (p: PointerXY, e: MouseEvent | TouchEvent) => void,
): void {
  function move(e: MouseEvent | TouchEvent) {
    if ("touches" in e && e.cancelable) e.preventDefault();
    onMove(pointerXY(e), e);
  }
  function end(e: MouseEvent | TouchEvent) {
    document.removeEventListener("mousemove", move as EventListener);
    document.removeEventListener("mouseup", end as EventListener);
    document.removeEventListener("touchmove", move as EventListener);
    document.removeEventListener("touchend", end as EventListener);
    document.removeEventListener("touchcancel", end as EventListener);
    onEnd(pointerXY(e), e);
  }
  document.addEventListener("mousemove", move as EventListener);
  document.addEventListener("mouseup", end as EventListener);
  document.addEventListener("touchmove", move as EventListener, {
    passive: false,
  });
  document.addEventListener("touchend", end as EventListener);
  document.addEventListener("touchcancel", end as EventListener);
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
  function startDrag(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    const p = pointerXY(e);
    const startX = p.clientX;
    const startY = p.clientY;
    const startLeft = parseInt(el.style.left) || 0;
    const startTop = parseInt(el.style.top) || 0;
    startPointerDrag(
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
  }
  handle.addEventListener("mousedown", startDrag as EventListener);
  handle.addEventListener("touchstart", startDrag as EventListener, {
    passive: false,
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
  function startResize(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    const p = pointerXY(e);
    const startX = p.clientX;
    const startY = p.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    startPointerDrag(
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
  }
  handle.addEventListener("mousedown", startResize as EventListener);
  handle.addEventListener("touchstart", startResize as EventListener, {
    passive: false,
  });
}
