import { wireMessage as wireTelegramMessage } from "../rpc-handlers/telegram";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "createTelegramSurface"
  | "splitTelegramSurface"
  | "telegramSend"
  | "telegramRequestHistory"
  | "telegramRequestState";

/** Telegram pane lifecycle plus the webview-driven read paths
 *  (history pagination + initial state hydration) and the outbound
 *  send. The bot integration itself lives in `telegram-service.ts`;
 *  these handlers are the webview ↔ bun bridge. */
export function registerTelegramWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    createTelegramSurface: () => {
      ctx.createTelegramWorkspaceSurface();
    },
    splitTelegramSurface: (payload) => {
      ctx.splitTelegramSurface(payload.direction);
    },
    telegramSend: (payload) => {
      if (!payload.chatId || !payload.text) return;
      void ctx.sendTelegramAndBroadcast(payload.chatId, payload.text);
    },
    telegramRequestHistory: (payload) => {
      const limit = payload.limit ?? 50;
      const before = payload.before;
      const rows = ctx.telegramDb.getHistory(payload.chatId, limit, before);
      const messages = rows.map(wireTelegramMessage);
      ctx.rpc.send("telegramHistory", {
        chatId: payload.chatId,
        messages,
        isLatest: !before,
      });
    },
    telegramRequestState: () => {
      ctx.sendTelegramStateToWebview();
    },
  };
}
