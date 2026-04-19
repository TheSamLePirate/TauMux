/**
 * telegram-pane.ts — DOM construction for a Telegram chat pane.
 *
 * Mirrors the structural pattern of browser-pane.ts and agent-panel.ts:
 * a `surface-bar` row with title + actions, a body region the
 * SurfaceManager positions via the same applyPositions code path as
 * every other surface kind. No terminal, no PTY — just a chat list +
 * composer that talks to the Bun-side TelegramService over RPC.
 */

import { createIcon, type IconName } from "./icons";
import type {
  TelegramChatWire,
  TelegramStatusWire,
  TelegramWireMessage,
} from "../../shared/types";
import {
  TELEGRAM_RENDER_WINDOW,
  formatTelegramTimestamp,
  mergeTelegramMessages,
  telegramAuthorLabel,
  telegramSendFailed,
} from "../../shared/telegram-view";

export interface TelegramPaneCallbacks {
  onSend: (chatId: string, text: string) => void;
  /** Pull older history for the active chat (used on scroll-up). */
  onRequestHistory: (chatId: string, before: number) => void;
  /** Re-fetch the current state — chat list + service status. */
  onRequestState: () => void;
  onClose: (surfaceId: string) => void;
  onFocus: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
}

export interface TelegramPaneView {
  id: string;
  surfaceType: "telegram";
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  /** Active chat the pane is currently displaying. Switching is local
   *  to the pane (no RPC) — incoming messages for other chats update
   *  the in-memory map but only render when the user switches to them. */
  activeChatId: string | null;
  chats: Map<string, TelegramChatWire>;
  /** Per-chat ordered message list. Newest at the end. Capped to the
   *  webview-side render window (history beyond is in the SQLite log). */
  messagesByChat: Map<string, TelegramWireMessage[]>;
  status: TelegramStatusWire;
  /** Callbacks the pane invokes upward. */
  callbacks: TelegramPaneCallbacks;
  /** Cleanup callbacks (event listeners) run on destroy. */
  _cleanup: (() => void)[];

  // DOM refs the SurfaceManager / external dispatchers need to update.
  chatSelectEl: HTMLSelectElement;
  statusPillEl: HTMLSpanElement;
  messagesEl: HTMLDivElement;
  composerEl: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  emptyStateEl: HTMLDivElement;
}

/** Build the pane and wire up all event listeners. The pane initializes
 *  in an empty state; the caller is expected to feed `telegramHistory`
 *  / `telegramState` events through the helpers below. */
