import type { Terminal } from "xterm";
import type { SidebandMetaMessage, PanelEvent } from "../../shared/types";
import { Panel } from "./panel";

export class PanelManager {
  private panels = new Map<string, Panel>();
  private pendingData = new Map<string, Uint8Array>();
  private lastTerminalResize: {
    cols: number;
    rows: number;
    pxWidth: number;
    pxHeight: number;
  } | null = null;

  constructor(
    private container: HTMLElement,
    private term: Terminal,
    private onEvent: (event: PanelEvent) => void,
  ) {
    // Update inline panels on scroll
    term.onScroll(() => this.updateInlinePanels());
    term.onResize(() => this.updateInlinePanels());
  }

  handleMeta(msg: SidebandMetaMessage): void {
    if (msg.type === "clear") {
      const panel = this.panels.get(msg.id);
      if (panel) {
        panel.remove();
        this.panels.delete(msg.id);
      }
      return;
    }

    if (msg.type === "update") {
      const panel = this.panels.get(msg.id);
      if (panel) {
        panel.updateMeta(msg);
      }
      return;
    }

    // Create new panel (image, svg, html, canvas2d)
    const existing = this.panels.get(msg.id);
    if (existing) {
      existing.remove();
    }

    const panel = new Panel(msg, this.container, (event) => {
      if (event.event === "close") {
        this.panels.get(event.id)?.remove();
        this.panels.delete(event.id);
      }
      this.onEvent(event);
    });
    this.panels.set(msg.id, panel);
    this.lastTerminalResize = null;
    this.emitTerminalResizeIfNeeded();

    // Resolve anchor row for inline panels
    if (panel.isInline) {
      panel.anchorRow = this.resolveAnchorRow(msg);
      this.updateInlinePanels();
    }

    // Check for pending data
    const pending = this.pendingData.get(msg.id);
    if (pending) {
      panel.setContent(pending);
      this.pendingData.delete(msg.id);
    }
  }

  handleData(id: string, base64: string): void {
    const binary = base64ToUint8Array(base64);

    const panel = this.panels.get(id);
    if (panel) {
      panel.setContent(binary);
    } else {
      this.pendingData.set(id, binary);
    }
  }

  /** Call after terminal resize to reposition inline panels */
  updateInlinePanels(): void {
    const buf = this.term.buffer.active;
    const viewportY = buf.baseY - (buf.baseY - buf.viewportY);
    const cellHeight = this.measureCellHeight();
    const visibleRows = this.term.rows;

    for (const panel of this.panels.values()) {
      if (panel.isInline) {
        panel.updateInlinePosition(viewportY, cellHeight, visibleRows);
      }
    }

    this.emitTerminalResizeIfNeeded();
  }

  private emitTerminalResizeIfNeeded(): void {
    const rect = this.container.getBoundingClientRect();
    const pxWidth = Math.round(rect.width);
    const pxHeight = Math.round(rect.height);
    const cols = this.term.cols;
    const rows = this.term.rows;

    if (pxWidth <= 0 || pxHeight <= 0 || cols <= 0 || rows <= 0) return;

    if (
      this.lastTerminalResize?.cols === cols &&
      this.lastTerminalResize?.rows === rows &&
      this.lastTerminalResize?.pxWidth === pxWidth &&
      this.lastTerminalResize?.pxHeight === pxHeight
    ) {
      return;
    }

    this.lastTerminalResize = { cols, rows, pxWidth, pxHeight };
    this.onEvent({
      id: "__terminal__",
      event: "resize",
      cols,
      rows,
      pxWidth,
      pxHeight,
    });
  }

  private resolveAnchorRow(msg: SidebandMetaMessage): number {
    const buf = this.term.buffer.active;
    if (msg.anchor && typeof msg.anchor === "object" && "row" in msg.anchor) {
      return msg.anchor.row;
    }
    // Default: "cursor" — current absolute cursor row
    return buf.baseY + buf.cursorY;
  }

  private measureCellHeight(): number {
    const termEl = this.container.parentElement;
    if (termEl) {
      const row = termEl.querySelector(".xterm-rows > div");
      if (row) return row.getBoundingClientRect().height;
    }
    // Fallback: estimate from font size and line height
    return 17;
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
