// Backend SDK — runs inside the extension's Bun process. Drives τ-mux control
// surfaces over the unix socket (env: HT_SOCKET_PATH / HT_RPC_TOKEN) and
// exchanges app-level messages with the frontend over stdin/stdout JSONL (the
// host forwards these to/from the iframe).

import { connect, type Socket } from "node:net";
import { makeApi, type TauMuxApi } from "./protocol";

export interface BackendSdk extends TauMuxApi {
  /** This surface's id (env HT_SURFACE_ID). */
  readonly surfaceId: string;
  /** This extension's id (env HT_EXTENSION_ID). */
  readonly extensionId: string;
  /** Receive an app-level message the frontend sent to the backend. */
  onMessage(handler: (data: unknown) => void): void;
  /** Push an app-level message to the frontend (delivered as a
   *  `backend-message`). */
  send(data: unknown): void;
  /** Close the control-surface socket. */
  dispose(): void;
}

class PersistentRpcSocket {
  private sock: Socket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private connected: Promise<void>;

  constructor(
    private path: string,
    private token: string,
  ) {
    this.connected = new Promise((resolve, reject) => {
      const s = connect(this.path);
      this.sock = s;
      s.on("connect", () => resolve());
      s.on("error", (err) => {
        reject(err);
        for (const { reject: rj } of this.pending.values()) rj(err as Error);
        this.pending.clear();
      });
      s.on("data", (chunk) => this.onData(chunk.toString()));
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const res = JSON.parse(t) as {
          id?: string;
          result?: unknown;
          error?: unknown;
        };
        const id = String(res.id ?? "");
        const entry = this.pending.get(id);
        if (!entry) continue;
        this.pending.delete(id);
        if (res.error) entry.reject(new Error(String(res.error)));
        else entry.resolve(res.result);
      } catch {
        /* ignore non-JSON */
      }
    }
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    await this.connected;
    const id = String(this.nextId++);
    const req: Record<string, unknown> = { id, method, params };
    if (this.token) req["__token"] = this.token;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.sock?.write(JSON.stringify(req) + "\n");
      } catch (err) {
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  dispose(): void {
    try {
      this.sock?.end();
    } catch {
      /* ignore */
    }
  }
}

/** Create the backend SDK. Call once at the top of your extension's
 *  `src/index.ts`. */
export function createBackendSdk(): BackendSdk {
  const socketPath = process.env["HT_SOCKET_PATH"] ?? "";
  const token = process.env["HT_RPC_TOKEN"] ?? "";
  const surfaceId = process.env["HT_SURFACE_ID"] ?? "";
  const extensionId = process.env["HT_EXTENSION_ID"] ?? "";

  const rpc = new PersistentRpcSocket(socketPath, token);
  const api = makeApi((method, params) => rpc.call(method, params ?? {}));

  // App-level frontend ⇄ backend channel over stdin/stdout JSONL.
  let messageHandler: ((data: unknown) => void) | null = null;
  let stdinBuf = "";
  process.stdin.on("data", (chunk: Buffer) => {
    stdinBuf += chunk.toString();
    const lines = stdinBuf.split("\n");
    stdinBuf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        messageHandler?.(JSON.parse(t));
      } catch {
        /* ignore non-JSON */
      }
    }
  });
  process.stdin.resume();

  return {
    ...api,
    surfaceId,
    extensionId,
    onMessage(handler) {
      messageHandler = handler;
    },
    send(data) {
      process.stdout.write(JSON.stringify(data) + "\n");
    },
    dispose() {
      rpc.dispose();
    },
  };
}
