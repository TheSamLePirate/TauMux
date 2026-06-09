// Shared message contract between Nebula's Vite frontend (the iframe) and its
// Bun backend. They exchange these over the @tau-mux/sdk app channel
// (frontend `sendToBackend` / `onBackendMessage`; backend `onMessage` / `send`).
// The backend owns all I/O — `fetch` (no CORS), server discovery, persistence,
// and every τ-mux control-surface call. The frontend is pure visuals + UX.

export interface ReqSpec {
  method: string; // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResult {
  id: string;
  ok: boolean;
  status: number; // 0 on transport error
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
  size: number; // response body bytes
  error?: string; // present on transport failure
}

/** A live local server discovered from τ-mux's process metadata. */
export interface Endpoint {
  label: string; // foreground command, e.g. "bun run dev"
  url: string; // http://127.0.0.1:<port>
  port: number;
  address: string;
  cwd?: string;
  command?: string;
  surfaceId?: string; // the terminal pane it belongs to
}

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  timeMs: number;
  at: number; // epoch ms
}

export interface SavedRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Frontend → backend. */
export type ToBackend =
  | { t: "send"; id: string; req: ReqSpec } // perform an HTTP request
  | { t: "discover" } // (re)scan running servers
  | { t: "history" } // ask for persisted history + collection
  | { t: "save"; req: SavedRequest } // upsert a saved request
  | { t: "delete"; id: string } // remove a saved request
  | { t: "open-browser"; url: string } // open the URL in a τ-mux browser pane
  | { t: "curl"; req: ReqSpec }; // open a terminal split + run the curl

/** Backend → frontend. */
export type ToFrontend =
  | { t: "response"; res: HttpResult }
  | { t: "endpoints"; items: Endpoint[] }
  | { t: "history"; items: HistoryEntry[] }
  | { t: "collection"; items: SavedRequest[] }
  | { t: "toast"; level: "info" | "success" | "error"; message: string };
