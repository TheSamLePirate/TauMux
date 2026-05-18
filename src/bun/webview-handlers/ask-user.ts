import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys = "askUserAnswer" | "askUserCancel" | "askUserRequestSnapshot";

/** Webview-side answers / cancels for the agent ask-user queue.
 *
 *  Plan #10 commit C — webview modal answers / cancels go straight to
 *  the same queue the socket-RPC handlers drive. Idempotent on
 *  unknown ids; the resolved subscriber handles fan-out (Telegram
 *  edit-in-place + webview push) so we don't pre-empt here. */
export function registerAskUserWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    askUserAnswer: (payload) => {
      ctx.askUser.answer(payload.request_id, payload.value);
    },
    askUserCancel: (payload) => {
      ctx.askUser.cancel(payload.request_id, payload.reason);
    },
    askUserRequestSnapshot: () => {
      ctx.rpc.send("askUserEvent", {
        kind: "snapshot",
        pending: ctx.askUser.pending_list(),
      });
    },
  };
}
