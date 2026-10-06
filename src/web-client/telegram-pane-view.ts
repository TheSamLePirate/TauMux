/**
 * Telegram chat pane for the web mirror.
 *
 * Extracted from main.ts (module-size ratchet — main crossed the
 * 1500-line cap for non-baselined modules). The pane is self-contained:
 * chat picker, status pill, message list with keyed re-render, and the
 * composer. Deps are injected so the module never reaches back into
 * main.ts's closure.
 */

import type { AppState, Store } from "./store";
import {
  formatTelegramTimestamp,
  telegramAuthorLabel,
  telegramSendFailed,
} from "../shared/telegram-view";

export interface TelegramPaneViewDeps {
  store: Store;
  container: HTMLElement;
  /** Same shape as transport.send. */
  sendMsg: (type: string, payload: Record<string, unknown>) => void;
  /** Register the mounted pane in main.ts's pane map. */
  register: (surfaceId: string, ref: TelegramPaneRef) => void;
  /** M15 — drain notifications queued for this surface pre-mount. */
  flushQueuedNotifications: (surfaceId: string) => void;
}

/** Structural match for main.ts's TermRef (telegram arm). */
export interface TelegramPaneRef {
  kind: "telegram";
  term: null;
  fitAddon: null;
  el: HTMLElement;
  termEl: HTMLElement;
  barTitle: HTMLElement;
  chipsEl: HTMLElement;
  telegram: {
    messagesEl: HTMLElement;
    composerEl: HTMLTextAreaElement;
    statusPillEl: HTMLElement;
    chatSelectEl: HTMLSelectElement;
    render: (state: AppState) => void;
  };
}

