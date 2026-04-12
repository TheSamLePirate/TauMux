/**
 * HyperTerm Canvas — TypeScript/Bun client library.
 *
 * Usage:
 *   import { ht } from "./hyperterm";
 *
 *   const id = ht.showSvg('<svg>...</svg>', { x: 100, y: 50 });
 *   ht.update(id, { x: 200 });
 *   ht.clear(id);
 *
 *   ht.onEvent((event) => console.log(event));
 *
 * When not running inside HyperTerm, all methods are safe no-ops.
 */

let _counter = 0;

function nextId(prefix = "ht"): string {
  return `${prefix}_${process.pid}_${++_counter}`;
}

// === Types ===

export interface PanelOptions {
  /** X position in pixels (default: 100) */
  x?: number;
  /** Y position in pixels (default: 100) */
  y?: number;
  /** Width in pixels or "auto" */
  width?: number | "auto";
  /** Height in pixels or "auto" */
  height?: number | "auto";
  /** Positioning mode */
  position?: "float" | "inline" | "overlay" | "fixed";
  /** Anchor for inline panels */
  anchor?: "cursor" | { row: number };
  /** Allow dragging (default: true for float) */
  draggable?: boolean;
  /** Allow resizing (default: true for float) */
  resizable?: boolean;
  /** Forward mouse/wheel events to fd5 */
  interactive?: boolean;
  /** CSS z-index stacking order */
  zIndex?: number;
  /** Opacity 0.0 - 1.0 */
  opacity?: number;
  /** Border radius in pixels */
  borderRadius?: number;
  /** Named data channel (default: "data") */
  dataChannel?: string;
  /** Timeout in ms for binary read (default: 5000) */
  timeout?: number;
  /** Image format hint (for "image" type): "png", "jpeg", "webp", "gif" */
  format?: string;
}

/** Mouse event data from an interactive panel */
export interface MouseEventData {
  /** Panel ID */
  id: string;
  /** Event type */
  event: string;
  /** X coordinate relative to panel content */
  x: number;
  /** Y coordinate relative to panel content */
  y: number;
  /** Mouse button (0=left, 1=middle, 2=right) */
  button: number;
  /** Bitmask of pressed buttons */
  buttons: number;
}

/** Wheel event data from an interactive panel */
export interface WheelEventData {
  id: string;
  x: number;
  y: number;
  /** Horizontal scroll delta */
  deltaX: number;
  /** Vertical scroll delta */
  deltaY: number;
  buttons: number;
}

/** Panel dragged to new position */
export interface DragEventData {
  id: string;
  x: number;
  y: number;
}

/** Panel resized to new dimensions */
export interface ResizeEventData {
  id: string;
  width: number;
  height: number;
}

/** Terminal resize event (from __terminal__ pseudo-panel) */
export interface TerminalResizeData {
  cols: number;
  rows: number;
  pxWidth: number;
  pxHeight: number;
}

/** Raw event from fd5 — superset of all event fields */
export interface HyperTermEvent {
  id: string;
  event: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  button?: number;
  buttons?: number;
  deltaX?: number;
  deltaY?: number;
  cols?: number;
  rows?: number;
  pxWidth?: number;
  pxHeight?: number;
  /** Error code (id="__system__", event="error") */
  code?: string;
  /** Error message (id="__system__", event="error") */
  message?: string;
  /** Reference panel id for system events */
  ref?: string;
}

export interface ChannelDescriptor {
  name: string;
  fd: number;
  direction: "out" | "in";
  encoding: "jsonl" | "binary";
}

export interface ChannelMap {
  version: number;
  channels: ChannelDescriptor[];
}

// === Event dispatcher ===

type EventCallback = (event: HyperTermEvent) => void;

class EventDispatcher {
  private listeners: EventCallback[] = [];
  private panelListeners = new Map<string, Map<string, EventCallback[]>>();
  private terminalResizeListeners: ((data: TerminalResizeData) => void)[] = [];
  private errorListeners: ((
    code: string,
    message: string,
    ref?: string,
  ) => void)[] = [];
  private closeResolvers = new Map<string, (() => void)[]>();

  addListener(cb: EventCallback): void {
    this.listeners.push(cb);
  }

  on(panelId: string, eventType: string, cb: EventCallback): void {
    let panel = this.panelListeners.get(panelId);
    if (!panel) {
      panel = new Map();
      this.panelListeners.set(panelId, panel);
    }
    let list = panel.get(eventType);
    if (!list) {
      list = [];
      panel.set(eventType, list);
    }
    list.push(cb);
  }

  onTerminalResize(cb: (data: TerminalResizeData) => void): void {
    this.terminalResizeListeners.push(cb);
  }