export function createTelegramPaneView(
  surfaceId: string,
  callbacks: TelegramPaneCallbacks,
): TelegramPaneView {
  const container = document.createElement("div");
  container.className = "surface-container surface-telegram";
  container.dataset["surfaceId"] = surfaceId;
  container.dataset["surfaceType"] = "telegram";
  container.style.display = "none";

  // ── Surface bar ──
  const bar = document.createElement("div");
  bar.className = "surface-bar";

  const barTitleWrap = document.createElement("div");
  barTitleWrap.className = "surface-bar-title-wrap";
  const barIcon = createIcon("messageCircle", "surface-bar-icon", 12);
  barTitleWrap.appendChild(barIcon);

  const barTitle = document.createElement("span");
  barTitle.className = "surface-bar-title";
  barTitle.textContent = "Telegram";
  barTitleWrap.appendChild(barTitle);
  bar.appendChild(barTitleWrap);

  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips";
  bar.appendChild(chipsEl);

  const barActions = document.createElement("div");
  barActions.className = "surface-bar-actions";

  const splitRightBtn = makeActionBtn("Split Right", "splitHorizontal", () =>
    callbacks.onSplit(surfaceId, "horizontal"),
  );
  const splitDownBtn = makeActionBtn("Split Down", "splitVertical", () =>
    callbacks.onSplit(surfaceId, "vertical"),
  );
  const closeBtn = makeActionBtn("Close", "close", () =>
    callbacks.onClose(surfaceId),
  );
  closeBtn.classList.add("surface-bar-close");
  barActions.append(splitRightBtn, splitDownBtn, closeBtn);
  bar.appendChild(barActions);
  container.appendChild(bar);

  // ── Toolbar (chat picker + status pill) ──
  const toolbar = document.createElement("div");
  toolbar.className = "telegram-toolbar";

  const chatSelectEl = document.createElement("select");
  chatSelectEl.className = "telegram-chat-select";
  chatSelectEl.setAttribute("aria-label", "Active chat");
  toolbar.appendChild(chatSelectEl);

  const statusPillEl = document.createElement("span");
  statusPillEl.className = "telegram-status-pill telegram-status-disabled";
  statusPillEl.textContent = "disabled";
  toolbar.appendChild(statusPillEl);

  container.appendChild(toolbar);

  // ── Body: messages + composer ──
  const body = document.createElement("div");
  body.className = "telegram-body";

  const messagesEl = document.createElement("div");
  messagesEl.className = "telegram-messages";
  body.appendChild(messagesEl);

  const emptyStateEl = document.createElement("div");
  emptyStateEl.className = "telegram-empty-state";
  emptyStateEl.textContent =
    "No messages yet. Configure a bot token in Settings → Telegram.";
  messagesEl.appendChild(emptyStateEl);

  const composerWrap = document.createElement("div");
  composerWrap.className = "telegram-composer";

  const composerEl = document.createElement("textarea");
  composerEl.className = "telegram-composer-input";
  composerEl.rows = 2;
  composerEl.placeholder =
    "Send a message…  (Enter = send · Shift+Enter = newline)";
  composerEl.spellcheck = false;
  composerWrap.appendChild(composerEl);

  const sendBtn = document.createElement("button");
  sendBtn.className = "telegram-send-btn";
  sendBtn.title = "Send";
  sendBtn.append(createIcon("send", "", 14));
  composerWrap.appendChild(sendBtn);

  body.appendChild(composerWrap);
  container.appendChild(body);

  const view: TelegramPaneView = {
    id: surfaceId,
    surfaceType: "telegram",
    container,
    titleEl: barTitle,
    chipsEl,
    title: "Telegram",
    activeChatId: null,
    chats: new Map(),
    messagesByChat: new Map(),
    status: { state: "disabled" },
    callbacks,
    _cleanup: [],
    chatSelectEl,
    statusPillEl,
    messagesEl,
    composerEl,
    sendBtn,
    emptyStateEl,
  };

  // ── Wiring ──
  const onDom = <T extends Event>(
    target: EventTarget,
    event: string,
    listener: (e: T) => void,
  ) => {
    target.addEventListener(event, listener as EventListener);
    view._cleanup.push(() => {
      target.removeEventListener(event, listener as EventListener);
    });
  };

  onDom(container, "mousedown", () => callbacks.onFocus(surfaceId));

  onDom(chatSelectEl, "change", () => {
    const next = chatSelectEl.value || null;
    view.activeChatId = next;
    renderMessages(view);
  });

  onDom<KeyboardEvent>(composerEl, "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    e.stopPropagation();
  });

  onDom(sendBtn, "click", submit);

  onDom(messagesEl, "scroll", () => {
    if (messagesEl.scrollTop > 4) return;
    const chatId = view.activeChatId;
    if (!chatId) return;
    const list = view.messagesByChat.get(chatId);
    if (!list || list.length === 0) return;
    callbacks.onRequestHistory(chatId, list[0].id);
  });

  function submit() {
    const text = composerEl.value.trim();
    const chatId = view.activeChatId;
    if (!text) return;
    if (!chatId) return;
    callbacks.onSend(chatId, text);
    composerEl.value = "";
  }

  // Pull initial state right away. The bun side responds with the
  // chat list + status; once a chat is active we'll request history.
  callbacks.onRequestState();

  return view;
}

