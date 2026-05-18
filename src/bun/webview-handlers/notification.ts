import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys = "clearNotifications" | "dismissNotification";

/** Notification panel actions originating from the webview. Both forward
 *  to the canonical socket handlers so the persistence + audit log path
 *  is identical to a CLI-driven dismiss / clear. */
export function registerNotificationWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    clearNotifications: () => {
      void ctx.socketHandler("notification.clear", {});
    },
    dismissNotification: (payload) => {
      void ctx.socketHandler("notification.dismiss", { id: payload.id });
    },
  };
}