  onError(cb: (code: string, message: string, ref?: string) => void): void {
    this.errorListeners.push(cb);
  }

  waitForClose(panelId: string): Promise<void> {
    return new Promise((resolve) => {
      let list = this.closeResolvers.get(panelId);
      if (!list) {
        list = [];
        this.closeResolvers.set(panelId, list);
      }
      list.push(resolve);
    });
  }

  dispatch(event: HyperTermEvent): void {
    // Global listeners
    for (const cb of this.listeners) cb(event);

    // System events
    if (event.id === "__system__") {
      if (event.event === "error") {
        for (const cb of this.errorListeners) {
          cb(event.code ?? "unknown", event.message ?? "", event.ref);
        }
      }
      return;
    }

    // Terminal resize
    if (event.id === "__terminal__" && event.event === "resize") {
      const data: TerminalResizeData = {
        cols: event.cols ?? 0,
        rows: event.rows ?? 0,
        pxWidth: event.pxWidth ?? 0,
        pxHeight: event.pxHeight ?? 0,
      };
      for (const cb of this.terminalResizeListeners) cb(data);
      return;
    }

    // Panel-specific listeners
    const panel = this.panelListeners.get(event.id);
    if (panel) {
      const list = panel.get(event.event);
      if (list) for (const cb of list) cb(event);
    }

    // Close resolvers
    if (event.event === "close") {
      const resolvers = this.closeResolvers.get(event.id);
      if (resolvers) {
        for (const r of resolvers) r();
        this.closeResolvers.delete(event.id);
      }
    }
  }
}

// === Main class ===

const encoder = new TextEncoder();

export class HyperTerm {
  readonly available: boolean;
  readonly debug: boolean;
  readonly protocolVersion: number;
  readonly channelMap: ChannelMap | null;
  private metaFd: number | null;
  private dataFd: number | null;
  private eventFd: number | null;
  private dispatcher = new EventDispatcher();
  private eventLoopStarted = false;

  constructor() {
    this.debug = !!process.env["HYPERTERM_DEBUG"];

    const channelsJson = process.env["HYPERTERM_CHANNELS"];
    if (channelsJson) {
      try {
        this.channelMap = JSON.parse(channelsJson) as ChannelMap;
      } catch {
        this.channelMap = null;
      }
    } else {
      this.channelMap = null;
    }

    const ver = process.env["HYPERTERM_PROTOCOL_VERSION"];
    this.protocolVersion = ver ? parseInt(ver) : 1;

    if (this.channelMap) {
      const meta = this.channelMap.channels.find((c) => c.name === "meta");
      const data = this.channelMap.channels.find((c) => c.name === "data");
      const events = this.channelMap.channels.find((c) => c.name === "events");
      this.metaFd = meta?.fd ?? null;
      this.dataFd = data?.fd ?? null;
      this.eventFd = events?.fd ?? null;
    } else {
      const meta = process.env["HYPERTERM_META_FD"];
      const data = process.env["HYPERTERM_DATA_FD"];
      const event = process.env["HYPERTERM_EVENT_FD"];
      this.metaFd = meta ? parseInt(meta) : null;
      this.dataFd = data ? parseInt(data) : null;
      this.eventFd = event ? parseInt(event) : null;
    }

    this.available = this.metaFd !== null && this.dataFd !== null;
  }

  // ── Low-level protocol ──

  /** Send raw metadata JSON to fd3. */
  sendMeta(meta: Record<string, unknown>): void {
    if (!this.available || this.metaFd === null) return;
    try {
      Bun.write(
        Bun.file(this.metaFd),
        encoder.encode(JSON.stringify(meta) + "\n"),
      );
    } catch (err) {
      if (this.debug) console.error("[hyperterm] sendMeta:", err);
    }
  }

  /** Send raw binary data to fd4 (or a named channel). */
  sendData(data: Uint8Array | string, channelName?: string): void {
    const fd = channelName ? this.getChannelFd(channelName) : this.dataFd;
    if (!this.available || fd === null) return;
    try {
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      Bun.write(Bun.file(fd), bytes);
    } catch (err) {
      if (this.debug) console.error("[hyperterm] sendData:", err);
    }
  }

  /** Look up a channel fd by name. */
  getChannelFd(name: string): number | null {
    if (!this.channelMap) return null;
    return this.channelMap.channels.find((c) => c.name === name)?.fd ?? null;
  }

  /** Flush a data channel — abort in-flight reads, discard leftover bytes. */
  flush(channelName = "data"): void {
    this.sendMeta({
      id: "__system__",
      type: "flush",
      dataChannel: channelName,
    });
  }

  // ── Panel creation ──