function makeActionBtn(
  label: string,
  iconName: IconName,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "surface-bar-btn";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.append(createIcon(iconName));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function destroyTelegramPaneView(view: TelegramPaneView): void {
  for (const fn of view._cleanup) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  view._cleanup = [];
}

/** Apply a fresh chat list + status from the bun side. Called on
 *  initial open and whenever the bun-side TelegramService announces
 *  state changes (token edit, restart, polling failure). */
export function telegramPaneApplyState(
  view: TelegramPaneView,
  state: { chats: TelegramChatWire[]; status: TelegramStatusWire },
): void {
  view.status = state.status;
  applyStatusPill(view);

  view.chats.clear();
  for (const chat of state.chats) {
    view.chats.set(chat.id, chat);
  }

  // Drop any in-memory messages whose chat no longer exists in the
  // server-side list (e.g. chat history was cleared).
  for (const chatId of view.messagesByChat.keys()) {
    if (!view.chats.has(chatId)) view.messagesByChat.delete(chatId);
  }

  rebuildChatSelect(view);

  if (!view.activeChatId && state.chats.length > 0) {
    view.activeChatId = state.chats[0].id;
    view.chatSelectEl.value = view.activeChatId;
    view.callbacks.onRequestHistory(view.activeChatId, 0);
  }

  renderMessages(view);
}

/** Apply a paginated history payload from the bun side. */
export function telegramPaneApplyHistory(
  view: TelegramPaneView,
  payload: {
    chatId: string;
    messages: TelegramWireMessage[];
    isLatest: boolean;
  },
): void {
  const existing = view.messagesByChat.get(payload.chatId) ?? [];
  const merged = mergeTelegramMessages(existing, payload.messages);
  view.messagesByChat.set(payload.chatId, merged);
  if (view.activeChatId === payload.chatId) {
    renderMessages(view, payload.isLatest);
  }
}

/** Push a single fresh message arriving from the polling loop or a
 *  successful send. Auto-scrolls when it lands in the active chat.
 *  Also patches outbound rows in place when their `tgMessageId` flips
 *  from null to a real id (retry success). */
export function telegramPaneAppendMessage(
  view: TelegramPaneView,
  message: TelegramWireMessage,
): void {
  const list = view.messagesByChat.get(message.chatId) ?? [];
  const existingIdx = list.findIndex((m) => m.id === message.id);
  if (existingIdx !== -1) {
    // Same row already in memory — replace it (retry success path: a
    // failed row gets re-broadcast with a populated tgMessageId).
    list[existingIdx] = message;
  } else {
    list.push(message);
    list.sort((a, b) => a.id - b.id);
    if (list.length > TELEGRAM_RENDER_WINDOW * 2) {
      list.splice(0, list.length - TELEGRAM_RENDER_WINDOW * 2);
    }
  }
  view.messagesByChat.set(message.chatId, list);

  // First message ever in a never-seen-before chat: register it so
  // the picker shows the new entry without waiting for a state push.
  if (!view.chats.has(message.chatId)) {
    view.chats.set(message.chatId, {
      id: message.chatId,
      name: message.fromName ?? message.chatId,
      lastSeen: message.ts,
    });
    rebuildChatSelect(view);
    if (!view.activeChatId) {
      view.activeChatId = message.chatId;
      view.chatSelectEl.value = view.activeChatId;
    }
  }

  if (view.activeChatId === message.chatId) {
    renderMessages(view, true);
  }
}

function applyStatusPill(view: TelegramPaneView): void {
  const { state, error } = view.status;
  view.statusPillEl.className = `telegram-status-pill telegram-status-${state}`;
  view.statusPillEl.textContent =
    state === "error" && error ? `error: ${error}` : state;
}

function rebuildChatSelect(view: TelegramPaneView): void {
  const previous = view.activeChatId;
  view.chatSelectEl.innerHTML = "";
  if (view.chats.size === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No chats yet";
    opt.disabled = true;
    view.chatSelectEl.appendChild(opt);
    view.chatSelectEl.disabled = true;
    return;
  }
  view.chatSelectEl.disabled = false;
  for (const chat of [...view.chats.values()].sort(
    (a, b) => b.lastSeen - a.lastSeen,
  )) {
    const opt = document.createElement("option");
    opt.value = chat.id;
    opt.textContent = chat.name || chat.id;
    view.chatSelectEl.appendChild(opt);
  }
  if (previous && view.chats.has(previous)) {
    view.chatSelectEl.value = previous;
  }
}

function renderMessages(view: TelegramPaneView, scrollToBottom = true): void {
  view.messagesEl.innerHTML = "";
  const chatId = view.activeChatId;
  if (!chatId) {
    view.messagesEl.appendChild(view.emptyStateEl);
    view.emptyStateEl.textContent =
      view.status.state === "disabled"
        ? "Telegram service is disabled. Configure a bot token in Settings → Telegram."
        : "No chat selected.";
    return;
  }
  const list = view.messagesByChat.get(chatId) ?? [];
  if (list.length === 0) {
    view.messagesEl.appendChild(view.emptyStateEl);
    view.emptyStateEl.textContent =
      view.status.state === "polling"
        ? "Waiting for the first message…"
        : "No messages yet.";
    return;
  }
  for (const m of list) {
    view.messagesEl.appendChild(renderMessage(m, view.callbacks));
  }
  if (scrollToBottom) {
    requestAnimationFrame(() => {
      view.messagesEl.scrollTop = view.messagesEl.scrollHeight;
    });
  }
}

function renderMessage(
  m: TelegramWireMessage,
  callbacks: TelegramPaneCallbacks,
): HTMLDivElement {
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
    // Failed-send badge with a retry handle. Telegram's API doesn't
    // accept "resend this row id"; we just submit the same text again
    // and let the new attempt land as a fresh message — the failed row
    // stays in history as a record of the attempt.
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
      callbacks.onSend(m.chatId, m.text);
    });
    failBar.appendChild(retryBtn);
    row.appendChild(failBar);
  }

  return row;
}
