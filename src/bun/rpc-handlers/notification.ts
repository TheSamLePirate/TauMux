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
  };
}