  showSvg(svg: string, opts: PanelOptions = {}): string {
    const id = nextId("svg");
    if (!this.available) return id;
    const data = encoder.encode(svg);
    this.sendMeta({
      id,
      type: "svg",
      ...panelDefaults(opts),
      ...filterUndefined(opts),
      byteLength: data.byteLength,
    });
    this.sendData(data);
    return id;
  }

  showHtml(html: string, opts: PanelOptions = {}): string {
    const id = nextId("html");
    if (!this.available) return id;
    const data = encoder.encode(html);
    this.sendMeta({
      id,
      type: "html",
      ...panelDefaults(opts),
      ...filterUndefined(opts),
      byteLength: data.byteLength,
    });
    this.sendData(data);
    return id;
  }

  async showImage(path: string, opts: PanelOptions = {}): Promise<string> {
    const id = nextId("img");
    if (!this.available) return id;
    const data = new Uint8Array(await Bun.file(path).arrayBuffer());
    const ext = path.split(".").pop()?.toLowerCase() ?? "png";
    const fmtMap: Record<string, string> = {
      png: "png",
      jpg: "jpeg",
      jpeg: "jpeg",
      webp: "webp",
      gif: "gif",
    };
    this.sendMeta({
      id,
      type: "image",
      format: opts.format ?? fmtMap[ext] ?? "png",
      ...panelDefaults(opts, { width: "auto", height: "auto" }),
      ...filterUndefined(opts),
      byteLength: data.byteLength,
    });
    this.sendData(data);
    return id;
  }

  showCanvas(pngData: Uint8Array, opts: PanelOptions = {}): string {
    const id = nextId("canvas");
    if (!this.available) return id;
    this.sendMeta({
      id,
      type: "canvas2d",
      ...panelDefaults(opts, { width: "auto", height: "auto" }),
      ...filterUndefined(opts),
      byteLength: pngData.byteLength,
    });
    this.sendData(pngData);
    return id;
  }

  async showCanvasFromFile(
    path: string,
    opts: PanelOptions = {},
  ): Promise<string> {
    const id = nextId("canvas");
    if (!this.available) return id;
    const data = new Uint8Array(await Bun.file(path).arrayBuffer());
    this.sendMeta({
      id,
      type: "canvas2d",
      ...panelDefaults(opts, { width: "auto", height: "auto" }),
      ...filterUndefined(opts),
      byteLength: data.byteLength,
    });
    this.sendData(data);
    return id;
  }

  // ── Panel manipulation ──

  /** Update panel properties and/or content. */
  update(id: string, fields: Record<string, unknown> = {}): void {
    if (!this.available) return;
    let binary: Uint8Array | null = null;
    const meta: Record<string, unknown> = { id, type: "update", ...fields };
    if (fields["data"] instanceof Uint8Array) {
      binary = fields["data"] as Uint8Array;
      meta["byteLength"] = binary.byteLength;
      delete meta["data"];
    } else if (typeof fields["data"] === "string") {
      binary = encoder.encode(fields["data"] as string);
      meta["byteLength"] = binary.byteLength;
      delete meta["data"];
    }
    this.sendMeta(meta);
    if (binary) this.sendData(binary);
  }

  /** Move a panel to a new position. */
  move(id: string, x: number, y: number): void {
    this.update(id, { x, y });
  }

  /** Resize a panel. */
  resize(id: string, width: number, height: number): void {
    this.update(id, { width, height });
  }

  /** Set panel opacity (0.0 - 1.0). */
  setOpacity(id: string, opacity: number): void {
    this.update(id, { opacity });
  }

  /** Set panel z-index. */
  setZIndex(id: string, zIndex: number): void {
    this.update(id, { zIndex });
  }

  /** Enable or disable interactivity on a panel. */
  setInteractive(id: string, interactive: boolean): void {
    this.update(id, { interactive });
  }

  /** Remove a panel. */
  clear(id: string): void {
    this.sendMeta({ id, type: "clear" });
  }

  // ── Events ──

  /** Start the background event loop (auto-started by event helpers). */
  private ensureEventLoop(): void {
    if (this.eventLoopStarted || this.eventFd === null) return;
    this.eventLoopStarted = true;
    this.runEventLoop();
  }

