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

export interface PanelOptions {
  x?: number;
  y?: number;
  width?: number | "auto";
  height?: number | "auto";
  position?: "float" | "inline" | "overlay" | "fixed";
  anchor?: "cursor" | { row: number };
  draggable?: boolean;
  resizable?: boolean;
  interactive?: boolean;
  zIndex?: number;
  opacity?: number;
  borderRadius?: number;
}

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
}

const encoder = new TextEncoder();

export class HyperTerm {
  readonly available: boolean;
  private metaFd: number | null;
  private dataFd: number | null;
  private eventFd: number | null;

  constructor() {
    const meta = process.env["HYPERTERM_META_FD"];
    const data = process.env["HYPERTERM_DATA_FD"];
    const event = process.env["HYPERTERM_EVENT_FD"];

    this.metaFd = meta ? parseInt(meta) : null;
    this.dataFd = data ? parseInt(data) : null;
    this.eventFd = event ? parseInt(event) : null;
    this.available = this.metaFd !== null && this.dataFd !== null;
  }

  private sendMeta(meta: Record<string, unknown>): void {
    if (!this.available || this.metaFd === null) return;
    try {
      Bun.write(
        Bun.file(this.metaFd),
        encoder.encode(JSON.stringify(meta) + "\n"),
      );
    } catch {
      // fd write failed
    }
  }

  private sendData(data: Uint8Array | string): void {
    if (!this.available || this.dataFd === null) return;
    try {
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      Bun.write(Bun.file(this.dataFd), bytes);
    } catch {
      // fd write failed
    }
  }

  showSvg(svg: string, opts: PanelOptions = {}): string {
    const id = nextId("svg");
    if (!this.available) return id;
    const data = encoder.encode(svg);
    this.sendMeta({
      id,
      type: "svg",
      position: opts.position ?? "float",
      x: opts.x ?? 100,
      y: opts.y ?? 100,
      width: opts.width ?? 400,
      height: opts.height ?? 300,
      draggable: opts.draggable ?? true,
      resizable: opts.resizable ?? true,
      interactive: opts.interactive ?? false,
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
      position: opts.position ?? "float",
      x: opts.x ?? 100,
      y: opts.y ?? 100,
      width: opts.width ?? 400,
      height: opts.height ?? 300,
      draggable: opts.draggable ?? true,
      resizable: opts.resizable ?? true,
      interactive: opts.interactive ?? false,
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
      format: fmtMap[ext] ?? "png",
      position: opts.position ?? "float",
      x: opts.x ?? 100,
      y: opts.y ?? 100,
      width: opts.width ?? "auto",
      height: opts.height ?? "auto",
      draggable: opts.draggable ?? true,
      resizable: opts.resizable ?? true,
      ...filterUndefined(opts),
      byteLength: data.byteLength,
    });
    this.sendData(data);
    return id;
  }

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

  clear(id: string): void {
    this.sendMeta({ id, type: "clear" });
  }

  /** Read events asynchronously. Callback is called for each event. */
  async onEvent(callback: (event: HyperTermEvent) => void): Promise<void> {
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
            callback(JSON.parse(line) as HyperTermEvent);
          } catch {
            // invalid JSON
          }
        }
      }
    } catch {
      // fd closed
    }
  }
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
