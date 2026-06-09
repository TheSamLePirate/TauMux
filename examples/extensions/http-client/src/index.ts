// HTTP Client — backend (runs inside the extension's Bun process).
//
// The frontend (iframe) never performs the HTTP request itself — that would be
// subject to the browser's CORS policy. Instead it forwards a request
// description to this backend, which runs `fetch` in a privileged, CORS-free
// environment and streams the response back. This process also persists request
// history to `state.json` in its own cwd (the host sets cwd to the extension
// directory) so the frontend can repopulate it on load.

import { createBackendSdk } from "@tau-mux/sdk/backend";

// ---- Wire types shared (by convention) with src/main.ts --------------------

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/** Frontend → backend: run this request. */
interface RequestMessage {
  type: "request";
  id: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A single persisted history entry. */
interface HistoryEntry {
  method: HttpMethod;
  url: string;
  status: number | null;
  at: number;
}

const STATE_FILE = "state.json";
const HISTORY_CAP = 50;

const sdk = createBackendSdk();

// In-memory history, loaded from disk on start and re-persisted on each request.
let history: HistoryEntry[] = [];

// ---- Persistence (best-effort; never crash the backend) --------------------

/** Load history from `state.json`. Returns [] on any failure or missing file. */
async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const file = Bun.file(STATE_FILE);
    if (!(await file.exists())) return [];
    const parsed = (await file.json()) as { history?: unknown };
    return Array.isArray(parsed.history)
      ? (parsed.history as HistoryEntry[])
      : [];
  } catch {
    return [];
  }
}

/** Persist the current history to `state.json`, capped to the last N entries. */
async function saveHistory(): Promise<void> {
  try {
    history = history.slice(-HISTORY_CAP);
    await Bun.write(STATE_FILE, JSON.stringify({ history }, null, 2));
  } catch {
    /* a failed write must not take down the backend */
  }
}

// ---- Request execution ------------------------------------------------------

/** Run a forwarded request via `fetch` and reply to the frontend. */
async function handleRequest(req: RequestMessage): Promise<void> {
  const { id, method, url } = req;

  // GET/HEAD cannot carry a body; everything else passes the editor body through.
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit = {
    method,
    headers: req.headers ?? {},
    body: hasBody ? req.body : undefined,
  };

  // High-resolution timing. Bun.nanoseconds() is monotonic; fall back to 0.
  const t0 = Bun.nanoseconds?.() ?? 0;

  try {
    const res = await fetch(url, init);
    const timeMs = ((Bun.nanoseconds?.() ?? 0) - t0) / 1e6;

    const headers = Object.fromEntries(res.headers) as Record<string, string>;
    const text = await res.text();

    sdk.send({
      type: "response",
      id,
      status: res.status,
      statusText: res.statusText,
      headers,
      body: text,
      timeMs,
    });

    // Record + persist, then surface a notification for the completed request.
    history.push({ method, url, status: res.status, at: Date.now() });
    await saveHistory();
    void sdk.notification
      .create({ title: `HTTP ${res.status}`, body: url })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sdk.send({ type: "response", id, error: message });

    // Even failures are worth remembering (status: null marks the error).
    history.push({ method, url, status: null, at: Date.now() });
    await saveHistory();
  }
}

// ---- Message routing --------------------------------------------------------

sdk.onMessage(async (data) => {
  try {
    const msg = data as { type?: string };
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "request") {
      await handleRequest(msg as RequestMessage);
    } else if (msg.type === "history") {
      // Reply with the saved history list for the frontend to render.
      sdk.send({ type: "history", items: history });
    }
  } catch (err) {
    // A handler must never throw — log to the sidebar and move on.
    void sdk.sidebar
      .log({ message: `http-client error: ${String(err)}`, level: "error" })
      .catch(() => {});
  }
});

// ---- Boot -------------------------------------------------------------------

history = await loadHistory();
void sdk.sidebar
  .log({ message: `http-client backend up (${sdk.surfaceId})` })
  .catch(() => {});
