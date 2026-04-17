/**
 * Browser-pane DOM event → RPC bridge.
 *
 * Before this module existed, 7 `ht-browser-*` listeners plus 3
 * cookie action listeners lived at the top of
 * src/views/terminal/index.ts, each following the same pattern: pull
 * detail off a CustomEvent, fall back to defaults on optional fields,
 * forward to rpc.send. Moving them here follows the same split we
 * did for agent-events.ts — the webview entry keeps its orchestration
 * intent, and the dispatch table becomes data.
 */

 
type RpcSend = (name: any, payload: any) => void;
interface Rpc {
  send: RpcSend;
}

interface BrowserEventRoute {
  event: string;
  method: string;
  /** Fields that must be truthy on detail — otherwise the event is
   *  dropped. Keeps half-filled events from reaching bun. */
  required: string[];
  /** Build the rpc payload from detail; defaults in the builder fill
   *  in optional fields that bun expects non-undefined. */
  buildPayload: (detail: Record<string, unknown>) => Record<string, unknown>;
}

const BROWSER_EVENT_ROUTES: BrowserEventRoute[] = [
  {
    event: "ht-browser-navigated",
    method: "browserNavigated",
    required: ["surfaceId"],
    buildPayload: (d) => ({
      surfaceId: d["surfaceId"],
      url: d["url"] ?? "",
      title: d["title"] ?? "",
    }),
  },
  {
    event: "ht-browser-title-changed",
    method: "browserTitleChanged",
    required: ["surfaceId"],
    buildPayload: (d) => ({
      surfaceId: d["surfaceId"],
      title: d["title"] ?? "",
    }),
  },
  {
    event: "ht-browser-eval-result",
    method: "browserEvalResult",
    required: ["surfaceId", "reqId"],
    buildPayload: (d) => ({
      surfaceId: d["surfaceId"],
      reqId: d["reqId"],
      result: d["result"],
      error: d["error"],
    }),
  },
  {
    event: "ht-browser-zoom",
    method: "browserSetZoom",
    required: ["surfaceId"],
    buildPayload: (d) => ({
      surfaceId: d["surfaceId"],
      zoom: d["zoom"] ?? 1.0,
    }),
  },
  {
    event: "ht-browser-console-log",
    method: "browserConsoleLog",
    required: ["surfaceId"],
    buildPayload: (d) => ({
      surfaceId: d["surfaceId"],
      level: d["level"] ?? "log",
      args: d["args"] ?? [],
      timestamp: d["timestamp"] ?? Date.now(),
    }),
  },
  {
    event: "ht-browser-error",
    method: "browserError",
    required: ["surfaceId"],
    buildPayload: (d) => ({
      surfaceId: d["surfaceId"],
      message: d["message"] ?? "",
      filename: d["filename"],
      lineno: d["lineno"],
      timestamp: d["timestamp"] ?? Date.now(),
    }),
  },
  {
    event: "ht-browser-dom-ready",
    method: "browserDomReady",
    required: ["surfaceId", "url"],
    buildPayload: (d) => ({
      surfaceId: d["surfaceId"],
      url: d["url"],
    }),
  },
];

/** Register every ht-browser-* and ht-cookie-* DOM event handler on
 *  `window`. Returns a teardown for tests. Cookie-action listeners
 *  are separate from the routes table because the event→method map
 *  is many-to-one (import/export/clear all hit browserCookieAction). */
export function registerBrowserEvents(rpc: Rpc): () => void {
  const abort = new AbortController();
  const opts: AddEventListenerOptions = { signal: abort.signal };

  for (const route of BROWSER_EVENT_ROUTES) {
    window.addEventListener(
      route.event,
      (e: Event) => {
        const detail = ((e as CustomEvent).detail ?? {}) as Record<
          string,
          unknown
        >;
        for (const key of route.required) {
          if (!detail[key]) return;
        }
        rpc.send(route.method, route.buildPayload(detail));
      },
      opts,
    );
  }

  window.addEventListener(
    "ht-cookie-import",
    (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | Record<string, unknown>
        | undefined;
      if (!detail?.["data"]) return;
      rpc.send("browserCookieAction", {
        action: "import",
        data: detail["data"],
        format: detail["format"],
      });
    },
    opts,
  );

  window.addEventListener(
    "ht-cookie-export",
    (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | Record<string, unknown>
        | undefined;
      rpc.send("browserCookieAction", {
        action: "export",
        format: (detail?.["format"] as string | undefined) || "json",
      });
    },
    opts,
  );

  window.addEventListener(
    "ht-cookie-clear",
    () => {
      rpc.send("browserCookieAction", { action: "clear" });
    },
    opts,
  );

  return () => abort.abort();
}
