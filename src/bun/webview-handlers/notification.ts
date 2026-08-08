import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys = "clearNotifications" | "dismissNotification" | "terminalNotify";

/** Notification panel actions originating from the webview. All forward
 *  to the canonical socket handlers so the persistence + audit log path
 *  is identical to a CLI-driven dismiss / clear / notify. */
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
    /** A program inside a PTY asked for a notification — OSC 9 (iTerm2
     *  dialect) or BEL. Routing through `notification.create` rather
     *  than straight to the sidebar is what makes these behave like
     *  every other notification: persisted, capped, mirrored to the web
     *  client, and forwarded to Telegram when that is enabled. Which is
     *  the whole point — an agent CLI's `terminal_bell` channel now
     *  reaches the user's phone. */
    terminalNotify: (payload) => {
      void ctx.socketHandler("notification.create", {
        title: payload.title,
        body: payload.body,
        surface_id: payload.surfaceId,
      });
    },
  };
}
