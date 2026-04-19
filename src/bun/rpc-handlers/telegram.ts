import type { Handler, HandlerDeps } from "./types";
import type { TelegramMessage } from "../telegram-db";
import type { TelegramWireMessage } from "../../shared/types";

/** RPC handlers for the Telegram integration. All methods degrade
 *  gracefully when the service isn't running — UIs render an empty list
 *  rather than erroring out so the pane stays usable. */
export function registerTelegram(deps: HandlerDeps): Record<string, Handler> {
  const { telegramDb } = deps;
  const getService = () => deps.getTelegramService?.();

  return {
    "telegram.send": async (params) => {
      const chatId = params["chat_id"] ?? params["chatId"];
      const text = params["text"];
      if (typeof chatId !== "string" || !chatId) {
        throw new Error("telegram.send: chat_id is required");
      }
      if (typeof text !== "string" || !text) {
        throw new Error("telegram.send: text is required");
      }
      const service = getService();
      if (!service) {
        throw new Error("telegram.send: service is not running");
      }
      const persisted = await service.sendMessage(chatId, text);
      return wireMessage(persisted);
    },

    "telegram.history": (params) => {
      const chatId = params["chat_id"] ?? params["chatId"];
      const rawLimit = params["limit"];
      const rawBefore = params["before"];
      if (typeof chatId !== "string" || !chatId) {
        return { messages: [] };
      }
      if (!telegramDb) return { messages: [] };
      const limit =
        typeof rawLimit === "number" && rawLimit > 0
          ? Math.min(rawLimit, 200)
          : 50;
      const before =
        typeof rawBefore === "number" && rawBefore > 0 ? rawBefore : undefined;
      const rows = telegramDb.getHistory(chatId, limit, before);
      return { messages: rows.map(wireMessage) };
    },

    "telegram.chats": () => {
      if (!telegramDb) return { chats: [] };
      return { chats: telegramDb.listChats() };
    },

    "telegram.status": () => {
      const service = getService();
      if (!service) {
        return { status: { state: "disabled" as const } };
      }
      return { status: service.getStatus() };
    },
  };
}

/** Persisted row → JSON wire shape that the webview / web mirror consume. */
export function wireMessage(m: TelegramMessage): TelegramWireMessage {
  return {
    id: m.id,
    chatId: m.chatId,
    direction: m.direction,
    text: m.text,
    ts: m.ts,
    fromName: m.fromName,
    tgMessageId: m.tgMessageId,
  };
}