  private async runEventLoop(): Promise<void> {
    if (this.eventFd === null) return;
    try {
      const stream = Bun.file(this.eventFd).stream();
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            this.dispatcher.dispatch(JSON.parse(line) as HyperTermEvent);
          } catch {
            if (this.debug)
              console.error("[hyperterm] Invalid event JSON:", line);
          }
        }
      }
    } catch (err) {
      if (this.debug) console.error("[hyperterm] Event stream error:", err);
    }
  }

  /** Register a raw event listener (receives all events). */
  onEvent(callback: (event: HyperTermEvent) => void): void {
    this.ensureEventLoop();
    this.dispatcher.addListener(callback);
  }

  /** Listen for click events on a panel. */
  onClick(id: string, callback: (data: MouseEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "click", (e) =>
      callback({
        id: e.id,
        event: e.event,
        x: e.x ?? 0,
        y: e.y ?? 0,
        button: e.button ?? 0,
        buttons: e.buttons ?? 0,
      }),
    );
  }

  /** Listen for mousedown events on a panel. */
  onMouseDown(id: string, callback: (data: MouseEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "mousedown", (e) =>
      callback({
        id: e.id,
        event: e.event,
        x: e.x ?? 0,
        y: e.y ?? 0,
        button: e.button ?? 0,
        buttons: e.buttons ?? 0,
      }),
    );
  }

  /** Listen for mouseup events on a panel. */
  onMouseUp(id: string, callback: (data: MouseEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "mouseup", (e) =>
      callback({
        id: e.id,
        event: e.event,
        x: e.x ?? 0,
        y: e.y ?? 0,
        button: e.button ?? 0,
        buttons: e.buttons ?? 0,
      }),
    );
  }

  /** Listen for mousemove events on a panel (~60fps throttled). */
  onMouseMove(id: string, callback: (data: MouseEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "mousemove", (e) =>
      callback({
        id: e.id,
        event: e.event,
        x: e.x ?? 0,
        y: e.y ?? 0,
        button: e.button ?? 0,
        buttons: e.buttons ?? 0,
      }),
    );
  }

  /** Listen for mouseenter events on a panel. */
  onMouseEnter(id: string, callback: (data: MouseEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "mouseenter", (e) =>
      callback({
        id: e.id,
        event: e.event,
        x: e.x ?? 0,
        y: e.y ?? 0,
        button: 0,
        buttons: e.buttons ?? 0,
      }),
    );
  }

  /** Listen for mouseleave events on a panel. */
  onMouseLeave(id: string, callback: (data: MouseEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "mouseleave", (e) =>
      callback({
        id: e.id,
        event: e.event,
        x: e.x ?? 0,
        y: e.y ?? 0,
        button: 0,
        buttons: 0,
      }),
    );
  }

  /** Listen for wheel/scroll events on a panel. */
  onWheel(id: string, callback: (data: WheelEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "wheel", (e) =>
      callback({
        id: e.id,
        x: e.x ?? 0,
        y: e.y ?? 0,
        deltaX: e.deltaX ?? 0,
        deltaY: e.deltaY ?? 0,
        buttons: e.buttons ?? 0,
      }),
    );
  }

  /** Listen for dragend events on a panel (panel moved by user). */
  onDrag(id: string, callback: (data: DragEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "dragend", (e) =>
      callback({ id: e.id, x: e.x ?? 0, y: e.y ?? 0 }),
    );
  }

  /** Listen for resize events on a panel (panel resized by user). */
  onPanelResize(id: string, callback: (data: ResizeEventData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "resize", (e) =>
      callback({ id: e.id, width: e.width ?? 0, height: e.height ?? 0 }),
    );
  }

  /** Listen for close events on a panel (user clicked X). */
  onClose(id: string, callback: () => void): void {
    this.ensureEventLoop();
    this.dispatcher.on(id, "close", () => callback());
  }

  /** Returns a Promise that resolves when the panel is closed. */
  waitForClose(id: string): Promise<void> {
    this.ensureEventLoop();
    return this.dispatcher.waitForClose(id);
  }

  /** Listen for terminal resize events (cols, rows, pixel dimensions). */
  onTerminalResize(callback: (data: TerminalResizeData) => void): void {
    this.ensureEventLoop();
    this.dispatcher.onTerminalResize(callback);
  }

  /** Listen for protocol error events from the terminal. */
  onError(
    callback: (code: string, message: string, ref?: string) => void,
  ): void {
    this.ensureEventLoop();
    this.dispatcher.onError(callback);
  }
}

// === Helpers ===

function panelDefaults(
  opts: PanelOptions,
  overrides: { width?: number | "auto"; height?: number | "auto" } = {},
): Record<string, unknown> {
  return {
    position: opts.position ?? "float",
    x: opts.x ?? 100,
    y: opts.y ?? 100,
    width: opts.width ?? overrides.width ?? 400,
    height: opts.height ?? overrides.height ?? 300,
    draggable: opts.draggable ?? true,
    resizable: opts.resizable ?? true,
    interactive: opts.interactive ?? false,
  };
}

function filterUndefined(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

/** Convenience singleton */
export const ht = new HyperTerm();
