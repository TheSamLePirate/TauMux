/**
 * The outbound notification ↔ Telegram bridge: what happens to a chat
 * message when a τ-mux notification is raised, and when it is answered.
 *
 * Both halves used to be inline in the `action === "notification"` arm of
 * `src/bun/index.ts`, which meant neither could be tested without
 * standing up the whole host runtime. They take their collaborators as
 * arguments instead — same shape as `telegram-button-dispatch.ts`, the
 * INBOUND counterpart that turns a tapped button back into a keystroke.
 *
 * The two halves are a pair, and the pairing is the point:
 *
 *   forward  — a new notification fans out to every allow-listed chat,
 *              optionally carrying an OK / No / Continue / Cancel
 *              keyboard bound to the originating surface.
 *   resolve  — when something on the τ-mux side ANSWERS the thing the
 *              notification was asking about, those buttons have to go.
 *              They point at a prompt that no longer exists, so a tap
 *              would fire a stray Enter into whatever now owns the pane.
 *
 * Only a dismiss carrying a `resolution` resolves. A user swiping the
 * card away has answered nothing, and leaves the chat untouched.
 *
 * Best-effort throughout: by the time either runs, the local notification
 * state has already changed. A Telegram outage or a busted SQLite handle
 * must degrade to a stale chat message, never to a thrown dispatch.
 */

import type { NotificationPayload } from "../shared/webview-actions";
import {
  formatNotificationResolutionForTelegram,
  planNotificationForwarding,
} from "./telegram-service";

/** Just enough of a workspace to attribute a notification to a pane. */
interface WorkspaceLike {
  name: string;
  surfaceIds: string[];
  surfaceTitles?: Record<string, string>;
}

export interface NotificationForwardDeps {
  /** False when the Telegram service isn't running — nothing to do. */
  live: boolean;
  settings: {
    telegramNotificationsEnabled: boolean;
    telegramAllowedUserIds: string;
    telegramNotificationButtonsEnabled: boolean;
  };
  workspaces: WorkspaceLike[];
  sendWithButtons: (opts: {
    chatId: string;
    text: string;
    notificationId: string;
    surfaceId: string | null;
  }) => void;
  send: (
    chatId: string,
    text: string,
    opts: { allowUnknownChat?: boolean },
  ) => void;
}

/**
 * Fan a freshly-created notification out to Telegram, when the user
 * opted in. `planNotificationForwarding` is pure and decides who gets
 * what; this only wires the deliveries through the live sender so rate
 * limiting and persistence stay on their existing path.
 *
 * With `telegramNotificationButtonsEnabled`, each delivery goes through
 * the buttons-aware send, which also persists the `notification_links`
 * row that both the inbound callback handler and `resolve` below need.
 */
export function forwardNotificationToTelegram(
  latest: Record<string, unknown>,
  deps: NotificationForwardDeps,
): void {
  if (!deps.live) return;
  const surfaceId = (latest["surfaceId"] as string | null) ?? null;
  const ws = surfaceId
    ? (deps.workspaces.find((w) => w.surfaceIds.includes(surfaceId)) ?? null)
    : null;
  const deliveries = planNotificationForwarding({
    enabled: deps.settings.telegramNotificationsEnabled,
    allowedUserIds: deps.settings.telegramAllowedUserIds,
    title: String(latest["title"] ?? ""),
    body: String(latest["body"] ?? ""),
    workspace: ws?.name ?? undefined,
    pane: ws?.surfaceTitles?.[surfaceId ?? ""] ?? undefined,
  });
  const notificationId = String(latest["id"] ?? "");
  const buttonsOn =
    deps.settings.telegramNotificationButtonsEnabled && !!notificationId;
  for (const { chatId, text } of deliveries) {
    if (buttonsOn) {
      deps.sendWithButtons({ chatId, text, notificationId, surfaceId });
    } else {
      // chatId is sourced from the user's `telegramAllowedUserIds`
      // allow-list, so a target not yet in `db.listChats()` (a
      // just-paired user) is legitimate.
      deps.send(chatId, text, { allowUnknownChat: true });
    }
  }
}

/** The `notification_links` reads `resolve` needs. Structural so the
 *  real `TelegramDatabase` satisfies it and tests can pass a fake. */
export interface NotificationLinkStore {
  getNotificationLinksForNotification(
    notificationId: string,
  ): Array<{ chatId: string; tgMessageId: number }>;
  dropNotificationLinks(notificationId: string): number;
}

export interface NotificationMessageEditor {
  editMessage(chatId: string, tgMessageId: number, text: string): unknown;
}

/**
 * Stamp every forwarded copy of a notification as resolved, then forget
 * the links.
 *
 * No-op unless the dismiss carried a `resolution` — that field is what
 * distinguishes "τ-mux answered this" from "the user swiped it away".
 *
 * Editing with no `replyMarkup` is what removes the buttons; dropping
 * the link rows afterwards closes the race where a tap already in flight
 * resolves against the surface anyway. The rows go even when the service
 * is down: the notification is gone locally, so a later tap has nothing
 * legitimate to resolve to.
 */
export function resolveForwardedNotification(
  payload: NotificationPayload,
  notificationId: string,
  db: NotificationLinkStore,
  service: NotificationMessageEditor | null,
  onWarn: (message: string, err: unknown) => void = console.warn,
): void {
  const resolution = payload.resolution;
  if (typeof resolution !== "string" || !resolution) return;

  let links: Array<{ chatId: string; tgMessageId: number }>;
  try {
    links = db.getNotificationLinksForNotification(notificationId);
  } catch (err) {
    onWarn("[telegram] resolution link lookup failed:", err);
    return;
  }
  if (links.length === 0) return;

  if (service) {
    const text = formatNotificationResolutionForTelegram({
      title: String(payload.dismissedTitle ?? ""),
      body: String(payload.dismissedBody ?? ""),
      resolution,
    });
    for (const link of links) {
      try {
        service.editMessage(link.chatId, link.tgMessageId, text);
      } catch (err) {
        // One unreachable chat must not strand the others' buttons.
        onWarn("[telegram] resolution edit failed:", err);
      }
    }
  }

  try {
    db.dropNotificationLinks(notificationId);
  } catch (err) {
    onWarn("[telegram] resolution link cleanup failed:", err);
  }
}
