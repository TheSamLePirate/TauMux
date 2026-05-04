import type {
  Handler,
  HandlerDeps,
  Notification,
  NotificationStore,
} from "./types";

/** Fresh mutable notification store. Owned by the aggregator and
 *  handed to the register fn via deps so every call to
 *  `createRpcHandler` starts with an empty ring. */
export function createNotificationStore(): NotificationStore {
  return { list: [], counter: 0 };
}

export function registerNotification(
  deps: HandlerDeps,
): Record<string, Handler> {
  const { dispatch, notifications } = deps;

  // Cap the in-memory notification history. Without this, a script
  // that spams `ht notify` in a loop would grow the list unboundedly —
  // every broadcast also marshals the whole list over RPC. 500 is plenty
  // for human consumption and keeps the broadcast payload small enough
  // that the WS frame never hits CLIENT_MESSAGE_MAX_BYTES.
  const MAX_NOTIFICATIONS = 500;

  return {
    "notification.create": (params) => {
      const surfaceId = params["surface_id"] as string | undefined;
      const n: Notification = {
        id: `notif:${++notifications.counter}`,
        title: (params["title"] as string) ?? "",
        subtitle: params["subtitle"] as string | undefined,
        body: (params["body"] as string) ?? "",
        time: Date.now(),
        surfaceId,
      };
      notifications.list.push(n);
      while (notifications.list.length > MAX_NOTIFICATIONS) {
        notifications.list.shift();
      }
      // Plan #09 commit B — fire the per-process onCreate hook so
      // the auto-continue engine (or any future bun-side observer)
      // sees turn-end notifications without polling. Synchronous
      // throws from the subscriber are swallowed so a buggy hook
      // can't fail the notification flow. Async rejections are NOT
      // caught here — hooks must handle their own promise errors.
      try {
        notifications.onCreate?.(n);
      } catch {
        /* swallow synchronous throws only */
      }
      dispatch("notification", {
        surfaceId: surfaceId ?? null,
        latest: {
          id: n.id,
          title: n.title,
          body: n.body,
          surfaceId: surfaceId ?? null,
        },
        notifications: notifications.list.map((x) => ({
          id: x.id,
          title: x.title,
          body: x.body,
          time: x.time,
          surfaceId: x.surfaceId ?? null,
        })),
      });
      return "OK";
    },

    "notification.list": () => {
      return notifications.list.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        time: n.time,
      }));
    },

    "notification.clear": () => {
      notifications.list.length = 0;
      dispatch("notification", { notifications: [] });
      return "OK";
    },

    "notification.dismiss": (params) => {
      const id = params["id"] as string | undefined;
      if (!id) return "OK";
      const idx = notifications.list.findIndex((n) => n.id === id);
      if (idx === -1) return "OK";
      // Snapshot the source surface BEFORE the splice. The webview's
      // overlay manager keeps a per-surface stack and needs this to
      // route the dismiss to the right one. Looking it up post-splice
      // (or via `notifications.find(...)` in the broadcast list) fails
      // because the entry is already gone — that was the regression
      // that left every card on screen until *all* notifications were
      // dismissed.
      const surfaceId = notifications.list[idx]?.surfaceId ?? null;
      notifications.list.splice(idx, 1);
      // Include the dismissed id so the bun→web bridge can broadcast
      // a `notificationDismiss` envelope without having to diff lists.
      dispatch("notification", {
        dismissed: id,
        surfaceId,
        notifications: notifications.list.map((x) => ({
          id: x.id,
          title: x.title,
          body: x.body,
          time: x.time,
          surfaceId: x.surfaceId ?? null,
        })),
      });
      return "OK";
    },
  };
}
