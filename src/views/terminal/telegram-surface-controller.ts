// TelegramSurfaceController — the Telegram-pane concern extracted out of the
// SurfaceManager god object (full_app_review_2026-05.md §3, H10). Mirrors
// BrowserSurfaceController: SurfaceManager keeps the generic surface
// machinery and delegates Telegram-specific work here.

import { htEvents } from "../../shared/event-bus";
import type {
  TelegramChatWire,
  TelegramStatusWire,
  TelegramWireMessage,
} from "../../shared/types";
import { playNotificationSound } from "./sounds";
import {
  type TelegramPaneView,
  createTelegramPaneView,
  telegramPaneApplyState,
  telegramPaneApplyHistory,
  telegramPaneAppendMessage,
  destroyTelegramPaneView,
} from "./telegram-pane";
import type { SurfaceView } from "./surface-manager";

export interface TelegramControllerDeps {
  getFocusedSurfaceId: () => string | null;
  getSurface: (id: string) => SurfaceView | undefined;
  allSurfaces: () => Iterable<SurfaceView>;
  focusSurface: (id: string) => void;
  /** Pulse the glow ring on a surface that received an inbound message
   *  while not focused. */
  notifyGlow: (surfaceId: string) => void;
}

export class TelegramSurfaceController {
  constructor(private deps: TelegramControllerDeps) {}

  /** Create + wire a Telegram pane view. The caller attaches
   *  `view.container` to the DOM and wraps it in a SurfaceView. */
  createTelegramView(surfaceId: string): TelegramPaneView {
    return createTelegramPaneView(surfaceId, {
      onSend: (chatId, text) => {
        htEvents.emit("ht-telegram-send", { chatId, text });
      },
      onRequestHistory: (chatId, before) => {
        htEvents.emit("ht-telegram-request-history", { chatId, before });
      },
      onRequestState: () => {
        htEvents.emit("ht-telegram-request-state", undefined);
      },
      onClose: (sid) => {
        htEvents.emit("ht-close-surface", { surfaceId: sid });
      },
      onSplit: (sid, direction) => {
        htEvents.emit("ht-split", { surfaceId: sid, direction });
      },
      onFocus: (sid) => this.deps.focusSurface(sid),
    });
  }

  /** Detach the pane (called from removeSurface). */
  destroyView(view: TelegramPaneView): void {
    destroyTelegramPaneView(view);
  }

  /** Append an inbound/outbound message to every bound Telegram pane;
   *  pulse glow + play the chime on a fresh inbound DM when the user isn't
   *  already looking at a Telegram pane. */
  handleMessage(message: TelegramWireMessage): void {
    let landedInTelegramPane = false;
    for (const view of this.deps.allSurfaces()) {
      if (view.telegramView) {
        telegramPaneAppendMessage(view.telegramView, message);
        landedInTelegramPane = true;
        if (
          view.id !== this.deps.getFocusedSurfaceId() &&
          message.direction === "in"
        ) {
          this.deps.notifyGlow(view.id);
        }
      }
    }
    const focusedId = this.deps.getFocusedSurfaceId();
    if (
      landedInTelegramPane &&
      message.direction === "in" &&
      focusedId !== null
    ) {
      const focused = this.deps.getSurface(focusedId);
      if (focused?.surfaceType !== "telegram") {
        playNotificationSound();
      }
    }
  }

  /** Apply a paginated history payload to every Telegram pane. */
  handleHistory(payload: {
    chatId: string;
    messages: TelegramWireMessage[];
    isLatest: boolean;
  }): void {
    for (const view of this.deps.allSurfaces()) {
      if (view.telegramView) {
        telegramPaneApplyHistory(view.telegramView, payload);
      }
    }
  }

  /** Apply a service status + chat list snapshot to every Telegram pane. */
  handleState(state: {
    chats: TelegramChatWire[];
    status: TelegramStatusWire;
  }): void {
    for (const view of this.deps.allSurfaces()) {
      if (view.telegramView) {
        telegramPaneApplyState(view.telegramView, state);
      }
    }
  }
}
