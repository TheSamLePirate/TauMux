// Nebula backend (Bun). Owns all I/O and every τ-mux control-surface call:
//   • fetch proxy (no CORS) with precise timing + size
//   • live server discovery from τ-mux process metadata (listening ports)
//   • "send as curl" → opens a terminal split and runs it
//   • "open in browser" → opens a τ-mux browser pane
//   • notifications on failure, a live latency sparkline in the sidebar
//   • request history + saved collection persisted to state.json
//
// The frontend (the 3D scene) just sends `ToBackend` messages and renders the
// `ToFrontend` replies.

import { createBackendSdk } from "@tau-mux/sdk/backend";
import type {
  Endpoint,
  HistoryEntry,
  HttpResult,
  ReqSpec,
  SavedRequest,
  ToBackend,
  ToFrontend,
} from "./protocol";

const sdk = createBackendSdk();

const STATE_FILE = "state.json";
const HISTORY_CAP = 60;
const SPARK_CAP = 24;

interface State {
  history: HistoryEntry[];
  collection: SavedRequest[];
}
let state: State = { history: [], collection: [] };
const latencies: number[] = [];

function send(msg: ToFrontend): void {
  sdk.send(msg);
}

async function loadState(): Promise<void> {
  try {
    const f = Bun.file(STATE_FILE);
    if (await f.exists()) {
      const parsed = (await f.json()) as Partial<State>;
      state = {
        history: Array.isArray(parsed.history) ? parsed.history : [],
        collection: Array.isArray(parsed.collection) ? parsed.collection : [],
      };
    }
  } catch {
    /* corrupt / missing → fresh */
  }
}

async function saveState(): Promise<void> {
  try {
    await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* best-effort */
  }
}

