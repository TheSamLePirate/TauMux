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
      const key = params["key"] as string | undefined;
      const n: Notification = {
        id: `notif:${++notifications.counter}`,
        title: (params["title"] as string) ?? "",
        subtitle: params["subtitle"] as string | undefined,
        body: (params["body"] as string) ?? "",
        time: Date.now(),
        surfaceId,
        ...(key ? { key } : {}),
      };
      notifications.list.push(n);
      while (notifications.list.length > MAX_NOTIFICATIONS) {
        notifications.list.shift();
      }
      notifications.persist?.();
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
      notifications.persist?.();
      dispatch("notification", { notifications: [] });
      return "OK";
    },

    "notification.dismiss": (params) => {
      const byId = params["id"] as string | undefined;
      // `key` is the producer-correlation path: dismiss the notification
      // I raised, without having captured the generated id. Newest match
      // wins — a key can legitimately repeat over a session's lifetime
      // (one per permission prompt), and the live one is the last.
      const byKey = params["key"] as string | undefined;
      // Free-text note ("auto-approved by τ-mux") explaining WHY this was
      // retracted rather than actioned. Purely informational here; the
      // host uses it to stamp the forwarded Telegram message so a chat
      // that got the alert also learns it no longer needs an answer.
      const resolution = params["resolution"] as string | undefined;
      if (!byId && !byKey) return "OK";
      const idx = byId
        ? notifications.list.findIndex((n) => n.id === byId)
        : notifications.list.findLastIndex((n) => n.key === byKey);
      if (idx === -1) return "OK";
      const id = notifications.list[idx]!.id;
      // Snapshot the source surface BEFORE the splice. The webview's
      // overlay manager keeps a per-surface stack and needs this to
      // route the dismiss to the right one. Looking it up post-splice
      // (or via `notifications.find(...)` in the broadcast list) fails
      // because the entry is already gone — that was the regression
      // that left every card on screen until *all* notifications were
      // dismissed.
      const entry = notifications.list[idx]!;
      const surfaceId = entry.surfaceId ?? null;
      notifications.list.splice(idx, 1);
      notifications.persist?.();
      // Include the dismissed id so the bun→web bridge can broadcast
      // a `notificationDismiss` envelope without having to diff lists.
      dispatch("notification", {
        dismissed: id,
        surfaceId,
        // Carried only on a resolved dismiss. The entry has already
        // been spliced out by now, so this is the host's only chance to
        // see the text it needs to re-render the Telegram card.
        ...(resolution
          ? {
              resolution,
              dismissedTitle: entry.title,
              dismissedBody: entry.body,
            }
          : {}),
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
