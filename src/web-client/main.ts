// τ-mux web-mirror client (entry).
//
// Bundled by scripts/build-web-client.ts into assets/web-client/client.js.
// This module wires three pieces:
//
//   store     — pure reducer-driven AppState (see store.ts)
//   view      — imperative DOM renderer that subscribes to the store
//   transport — WebSocket layer that translates v2 envelopes to actions
//
// Streaming output (stdout, sideband binary payloads) is intentionally NOT
// stored in AppState. The transport layer writes stdout straight into the
// xterm instance owned by the view, and delivers sideband payloads to a
// renderer keyed by panel id.

import {
  createStore,
  type AppState,
  type PanelState,
  type Store,
} from "./store";
import { ICONS } from "./icons";
import {
  createPanelRendererRegistry,
  releasePanelBlobUrl,
} from "./panel-renderers";
import { createProtocolDispatcher } from "./protocol-dispatcher";
import { createLayoutView } from "./layout";
import {
  setupPanelDrag,
  setupPanelMouse,
  setupPanelResize,
} from "./panel-interaction";
import { createSidebarView } from "./sidebar";
import { createTransport } from "./transport";
import { attachDictationInput, type DictationInput } from "./dictation-input";
import { attachSidebarResize } from "../shared/sidebar-resize";
import { focusXtermPreservingScroll } from "../shared/xterm-focus";
import {
  formatTelegramTimestamp,
  telegramAuthorLabel,
  telegramSendFailed,
} from "../shared/telegram-view";

declare const Terminal: any;
declare const FitAddon: any;
declare const WebLinksAddon: any;

// ---------------------------------------------------------------------------
// Terminal theme / options
// ---------------------------------------------------------------------------

const TERM_THEME = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  cursorAccent: "#1e1e2e",
  selectionBackground: "#585b70",
  selectionForeground: "#cdd6f4",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
};

const TERM_OPTS = {
  theme: TERM_THEME,
  fontFamily:
    "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 13,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: "bar",
  scrollback: 10000,
};

const GAP = 2;
const TOOLBAR_HEIGHT = 36;
const SIDEBAR_WIDTH = 260;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 600;
const SIDEBAR_WIDTH_KEY = "ht:sidebar-width";

/** Read the persisted sidebar width. Returns the default when the
 *  storage entry is missing, unparseable, or out of bounds. */
function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return SIDEBAR_WIDTH;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < SIDEBAR_MIN || n > SIDEBAR_MAX) {
      return SIDEBAR_WIDTH;
    }
    return n;
  } catch {
    return SIDEBAR_WIDTH;
  }
}

function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    /* quota / privacy-mode — silently skip */
  }
}

// ---------------------------------------------------------------------------
// Font load gate — after fonts resolve, we boot.
// ---------------------------------------------------------------------------

const fr = new FontFace(
  "JetBrainsMono Nerd Font Mono",
  "url(/fonts/nerd-regular.ttf)",
  { style: "normal", weight: "400" },
);
const fb = new FontFace(
  "JetBrainsMono Nerd Font Mono",
  "url(/fonts/nerd-bold.ttf)",
  { style: "normal", weight: "700" },
);
(document as any).fonts.add(fr);
(document as any).fonts.add(fb);

Promise.all([fr.load(), fb.load()])
  .then(() => (document as any).fonts.ready)
  .then(boot)
  .catch(boot);