export function createTelegramPaneView(
  deps: TelegramPaneViewDeps,
  surfaceId: string,
): void {
  const { store, container, sendMsg } = deps;
  const el = document.createElement("div");
  el.className = "pane pane-telegram";
  el.setAttribute("data-surface", surfaceId);

  const bar = document.createElement("div");
  bar.className = "surface-bar";
  const barTitle = document.createElement("span");
  barTitle.className = "surface-bar-title";
  barTitle.textContent = "Telegram";
  bar.appendChild(barTitle);
  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips";
  bar.appendChild(chipsEl);
  el.appendChild(bar);

  const toolbar = document.createElement("div");
  toolbar.className = "telegram-toolbar";
  const chatSelectEl = document.createElement("select");
  chatSelectEl.className = "telegram-chat-select";
  chatSelectEl.addEventListener("change", () => {
    const next = chatSelectEl.value || null;
    if (next) store.dispatch({ kind: "telegram/select-chat", chatId: next });
  });
  toolbar.appendChild(chatSelectEl);
  const statusPillEl = document.createElement("span");
  statusPillEl.className = "telegram-status-pill";
  toolbar.appendChild(statusPillEl);
  el.appendChild(toolbar);

  const body = document.createElement("div");
  body.className = "telegram-body";
  const messagesEl = document.createElement("div");
  messagesEl.className = "telegram-messages";
  body.appendChild(messagesEl);
  const composerWrap = document.createElement("div");
  composerWrap.className = "telegram-composer";
  const composerEl = document.createElement("textarea");
  composerEl.rows = 2;
  composerEl.placeholder = "Send a message…  (Enter = send · Shift+Enter)";
  composerEl.className = "telegram-composer-input";
  composerWrap.appendChild(composerEl);
  const sendBtn = document.createElement("button");
  sendBtn.className = "telegram-send-btn";
  sendBtn.textContent = "Send";
  composerWrap.appendChild(sendBtn);
  body.appendChild(composerWrap);
  el.appendChild(body);

  container.appendChild(el);

  const submit = () => {
    const text = composerEl.value.trim();
    const chatId = store.getState().telegram.activeChatId;
    if (!text || !chatId) return;
    sendMsg("telegramSend", { chatId, text });
    composerEl.value = "";
  };

  composerEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    e.stopPropagation();
  });
  sendBtn.addEventListener("click", submit);

  messagesEl.addEventListener("scroll", () => {
    if (messagesEl.scrollTop > 4) return;
    const s = store.getState();
    const chatId = s.telegram.activeChatId;
    if (!chatId) return;
    const list = s.telegram.messagesByChat[chatId];
    if (!list || list.length === 0) return;
    sendMsg("telegramRequestHistory", { chatId, before: list[0].id });
  });

  el.addEventListener("click", () => {
    if (store.getState().focusedSurfaceId === surfaceId) return;
    store.dispatch({ kind: "focus/set", surfaceId });
    sendMsg("focusSurface", { surfaceId });
  });

  function render(s: AppState) {
    const tg = s.telegram;
    // Status pill
    statusPillEl.className = `tg-status-pill tg-status-${tg.status.state}`;
    statusPillEl.textContent =
      (tg.status.state === "error" || tg.status.state === "conflict") &&
      tg.status.error
        ? `${tg.status.state}: ${tg.status.error}`
        : tg.status.state;

    // Chat picker
    const wantedValues = tg.chats.map((c) => c.id).join("|");
    if (chatSelectEl.dataset["v"] !== wantedValues) {
      chatSelectEl.innerHTML = "";
      if (tg.chats.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No chats yet";
        opt.disabled = true;
        chatSelectEl.appendChild(opt);
        chatSelectEl.disabled = true;
      } else {
        chatSelectEl.disabled = false;
        for (const chat of tg.chats) {
          const opt = document.createElement("option");
          opt.value = chat.id;
          opt.textContent = chat.name || chat.id;
          chatSelectEl.appendChild(opt);
        }
      }
      chatSelectEl.dataset["v"] = wantedValues;
    }
    if (tg.activeChatId && chatSelectEl.value !== tg.activeChatId) {
      chatSelectEl.value = tg.activeChatId;
    }

    // Messages
    const chatId = tg.activeChatId;
    const list = chatId ? (tg.messagesByChat[chatId] ?? []) : [];
    // Keyed render — only re-build when set of ids changes.
    const idKey = list.map((m) => m.id).join(",");
    if (messagesEl.dataset["k"] !== idKey) {
      const wasNearBottom =
        messagesEl.scrollHeight -
          messagesEl.scrollTop -
          messagesEl.clientHeight <
        80;
      messagesEl.innerHTML = "";
      if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "telegram-empty";
        empty.textContent =
          tg.status.state === "disabled"
            ? "Telegram service is disabled."
            : "No messages yet.";
        messagesEl.appendChild(empty);
      } else {
        for (const m of list) {
          const failed = telegramSendFailed(m);
          const row = document.createElement("div");
          row.className = `telegram-msg telegram-msg-${m.direction}${
            failed ? " telegram-msg-failed" : ""
          }`;
          const meta = document.createElement("div");
          meta.className = "telegram-msg-meta";
          meta.textContent = `${telegramAuthorLabel(m)} · ${formatTelegramTimestamp(m.ts)}`;
          row.appendChild(meta);
          const text = document.createElement("div");
          text.className = "telegram-msg-text";
          text.textContent = m.text;
          row.appendChild(text);
          if (failed) {
            const failBar = document.createElement("div");
            failBar.className = "telegram-msg-fail-bar";
            const badge = document.createElement("span");
            badge.className = "telegram-msg-fail-badge";
            badge.textContent = "failed";
            failBar.appendChild(badge);
            const retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "telegram-msg-retry-btn";
            retryBtn.textContent = "Retry";
            retryBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              sendMsg("telegramSend", { chatId: m.chatId, text: m.text });
            });
            failBar.appendChild(retryBtn);
            row.appendChild(failBar);
          }
          messagesEl.appendChild(row);
        }
      }
      messagesEl.dataset["k"] = idKey;
      if (wasNearBottom) {
        requestAnimationFrame(() => {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        });
      }
    }
  }

  deps.register(surfaceId, {
    kind: "telegram",
    term: null,
    fitAddon: null,
    el,
    termEl: messagesEl,
    barTitle,
    chipsEl,
    telegram: { messagesEl, composerEl, statusPillEl, chatSelectEl, render },
  });

  // M15 — drain any notifications queued for this surface before
  // its pane mounted (same path as terminal panes).
  deps.flushQueuedNotifications(surfaceId);

  // Initial paint + ensure we have history for whatever chat is active.
  render(store.getState());
  const active = store.getState().telegram.activeChatId;
  if (active) {
    sendMsg("telegramRequestHistory", { chatId: active });
  }
}
