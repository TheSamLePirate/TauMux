import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys = "planClear";

/** Plan-panel actions originating from the webview. Forwarded to the
 *  canonical socket handler so a click on a card's clear control takes
 *  the exact same path as `ht plan clear` — one implementation, one
 *  broadcast, no chance of the panel and the CLI disagreeing about
 *  what "cleared" means. */
export function registerPlanWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    planClear: (payload) => {
      void ctx.socketHandler("plan.clear", {
        workspace_id: payload.workspaceId,
        ...(payload.agentId ? { agent_id: payload.agentId } : {}),
      });
    },
  };
}
