import type { SidebandContentMessage, PanelEvent } from "../../shared/types";
import { createIcon } from "./icons";
import {
  getRenderer,
  getRendererIcon,
  getRendererCssClass,
} from "./content-renderers";
import { renderSandboxedMarkup } from "../../shared/sideband-sandbox";

export class Panel {
  readonly id: string;
  readonly el: HTMLDivElement;
  readonly isInline: boolean;
  readonly isFixed: boolean;
  anchorRow: number;
  private contentEl: HTMLDivElement;
  private dragHandle: HTMLDivElement;
  private closeBtn: HTMLDivElement;
  private resizeHandle: HTMLDivElement;
  private meta: SidebandContentMessage;
  private onEvent: (e: PanelEvent) => void;
  private hasContent = false;
  private currentTypeCssClass: string | null = null;
  private contentRect: DOMRect | null = null;

  constructor(
    meta: SidebandContentMessage,
    container: HTMLElement,
    onEvent: (e: PanelEvent) => void,
  ) {
    this.id = meta.id;
    this.meta = meta;
    this.onEvent = onEvent;
    this.isInline = meta.position === "inline";
    this.isFixed = meta.position === "fixed";
    this.anchorRow = 0;

    this.el = document.createElement("div");
    this.el.className = "panel";
    this.el.dataset["panelId"] = meta.id;

    this.dragHandle = document.createElement("div");
    this.dragHandle.className = "panel-drag-handle";

    this.closeBtn = document.createElement("div");
    this.closeBtn.className = "panel-close-btn";
    this.closeBtn.append(createIcon("close", "", 12));
    this.closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onEvent({ id: this.id, event: "close" });
    });

    const titleGroup = document.createElement("div");
    titleGroup.className = "panel-title-group";
    titleGroup.append(
      createIcon(getRendererIcon(meta.type), "panel-title-icon", 12),
    );

    const titleEl = document.createElement("span");
    titleEl.className = "panel-title";
    titleEl.textContent = meta.id;
    titleGroup.appendChild(titleEl);

    this.dragHandle.appendChild(titleGroup);
    this.dragHandle.appendChild(this.closeBtn);

    this.contentEl = document.createElement("div");
    this.contentEl.className = "panel-content";

    this.resizeHandle = document.createElement("div");
    this.resizeHandle.className = "panel-resize-handle";

    if (!this.isFixed) {
      this.el.appendChild(this.dragHandle);
    }
    this.el.appendChild(this.contentEl);
    if (!this.isFixed) {
      this.el.appendChild(this.resizeHandle);
    }

    this.syncClasses();
    this.applyMeta(meta);
    if (meta.data !== undefined) {
      this.renderInlineData(meta.data);
      this.hasContent = true;
    }
    this.setupDrag();
    this.setupResize();
    this.setupInteractive(meta.interactive ?? false);

    container.appendChild(this.el);

    // W1-SIDEBAND — the resting opacity is already set to the target by
    // `applyMeta` above (line 82), synchronously. We do NOT gate visibility
    // on a rAF: WKWebView suspends rAF when the window is backgrounded, and
    // the old `opacity=0; rAF(() => opacity=target)` stranded panels fully
    // transparent until something else happened to re-render them. The
    // entrance fade is now a CSS keyframe (`.panel-enter`) whose resting
    // state is the target opacity, so it can never leave the panel invisible.
    // Strip the class via several idempotent nets — first to fire wins; if
    // all are suspended the resting opacity still shows the panel.
    this.el.classList.add("panel-enter");
    const reveal = () => this.el.classList.remove("panel-enter");
    requestAnimationFrame(reveal);
    setTimeout(reveal, 200);
    this.el.addEventListener("animationend", reveal, { once: true });
  }

  updateMeta(msg: SidebandContentMessage): void {
    if (msg.x !== undefined) this.meta.x = msg.x;
    if (msg.y !== undefined) this.meta.y = msg.y;
    if (msg.width !== undefined) this.meta.width = msg.width;
    if (msg.height !== undefined) this.meta.height = msg.height;
    if (msg.zIndex !== undefined) this.meta.zIndex = msg.zIndex;
    if (msg.opacity !== undefined) this.meta.opacity = msg.opacity;
    if (msg.borderRadius !== undefined) {
      this.meta.borderRadius = msg.borderRadius;
    }
    if (msg.interactive !== undefined) {
      this.meta.interactive = msg.interactive;
      this.setupInteractive(msg.interactive);
    }
    if (msg.data !== undefined) {
      this.renderInlineData(msg.data);
    }

    this.syncClasses();
    this.applyMeta(this.meta);
  }

  /**
   * H4 (full_app_review_2026-05.md §7.2): the inline `meta.data` markup
   * sink. Display-only html/svg renders inside the shared sandboxed iframe
   * (no scripts, no same-origin, strict CSP) so a sideband producer can't
   * run script with the native webview's Electrobun RPC privilege. An
   * interactive panel forwards DOM events via listeners on `contentEl`,
   * which an iframe would intercept, so it keeps the DIRECT path — the
   * explicit, opt-in native trust boundary. Non-markup inline data (any
   * other type) is unchanged.
   */
  private renderInlineData(data: string): void {
    const type = this.meta.type;
    if ((type === "html" || type === "svg") && !this.meta.interactive) {
      // `type` is narrowed to "html" | "svg" here; the cast placates the
      // `(string & {})` autocomplete-union on SidebandContentMessage.type.
      renderSandboxedMarkup(this.contentEl, data, type as "html" | "svg");
    } else {
      this.contentEl.innerHTML = data;
    }
  }

  setContent(data: Uint8Array): void {
    const renderer = getRenderer(this.meta.type);
    if (!renderer) return;

    if (this.hasContent) {
      renderer.update(this.contentEl, data, this.meta);
    } else {
      renderer.mount(this.contentEl, data, this.meta);
      this.hasContent = true;
    }
  }

  updateInlinePosition(
    viewportY: number,
    cellHeight: number,
    visibleRows: number,
  ): void {
    if (!this.isInline) return;
    const visibleRow = this.anchorRow - viewportY;
    if (visibleRow < 0 || visibleRow >= visibleRows) {
      this.el.style.display = "none";
    } else {
      this.el.style.display = "";
      this.el.style.top = `${visibleRow * cellHeight}px`;
    }
  }

  remove(): void {
    if (this.hasContent) {
      const renderer = getRenderer(this.meta.type);
      renderer?.destroy?.(this.contentEl);
    }
    this.el.remove();
  }

  private syncClasses(): void {
    this.el.classList.toggle(
      "panel-position-inline",
      this.meta.position === "inline",
    );
    this.el.classList.toggle(
      "panel-position-float",
      this.meta.position === "float",
    );
    this.el.classList.toggle(
      "panel-position-overlay",
      this.meta.position === "overlay",
    );
    this.el.classList.toggle(
      "panel-position-fixed",
      this.meta.position === "fixed",
    );
    this.el.classList.toggle(
      "panel-interactive",
      Boolean(this.meta.interactive),
    );

    // Remove previous type class, apply current from renderer registry
    if (this.currentTypeCssClass) {
      this.el.classList.remove(`panel-type-${this.currentTypeCssClass}`);
    }
    const cssClass = getRendererCssClass(this.meta.type);
    if (cssClass) {
      this.el.classList.add(`panel-type-${cssClass}`);
      this.currentTypeCssClass = cssClass;
    } else {
      this.currentTypeCssClass = null;
    }
  }

  private applyMeta(m: SidebandContentMessage): void {
    const s = this.el.style;
    if (m.x !== undefined) s.left = `${m.x}px`;
    if (m.y !== undefined) s.top = `${m.y}px`;
    if (m.width !== undefined && m.width !== "auto") s.width = `${m.width}px`;
    if (m.height !== undefined && m.height !== "auto")
      s.height = `${m.height}px`;
    if (m.zIndex !== undefined) s.zIndex = String(m.zIndex);
    // W1-SIDEBAND — always assert the resting opacity (default 1). `m` is
    // `this.meta` on updates, so an explicitly-set opacity persists; an
    // unset one resolves to fully opaque. This makes every meta update
    // self-heal a panel that somehow ended up transparent, matching the
    // web mirror's opaque-by-default behaviour.
    s.opacity = String(m.opacity ?? 1);
    if (m.borderRadius !== undefined) s.borderRadius = `${m.borderRadius}px`;
    if (this.isInline && m.x === undefined) s.left = "12px";

    const isFixed = m.position === "fixed";
    const draggable = isFixed ? false : (m.draggable ?? m.position === "float");
    this.dragHandle.style.display = draggable ? "flex" : "none";

    const resizable = isFixed ? false : (m.resizable ?? m.position === "float");
    this.resizeHandle.style.display = resizable ? "block" : "none";
  }

  private setupDrag(): void {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let lastDx = 0;
    let lastDy = 0;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      lastDx = dx;
      lastDy = dy;
      this.el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      this.dragHandle.style.cursor = "grab";
      this.el.classList.remove("panel-dragging");
      this.el.style.transform = "";
      this.meta.x = Math.round(startLeft + lastDx);
      this.meta.y = Math.round(startTop + lastDy);
      this.el.style.left = `${this.meta.x}px`;
      this.el.style.top = `${this.meta.y}px`;
      this.onEvent({
        id: this.id,
        event: "dragend",
        x: this.meta.x,
        y: this.meta.y,
      });
    };

    this.dragHandle.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).classList.contains("panel-close-btn"))
        return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(this.el.style.left) || 0;
      startTop = parseInt(this.el.style.top) || 0;
      this.dragHandle.style.cursor = "grabbing";
      this.el.classList.add("panel-dragging");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  private setupResize(): void {
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let pendingW = 0;
    let pendingH = 0;
    let resizeFrame: number | null = null;

    const onMouseMove = (e: MouseEvent) => {
      pendingW = Math.max(120, startW + (e.clientX - startX));
      pendingH = Math.max(72, startH + (e.clientY - startY));
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        this.el.style.width = `${pendingW}px`;
        this.el.style.height = `${pendingH}px`;
        this.contentRect = null;
      });
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      if (pendingW > 0 && pendingH > 0) {
        this.el.style.width = `${pendingW}px`;
        this.el.style.height = `${pendingH}px`;
      }
      this.el.classList.remove("panel-resizing");
      this.meta.width = parseInt(this.el.style.width);
      this.meta.height = parseInt(this.el.style.height);
      this.onEvent({
        id: this.id,
        event: "resize",
        width: parseInt(this.el.style.width),
        height: parseInt(this.el.style.height),
      });
    };

    this.resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startW = this.el.offsetWidth;
      startH = this.el.offsetHeight;
      this.el.classList.add("panel-resizing");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  private setupInteractive(interactive: boolean): void {
    this.el.classList.toggle("panel-interactive", interactive);
    if (interactive) {
      this.contentEl.classList.remove("non-interactive");
      this.contentEl.addEventListener("click", this.handleContentEvent);
      this.contentEl.addEventListener("mousedown", this.handleContentEvent);
      this.contentEl.addEventListener("mouseup", this.handleContentEvent);
      this.contentEl.addEventListener("mousemove", this.handleMouseMove);
      this.contentEl.addEventListener("mouseenter", this.handleContentEvent);
      this.contentEl.addEventListener("mouseleave", this.handleContentEvent);
      this.contentEl.addEventListener("wheel", this.handleWheel, {
        passive: true,
      });
    } else {
      this.contentEl.classList.add("non-interactive");
      this.contentEl.removeEventListener("click", this.handleContentEvent);
      this.contentEl.removeEventListener("mousedown", this.handleContentEvent);
      this.contentEl.removeEventListener("mouseup", this.handleContentEvent);
      this.contentEl.removeEventListener("mousemove", this.handleMouseMove);
      this.contentEl.removeEventListener("mouseenter", this.handleContentEvent);
      this.contentEl.removeEventListener("mouseleave", this.handleContentEvent);
      this.contentEl.removeEventListener("wheel", this.handleWheel);
    }
  }

  private handleContentEvent = (e: MouseEvent): void => {
    if (e.type === "mouseenter" || e.type === "mousedown") {
      this.contentRect = this.contentEl.getBoundingClientRect();
    }
    const rect = this.contentRect ?? this.contentEl.getBoundingClientRect();
    if (e.type === "mouseleave") this.contentRect = null;
    // Listeners are only attached for the six pointer event types below,
    // so e.type is always a PanelPointerEventName at runtime.
    this.onEvent({
      id: this.id,
      event: e.type as
        | "mousedown"
        | "mouseup"
        | "click"
        | "mousemove"
        | "mouseenter"
        | "mouseleave",
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
      button: e.button,
      buttons: e.buttons,
    });
  };

  // Throttle mousemove to ~60 fps to avoid flooding fd5
  private lastMoveTime = 0;
  private handleMouseMove = (e: MouseEvent): void => {
    const now = performance.now();
    if (now - this.lastMoveTime < 16) return;
    this.lastMoveTime = now;
    this.handleContentEvent(e);
  };

  private handleWheel = (e: WheelEvent): void => {
    const rect = this.contentEl.getBoundingClientRect();
    this.contentRect = rect;
    this.onEvent({
      id: this.id,
      event: "wheel",
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
      deltaX: Math.round(e.deltaX),
      deltaY: Math.round(e.deltaY),
      buttons: e.buttons,
    });
  };
}