async function runRequest(id: string, req: ReqSpec): Promise<void> {
  const method = (req.method || "GET").toUpperCase();
  const t0 = Bun.nanoseconds();
  let res: HttpResult;
  try {
    const init: RequestInit = { method, headers: req.headers ?? {} };
    if (method !== "GET" && method !== "HEAD" && req.body) init.body = req.body;
    const r = await fetch(req.url, init);
    const body = await r.text();
    const timeMs = Math.round((Bun.nanoseconds() - t0) / 1e6);
    res = {
      id,
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      headers: Object.fromEntries(r.headers),
      body,
      timeMs,
      size: new TextEncoder().encode(body).length,
    };
  } catch (err) {
    const timeMs = Math.round((Bun.nanoseconds() - t0) / 1e6);
    res = {
      id,
      ok: false,
      status: 0,
      statusText: "",
      headers: {},
      body: "",
      timeMs,
      size: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  send({ t: "response", res });

  // History (newest first, capped) + persist.
  state.history.unshift({
    id,
    method,
    url: req.url,
    status: res.status,
    ok: res.ok,
    timeMs: res.timeMs,
    at: Date.now(),
  });
  state.history = state.history.slice(0, HISTORY_CAP);
  void saveState();

  // Live latency sparkline + a status chip in the τ-mux sidebar. The
  // `_sparkline` key suffix tells the status renderer to draw a graph; the
  // value is comma-separated samples.
  latencies.push(res.timeMs);
  while (latencies.length > SPARK_CAP) latencies.shift();
  try {
    await sdk.sidebar.setStatus({
      key: "nebula_latency_sparkline",
      value: latencies.join(","),
      color: res.ok ? "cyan" : "red",
    });
    await sdk.sidebar.setStatus({
      key: "nebula_last",
      value: res.error ? "ERR" : `${res.status} · ${res.timeMs}ms`,
      icon: "🛰",
      color: res.ok ? "green" : "red",
    });
  } catch {
    /* sidebar optional */
  }

  // Notify on failure so a 5xx / transport error reaches you even if the pane
  // is in the background.
  if (!res.ok) {
    try {
      await sdk.notification.create({
        title: `Nebula · ${res.error ? "request failed" : `HTTP ${res.status}`}`,
        body: `${method} ${req.url}`,
      });
    } catch {
      /* notifications optional */
    }
  }
}

/** Discover live local servers from τ-mux's process metadata: every listening
 *  TCP port owned by any terminal pane becomes a one-click endpoint. */
async function discover(): Promise<void> {
  const endpoints: Endpoint[] = [];
  const seen = new Set<string>();
  try {
    const surfaces = ((await sdk.surface.list()) ?? []) as Array<{
      id: string;
    }>;
    for (const s of surfaces) {
      const meta = (await sdk.call("surface.metadata", {
        surface_id: s.id,
      })) as {
        cwd?: string;
        foregroundPid?: number;
        tree?: Array<{ pid: number; command: string }>;
        listeningPorts?: Array<{ port: number; address: string }>;
      } | null;
      if (!meta) continue;
      const command =
        meta.tree?.find((p) => p.pid === meta.foregroundPid)?.command ??
        meta.tree?.[0]?.command;
      for (const lp of meta.listeningPorts ?? []) {
        const host =
          lp.address === "*" ||
          lp.address === "::" ||
          lp.address === "0.0.0.0" ||
          lp.address === "::1"
            ? "127.0.0.1"
            : lp.address;
        const url = `http://${host}:${lp.port}`;
        if (seen.has(url)) continue;
        seen.add(url);
        endpoints.push({
          label: command ?? `port ${lp.port}`,
          url,
          port: lp.port,
          address: lp.address,
          cwd: meta.cwd,
          command,
          surfaceId: s.id,
        });
      }
    }
  } catch (err) {
    send({
      t: "toast",
      level: "error",
      message: `discover failed: ${String(err)}`,
    });
  }
  endpoints.sort((a, b) => a.port - b.port);
  send({ t: "endpoints", items: endpoints });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function buildCurl(req: ReqSpec): string {
  const method = (req.method || "GET").toUpperCase();
  const parts = ["curl", "-i", "-X", method];
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    parts.push("-H", shellQuote(`${k}: ${v}`));
  }
  if (req.body && method !== "GET" && method !== "HEAD") {
    parts.push("--data", shellQuote(req.body));
  }
  parts.push(shellQuote(req.url));
  return parts.join(" ");
}

sdk.onMessage(async (raw) => {
  const msg = raw as ToBackend;
  if (!msg || typeof msg !== "object") return;
  switch (msg.t) {
    case "send":
      await runRequest(msg.id, msg.req);
      break;
    case "discover":
      await discover();
      break;
    case "history":
      send({ t: "history", items: state.history });
      send({ t: "collection", items: state.collection });
      break;
    case "save": {
      const i = state.collection.findIndex((r) => r.id === msg.req.id);
      if (i >= 0) state.collection[i] = msg.req;
      else state.collection.push(msg.req);
      await saveState();
      send({ t: "collection", items: state.collection });
      break;
    }
    case "delete":
      state.collection = state.collection.filter((r) => r.id !== msg.id);
      await saveState();
      send({ t: "collection", items: state.collection });
      break;
    case "open-browser":
      try {
        await sdk.browser.open({ url: msg.url });
        send({
          t: "toast",
          level: "success",
          message: "Opened in a browser pane",
        });
      } catch (err) {
        send({ t: "toast", level: "error", message: String(err) });
      }
      break;
    case "curl":
      try {
        const split = (await sdk.call("surface.split", {
          direction: "down",
        })) as { id?: string } | string;
        const sid = typeof split === "object" ? split.id : undefined;
        const curl = buildCurl(msg.req);
        // Give the new shell a beat to come up, then run the curl.
        await new Promise((r) => setTimeout(r, 500));
        await sdk.call("surface.send_text", {
          surface_id: sid,
          text: curl + "\n",
        });
        send({
          t: "toast",
          level: "success",
          message: "Sent curl to a new terminal",
        });
      } catch (err) {
        send({ t: "toast", level: "error", message: String(err) });
      }
      break;
  }
});

// Boot.
await loadState();
try {
  await sdk.sidebar.log({ message: `Nebula online (${sdk.surfaceId})` });
} catch {
  /* optional */
}
send({ t: "history", items: state.history });
send({ t: "collection", items: state.collection });
void discover();
