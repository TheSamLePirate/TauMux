/**
 * Webview fault reporting — the UI layer's failure path.
 *
 * This webview holds 100% of the UI and historically had NO failure
 * path: a throw anywhere (SurfaceManager has zero try/catch across
 * ~3k lines) produced no log line, no health row, no toast — every
 * "the sidebar froze" report was unreproducible by construction.
 *
 * `installWebviewFaultReporting` forwards window `error` and
 * `unhandledrejection` events to bun via the `webviewFault` message,
 * where they are logged and published as a `webview` health row.
 * Throttled here (and again bun-side) so a render-loop exception
 * can't flood the pipe.
 */

interface FaultSender {
  send(
    method: "webviewFault",
    payload: {
      kind: "error" | "unhandledrejection";
      message: string;
      stack?: string;
      source?: string;
    },
  ): void;
}

const FAULT_REPORT_WINDOW_MS = 10_000;
const FAULT_REPORT_MAX_PER_WINDOW = 5;

export function installWebviewFaultReporting(rpc: FaultSender): void {
  const timestamps: number[] = [];

  function report(
    kind: "error" | "unhandledrejection",
    message: string,
    stack?: string,
    source?: string,
  ): void {
    const now = Date.now();
    while (
      timestamps.length > 0 &&
      now - timestamps[0]! > FAULT_REPORT_WINDOW_MS
    ) {
      timestamps.shift();
    }
    if (timestamps.length >= FAULT_REPORT_MAX_PER_WINDOW) return;
    timestamps.push(now);
    try {
      rpc.send("webviewFault", { kind, message, stack, source });
    } catch {
      // The fault pipe itself is down — nothing more we can do; the
      // console still has the original error.
    }
  }

  window.addEventListener("error", (event) => {
    report(
      "error",
      event.message || "unknown error",
      event.error instanceof Error ? event.error.stack : undefined,
      event.filename ? `${event.filename}:${event.lineno}` : undefined,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report(
      "unhandledrejection",
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    );
  });
}