function boot() {
  const container = document.getElementById("pane-container")!;
  const wsSelectEl = document.getElementById(
    "workspace-select",
  ) as HTMLSelectElement;
  const dotEl = document.getElementById("status-dot")!;
  const fsBtn = document.getElementById("fullscreen-btn")!;
  const backBtn = document.getElementById("back-btn")!;
  const sidebarEl = document.getElementById("sidebar")!;
  const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn")!;

  // Swap emoji chrome for inline SVGs.
  sidebarToggleBtn.innerHTML = ICONS.sidebar;
  backBtn.innerHTML = ICONS.back;
  fsBtn.innerHTML = ICONS.fullscreen;

  // ------------------------------------------------------------------
  // Store + side-car xterm instances
  // ------------------------------------------------------------------

  const store: Store = createStore();

  // Xterm lives outside the store because it is a stateful, mutable,
  // side-effectful object. We keep a map keyed by surface id, create
  // entries when a surface appears in state, and dispose them when it
  // leaves.
  interface TermRef {
    /** Pane kind. "telegram" panes have null `term`/`fitAddon` and own
     *  a separate render path (no xterm). */
    kind: "term" | "telegram";
    term: any | null;
    fitAddon: any | null;
    el: HTMLElement;
    termEl: HTMLElement;
    barTitle: HTMLElement;
    chipsEl: HTMLElement;
    /** Mobile / dictation input shim attached to xterm's helper textarea. */
    dictation?: DictationInput;
    /** Telegram-only handle on the chat DOM and its update fn. */
    telegram?: {
      messagesEl: HTMLElement;
      composerEl: HTMLTextAreaElement;
      statusPillEl: HTMLElement;
      chatSelectEl: HTMLSelectElement;
      render: (state: AppState) => void;
    };
  }
  const terms: Record<string, TermRef> = {};
  const panelsDom: Record<
    string,
    { el: HTMLElement; contentEl: HTMLElement; panelId: string }
  > = {};
  // Binary sideband frames arrive synchronously from the WebSocket but
  // DOM creation is deferred to rAF via the store subscription. If a
  // frame arrives before `ensurePanelDom` has run for its id, buffer it
  // here and flush once the DOM exists. Mirrors PanelManager.pendingData
  // on the native side.
  const pendingPanelData: Record<string, Uint8Array> = {};

  // ------------------------------------------------------------------
  // Transport + protocol dispatch
  // ------------------------------------------------------------------

  function setDotFromState(state: AppState) {
    dotEl.className =
      state.connection.status === "connected"
        ? "connected"
        : state.connection.status === "connecting"
          ? "reconnecting"
          : "";
  }

  // Forward declaration: the dispatcher needs `sendMsg`, which comes
  // from the transport, but the transport's onTextMessage hook needs
  // the dispatcher. Resolved by letting the transport factory capture
  // a closure over `handleServerMessage` that we install below.
  let handleServerMessage: (type: string, payload: unknown) => void = () => {};
  const transport = createTransport({
    store,
    onTextMessage: (type, payload) => handleServerMessage(type, payload),
    onBinaryFrame: (id, data) => renderPanelData(id, data, true),
  });
  const sendMsg = transport.send;
  handleServerMessage = createProtocolDispatcher({
    store,
    writeOutput: (surfaceId, data, reset) => {
      const ref = terms[surfaceId];
      if (!ref) return;
      if (reset) ref.term.reset();
      ref.term.write(data);
    },
    subscribeSurface: (surfaceId) => sendMsg("subscribeSurface", { surfaceId }),
  });

  // ------------------------------------------------------------------
  // View renderers
  // ------------------------------------------------------------------

  // Scheduled render, coalescing multiple dispatches in the same tick.
  let scheduled = false;
  let prevState: AppState = store.getState();
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const s = store.getState();
      render(s, prevState);
      prevState = s;
    });
  }
  store.subscribe(() => scheduleRender());

  const sidebarView = createSidebarView({
    store,
    sendMsg,
    sidebarEl,
    sidebarToggleBtn,
    workspaceSelectEl: wsSelectEl,
  });

  const layoutView = createLayoutView({
    container,
    sidebarEl,
    terms,
    gap: GAP,
    sidebarWidth: SIDEBAR_WIDTH,
    toolbarHeight: TOOLBAR_HEIGHT,
  });

  // Apply the persisted sidebar width before first render so the pane
  // container lands on its final left offset instead of jumping mid-
  // session. The variable also drives the resize handle's x position.
  const initialSidebarWidth = loadSidebarWidth();
  document.documentElement.style.setProperty(
    "--ht-sidebar-width",
    `${initialSidebarWidth}px`,
  );

  // Drag-to-resize. Live moves mutate the CSS variable; the layout
  // view re-runs on every frame so xterm fit follows the handle in
  // lockstep. Commits persist the final width to localStorage.
  const resizeHandleEl = document.getElementById("sidebar-resize-handle");
  if (resizeHandleEl) {
    attachSidebarResize({
      handle: resizeHandleEl,
      min: SIDEBAR_MIN,
      max: SIDEBAR_MAX,
      defaultWidth: SIDEBAR_WIDTH,
      // Web mirror sidebar hugs the viewport's left edge.
      getSidebarLeft: () => 0,
      onLive: (width) => {
        document.documentElement.style.setProperty(
          "--ht-sidebar-width",
          `${width}px`,
        );
        layoutView.applyLayout(store.getState());
      },
      onCommit: (width) => {
        document.documentElement.style.setProperty(
          "--ht-sidebar-width",
          `${width}px`,
        );
        saveSidebarWidth(width);
        layoutView.applyLayout(store.getState());
      },
    });
  }

  function render(state: AppState, prev: AppState) {
    setDotFromState(state);
    if (state.sidebarVisible !== prev.sidebarVisible)
      sidebarView.applyVisibility(state);
    if (
      state.workspaces !== prev.workspaces ||
      state.activeWorkspaceId !== prev.activeWorkspaceId
    ) {
      sidebarView.updateWorkspaceSelect(state);
    }
    if (
      state.sidebar !== prev.sidebar ||
      state.workspaces !== prev.workspaces ||
      state.activeWorkspaceId !== prev.activeWorkspaceId ||
      state.focusedSurfaceId !== prev.focusedSurfaceId
    ) {
      sidebarView.render(state);
    }
    reconcilePanes(state);
    reconcilePanels(state);
    layoutView.applyLayout(state);
    applyChips(state, prev);
    applyFullscreen(state, prev);
    applyGlow(state, prev);
    if (state.telegram !== prev.telegram) renderTelegramPanes(state);
  }

  /** Re-render every Telegram pane on every store change. The pane's
   *  internal `render` function is keyed so unchanged DOM survives. */
  function renderTelegramPanes(state: AppState) {
    for (const sid in terms) {
      const ref = terms[sid]!;
      if (ref.kind === "telegram") ref.telegram?.render(state);
    }
  }

  // ------------------------------------------------------------------
  // Pane reconciliation
  // ------------------------------------------------------------------

  function reconcilePanes(state: AppState) {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    const activeIds = new Set<string>();
    if (ws) collectSurfaceIds(ws.layout, activeIds);

    // Remove panes no longer in the layout.
    for (const sid in terms) {
      if (!activeIds.has(sid)) disposePane(sid);
    }
    // Create panes for surfaces newly in the layout.
    for (const sid of activeIds) {
      if (!terms[sid]) createPane(sid, state);
    }
    // Resize to whatever the snapshot says.
    for (const sid in terms) {
      const ref = terms[sid]!;
      if (!ref.term) continue;
      const surf = state.surfaces[sid];
      if (surf && surf.cols && surf.rows) {
        try {
          ref.term.resize(surf.cols, surf.rows);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function collectSurfaceIds(node: any, out: Set<string>) {
    if (!node) return;
    if (node.type === "leaf") out.add(node.surfaceId);
    else for (const c of node.children) collectSurfaceIds(c, out);
  }

  function createPane(surfaceId: string, state: AppState) {
    if (surfaceId.startsWith("tg:")) {
      createTelegramPane(surfaceId, state);
      return;
    }
    const surf = state.surfaces[surfaceId];
    const el = document.createElement("div");
    el.className = "pane";
    el.setAttribute("data-surface", surfaceId);

    const bar = document.createElement("div");
    bar.className = "pane-bar";
    const barTitle = document.createElement("span");
    barTitle.className = "pane-bar-title";
    barTitle.textContent = surf?.title ?? surfaceId;
    bar.appendChild(barTitle);

    const chipsEl = document.createElement("div");
    chipsEl.className = "pane-bar-chips";
    bar.appendChild(chipsEl);

    const paneFsBtn = document.createElement("button");
    paneFsBtn.className = "pane-bar-btn";
    paneFsBtn.title = "Fullscreen";
    paneFsBtn.innerHTML = ICONS.fullscreen;
    paneFsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      store.dispatch({ kind: "fullscreen/enter", surfaceId });
    });
    bar.appendChild(paneFsBtn);
    el.appendChild(bar);

    const termEl = document.createElement("div");
    termEl.className = "pane-term";
    el.appendChild(termEl);
    container.appendChild(el);

    const term = new Terminal(TERM_OPTS);
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
    term.open(termEl);
    term.onData((data: string) => sendMsg("stdin", { surfaceId, data }));
    term.onBinary((data: string) => sendMsg("stdin", { surfaceId, data }));

    // Mobile / dictation shim: capture-phase listener on xterm's hidden
    // helper textarea forwards iOS Dictation, SuperWhisper, WhisperFlow
    // and other beforeinput-driven keyboards directly to stdin so xterm's
    // keydown-centric path can't lose / duplicate text. Hardware
    // keyboards on desktop are unaffected (xterm preventDefaults their
    // keydown, suppressing the follow-on beforeinput).
    let dictation: DictationInput | null = null;
    const helperTa = termEl.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea",
    );
    if (helperTa) {
      dictation = attachDictationInput({
        textarea: helperTa,
        term,
        onData: (data) => sendMsg("stdin", { surfaceId, data }),
      });
    }

    el.addEventListener("click", () => {
      if (store.getState().focusedSurfaceId === surfaceId) return;
      store.dispatch({ kind: "focus/set", surfaceId });
      focusXtermPreservingScroll(term, termEl);
      sendMsg("focusSurface", { surfaceId });
    });

    // Propose resize to the server when the rendered pane geometry
    // changes. The server decides whether to honor it (native app is
    // authoritative by default). Rate-limited to avoid spamming during
    // window drags.
    let lastProposed: { cols: number; rows: number } | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          const dims = fitAddon.proposeDimensions();
          if (!dims || !dims.cols || !dims.rows) return;
          if (
            lastProposed &&
            lastProposed.cols === dims.cols &&
            lastProposed.rows === dims.rows
          )
            return;
          lastProposed = { cols: dims.cols, rows: dims.rows };
          sendMsg("surfaceResizeRequest", {
            surfaceId,
            cols: dims.cols,
            rows: dims.rows,
          });
        } catch {
          /* ignore */
        }
      }, 250);
    });
    ro.observe(termEl);

    terms[surfaceId] = {
      kind: "term",
      term,
      fitAddon,
      el,
      termEl,
      barTitle,
      chipsEl,
      dictation: dictation ?? undefined,
    };

    // Paint chips from existing metadata, if any.
    const meta = surf?.metadata;
    if (meta) renderPaneChips(chipsEl, meta);
  }

  function disposePane(surfaceId: string) {
    const ref = terms[surfaceId];
    if (!ref) return;
    if (ref.dictation) {
      try {
        ref.dictation.dispose();
      } catch {
        /* ignore */
      }
    }
    if (ref.term) {
      try {
        ref.term.dispose();
      } catch {
        /* ignore */
      }
    }
    ref.el.remove();
    delete terms[surfaceId];
  }

  /** Build a Telegram pane DOM. Mirrors the structure of the native
   *  webview's TelegramPaneView: chat picker + status pill + scrollable
   *  message list + composer with Enter=send / Shift+Enter=newline.
   *  Renders react-style on every store update via the `render` fn so
   *  there's no per-event surgery. */
  function createTelegramPane(surfaceId: string, _state: AppState) {
    const el = document.createElement("div");
    el.className = "pane pane-telegram";
    el.setAttribute("data-surface", surfaceId);

    const bar = document.createElement("div");
    bar.className = "pane-bar";
    const barTitle = document.createElement("span");
    barTitle.className = "pane-bar-title";
    barTitle.textContent = "Telegram";
    bar.appendChild(barTitle);
    const chipsEl = document.createElement("div");
    chipsEl.className = "pane-bar-chips";
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

    terms[surfaceId] = {
      kind: "telegram",
      term: null,
      fitAddon: null,
      el,
      termEl: messagesEl,
      barTitle,
      chipsEl,
      telegram: { messagesEl, composerEl, statusPillEl, chatSelectEl, render },
    };

    // Initial paint + ensure we have history for whatever chat is active.
    render(store.getState());
    const active = store.getState().telegram.activeChatId;
    if (active) {
      sendMsg("telegramRequestHistory", { chatId: active });
    }
  }

  // ------------------------------------------------------------------
  // Chips
  // ------------------------------------------------------------------

  function applyChips(state: AppState, prev: AppState) {
    for (const sid in terms) {
      const ref = terms[sid]!;
      const surf = state.surfaces[sid];
      const prevSurf = prev.surfaces[sid];
      if (surf && (surf.metadata !== prevSurf?.metadata || !prevSurf)) {
        if (surf.metadata) renderPaneChips(ref.chipsEl, surf.metadata);
      }
      if (surf && surf.title !== prevSurf?.title) {
        ref.barTitle.textContent = surf.title;
      }
    }
  }

  function renderPaneChips(host: HTMLElement, meta: any) {
    host.innerHTML = "";
    let fg: any = null;
    for (let i = 0; i < meta.tree.length; i++) {
      if (meta.tree[i].pid === meta.foregroundPid) {
        fg = meta.tree[i];
        break;
      }
    }
    if (fg && meta.foregroundPid !== meta.pid && fg.command) {
      const c = document.createElement("span");
      c.className = "pane-chip chip-command";
      c.textContent =
        fg.command.length > 48
          ? fg.command.slice(0, 47) + "\u2026"
          : fg.command;
      c.title = fg.command;
      host.appendChild(c);
    }
    if (meta.cwd) {
      const parts = meta.cwd
        .replace(/\/+$/, "")
        .split("/")
        .filter((s: string) => s);
      const short =
        parts.length <= 2
          ? meta.cwd.charAt(0) === "/"
            ? "/" + parts.join("/")
            : parts.join("/")
          : "\u2026/" + parts.slice(-2).join("/");
      const cc = document.createElement("span");
      cc.className = "pane-chip chip-cwd";
      cc.textContent = short;
      cc.title = meta.cwd;
      host.appendChild(cc);
    }
    if (meta.git) {
      const g = meta.git;
      const dirty =
        g.staged +
          g.unstaged +
          g.untracked +
          g.conflicts +
          g.insertions +
          g.deletions >
        0;
      const gc = document.createElement("span");
      gc.className = "pane-chip chip-git" + (dirty ? " dirty" : "");
      const gitPart = (cls: string, text: string) => {
        const s = document.createElement("span");
        s.className = cls;
        s.textContent = text;
        return s;
      };
      gc.appendChild(gitPart("chip-git-branch", "\u2387 " + g.branch));
      if (g.ahead > 0)
        gc.appendChild(gitPart("chip-git-ahead", "\u2191" + g.ahead));
      if (g.behind > 0)
        gc.appendChild(gitPart("chip-git-behind", "\u2193" + g.behind));
      if (g.conflicts > 0)
        gc.appendChild(gitPart("chip-git-conflicts", "!" + g.conflicts));
      if (g.insertions > 0)
        gc.appendChild(gitPart("chip-git-add", "+" + g.insertions));
      if (g.deletions > 0)
        gc.appendChild(gitPart("chip-git-del", "\u2212" + g.deletions));
      let tip = "branch: " + g.branch + (g.head ? " @ " + g.head : "");
      if (g.upstream) tip += "\nupstream: " + g.upstream;
      tip +=
        "\nfiles: " +
        g.staged +
        " staged \u00b7 " +
        g.unstaged +
        " unstaged \u00b7 " +
        g.untracked +
        " untracked" +
        (g.conflicts ? " \u00b7 " + g.conflicts + " conflicts" : "");
      if (g.insertions || g.deletions)
        tip += "\ndiff vs HEAD: +" + g.insertions + " -" + g.deletions;
      gc.title = tip;
      host.appendChild(gc);
    }
    const seen: Record<string, true> = {};
    for (let j = 0; j < meta.listeningPorts.length; j++) {
      const lp = meta.listeningPorts[j];
      if (seen[lp.port]) continue;
      seen[lp.port] = true;
      const pc = document.createElement("span");
      pc.className = "pane-chip chip-port";
      pc.textContent = ":" + lp.port;
      pc.title =
        lp.proto +
        " " +
        lp.address +
        ":" +
        lp.port +
        " (pid " +
        lp.pid +
        ") \u2014 click to open";
      pc.setAttribute("role", "button");
      pc.tabIndex = 0;
      const port = lp.port;
      pc.addEventListener("click", (e) => {
        e.stopPropagation();
        window.open("http://" + location.hostname + ":" + port, "_blank");
      });
      host.appendChild(pc);
    }
  }

  // ------------------------------------------------------------------
  // Fullscreen
  // ------------------------------------------------------------------

  function applyFullscreen(state: AppState, prev: AppState) {
    if (state.fullscreenSurfaceId === prev.fullscreenSurfaceId) return;
    document.body.classList.toggle(
      "fullscreen-mode",
      state.fullscreenSurfaceId !== null,
    );
    if (prev.fullscreenSurfaceId && terms[prev.fullscreenSurfaceId]) {
      terms[prev.fullscreenSurfaceId]!.el.classList.remove("fullscreen-active");
    }
    if (state.fullscreenSurfaceId && terms[state.fullscreenSurfaceId]) {
      terms[state.fullscreenSurfaceId]!.el.classList.add("fullscreen-active");
      try {
        focusXtermPreservingScroll(
          terms[state.fullscreenSurfaceId]!.term,
          terms[state.fullscreenSurfaceId]!.termEl,
        );
      } catch {
        /* ignore */
      }
    }
  }

  backBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    store.dispatch({ kind: "fullscreen/exit" });
  });
  fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });

  wsSelectEl.addEventListener("change", () => {
    const wsId = wsSelectEl.value;
    const state = store.getState();
    if (wsId && wsId !== state.activeWorkspaceId) {
      store.dispatch({ kind: "workspace/active", workspaceId: wsId });
      store.dispatch({ kind: "fullscreen/exit" });
      sendMsg("selectWorkspace", { workspaceId: wsId });
      sendMsg("subscribeWorkspace", { workspaceId: wsId });
    }
  });

  // ------------------------------------------------------------------
  // Panels (sideband content overlays)
  // ------------------------------------------------------------------

  function reconcilePanels(state: AppState) {
    // Remove DOM panels whose state entry is gone.
    for (const id in panelsDom) {
      if (!state.panels[id]) {
        // Revoke any blob URL tied to this panel (image / canvas2d
        // renderers). Without this, every webcam frame's blob stays
        // reachable until the page unloads.
        releasePanelBlobUrl(panelsDom[id]!.contentEl);
        panelsDom[id]!.el.remove();
        delete panelsDom[id];
      }
    }
    // Drop buffered binary frames for panels that never materialized
    // (e.g. meta cleared or failed before rAF ran).
    for (const id in pendingPanelData) {
      if (!state.panels[id]) delete pendingPanelData[id];
    }
    // Create / update panels from state.
    for (const id in state.panels) {
      const ps = state.panels[id]!;
      ensurePanelDom(id, ps);
    }
  }

  function ensurePanelDom(id: string, ps: PanelState) {
    const existing = panelsDom[id];
    const meta: any = ps.meta;

    if (existing) {
      // Apply position/size/opacity updates from the latest meta.
      if (meta.x !== undefined) existing.el.style.left = meta.x + "px";
      if (meta.y !== undefined) existing.el.style.top = meta.y + "px";
      if (meta.width !== undefined && meta.width !== "auto")
        existing.el.style.width = meta.width + "px";
      if (meta.height !== undefined && meta.height !== "auto")
        existing.el.style.height = meta.height + "px";
      if (meta.opacity !== undefined)
        existing.el.style.opacity = String(meta.opacity);
      if (meta.data !== undefined) existing.contentEl.innerHTML = meta.data;
      return;
    }

    const ref = terms[ps.surfaceId];
    if (!ref) return;
    const isFixed = meta.position === "fixed";
    const el = document.createElement("div");
    el.className = "web-panel" + (isFixed ? " fixed" : "");
    if (meta.x !== undefined) el.style.left = meta.x + "px";
    if (meta.y !== undefined) el.style.top = meta.y + "px";
    if (meta.width !== undefined && meta.width !== "auto")
      el.style.width = meta.width + "px";
    if (meta.height !== undefined && meta.height !== "auto")
      el.style.height = meta.height + "px";
    if (meta.opacity !== undefined) el.style.opacity = String(meta.opacity);
    if (meta.zIndex !== undefined) el.style.zIndex = String(meta.zIndex);
    const draggable = isFixed
      ? false
      : meta.draggable !== undefined
        ? meta.draggable
        : meta.position === "float";
    const resizable = isFixed
      ? false
      : meta.resizable !== undefined
        ? meta.resizable
        : meta.position === "float";
    if (draggable) {
      el.classList.add("draggable");
      const dragH = document.createElement("div");
      dragH.className = "web-panel-drag";
      dragH.textContent = id;
      el.insertBefore(dragH, el.firstChild);
      setupPanelDrag(el, dragH, id, ps.surfaceId, sendMsg);
    }
    const contentEl = document.createElement("div");
    contentEl.className = "web-panel-content";
    el.appendChild(contentEl);
    if (resizable) {
      el.classList.add("resizable");
      const resizeH = document.createElement("div");
      resizeH.className = "web-panel-resize";
      el.appendChild(resizeH);
      setupPanelResize(el, resizeH, id, ps.surfaceId, sendMsg);
    }
    ref.termEl.appendChild(el);
    if (meta.interactive) {
      el.classList.add("interactive");
      setupPanelMouse(contentEl, id, ps.surfaceId, sendMsg);
    }
    panelsDom[id] = { el, contentEl, panelId: id };
    if (meta.data !== undefined) contentEl.innerHTML = meta.data;

    // Flush any binary frame that arrived before this DOM was created.
    const pending = pendingPanelData[id];
    if (pending) {
      delete pendingPanelData[id];
      renderPanelData(id, pending, true);
    }

    // Inform the script of the terminal pixel size for interactive panels
    // when we're not scaling to a native viewport.
    if (!store.getState().nativeViewport) {
      const rect = ref.termEl.getBoundingClientRect();
      const pxW = Math.round(rect.width);
      const pxH = Math.round(rect.height);
      if (pxW > 0 && pxH > 0 && ref.term) {
        sendMsg("panelMouseEvent", {
          surfaceId: ps.surfaceId,
          id: "__terminal__",
          event: "resize",
          cols: ref.term.cols,
          rows: ref.term.rows,
          pxWidth: pxW,
          pxHeight: pxH,
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Content renderers — panel binary data (image, svg, html, canvas2d)
  // ------------------------------------------------------------------

  const panelRenderers = createPanelRendererRegistry();

  function renderPanelData(panelId: string, data: unknown, isBinary: boolean) {
    const state = store.getState();
    const ps = state.panels[panelId];
    const dom = panelsDom[panelId];
    if (!ps || !dom) {
      // DOM not created yet (rAF hasn't fired since the meta envelope
      // arrived). Stash bytes and let ensurePanelDom flush them.
      if (isBinary) pendingPanelData[panelId] = data as Uint8Array;
      return;
    }
    const renderer = panelRenderers.get(ps.meta.type);
    if (renderer)
      renderer(
        dom.contentEl,
        data,
        ps.meta as unknown as Record<string, unknown>,
        isBinary,
      );
  }

  // ------------------------------------------------------------------
  // Glow (per-surface pane pulse on notification)
  // ------------------------------------------------------------------

  function applyGlow(state: AppState, prev: AppState) {
    const set = new Set(state.glowingSurfaceIds);
    const prevSet = new Set(prev.glowingSurfaceIds);
    for (const sid in terms) {
      const ref = terms[sid]!;
      const should = set.has(sid);
      const was = prevSet.has(sid);
      if (should !== was) ref.el.classList.toggle("notify-glow", should);
    }
  }

  // ------------------------------------------------------------------
  // Misc glue
  // ------------------------------------------------------------------

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const s = store.getState();
      if (!s.fullscreenSurfaceId) layoutView.applyLayout(s);
      layoutView.scaleTerminals(s);
    }, 100);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && store.getState().fullscreenSurfaceId) {
      store.dispatch({ kind: "fullscreen/exit" });
    }
  });

  // Pull the Telegram state once we're hooked up. Server replies with a
  // `telegramState` envelope which fills in chats + status; subsequent
  // updates arrive automatically via broadcast.
  let lastConnStatus: AppState["connection"]["status"] = "connecting";
  store.subscribe((s) => {
    if (s.connection.status === "connected" && lastConnStatus !== "connected") {
      sendMsg("telegramRequestState", {});
    }
    lastConnStatus = s.connection.status;
  });

  transport.connect();
}

// Re-export for type checkers picking this up as a module.
export {};
