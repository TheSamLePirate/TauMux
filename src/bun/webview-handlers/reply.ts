import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys = "readScreenResponse" | "webviewResponse";

/** Webview → bun reply channels for round-trip RPC.
 *
 *  Two distinct paths coexist for back-compat reasons documented in
 *  `doc/system-rpc-socket.md`:
 *
 *  - `readScreenResponse` — legacy single-purpose reply for
 *    `surface.read_text` round-trips.
 *  - `webviewResponse` — generic `{ reqId, result }` reply used by
 *    Tier 2 `__test.*` and future read-style RPC. */
export function registerReplyWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    readScreenResponse: (payload) => {
      const resolve = ctx.pendingReads.get(payload.reqId);
      if (resolve) {
        ctx.pendingReads.delete(payload.reqId);
        resolve(payload.content);
      }
    },
    webviewResponse: (payload) => {
      const resolve = ctx.pendingReads.get(payload.reqId);
      if (resolve) {
        ctx.pendingReads.delete(payload.reqId);
        resolve(payload.result);
      }
    },
  };
}
