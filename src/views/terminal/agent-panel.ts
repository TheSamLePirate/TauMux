/**
 * Agent Panel — a pro dark-themed interactive chat UI for the pi coding agent.
 * Fully integrated with HyperTerm Canvas. Features:
 *  - Slash command autocomplete with all pi commands
 *  - Real-time streaming with thinking blocks and tool calls
 *  - Model/thinking cycling (Ctrl+P / Shift+Tab)
 *  - Steer (during streaming) and follow-up (Alt+Enter) modes
 *  - Session stats, context meter, cost tracking
 *  - Extension UI dialogs (select, confirm, input, editor)
 *  - Fork, export, copy, session management
 *  - Bash command execution (!command)
 *  - Collapsible tool calls with diff highlighting
 */

import { createIcon } from "./icons";
import {
  autoResize,
  dispatch,
  escapeHtml,
  extractContent,
  extractImageBlocks,
  extractTextBlocks,
  extractThinkingBlocks,
  fmtK,
  formatArgs,
  type ImageAttachment,
  mdLite,
} from "./agent-panel-utils";
import {
  appendWelcome,
  buildToolCallEl,
  type ChatMessage,
  createMsgEl,
  type ToolCallState,
} from "./agent-panel-messages";

// ── Public interfaces ──

export interface AgentPanelCallbacks {
  onSendPrompt: (
    agentId: string,
    message: string,
    images?: ImageAttachment[],
  ) => void;
  onAbort: (agentId: string) => void;
  onSetModel: (agentId: string, provider: string, modelId: string) => void;
  onSetThinking: (agentId: string, level: string) => void;
  onNewSession: (agentId: string) => void;
  onCompact: (agentId: string) => void;
  onClose: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
  onFocus: (surfaceId: string) => void;
  onGetModels: (agentId: string) => void;
  onGetState: (agentId: string) => void;
}

interface SlashCommand {
  name: string;
  description: string;
  /** Source of the command */
  source: "builtin" | "extension" | "prompt" | "skill";
}

export interface AgentPaneView {
  agentId: string;
  surfaceId: string;
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  _state: AgentPanelState;
  _elements: AgentPanelElements;
}

interface AgentModelSummary {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

interface AgentPanelState {
  messages: ChatMessage[];
  currentText: string;
  currentThinking: string;
  isStreaming: boolean;
  isCompacting: boolean;
  model: AgentModelSummary | null;
  thinkingLevel: string;
  toolCalls: Map<string, ToolCallState>;
  availableModels: AgentModelSummary[] | null;
  sessionStats: {
    tokens?: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheWrite?: number;
      total: number;
    };
    cost?: number;
    contextUsage?: {
      tokens: number | null;
      contextWindow: number;
      percent: number | null;
    };
    sessionFile?: string;
    sessionId?: string;
    userMessages?: number;
    assistantMessages?: number;
    toolCalls?: number;
    toolResults?: number;
    totalMessages?: number;
  } | null;
  autoScroll: boolean;
  showModelSelector: boolean;
  showThinkingSelector: boolean;
  retryState: { attempt: number; maxAttempts: number; delayMs: number } | null;
  turnCount: number;
  totalToolCalls: number;
  sessionName: string | null;
  sessionFile: string | null;
  sessionId: string | null;
  messageCount: number;
  pendingMessageCount: number;
  autoCompactionEnabled: boolean;
  autoRetryEnabled: boolean;
  steeringMode: string;
  followUpMode: string;
  pendingSteer: number;
  pendingFollowUp: number;
  widgetsAbove: Map<string, string[]>;
  widgetsBelow: Map<string, string[]>;
  pendingImages: ImageAttachment[];
  dragActive: boolean;
  scopedModelIds: Set<string>;
  sessionList: {
    path: string;
    updatedAt: number;
    name?: string | null;
    cwd?: string | null;
    preview?: string | null;
  }[];
  sessionListFilter: string;
  sessionTree: {
    id: string;
    parentId: string | null;
    depth: number;
    role: string;
    entryType: string;
    text: string;
    timestamp?: string | null;
    childCount: number;
    active: boolean;
  }[];
  /** Available slash commands from pi */
  commands: SlashCommand[];
  /** Is the slash command dropdown visible? */
  showSlashMenu: boolean;
  /** Current slash filter text */
  slashFilter: string;
  /** Index of selected slash command */
  slashSelectedIndex: number;
  /** Extension UI dialog state */
  activeDialog: ExtensionDialog | null;
}

interface ExtensionDialog {
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: { label: string; value: string; description?: string }[];
  defaultValue?: string;
  placeholder?: string;
  selectedIndex: number;
  inputValue: string;
}

interface AgentPanelElements {
  messagesEl: HTMLDivElement;
  inputEl: HTMLTextAreaElement;
  inputBarEl: HTMLDivElement;
  footerEl: HTMLDivElement;
  sendBtn: HTMLButtonElement;
  modelBtnLabel: HTMLSpanElement;
  thinkingBtnLabel: HTMLSpanElement;
  modelSelectorEl: HTMLDivElement;
  thinkingSelectorEl: HTMLDivElement;
  toolbarEl: HTMLDivElement;
  streamingIndicator: HTMLDivElement;
  contextMeter: HTMLDivElement;
  contextMeterFill: HTMLDivElement;
  contextMeterLabel: HTMLSpanElement;
  slashMenuEl: HTMLDivElement;
  dialogOverlay: HTMLDivElement;
  sessionNameEl: HTMLSpanElement;
  statsEl: HTMLDivElement;
  widgetsAboveEl: HTMLDivElement;
  widgetsBelowEl: HTMLDivElement;
  attachmentTrayEl: HTMLDivElement;
  modelMetaEl: HTMLDivElement;
}

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
const THINKING_COLORS: Record<string, string> = {
  off: "rgba(255,255,255,0.25)",
  minimal: "rgba(255,255,255,0.4)",
  low: "#67e8f9",
  medium: "#a78bfa",
  high: "#f97316",
  xhigh: "#ef4444",
};

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "/model", description: "Switch model", source: "builtin" },
  { name: "/new", description: "Start a new session", source: "builtin" },
  {
    name: "/resume",
    description: "Open another session by path",
    source: "builtin",
  },
  { name: "/name", description: "Set session display name", source: "builtin" },
  {
    name: "/session",
    description: "Show session info & stats",
    source: "builtin",
  },
  {
    name: "/compact",
    description: "Compact context window",
    source: "builtin",
  },
  {
    name: "/copy",
    description: "Copy last assistant message",
    source: "builtin",
  },
  { name: "/export", description: "Export session to HTML", source: "builtin" },
  {
    name: "/fork",
    description: "Fork from a previous message",
    source: "builtin",
  },
  { name: "/tree", description: "Navigate session tree", source: "builtin" },
  {
    name: "/settings",
    description: "Thinking, steering, retry settings",
    source: "builtin",
  },
  {
    name: "/hotkeys",
    description: "Show keyboard shortcuts",
    source: "builtin",
  },
  { name: "/clear", description: "Clear chat display", source: "builtin" },
  { name: "/help", description: "Show available commands", source: "builtin" },
];

// ── Factory ──

export function createAgentPaneView(
  surfaceId: string,
  agentId: string,
  callbacks: AgentPanelCallbacks,
): AgentPaneView {
  const container = document.createElement("div");
  container.className = "surface-container agent-surface";
  container.dataset["surfaceId"] = surfaceId;
  container.style.display = "none";

  // ── Status bar ──
  const bar = document.createElement("div");
  bar.className = "surface-bar";

  const barTitleWrap = document.createElement("div");
  barTitleWrap.className = "surface-bar-title-wrap";
  const barIcon = createIcon("command", "surface-bar-icon");
  barIcon.classList.add("agent-bar-icon");
  barTitleWrap.appendChild(barIcon);
  const barTitle = document.createElement("span");
  barTitle.className = "surface-bar-title";
  barTitle.textContent = "Pi Agent";
  barTitleWrap.appendChild(barTitle);
  bar.appendChild(barTitleWrap);

  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips";
  bar.appendChild(chipsEl);

  const barActions = document.createElement("div");
  barActions.className = "surface-bar-actions";

  for (const [title, icon, dir] of [
    ["Split Right", "splitHorizontal", "horizontal"],
    ["Split Down", "splitVertical", "vertical"],
  ] as const) {
    const btn = document.createElement("button");
    btn.className = "surface-bar-btn";
    btn.title = title;
    btn.append(createIcon(icon));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      callbacks.onSplit(surfaceId, dir);
    });
    barActions.appendChild(btn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "surface-bar-btn surface-bar-close";
  closeBtn.title = "Close";
  closeBtn.append(createIcon("close"));
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onClose(surfaceId);
  });
  barActions.appendChild(closeBtn);
  bar.appendChild(barActions);
  container.appendChild(bar);

  // ── Body ──
  const body = document.createElement("div");
  body.className = "agent-body";

  // ── Toolbar ──
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "agent-toolbar";

  // Session name (editable on click)
  const sessionNameEl = document.createElement("span");
  sessionNameEl.className = "agent-session-name";
  sessionNameEl.textContent = "";
  sessionNameEl.title = "Click to rename session";
  sessionNameEl.addEventListener("click", () => {
    const name = prompt("Session name:", state.sessionName || "");
    if (name !== null) {
      dispatch("ht-agent-set-session-name", { agentId, name });
    }
  });
  toolbarEl.appendChild(sessionNameEl);

  // Model button
  const modelBtn = document.createElement("button");
  modelBtn.className = "agent-tb-btn agent-tb-model";
  modelBtn.title = "Switch model (Ctrl+P)";
  const modelDot = document.createElement("span");
  modelDot.className = "agent-tb-dot agent-tb-dot-model";
  modelBtn.appendChild(modelDot);
  const modelBtnLabel = document.createElement("span");
  modelBtnLabel.textContent = "Loading\u2026";
  modelBtn.appendChild(modelBtnLabel);
  const modelChevron = document.createElement("span");
  modelChevron.className = "agent-tb-chevron";
  modelChevron.textContent = "\u25be";
  modelBtn.appendChild(modelChevron);
  modelBtn.addEventListener("click", () => {
    state.showModelSelector = !state.showModelSelector;
    state.showThinkingSelector = false;
    renderDropdowns(view);
    if (state.showModelSelector) callbacks.onGetModels(agentId);
  });
  toolbarEl.appendChild(modelBtn);

  // Thinking button
  const thinkingBtn = document.createElement("button");
  thinkingBtn.className = "agent-tb-btn agent-tb-thinking";
  thinkingBtn.title = "Thinking level (Shift+Tab)";
  const thinkDot = document.createElement("span");
  thinkDot.className = "agent-tb-dot";
  thinkDot.style.background = THINKING_COLORS["off"];
  thinkingBtn.appendChild(thinkDot);
  const thinkingBtnLabel = document.createElement("span");
  thinkingBtnLabel.textContent = "off";
  thinkingBtn.appendChild(thinkingBtnLabel);
  const thinkChevron = document.createElement("span");
  thinkChevron.className = "agent-tb-chevron";
  thinkChevron.textContent = "\u25be";
  thinkingBtn.appendChild(thinkChevron);
  thinkingBtn.addEventListener("click", () => {
    state.showThinkingSelector = !state.showThinkingSelector;
    state.showModelSelector = false;
    renderDropdowns(view);
  });
  toolbarEl.appendChild(thinkingBtn);

  // Spacer
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  toolbarEl.appendChild(spacer);

  // Toolbar action buttons
  const actionDefs: [string, string, () => void][] = [
    ["\u21bb New", "New session", () => callbacks.onNewSession(agentId)],
    [
      "\u25f3 Session",
      "Show session info",
      () => executeBuiltinCommand(view, callbacks, "/session"),
    ],
    [
      "\u2442 Fork",
      "Fork from an earlier message",
      () => dispatch("ht-agent-get-fork-messages", { agentId }),
    ],
    ["\u2699 Settings", "Agent settings", () => showSettingsDialog(view)],
    ["\u2298 Compact", "Compact context", () => callbacks.onCompact(agentId)],
    [
      "\u2398 Copy",
      "Copy last response",
      () => dispatch("ht-agent-get-last-assistant-text", { agentId }),
    ],
    [
      "\u21a7 Export",
      "Export to HTML",
      () => dispatch("ht-agent-export-html", { agentId }),
    ],
  ];
  for (const [label, title, handler] of actionDefs) {
    const btn = document.createElement("button");
    btn.className = "agent-tb-btn agent-tb-action";
    btn.title = title;
    btn.textContent = label;
    btn.addEventListener("click", handler);
    toolbarEl.appendChild(btn);
  }

  body.appendChild(toolbarEl);

  const modelMetaEl = document.createElement("div");
  modelMetaEl.className = "agent-model-meta";
  body.appendChild(modelMetaEl);

  // ── Session stats row ──
  const statsEl = document.createElement("div");
  statsEl.className = "agent-stats agent-stats-hidden";
  body.appendChild(statsEl);

  // ── Dropdowns ──
  const modelSelectorEl = document.createElement("div");
  modelSelectorEl.className = "agent-dropdown agent-dropdown-hidden";
  body.appendChild(modelSelectorEl);

  const thinkingSelectorEl = document.createElement("div");
  thinkingSelectorEl.className = "agent-dropdown agent-dropdown-hidden";
  body.appendChild(thinkingSelectorEl);

  // ── Streaming indicator ──
  const streamingIndicator = document.createElement("div");
  streamingIndicator.className =
    "agent-streaming-bar agent-streaming-bar-hidden";
  streamingIndicator.innerHTML = `<div class="agent-streaming-bar-glow"></div><span class="agent-streaming-bar-label">Thinking</span>`;
  body.appendChild(streamingIndicator);

  // ── Messages ──
  const messagesEl = document.createElement("div");
  messagesEl.className = "agent-messages";
  appendWelcome(messagesEl);
  body.appendChild(messagesEl);

  const widgetsAboveEl = document.createElement("div");
  widgetsAboveEl.className = "agent-widgets agent-widgets-above";
  body.appendChild(widgetsAboveEl);

  // ── Context meter ──
  const contextMeter = document.createElement("div");
  contextMeter.className = "agent-context-meter";
  const contextMeterFill = document.createElement("div");
  contextMeterFill.className = "agent-context-fill";
  contextMeter.appendChild(contextMeterFill);
  const contextMeterLabel = document.createElement("span");
  contextMeterLabel.className = "agent-context-label";
  contextMeterLabel.textContent = "";
  contextMeter.appendChild(contextMeterLabel);

  // ── Footer ──
  const footerEl = document.createElement("div");
  footerEl.className = "agent-footer";
  footerEl.appendChild(contextMeter);
  const footerText = document.createElement("span");
  footerText.className = "agent-footer-text";
  footerText.textContent = "Ready";
  footerEl.appendChild(footerText);
  body.appendChild(footerEl);

  // ── Slash command menu ──
  const slashMenuEl = document.createElement("div");
  slashMenuEl.className = "agent-slash-menu agent-slash-menu-hidden";
  body.appendChild(slashMenuEl);

  // ── Dialog overlay ──
  const dialogOverlay = document.createElement("div");
  dialogOverlay.className = "agent-dialog-overlay agent-dialog-hidden";
  body.appendChild(dialogOverlay);

  // ── Input bar ──
  const inputBarEl = document.createElement("div");
  inputBarEl.className = "agent-input-bar";

  const inputWrap = document.createElement("div");
  inputWrap.className = "agent-input-wrap";

  const inputEl = document.createElement("textarea");
  inputEl.className = "agent-input";
  inputEl.placeholder = "Message pi agent\u2026  (/ for commands)";
  inputEl.rows = 1;
  inputEl.addEventListener("input", () => {
    autoResize(inputEl);
    handleSlashInput(view);
  });
  inputEl.addEventListener("keydown", (e) =>
    handleInputKeydown(e, view, callbacks),
  );
  inputEl.addEventListener("paste", (e) => {
    void handlePasteImages(e, view);
  });
  inputEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    view._state.dragActive = true;
    syncInputDecorations(view);
  });
  inputEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    view._state.dragActive = true;
    syncInputDecorations(view);
  });
  inputEl.addEventListener("dragleave", () => {
    view._state.dragActive = false;
    syncInputDecorations(view);
  });
  inputEl.addEventListener("drop", (e) => {
    e.preventDefault();
    view._state.dragActive = false;
    syncInputDecorations(view);
    void handleDropImages(e, view);
  });
  inputWrap.appendChild(inputEl);

  // Input hint
  const inputHint = document.createElement("div");
  inputHint.className = "agent-input-hint";
  inputHint.innerHTML = `<kbd>Enter</kbd> send <kbd>Shift+Enter</kbd> newline <kbd>/</kbd> commands <kbd>Alt+Enter</kbd> follow-up`;
  inputWrap.appendChild(inputHint);

  inputBarEl.appendChild(inputWrap);

  const attachmentTrayEl = document.createElement("div");
  attachmentTrayEl.className =
    "agent-attachment-tray agent-attachment-tray-hidden";
  inputWrap.appendChild(attachmentTrayEl);

  const sendBtn = document.createElement("button");
  sendBtn.className = "agent-send-btn";
  sendBtn.title = "Send (Enter)";
  sendBtn.innerHTML = SEND_ICON;
  sendBtn.addEventListener("click", () => {
    if (state.isStreaming) {
      callbacks.onAbort(agentId);
    } else {
      submitInput(view, callbacks);
    }
  });
  inputBarEl.appendChild(sendBtn);

  body.appendChild(inputBarEl);

  const widgetsBelowEl = document.createElement("div");
  widgetsBelowEl.className = "agent-widgets agent-widgets-below";
  body.appendChild(widgetsBelowEl);

  container.appendChild(body);

  container.addEventListener("mousedown", () => callbacks.onFocus(surfaceId));
  messagesEl.addEventListener("scroll", () => {
    state.autoScroll =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
      50;
  });

  const state: AgentPanelState = {
    messages: [],
    currentText: "",
    currentThinking: "",
    isStreaming: false,
    isCompacting: false,
    model: null,
    thinkingLevel: "off",
    toolCalls: new Map(),
    availableModels: null,
    sessionStats: null,
    autoScroll: true,
    showModelSelector: false,
    showThinkingSelector: false,
    retryState: null,
    turnCount: 0,
    totalToolCalls: 0,
    sessionName: null,
    sessionFile: null,
    sessionId: null,
    messageCount: 0,
    pendingMessageCount: 0,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    steeringMode: "all",
    followUpMode: "all",
    pendingSteer: 0,
    pendingFollowUp: 0,
    widgetsAbove: new Map(),
    widgetsBelow: new Map(),
    pendingImages: [],
    dragActive: false,
    scopedModelIds: new Set(),
    sessionList: [],
    sessionListFilter: "",
    sessionTree: [],
    commands: [...BUILTIN_COMMANDS],
    showSlashMenu: false,
    slashFilter: "",
    slashSelectedIndex: 0,
    activeDialog: null,
  };

  const elements: AgentPanelElements = {
    messagesEl,
    inputEl,
    inputBarEl,
    footerEl,
    sendBtn,
    modelBtnLabel,
    thinkingBtnLabel,
    modelSelectorEl,
    thinkingSelectorEl,
    toolbarEl,
    streamingIndicator,
    contextMeter,
    contextMeterFill,
    contextMeterLabel,
    slashMenuEl,
    dialogOverlay,
    sessionNameEl,
    statsEl,
    widgetsAboveEl,
    widgetsBelowEl,
    attachmentTrayEl,
    modelMetaEl,
  };

  const view: AgentPaneView = {
    agentId,
    surfaceId,
    container,
    titleEl: barTitle,
    chipsEl,
    title: "Pi Agent",
    _state: state,
    _elements: elements,
  };

  // Fetch initial state and commands
  setTimeout(() => {
    callbacks.onGetState(agentId);
    dispatch("ht-agent-get-commands", { agentId });
    dispatch("ht-agent-get-session-stats", { agentId });
    dispatch("ht-agent-get-messages", { agentId });
  }, 300);

  return view;
}

// ── Event handler ──

export function agentPanelHandleEvent(
  view: AgentPaneView,
  event: Record<string, unknown>,
): void {
  const s = view._state;
  const el = view._elements;
  const t = event["type"] as string;

  switch (t) {
    case "agent_start":
      s.isStreaming = true;
      s.currentText = "";
      s.currentThinking = "";
      s.toolCalls.clear();
      s.turnCount++;
      syncStreamingUI(view);
      break;

    case "agent_end":
      s.isStreaming = false;
      flushStreaming(view);
      syncStreamingUI(view);
      // Refresh stats after each agent run
      dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
      break;

    case "turn_start":
      break;

    case "turn_end":
      break;

    case "message_start":
      break;

    case "message_end":
      break;

    case "message_update": {
      const d = event["assistantMessageEvent"] as
        | Record<string, unknown>
        | undefined;
      if (!d) break;
      const dt = d["type"] as string;
      if (dt === "text_delta") {
        s.currentText += d["delta"] as string;
        renderStream(view);
      } else if (dt === "thinking_delta") {
        s.currentThinking += d["delta"] as string;
        renderThinkingStream(view);
      } else if (dt === "done" || dt === "error") {
        flushStreaming(view);
      }
      break;
    }

    case "tool_execution_start": {
      const tcId = event["toolCallId"] as string;
      s.totalToolCalls++;
      s.toolCalls.set(tcId, {
        id: tcId,
        name: event["toolName"] as string,
        args: formatArgs(event["args"]),
        rawArgs: event["args"],
        isRunning: true,
        collapsed: false,
        startTime: Date.now(),
      });
      renderToolCall(view, tcId);
      updateChips(view);
      break;
    }

    case "tool_execution_update": {
      const tcId = event["toolCallId"] as string;
      const tc = s.toolCalls.get(tcId);
      if (tc) {
        const pr = event["partialResult"] as
          | Record<string, unknown>
          | undefined;
        if (pr?.["content"]) {
          tc.result = extractContent(pr["content"]).slice(0, 3000);
        }
        renderToolCall(view, tcId);
      }
      break;
    }

    case "tool_execution_end": {
      const tcId = event["toolCallId"] as string;
      const tc = s.toolCalls.get(tcId);
      if (tc) {
        tc.isRunning = false;
        tc.isError = event["isError"] as boolean;
        const r = event["result"] as Record<string, unknown> | undefined;
        if (r?.["content"])
          tc.result = extractContent(r["content"]).slice(0, 6000);
        tc.collapsed = true;
        renderToolCall(view, tcId);
        updateChips(view);
      }
      break;
    }

    case "compaction_start":
      s.isCompacting = true;
      el.streamingIndicator.classList.remove("agent-streaming-bar-hidden");
      setStreamLabel(el, "Compacting context\u2026");
      break;

    case "compaction_end": {
      s.isCompacting = false;
      if (!s.isStreaming)
        el.streamingIndicator.classList.add("agent-streaming-bar-hidden");
      if (event["aborted"]) {
        addSystemMessage(view, "Context compaction aborted");
      } else if (event["errorMessage"]) {
        addSystemMessage(
          view,
          `Context compaction failed: ${event["errorMessage"] as string}`,
        );
      } else {
        const reason = (event["reason"] as string) ?? "manual";
        const willRetry = Boolean(event["willRetry"]);
        addSystemMessage(
          view,
          `Context compacted (${reason})${willRetry ? ", retrying request…" : ""}`,
        );
      }
      dispatch("ht-agent-get-state", { agentId: view.agentId });
      dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
      syncFooter(view);
      break;
    }

    case "auto_retry_start":
      s.retryState = {
        attempt: event["attempt"] as number,
        maxAttempts: event["maxAttempts"] as number,
        delayMs: event["delayMs"] as number,
      };
      el.streamingIndicator.classList.remove("agent-streaming-bar-hidden");
      setStreamLabel(
        el,
        `Retrying (${s.retryState.attempt}/${s.retryState.maxAttempts})\u2026`,
      );
      break;

    case "auto_retry_end":
      s.retryState = null;
      if (!s.isStreaming)
        el.streamingIndicator.classList.add("agent-streaming-bar-hidden");
      if (event["success"] === false && event["finalError"]) {
        addSystemMessage(
          view,
          `Retry failed: ${event["finalError"] as string}`,
        );
      }
      syncFooter(view);
      break;

    case "queue_update": {
      const steering = event["steering"];
      const followUp = event["followUp"];
      s.pendingSteer = Array.isArray(steering)
        ? steering.length
        : ((event["pendingSteer"] as number) ?? 0);
      s.pendingFollowUp = Array.isArray(followUp)
        ? followUp.length
        : ((event["pendingFollowUp"] as number) ?? 0);
      updateChips(view);
      syncFooter(view);
      break;
    }

    case "response":
      handleResponse(view, event);
      break;

    case "agent_stderr": {
      const text = event["text"] as string;
      if (text && !text.includes("Debugger") && !text.includes("inspector")) {
        addSystemMessage(view, text);
      }
      break;
    }

    case "extension_ui_request":
      handleExtUI(view, event);
      break;

    case "extension_error": {
      const extensionPath = (event["extensionPath"] as string) ?? "extension";
      const error = (event["error"] as string) ?? "Unknown extension error";
      addSystemMessage(view, `Extension error in ${extensionPath}: ${error}`);
      break;
    }

    case "agent_exit": {
      s.isStreaming = false;
      flushStreaming(view);
      addSystemMessage(
        view,
        `Agent process exited (code ${event["code"] ?? "?"})`,
      );
      syncStreamingUI(view);
      break;
    }
  }
}

export function agentPanelAddUserMessage(
  view: AgentPaneView,
  text: string,
  images?: ImageAttachment[],
): void {
  view._state.messages.push({
    role: "user",
    content: text,
    images: images?.length ? images : undefined,
    timestamp: Date.now(),
  });
  renderAllMessages(view);
}

export function agentPanelFocusInput(view: AgentPaneView): void {
  view._elements.inputEl.focus();
}

// ── Input handling ──

function handleInputKeydown(
  e: KeyboardEvent,
  view: AgentPaneView,
  cb: AgentPanelCallbacks,
): void {
  const s = view._state;

  // Slash menu navigation
  if (s.showSlashMenu) {
    const filtered = getFilteredCommands(s);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      s.slashSelectedIndex = Math.min(
        s.slashSelectedIndex + 1,
        filtered.length - 1,
      );
      renderSlashMenu(view);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      s.slashSelectedIndex = Math.max(s.slashSelectedIndex - 1, 0);
      renderSlashMenu(view);
      return;
    }
    if (e.key === "Tab" || e.key === "Enter") {
      if (filtered.length > 0) {
        e.preventDefault();
        const cmd = filtered[s.slashSelectedIndex];
        // Complete the command
        view._elements.inputEl.value = cmd.name + " ";
        autoResize(view._elements.inputEl);
        hideSlashMenu(view);
        // If it's Enter on a no-arg command, execute immediately
        if (e.key === "Enter") {
          executeSlashCommand(view, cb);
        }
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideSlashMenu(view);
      return;
    }
  }

  // Normal keys
  if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    const text = view._elements.inputEl.value.trim();
    if (text.startsWith("/")) {
      executeSlashCommand(view, cb);
    } else if (text.startsWith("!")) {
      // Bash shorthand: !command
      const cmd = text.slice(1).trim();
      if (cmd) {
        addSystemMessage(view, `$ ${cmd}`);
        dispatch("ht-agent-bash", { agentId: view.agentId, command: cmd });
        view._elements.inputEl.value = "";
        clearPendingImages(view);
        autoResize(view._elements.inputEl);
      }
    } else {
      submitInput(view, cb);
    }
    return;
  }

  // Alt+Enter: queue follow-up
  if (e.key === "Enter" && e.altKey) {
    e.preventDefault();
    const text = view._elements.inputEl.value.trim();
    if ((text || s.pendingImages.length > 0) && s.isStreaming) {
      dispatch("ht-agent-follow-up", {
        agentId: view.agentId,
        message: text,
        images: s.pendingImages,
      });
      addSystemMessage(
        view,
        `Queued follow-up: ${text || `${s.pendingImages.length} image${s.pendingImages.length === 1 ? "" : "s"}`}`,
      );
      view._elements.inputEl.value = "";
      clearPendingImages(view);
      autoResize(view._elements.inputEl);
    } else if (text || s.pendingImages.length > 0) {
      submitInput(view, cb);
    }
    return;
  }

  // Escape: abort or close dialogs
  if (e.key === "Escape") {
    e.preventDefault();
    if (s.activeDialog) {
      dismissDialog(view);
    } else if (s.isStreaming) {
      cb.onAbort(view.agentId);
    }
    return;
  }

  // Ctrl+P / Shift+Ctrl+P: cycle model within local scope when available
  if (e.key === "p" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const direction: 1 | -1 = e.shiftKey ? -1 : 1;
    if (!cycleScopedModel(view, direction)) {
      dispatch("ht-agent-cycle-model", { agentId: view.agentId });
    }
    return;
  }

  // Shift+Tab: cycle thinking
  if (e.key === "Tab" && e.shiftKey) {
    e.preventDefault();
    dispatch("ht-agent-cycle-thinking", { agentId: view.agentId });
    return;
  }
}

function submitInput(view: AgentPaneView, cb: AgentPanelCallbacks): void {
  const text = view._elements.inputEl.value.trim();
  const images = [...view._state.pendingImages];
  if (!text && images.length === 0) return;

  hideSlashMenu(view);

  if (view._state.isStreaming) {
    dispatch("ht-agent-steer", {
      agentId: view.agentId,
      message: text,
      images,
    });
    addSystemMessage(
      view,
      `Steering: ${text || `${images.length} image${images.length === 1 ? "" : "s"}`}`,
    );
  } else {
    cb.onSendPrompt(view.agentId, text, images);
  }
  view._elements.inputEl.value = "";
  clearPendingImages(view);
  autoResize(view._elements.inputEl);
}

async function handlePasteImages(
  e: ClipboardEvent,
  view: AgentPaneView,
): Promise<void> {
  const items = Array.from(e.clipboardData?.items ?? []);
  const files = items
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (files.length === 0) return;
  e.preventDefault();
  await addPendingImages(view, files);
}

async function handleDropImages(
  e: DragEvent,
  view: AgentPaneView,
): Promise<void> {
  const files = Array.from(e.dataTransfer?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (files.length === 0) return;
  await addPendingImages(view, files);
}

async function addPendingImages(
  view: AgentPaneView,
  files: File[],
): Promise<void> {
  const images = await Promise.all(files.map(fileToImageAttachment));
  view._state.pendingImages.push(...images.filter(Boolean));
  renderAttachmentTray(view);
  syncInputDecorations(view);
}

function clearPendingImages(view: AgentPaneView): void {
  view._state.pendingImages = [];
  renderAttachmentTray(view);
  syncInputDecorations(view);
}

function renderAttachmentTray(view: AgentPaneView): void {
  const { attachmentTrayEl } = view._elements;
  const { pendingImages } = view._state;
  attachmentTrayEl.innerHTML = "";
  attachmentTrayEl.classList.toggle(
    "agent-attachment-tray-hidden",
    pendingImages.length === 0,
  );
  for (const [index, img] of pendingImages.entries()) {
    const chip = document.createElement("div");
    chip.className = "agent-attachment-chip";
    const thumb = document.createElement("img");
    thumb.className = "agent-attachment-thumb";
    thumb.src = `data:${img.mimeType};base64,${img.data}`;
    chip.appendChild(thumb);
    const label = document.createElement("span");
    label.className = "agent-attachment-label";
    label.textContent = img.fileName ?? img.mimeType;
    chip.appendChild(label);
    const rm = document.createElement("button");
    rm.className = "agent-attachment-remove";
    rm.textContent = "×";
    rm.title = "Remove image";
    rm.addEventListener("click", () => {
      view._state.pendingImages.splice(index, 1);
      renderAttachmentTray(view);
      syncInputDecorations(view);
    });
    chip.appendChild(rm);
    attachmentTrayEl.appendChild(chip);
  }
}

function syncInputDecorations(view: AgentPaneView): void {
  view._elements.inputBarEl.classList.toggle(
    "agent-input-bar-drop",
    view._state.dragActive,
  );
  view._elements.inputEl.classList.toggle(
    "agent-input-with-attachments",
    view._state.pendingImages.length > 0,
  );
}

async function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const [, payload = ""] = dataUrl.split(",");
  return {
    type: "image",
    data: payload,
    mimeType: file.type || "image/png",
    fileName: file.name,
  };
}

// ── Slash commands ──

function handleSlashInput(view: AgentPaneView): void {
  const text = view._elements.inputEl.value;
  if (text.startsWith("/") && !text.includes("\n")) {
    const filter = text.slice(1).toLowerCase();
    view._state.slashFilter = filter;
    view._state.slashSelectedIndex = 0;
    view._state.showSlashMenu = true;
    renderSlashMenu(view);
  } else {
    hideSlashMenu(view);
  }
}

function getFilteredCommands(s: AgentPanelState): SlashCommand[] {
  if (!s.slashFilter) return s.commands;
  return s.commands.filter(
    (c) =>
      c.name.toLowerCase().includes(s.slashFilter) ||
      c.description.toLowerCase().includes(s.slashFilter),
  );
}

function renderSlashMenu(view: AgentPaneView): void {
  const { slashMenuEl } = view._elements;
  const s = view._state;
  const cmds = getFilteredCommands(s);

  slashMenuEl.innerHTML = "";

  if (cmds.length === 0) {
    slashMenuEl.classList.add("agent-slash-menu-hidden");
    return;
  }

  slashMenuEl.classList.remove("agent-slash-menu-hidden");

  const header = document.createElement("div");
  header.className = "agent-slash-hdr";
  header.textContent = "Commands";
  slashMenuEl.appendChild(header);

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    const item = document.createElement("button");
    item.className = `agent-slash-item${i === s.slashSelectedIndex ? " agent-slash-item-sel" : ""}`;

    const name = document.createElement("span");
    name.className = "agent-slash-name";
    name.textContent = cmd.name;
    item.appendChild(name);

    const desc = document.createElement("span");
    desc.className = "agent-slash-desc";
    desc.textContent = cmd.description;
    item.appendChild(desc);

    if (cmd.source !== "builtin") {
      const badge = document.createElement("span");
      badge.className = `agent-slash-badge agent-slash-badge-${cmd.source}`;
      badge.textContent = cmd.source;
      item.appendChild(badge);
    }

    item.addEventListener("click", () => {
      view._elements.inputEl.value = cmd.name + " ";
      autoResize(view._elements.inputEl);
      hideSlashMenu(view);
      view._elements.inputEl.focus();
    });
    slashMenuEl.appendChild(item);
  }
}

function hideSlashMenu(view: AgentPaneView): void {
  view._state.showSlashMenu = false;
  view._elements.slashMenuEl.classList.add("agent-slash-menu-hidden");
}

function executeSlashCommand(
  view: AgentPaneView,
  cb: AgentPanelCallbacks,
): void {
  const raw = view._elements.inputEl.value.trim();
  view._elements.inputEl.value = "";
  autoResize(view._elements.inputEl);
  hideSlashMenu(view);

  const parts = raw.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");
  const agentId = view.agentId;

  switch (cmd) {
    case "/new":
      cb.onNewSession(agentId);
      break;
    case "/resume":
      if (args) showSwitchSessionDialog(view, args);
      else dispatch("ht-agent-list-sessions", { agentId });
      break;
    case "/model":
      if (args) {
        // Try to match model by name
        const m = view._state.availableModels?.find(
          (x) =>
            x.name.toLowerCase().includes(args.toLowerCase()) ||
            x.id.toLowerCase().includes(args.toLowerCase()),
        );
        if (m) {
          dispatch("ht-agent-set-model", {
            agentId,
            provider: m.provider,
            modelId: m.id,
          });
          addSystemMessage(view, `Switching to ${m.name}`);
        } else {
          addSystemMessage(
            view,
            `Model not found: ${args}. Opening model selector\u2026`,
          );
          view._state.showModelSelector = true;
          renderDropdowns(view);
          cb.onGetModels(agentId);
        }
      } else {
        view._state.showModelSelector = true;
        renderDropdowns(view);
        cb.onGetModels(agentId);
      }
      break;
    case "/compact":
      if (args) {
        dispatch("ht-agent-compact", { agentId }); // pi doesn't support custom instructions via RPC compact yet
      }
      cb.onCompact(agentId);
      addSystemMessage(view, "Compacting context\u2026");
      break;
    case "/name":
      if (args) {
        dispatch("ht-agent-set-session-name", { agentId, name: args });
        addSystemMessage(view, `Session renamed to "${args}"`);
      } else {
        addSystemMessage(view, "Usage: /name <session name>");
      }
      break;
    case "/session":
      dispatch("ht-agent-get-state", { agentId });
      dispatch("ht-agent-get-session-stats", { agentId });
      showSessionStats(view);
      break;
    case "/copy":
      dispatch("ht-agent-get-last-assistant-text", { agentId });
      break;
    case "/export":
      dispatch("ht-agent-export-html", {
        agentId,
        outputPath: args || undefined,
      });
      addSystemMessage(view, "Exporting session\u2026");
      break;
    case "/fork":
      dispatch("ht-agent-get-fork-messages", { agentId });
      addSystemMessage(view, "Fetching fork points\u2026");
      break;
    case "/tree":
      dispatch("ht-agent-get-session-tree", {
        agentId,
        sessionPath: view._state.sessionFile ?? undefined,
      });
      break;
    case "/settings":
      showSettingsDialog(view);
      break;
    case "/hotkeys":
      showHotkeysMessage(view);
      break;
    case "/clear":
      view._state.messages = [];
      renderAllMessages(view);
      break;
    case "/help":
      showHelpMessage(view);
      break;
    default:
      // Unknown slash command — send it as a prompt (pi might handle it as a skill/template)
      cb.onSendPrompt(agentId, raw);
      break;
  }
}

function executeBuiltinCommand(
  view: AgentPaneView,
  cb: AgentPanelCallbacks,
  command: string,
): void {
  view._elements.inputEl.value = command;
  executeSlashCommand(view, cb);
}

// ── Extension UI ──

function handleExtUI(view: AgentPaneView, ev: Record<string, unknown>): void {
  const method = ev["method"] as string;
  const id = ev["id"] as string;
  if (!method || !id) return;

  // Fire-and-forget methods
  if (method === "notify") {
    const level = (ev["notifyType"] as string) ?? "info";
    const msg = ev["message"] as string;
    addSystemMessage(view, `[${level}] ${msg}`);
    return;
  }

  if (method === "setStatus") {
    const key = ev["statusKey"] as string;
    const text = ev["statusText"] as string | undefined;
    if (key && text) {
      const existing = view.chipsEl.querySelector(
        `[data-ck="${key}"]`,
      ) as HTMLSpanElement | null;
      if (existing) {
        existing.textContent = text;
      } else {
        const chip = document.createElement("span");
        chip.className = "surface-chip chip-agent-status";
        chip.dataset["ck"] = key;
        chip.textContent = text;
        view.chipsEl.appendChild(chip);
      }
    } else if (key) {
      // Remove status chip
      view.chipsEl.querySelector(`[data-ck="${key}"]`)?.remove();
    }
    return;
  }

  if (method === "setWidget") {
    const key = ev["widgetKey"] as string;
    const placement = (ev["widgetPlacement"] as string) ?? "aboveEditor";
    const lines = Array.isArray(ev["widgetLines"])
      ? (ev["widgetLines"] as string[])
      : null;
    const target =
      placement === "belowEditor"
        ? view._state.widgetsBelow
        : view._state.widgetsAbove;
    if (key && lines && lines.length > 0) target.set(key, lines);
    else if (key) target.delete(key);
    renderWidgets(view);
    return;
  }

  if (method === "set_editor_text") {
    const text = (ev["text"] as string) ?? "";
    view._elements.inputEl.value = text;
    autoResize(view._elements.inputEl);
    view._elements.inputEl.focus();
    return;
  }

  if (method === "setTitle") {
    const title = ev["title"] as string;
    if (title) {
      view.titleEl.textContent = title;
      view.title = title;
    }
    return;
  }

  // Dialog methods
  if (method === "select") {
    const rawOptions = (ev["options"] as unknown[]) ?? [];
    const options = rawOptions.map((option) => {
      if (typeof option === "string") {
        return { label: option, value: option };
      }
      const rec = option as Record<string, unknown>;
      return {
        label: (rec["label"] as string) ?? (rec["value"] as string) ?? "",
        value: (rec["value"] as string) ?? (rec["label"] as string) ?? "",
        description: rec["description"] as string | undefined,
      };
    });
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      options,
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view);
    return;
  }

  if (method === "confirm") {
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      options: [
        { label: "Yes", value: "true" },
        { label: "No", value: "false" },
      ],
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view);
    return;
  }

  if (method === "input") {
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      placeholder: ev["placeholder"] as string,
      defaultValue: ev["defaultValue"] as string,
      selectedIndex: 0,
      inputValue: (ev["defaultValue"] as string) ?? "",
    };
    renderDialog(view);
    return;
  }

  if (method === "editor") {
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      defaultValue: ev["defaultValue"] as string,
      selectedIndex: 0,
      inputValue: (ev["defaultValue"] as string) ?? "",
    };
    renderDialog(view);
    return;
  }

  // Unknown dialog — auto-cancel
  dispatch("ht-agent-extension-ui-response", {
    agentId: view.agentId,
    id,
    response: { cancelled: true },
  });
}

function renderDialog(view: AgentPaneView): void {
  const { dialogOverlay } = view._elements;
  const d = view._state.activeDialog;
  if (!d) return;

  dialogOverlay.classList.remove("agent-dialog-hidden");
  dialogOverlay.innerHTML = "";

  const modal = document.createElement("div");
  modal.className = "agent-dialog";

  // Title
  if (d.title) {
    const title = document.createElement("div");
    title.className = "agent-dialog-title";
    title.textContent = d.title;
    modal.appendChild(title);
  }

  // Message
  if (d.message) {
    const msg = document.createElement("div");
    msg.className = "agent-dialog-msg";
    msg.textContent = d.message;
    modal.appendChild(msg);
  }

  if (d.method === "select" && d.options) {
    const list = document.createElement("div");
    list.className = "agent-dialog-list";
    for (let i = 0; i < d.options.length; i++) {
      const opt = d.options[i];
      const btn = document.createElement("button");
      btn.className = `agent-dialog-option${i === d.selectedIndex ? " agent-dialog-option-sel" : ""}`;
      const lbl = document.createElement("span");
      lbl.textContent = opt.label;
      btn.appendChild(lbl);
      if (opt.description) {
        const desc = document.createElement("span");
        desc.className = "agent-dialog-opt-desc";
        desc.textContent = opt.description;
        btn.appendChild(desc);
      }
      btn.addEventListener("click", () => {
        dispatch("ht-agent-extension-ui-response", {
          agentId: view.agentId,
          id: d.id,
          response: { value: opt.value },
        });
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      });
      list.appendChild(btn);
    }
    modal.appendChild(list);
  }

  if (d.method === "confirm") {
    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    for (const [label, value] of [
      ["Yes", true],
      ["No", false],
    ] as const) {
      const btn = document.createElement("button");
      btn.className = `agent-dialog-btn${value ? " agent-dialog-btn-primary" : ""}`;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        dispatch("ht-agent-extension-ui-response", {
          agentId: view.agentId,
          id: d.id,
          response: { confirmed: value },
        });
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      });
      actions.appendChild(btn);
    }
    modal.appendChild(actions);
  }

  if (d.method === "input" || d.method === "switch_session") {
    const input = document.createElement("input");
    input.className = "agent-dialog-input";
    input.type = "text";
    input.value = d.inputValue;
    input.placeholder = d.placeholder ?? "";
    input.addEventListener("input", () => {
      d.inputValue = input.value;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (d.method === "switch_session") {
          const sessionPath = input.value.trim();
          if (sessionPath) {
            dispatch("ht-agent-switch-session", {
              agentId: view.agentId,
              sessionPath,
            });
          }
        } else {
          dispatch("ht-agent-extension-ui-response", {
            agentId: view.agentId,
            id: d.id,
            response: { value: input.value },
          });
        }
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      }
    });
    modal.appendChild(input);
    setTimeout(() => input.focus(), 50);

    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    const okBtn = document.createElement("button");
    okBtn.className = "agent-dialog-btn agent-dialog-btn-primary";
    okBtn.textContent = d.method === "switch_session" ? "Open" : "OK";
    okBtn.addEventListener("click", () => {
      if (d.method === "switch_session") {
        const sessionPath = input.value.trim();
        if (sessionPath) {
          dispatch("ht-agent-switch-session", {
            agentId: view.agentId,
            sessionPath,
          });
        }
      } else {
        dispatch("ht-agent-extension-ui-response", {
          agentId: view.agentId,
          id: d.id,
          response: { value: input.value },
        });
      }
      view._state.activeDialog = null;
      dialogOverlay.classList.add("agent-dialog-hidden");
    });
    actions.appendChild(okBtn);
    modal.appendChild(actions);
  }

  if (d.method === "editor") {
    const textarea = document.createElement("textarea");
    textarea.className = "agent-dialog-editor";
    textarea.value = d.inputValue;
    textarea.rows = 12;
    textarea.addEventListener("input", () => {
      d.inputValue = textarea.value;
    });
    modal.appendChild(textarea);
    setTimeout(() => textarea.focus(), 50);

    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    const okBtn = document.createElement("button");
    okBtn.className = "agent-dialog-btn agent-dialog-btn-primary";
    okBtn.textContent = "Submit";
    okBtn.addEventListener("click", () => {
      dispatch("ht-agent-extension-ui-response", {
        agentId: view.agentId,
        id: d.id,
        response: { value: textarea.value },
      });
      view._state.activeDialog = null;
      dialogOverlay.classList.add("agent-dialog-hidden");
    });
    actions.appendChild(okBtn);
    modal.appendChild(actions);
  }

  if (d.method === "session_browser") {
    const search = document.createElement("input");
    search.className = "agent-dialog-input";
    search.placeholder = "Search by name, cwd, preview, or path";
    search.value = view._state.sessionListFilter;
    modal.appendChild(search);

    const list = document.createElement("div");
    list.className = "agent-dialog-list agent-dialog-list-large";
    const renderList = () => {
      view._state.sessionListFilter = search.value.toLowerCase();
      list.innerHTML = "";
      const filtered = view._state.sessionList.filter((session) => {
        const hay = [session.name, session.cwd, session.preview, session.path]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        return (
          !view._state.sessionListFilter ||
          hay.includes(view._state.sessionListFilter)
        );
      });
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "agent-dialog-opt-desc";
        empty.textContent = "No matching sessions.";
        list.appendChild(empty);
      }
      for (const session of filtered) {
        const btn = document.createElement("button");
        btn.className = "agent-dialog-option";
        const title = document.createElement("span");
        title.textContent = session.name || session.preview || session.path;
        btn.appendChild(title);
        const desc = document.createElement("span");
        desc.className = "agent-dialog-opt-desc";
        desc.textContent = `${session.cwd ?? ""} • ${new Date(session.updatedAt).toLocaleString()}\n${session.path}`;
        btn.appendChild(desc);
        btn.addEventListener("click", () => {
          dispatch("ht-agent-switch-session", {
            agentId: view.agentId,
            sessionPath: session.path,
          });
          view._state.activeDialog = null;
          dialogOverlay.classList.add("agent-dialog-hidden");
        });
        list.appendChild(btn);
      }
    };
    search.addEventListener("input", renderList);
    renderList();
    modal.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    const manualBtn = document.createElement("button");
    manualBtn.className = "agent-dialog-btn";
    manualBtn.textContent = "Open by path…";
    manualBtn.addEventListener("click", () => {
      showSwitchSessionDialog(view);
    });
    actions.appendChild(manualBtn);
    modal.appendChild(actions);
    setTimeout(() => search.focus(), 30);
  }

  if (d.method === "tree_browser") {
    const list = document.createElement("div");
    list.className = "agent-dialog-list agent-dialog-list-large";
    if (view._state.sessionTree.length === 0) {
      const empty = document.createElement("div");
      empty.className = "agent-dialog-opt-desc";
      empty.textContent = "No session tree data available.";
      list.appendChild(empty);
    }
    for (const node of view._state.sessionTree) {
      const btn = document.createElement("button");
      btn.className = "agent-dialog-option agent-tree-node";
      btn.style.paddingLeft = `${10 + node.depth * 18}px`;
      if (node.active) btn.classList.add("agent-dialog-option-sel");
      const title = document.createElement("span");
      title.innerHTML = `<span class="agent-tree-role agent-tree-role-${escapeHtml(node.role)}">${escapeHtml(node.role)}</span> ${escapeHtml(node.text.slice(0, 120) || node.entryType)}`;
      btn.appendChild(title);
      const desc = document.createElement("span");
      desc.className = "agent-dialog-opt-desc";
      desc.textContent = `${node.timestamp ?? ""}${node.active ? " • active leaf" : ""}${node.childCount > 0 ? ` • ${node.childCount} child${node.childCount === 1 ? "" : "ren"}` : ""}`;
      btn.appendChild(desc);
      btn.addEventListener("click", () => {
        if (node.role === "user") {
          dispatch("ht-agent-fork", {
            agentId: view.agentId,
            entryId: node.id,
          });
        } else {
          addSystemMessage(
            view,
            "Only user nodes can currently be branched via RPC; select a user node to fork from that point.",
          );
        }
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      });
      list.appendChild(btn);
    }
    modal.appendChild(list);
  }

  if (d.method === "settings") {
    const list = document.createElement("div");
    list.className = "agent-dialog-list";

    const addToggle = (
      label: string,
      value: string,
      description: string,
      action: () => void,
      active = false,
    ) => {
      const btn = document.createElement("button");
      btn.className = `agent-dialog-option${active ? " agent-dialog-option-sel" : ""}`;
      const lbl = document.createElement("span");
      lbl.textContent = `${label}: ${value}`;
      btn.appendChild(lbl);
      const desc = document.createElement("span");
      desc.className = "agent-dialog-opt-desc";
      desc.textContent = description;
      btn.appendChild(desc);
      btn.addEventListener("click", action);
      list.appendChild(btn);
    };

    addToggle(
      "Steering delivery",
      view._state.steeringMode,
      "Choose whether queued steering messages are delivered all at once or one at a time.",
      () => {
        dispatch("ht-agent-set-steering-mode", {
          agentId: view.agentId,
          mode: view._state.steeringMode === "all" ? "one-at-a-time" : "all",
        });
        dismissDialog(view);
      },
      true,
    );

    addToggle(
      "Follow-up delivery",
      view._state.followUpMode,
      "Choose whether follow-up messages are delivered all at once or one at a time.",
      () => {
        dispatch("ht-agent-set-follow-up-mode", {
          agentId: view.agentId,
          mode: view._state.followUpMode === "all" ? "one-at-a-time" : "all",
        });
        dismissDialog(view);
      },
    );

    addToggle(
      "Auto compaction",
      view._state.autoCompactionEnabled ? "on" : "off",
      "Automatically compact the session when context pressure gets high.",
      () => {
        dispatch("ht-agent-set-auto-compaction", {
          agentId: view.agentId,
          enabled: !view._state.autoCompactionEnabled,
        });
        dismissDialog(view);
      },
    );

    addToggle(
      "Auto retry",
      view._state.autoRetryEnabled ? "on" : "off",
      "Retry transient provider failures like rate limits or overloaded responses.",
      () => {
        dispatch("ht-agent-set-auto-retry", {
          agentId: view.agentId,
          enabled: !view._state.autoRetryEnabled,
        });
        dismissDialog(view);
      },
    );

    addToggle(
      "Scoped models",
      `${view._state.scopedModelIds.size}`,
      "Ctrl+P cycles only models included in the scope. Manage the scope from the model picker.",
      () => {
        view._state.showModelSelector = true;
        view._state.showThinkingSelector = false;
        renderDropdowns(view);
        dismissDialog(view);
        dispatch("ht-agent-get-models", { agentId: view.agentId });
      },
    );

    addToggle(
      "Resume browser",
      "open",
      "Browse recent pi sessions with metadata instead of typing a path manually.",
      () => {
        dismissDialog(view);
        dispatch("ht-agent-list-sessions", { agentId: view.agentId });
      },
    );

    addToggle(
      "Tree browser",
      "open",
      "Browse the current session tree and fork from earlier user nodes.",
      () => {
        dismissDialog(view);
        dispatch("ht-agent-get-session-tree", {
          agentId: view.agentId,
          sessionPath: view._state.sessionFile ?? undefined,
        });
      },
    );

    modal.appendChild(list);
  }

  // Cancel button for all dialogs
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "agent-dialog-cancel";
  cancelBtn.textContent = "Cancel (Esc)";
  cancelBtn.addEventListener("click", () => dismissDialog(view));
  modal.appendChild(cancelBtn);

  dialogOverlay.appendChild(modal);

  // Click outside to dismiss
  dialogOverlay.addEventListener(
    "click",
    (e) => {
      if (e.target === dialogOverlay) dismissDialog(view);
    },
    { once: true },
  );
}

function dismissDialog(view: AgentPaneView): void {
  const d = view._state.activeDialog;
  if (d) {
    if (!d.id.startsWith("__")) {
      dispatch("ht-agent-extension-ui-response", {
        agentId: view.agentId,
        id: d.id,
        response: { cancelled: true },
      });
    }
    view._state.activeDialog = null;
    view._elements.dialogOverlay.classList.add("agent-dialog-hidden");
  }
}

// ── Streaming ──

function flushStreaming(view: AgentPaneView): void {
  const s = view._state;
  if (s.currentText || s.currentThinking) {
    s.messages.push({
      role: "assistant",
      content: s.currentText,
      thinking: s.currentThinking || undefined,
      timestamp: Date.now(),
    });
    s.currentText = "";
    s.currentThinking = "";
  }
  for (const [, tc] of s.toolCalls) {
    if (!tc.isRunning) {
      s.messages.push({
        role: "tool",
        content: tc.result ?? "",
        toolName: tc.name,
        toolArgs: tc.rawArgs,
        isError: tc.isError,
        timestamp: Date.now(),
      });
    }
  }
  s.toolCalls.clear();
  renderAllMessages(view);
}

function syncStreamingUI(view: AgentPaneView): void {
  const { sendBtn, inputEl, streamingIndicator } = view._elements;
  const { isStreaming } = view._state;

  if (isStreaming) {
    sendBtn.innerHTML = STOP_ICON;
    sendBtn.title = "Stop (Escape)";
    sendBtn.classList.add("agent-send-stop");
    inputEl.placeholder =
      "Steer the agent\u2026 (Esc to stop, Alt+Enter follow-up)";
    streamingIndicator.classList.remove("agent-streaming-bar-hidden");
    setStreamLabel(view._elements, "Generating\u2026");
  } else {
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.title = "Send (Enter)";
    sendBtn.classList.remove("agent-send-stop");
    inputEl.placeholder = "Message pi agent\u2026  (/ for commands)";
    streamingIndicator.classList.add("agent-streaming-bar-hidden");
  }
  syncFooter(view);
}

function setStreamLabel(el: AgentPanelElements, text: string): void {
  const label = el.streamingIndicator.querySelector(
    ".agent-streaming-bar-label",
  ) as HTMLElement;
  if (label) label.textContent = text;
}

function syncFooter(view: AgentPaneView): void {
  const { footerEl, contextMeterFill, contextMeterLabel } = view._elements;
  const {
    model,
    thinkingLevel,
    sessionStats,
    turnCount,
    totalToolCalls,
    sessionName,
    messageCount,
    pendingSteer,
    pendingFollowUp,
    steeringMode,
    followUpMode,
    autoCompactionEnabled,
    autoRetryEnabled,
  } = view._state;
  const txt = footerEl.querySelector(".agent-footer-text") as HTMLElement;

  const parts: string[] = [];
  if (sessionName) parts.push(sessionName);
  if (model) parts.push(model.name || model.id);
  if (thinkingLevel !== "off") parts.push(`thinking:${thinkingLevel}`);
  if (turnCount > 0) parts.push(`${turnCount} turns`);
  if (messageCount > 0) parts.push(`${messageCount} msgs`);
  if (totalToolCalls > 0) parts.push(`${totalToolCalls} tools`);
  if (pendingSteer > 0) parts.push(`${pendingSteer} steer(${steeringMode})`);
  if (pendingFollowUp > 0)
    parts.push(`${pendingFollowUp} follow(${followUpMode})`);
  if (!autoCompactionEnabled) parts.push("compact:off");
  if (!autoRetryEnabled) parts.push("retry:off");
  if (sessionStats?.cost != null)
    parts.push(`$${sessionStats.cost.toFixed(4)}`);
  if (sessionStats?.tokens?.total) {
    const t = sessionStats.tokens;
    parts.push(`${fmtK(t.total)} tok`);
  }
  txt.textContent = parts.length ? parts.join(" \u00b7 ") : "Ready";

  const pct = sessionStats?.contextUsage?.percent;
  if (pct != null) {
    contextMeterFill.style.width = `${Math.min(100, pct)}%`;
    contextMeterFill.style.background =
      pct > 80 ? "#f87171" : pct > 50 ? "#f59e0b" : "var(--accent-primary)";
    contextMeterLabel.textContent = `${pct}%`;
  } else {
    contextMeterFill.style.width = "0%";
    contextMeterLabel.textContent = "";
  }
}

function updateChips(view: AgentPaneView): void {
  const { chipsEl } = view;
  // Remove auto chips, keep extension status chips
  chipsEl
    .querySelectorAll(
      ".chip-agent-tool, .chip-agent-streaming, .chip-agent-queue",
    )
    .forEach((c) => c.remove());

  const running = [...view._state.toolCalls.values()].filter(
    (tc) => tc.isRunning,
  );
  if (running.length > 0) {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-agent-tool";
    chip.textContent = `\u27f3 ${running[0].name}${running.length > 1 ? ` +${running.length - 1}` : ""}`;
    chipsEl.appendChild(chip);
  }

  if (view._state.isStreaming) {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-agent-streaming";
    chip.textContent = "streaming";
    chipsEl.appendChild(chip);
  }

  const q = view._state.pendingSteer + view._state.pendingFollowUp;
  if (q > 0) {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-agent-queue";
    chip.textContent = `${q} queued`;
    chipsEl.appendChild(chip);
  }
}

// ── Rendering ──

function renderAllMessages(view: AgentPaneView): void {
  const { messagesEl } = view._elements;
  const { messages, autoScroll } = view._state;

  messagesEl.innerHTML = "";
  if (messages.length === 0) {
    appendWelcome(messagesEl);
    return;
  }

  for (const msg of messages) {
    messagesEl.appendChild(createMsgEl(view.agentId, msg));
  }

  for (const [, tc] of view._state.toolCalls) {
    messagesEl.appendChild(buildToolCallEl(view.agentId, tc));
  }

  if (autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderStream(view: AgentPaneView): void {
  const { messagesEl } = view._elements;
  const { currentText, autoScroll } = view._state;

  let el = messagesEl.querySelector(".agent-msg-live") as HTMLDivElement | null;
  let contentEl: HTMLDivElement | null = null;
  let cursor: HTMLSpanElement | null = null;
  if (!el) {
    el = document.createElement("div");
    el.className = "agent-msg agent-msg-assistant agent-msg-live";
    contentEl = document.createElement("div");
    contentEl.className = "agent-msg-content";
    cursor = document.createElement("span");
    cursor.className = "agent-cursor";
    contentEl.appendChild(cursor);
    el.appendChild(contentEl);
    messagesEl.appendChild(el);
  } else {
    // Reuse the existing subtree. Recreating contentEl on every token
    // meant the full markdown-HTML + cursor were rebuilt per delta,
    // which is the dominant cost on long streams (O(N) DOM work × N
    // tokens = O(N²) wall time). Updating innerHTML in place plus a
    // length guard cuts it to O(N) effective.
    contentEl = el.querySelector(".agent-msg-content") as HTMLDivElement | null;
    if (!contentEl) {
      contentEl = document.createElement("div");
      contentEl.className = "agent-msg-content";
      el.appendChild(contentEl);
    }
    cursor = contentEl.querySelector(".agent-cursor") as HTMLSpanElement | null;
  }

  // Skip the mdLite + innerHTML write entirely when the text hasn't
  // changed since the last render (renderStream is triggered by more
  // than just new tokens).
  const lastLen = Number(el.dataset["renderedLen"] ?? "-1");
  if (lastLen !== currentText.length) {
    const html = mdLite(currentText);
    contentEl.innerHTML = html;
    if (!cursor) {
      cursor = document.createElement("span");
      cursor.className = "agent-cursor";
    }
    contentEl.appendChild(cursor);
    el.dataset["renderedLen"] = String(currentText.length);
  }

  if (autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderThinkingStream(view: AgentPaneView): void {
  const { messagesEl } = view._elements;
  const { currentThinking, autoScroll } = view._state;

  let el = messagesEl.querySelector(
    ".agent-think-live",
  ) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "agent-think agent-think-live";
    const liveMsg = messagesEl.querySelector(".agent-msg-live");
    if (liveMsg) messagesEl.insertBefore(el, liveMsg);
    else messagesEl.appendChild(el);
  }
  el.innerHTML = "";
  const hdr = document.createElement("div");
  hdr.className = "agent-think-hdr";
  hdr.innerHTML = `<span class="agent-think-icon">\u25c8</span> Thinking\u2026`;
  el.appendChild(hdr);
  const body = document.createElement("div");
  body.className = "agent-think-body";
  body.textContent =
    currentThinking.length > 800
      ? "\u2026" + currentThinking.slice(-800)
      : currentThinking;
  el.appendChild(body);

  if (autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderToolCall(view: AgentPaneView, tcId: string): void {
  const { messagesEl } = view._elements;
  const tc = view._state.toolCalls.get(tcId);
  if (!tc) return;

  const existing = messagesEl.querySelector(
    `[data-tcid="${tcId}"]`,
  ) as HTMLDivElement | null;
  const el = buildToolCallEl(view.agentId, tc);
  if (existing) {
    existing.replaceWith(el);
  } else {
    const liveMsg = messagesEl.querySelector(".agent-msg-live");
    if (liveMsg) messagesEl.insertBefore(el, liveMsg);
    else messagesEl.appendChild(el);
  }

  if (view._state.autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderDropdowns(view: AgentPaneView): void {
  const { modelSelectorEl, thinkingSelectorEl } = view._elements;
  const s = view._state;

  if (s.showModelSelector) {
    modelSelectorEl.classList.remove("agent-dropdown-hidden");
    modelSelectorEl.innerHTML = "";
    if (!s.availableModels) {
      const ld = document.createElement("div");
      ld.className = "agent-dd-loading";
      ld.innerHTML = `<span class="agent-dd-spinner"></span> Loading models\u2026`;
      modelSelectorEl.appendChild(ld);
    } else {
      const hint = document.createElement("div");
      hint.className = "agent-dd-hint";
      hint.textContent =
        "Click to switch. Click the scope dot to include/exclude from Ctrl+P cycling.";
      modelSelectorEl.appendChild(hint);

      const byProvider = new Map<string, typeof s.availableModels>();
      for (const m of s.availableModels) {
        const g = byProvider.get(m.provider) ?? [];
        g.push(m);
        byProvider.set(m.provider, g);
      }
      for (const [prov, models] of byProvider) {
        const gh = document.createElement("div");
        gh.className = "agent-dd-group";
        gh.textContent = prov;
        modelSelectorEl.appendChild(gh);
        for (const m of models) {
          const item = document.createElement("button");
          item.className = "agent-dd-item agent-dd-item-model";
          if (s.model?.provider === m.provider && s.model?.id === m.id) {
            item.classList.add("agent-dd-item-active");
          }

          const scope = document.createElement("span");
          scope.className = `agent-model-scope${s.scopedModelIds.has(scopedModelKey(m)) ? " agent-model-scope-on" : ""}`;
          scope.title = "Toggle scoped model cycling";
          scope.textContent = s.scopedModelIds.has(scopedModelKey(m))
            ? "●"
            : "○";
          scope.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const key = scopedModelKey(m);
            if (s.scopedModelIds.has(key) && s.scopedModelIds.size > 1)
              s.scopedModelIds.delete(key);
            else s.scopedModelIds.add(key);
            renderDropdowns(view);
            renderModelMeta(view);
          });
          item.appendChild(scope);

          const main = document.createElement("div");
          main.className = "agent-dd-model-main";
          const label = document.createElement("div");
          label.className = "agent-dd-model-name";
          label.textContent = m.name || m.id;
          main.appendChild(label);
          const meta = document.createElement("div");
          meta.className = "agent-dd-model-meta";
          meta.append(...buildModelBadges(m));
          main.appendChild(meta);
          item.appendChild(main);

          item.addEventListener("click", () => {
            s.showModelSelector = false;
            renderDropdowns(view);
            window.dispatchEvent(
              new CustomEvent("ht-agent-set-model", {
                detail: {
                  agentId: view.agentId,
                  provider: m.provider,
                  modelId: m.id,
                },
              }),
            );
          });
          modelSelectorEl.appendChild(item);
        }
      }
    }
  } else {
    modelSelectorEl.classList.add("agent-dropdown-hidden");
  }

  if (s.showThinkingSelector) {
    thinkingSelectorEl.classList.remove("agent-dropdown-hidden");
    thinkingSelectorEl.innerHTML = "";
    for (const lvl of THINKING_LEVELS) {
      const item = document.createElement("button");
      item.className = "agent-dd-item";
      if (s.thinkingLevel === lvl) item.classList.add("agent-dd-item-active");
      const dot = document.createElement("span");
      dot.className = "agent-tb-dot";
      dot.style.background = THINKING_COLORS[lvl] ?? "var(--text-dim)";
      item.appendChild(dot);
      const label = document.createElement("span");
      label.textContent = lvl;
      item.appendChild(label);
      item.addEventListener("click", () => {
        s.showThinkingSelector = false;
        renderDropdowns(view);
        window.dispatchEvent(
          new CustomEvent("ht-agent-set-thinking", {
            detail: { agentId: view.agentId, level: lvl },
          }),
        );
      });
      thinkingSelectorEl.appendChild(item);
    }
  } else {
    thinkingSelectorEl.classList.add("agent-dropdown-hidden");
  }
}

function toModelSummary(rec: Record<string, unknown>): AgentModelSummary {
  return {
    provider: (rec["provider"] as string) ?? "",
    id: (rec["id"] as string) ?? "",
    name: (rec["name"] as string) ?? (rec["id"] as string) ?? "",
    reasoning: rec["reasoning"] as boolean | undefined,
    input: Array.isArray(rec["input"]) ? (rec["input"] as string[]) : undefined,
    contextWindow: rec["contextWindow"] as number | undefined,
    maxTokens: rec["maxTokens"] as number | undefined,
    cost: (rec["cost"] as AgentModelSummary["cost"]) ?? undefined,
  };
}

function scopedModelKey(
  model: Pick<AgentModelSummary, "provider" | "id">,
): string {
  return `${model.provider}/${model.id}`;
}

function buildModelBadges(model: AgentModelSummary): HTMLElement[] {
  const mk = (text: string, cls = "") => {
    const badge = document.createElement("span");
    badge.className = `agent-model-badge${cls ? ` ${cls}` : ""}`;
    badge.textContent = text;
    return badge;
  };
  const badges: HTMLElement[] = [
    mk(model.provider, "agent-model-badge-provider"),
  ];
  if (model.reasoning) badges.push(mk("reasoning"));
  if (model.input?.includes("image")) badges.push(mk("vision"));
  if (model.contextWindow) badges.push(mk(`${fmtK(model.contextWindow)} ctx`));
  if (model.maxTokens) badges.push(mk(`${fmtK(model.maxTokens)} out`));
  if (model.cost?.input != null && model.cost?.output != null) {
    badges.push(
      mk(
        `$${model.cost.input}/$${model.cost.output}`,
        "agent-model-badge-cost",
      ),
    );
  }
  return badges;
}

function renderModelMeta(view: AgentPaneView): void {
  const { modelMetaEl } = view._elements;
  modelMetaEl.innerHTML = "";
  const model = view._state.model;
  if (!model) {
    modelMetaEl.style.display = "none";
    return;
  }
  modelMetaEl.style.display = "flex";
  const badges = buildModelBadges(model);
  for (const badge of badges) modelMetaEl.appendChild(badge);
  const scope = document.createElement("span");
  scope.className = "agent-model-badge agent-model-badge-scope";
  scope.textContent = `${view._state.scopedModelIds.size || 0} scoped`;
  modelMetaEl.appendChild(scope);
}

function cycleScopedModel(view: AgentPaneView, direction: 1 | -1): boolean {
  const models = view._state.availableModels;
  if (!models || models.length === 0) return false;
  const scoped = models.filter((model) =>
    view._state.scopedModelIds.has(scopedModelKey(model)),
  );
  if (scoped.length === 0) return false;
  const currentIndex = Math.max(
    0,
    scoped.findIndex(
      (model) =>
        model.provider === view._state.model?.provider &&
        model.id === view._state.model?.id,
    ),
  );
  const next =
    scoped[(currentIndex + direction + scoped.length) % scoped.length];
  dispatch("ht-agent-set-model", {
    agentId: view.agentId,
    provider: next.provider,
    modelId: next.id,
  });
  return true;
}

function handleResponse(
  view: AgentPaneView,
  ev: Record<string, unknown>,
): void {
  const s = view._state;
  const el = view._elements;
  const cmd = ev["command"] as string;
  const ok = ev["success"] as boolean;
  const data = ev["data"] as Record<string, unknown> | undefined;

  if (!ok) {
    const error = (ev["error"] as string) ?? `Command failed: ${cmd}`;
    addSystemMessage(view, error);
    return;
  }

  if (cmd === "get_state" && data) {
    if (data["model"]) {
      s.model = toModelSummary(data["model"] as Record<string, unknown>);
      el.modelBtnLabel.textContent = s.model?.name ?? s.model?.id ?? "No model";
    }
    if (data["thinkingLevel"]) {
      s.thinkingLevel = data["thinkingLevel"] as string;
      el.thinkingBtnLabel.textContent = s.thinkingLevel;
      const dot = el.toolbarEl.querySelector(
        ".agent-tb-thinking .agent-tb-dot",
      ) as HTMLElement | null;
      if (dot)
        dot.style.background =
          THINKING_COLORS[s.thinkingLevel] ?? "var(--text-dim)";
    }
    s.sessionName = (data["sessionName"] as string) ?? null;
    el.sessionNameEl.textContent = s.sessionName ?? "";
    s.sessionFile = (data["sessionFile"] as string) ?? null;
    s.sessionId = (data["sessionId"] as string) ?? null;
    s.messageCount = (data["messageCount"] as number) ?? s.messageCount;
    s.pendingMessageCount =
      (data["pendingMessageCount"] as number) ?? s.pendingMessageCount;
    s.autoCompactionEnabled =
      (data["autoCompactionEnabled"] as boolean) ?? s.autoCompactionEnabled;
    s.steeringMode = (data["steeringMode"] as string) ?? s.steeringMode;
    s.followUpMode = (data["followUpMode"] as string) ?? s.followUpMode;
    s.isStreaming = (data["isStreaming"] as boolean) ?? false;
    syncStreamingUI(view);
    syncFooter(view);
    renderModelMeta(view);
  }

  if (cmd === "get_available_models" && data) {
    const arr = (data as { models?: unknown[] }).models;
    if (Array.isArray(arr)) {
      s.availableModels = arr.map((m) =>
        toModelSummary(m as Record<string, unknown>),
      );
      if (s.scopedModelIds.size === 0) {
        for (const model of s.availableModels) {
          s.scopedModelIds.add(scopedModelKey(model));
        }
      }
      renderDropdowns(view);
      renderModelMeta(view);
    }
  }

  if (cmd === "set_model" && data) {
    s.model = toModelSummary(data);
    el.modelBtnLabel.textContent = s.model.name;
    addSystemMessage(view, `Model: ${s.model.name}`);
    syncFooter(view);
    renderModelMeta(view);
  }

  if (cmd === "cycle_model" && data) {
    const m = data["model"] as Record<string, unknown> | undefined;
    if (m) {
      s.model = toModelSummary(m);
      el.modelBtnLabel.textContent = s.model.name;
      addSystemMessage(view, `Model: ${s.model.name}`);
    }
    if (data["thinkingLevel"]) {
      s.thinkingLevel = data["thinkingLevel"] as string;
      el.thinkingBtnLabel.textContent = s.thinkingLevel;
      const dot = el.toolbarEl.querySelector(
        ".agent-tb-thinking .agent-tb-dot",
      ) as HTMLElement | null;
      if (dot)
        dot.style.background =
          THINKING_COLORS[s.thinkingLevel] ?? "var(--text-dim)";
    }
    syncFooter(view);
    renderModelMeta(view);
  }

  if (cmd === "cycle_thinking_level" && data) {
    if (data["level"]) {
      s.thinkingLevel = data["level"] as string;
      el.thinkingBtnLabel.textContent = s.thinkingLevel;
      const dot = el.toolbarEl.querySelector(
        ".agent-tb-thinking .agent-tb-dot",
      ) as HTMLElement | null;
      if (dot)
        dot.style.background =
          THINKING_COLORS[s.thinkingLevel] ?? "var(--text-dim)";
      addSystemMessage(view, `Thinking: ${s.thinkingLevel}`);
    }
    syncFooter(view);
  }

  if (cmd === "set_thinking_level") {
    dispatch("ht-agent-get-state", { agentId: view.agentId });
  }

  if (cmd === "set_steering_mode") {
    if (data?.["mode"]) s.steeringMode = data["mode"] as string;
    dispatch("ht-agent-get-state", { agentId: view.agentId });
    addSystemMessage(view, `Steering delivery: ${s.steeringMode}`);
    syncFooter(view);
  }

  if (cmd === "set_follow_up_mode") {
    if (data?.["mode"]) s.followUpMode = data["mode"] as string;
    dispatch("ht-agent-get-state", { agentId: view.agentId });
    addSystemMessage(view, `Follow-up delivery: ${s.followUpMode}`);
    syncFooter(view);
  }

  if (cmd === "set_auto_compaction") {
    s.autoCompactionEnabled =
      typeof data?.["enabled"] === "boolean"
        ? Boolean(data["enabled"])
        : !s.autoCompactionEnabled;
    addSystemMessage(
      view,
      `Auto compaction ${s.autoCompactionEnabled ? "enabled" : "disabled"}`,
    );
    dispatch("ht-agent-get-state", { agentId: view.agentId });
    syncFooter(view);
  }

  if (cmd === "set_auto_retry") {
    s.autoRetryEnabled =
      typeof data?.["enabled"] === "boolean"
        ? Boolean(data["enabled"])
        : !s.autoRetryEnabled;
    addSystemMessage(
      view,
      `Auto retry ${s.autoRetryEnabled ? "enabled" : "disabled"}`,
    );
    dispatch("ht-agent-get-state", { agentId: view.agentId });
    syncFooter(view);
  }

  if (cmd === "abort_retry") {
    s.retryState = null;
    addSystemMessage(view, "Retry aborted");
  }

  if (cmd === "get_session_stats" && data) {
    s.sessionStats = data as AgentPanelState["sessionStats"];
    if (data["sessionFile"]) s.sessionFile = data["sessionFile"] as string;
    if (data["sessionId"]) s.sessionId = data["sessionId"] as string;
    if (typeof data["totalMessages"] === "number") {
      s.messageCount = data["totalMessages"] as number;
    }
    syncFooter(view);
    renderStats(view);
  }

  if (cmd === "get_messages" && data) {
    const messages = Array.isArray(data["messages"])
      ? (data["messages"] as Record<string, unknown>[])
      : [];
    s.messages = messages.flatMap(convertAgentMessageToChatMessages);
    s.turnCount = s.messages.filter((m) => m.role === "assistant").length;
    s.totalToolCalls = s.messages.filter((m) => m.role === "tool").length;
    renderAllMessages(view);
    syncFooter(view);
  }

  if (cmd === "new_session") {
    s.messages = [];
    s.currentText = "";
    s.currentThinking = "";
    s.toolCalls.clear();
    s.turnCount = 0;
    s.totalToolCalls = 0;
    s.sessionStats = null;
    s.sessionName = null;
    s.widgetsAbove.clear();
    s.widgetsBelow.clear();
    s.sessionTree = [];
    s.sessionList = [];
    renderWidgets(view);
    s.sessionFile = null;
    s.sessionId = null;
    s.messageCount = 0;
    el.sessionNameEl.textContent = "";
    renderAllMessages(view);
    syncFooter(view);
    addSystemMessage(view, "New session started");
    dispatch("ht-agent-get-state", { agentId: view.agentId });
    dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
    dispatch("ht-agent-get-messages", { agentId: view.agentId });
  }

  if (cmd === "get_commands" && data) {
    const arr = Array.isArray(data["commands"])
      ? (data["commands"] as Record<string, unknown>[])
      : Array.isArray(data)
        ? (data as unknown as Record<string, unknown>[])
        : [];
    const piCmds: SlashCommand[] = arr
      .filter((c) => typeof c["name"] === "string")
      .map((c) => ({
        name: `/${c["name"] as string}`,
        description: (c["description"] as string) ?? "",
        source: (c["source"] as SlashCommand["source"]) ?? "extension",
      }));
    const builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.name));
    s.commands = [
      ...BUILTIN_COMMANDS,
      ...piCmds.filter((c) => !builtinNames.has(c.name)),
    ];
  }

  if (cmd === "get_last_assistant_text" && data) {
    const text = (data as { text?: string | null }).text;
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        addSystemMessage(view, "Copied last response to clipboard");
      });
    } else {
      addSystemMessage(view, "No assistant message to copy");
    }
  }

  if (cmd === "export_html" && data) {
    const path = (data as { path?: string }).path;
    addSystemMessage(view, path ? `Exported to ${path}` : "Session exported");
  }

  if (cmd === "switch_session") {
    const cancelled = Boolean(data?.["cancelled"]);
    addSystemMessage(
      view,
      cancelled ? "Session switch cancelled" : "Session switched",
    );
    if (!cancelled) {
      dispatch("ht-agent-get-state", { agentId: view.agentId });
      dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
      dispatch("ht-agent-get-messages", { agentId: view.agentId });
      dispatch("ht-agent-get-session-tree", { agentId: view.agentId });
    }
  }

  if (cmd === "list_sessions" && data) {
    s.sessionList = Array.isArray(data["sessions"])
      ? (data["sessions"] as AgentPanelState["sessionList"])
      : [];
    showSessionBrowserDialog(view);
  }

  if (cmd === "get_session_tree" && data) {
    s.sessionTree = Array.isArray(data["tree"])
      ? (data["tree"] as AgentPanelState["sessionTree"])
      : [];
    showTreeDialog(view);
  }

  if (cmd === "get_fork_messages" && data) {
    const arr = Array.isArray(data["messages"])
      ? (data["messages"] as { entryId: string; text: string }[])
      : Array.isArray(data)
        ? (data as unknown as { entryId: string; text: string }[])
        : [];
    if (arr.length > 0) {
      showForkDialog(view, arr);
    } else {
      addSystemMessage(view, "No fork points available");
    }
  }

  if (cmd === "fork") {
    const cancelled = Boolean(data?.["cancelled"]);
    const text = (data?.["text"] as string) ?? "";
    addSystemMessage(
      view,
      cancelled
        ? "Fork cancelled"
        : `Forked session${text ? ` from: ${text.slice(0, 80)}` : ""}`,
    );
    if (!cancelled) {
      dispatch("ht-agent-get-state", { agentId: view.agentId });
      dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
      dispatch("ht-agent-get-messages", { agentId: view.agentId });
    }
  }

  if (cmd === "set_session_name") {
    const name = (data?.["name"] as string) ?? (ev["name"] as string) ?? "";
    s.sessionName = name || null;
    el.sessionNameEl.textContent = name;
    syncFooter(view);
  }

  if (cmd === "bash" && data) {
    const output = (data as { output?: string }).output ?? "";
    const exitCode = (data as { exitCode?: number }).exitCode ?? 0;
    s.messages.push({
      role: "bash",
      content: output,
      exitCode,
      command: (data as { command?: string }).command ?? undefined,
      truncated: Boolean((data as { truncated?: boolean }).truncated),
      fullOutputPath:
        (data as { fullOutputPath?: string | null }).fullOutputPath ?? null,
      timestamp: Date.now(),
    });
    renderAllMessages(view);
  }
}

// ── Special views ──

function convertAgentMessageToChatMessages(
  message: Record<string, unknown>,
): ChatMessage[] {
  const role = message["role"] as string;
  const timestamp = (message["timestamp"] as number) ?? Date.now();

  if (role === "user") {
    return [
      {
        role: "user",
        content: extractTextBlocks(message["content"]),
        images: extractImageBlocks(message["content"]),
        timestamp,
      },
    ];
  }

  if (role === "assistant") {
    return [
      {
        role: "assistant",
        content: extractTextBlocks(message["content"]),
        thinking: extractThinkingBlocks(message["content"]),
        timestamp,
      },
    ];
  }

  if (role === "toolResult") {
    return [
      {
        role: "tool",
        content: extractContent(message["content"]),
        toolName: (message["toolName"] as string) ?? "tool",
        isError: Boolean(message["isError"]),
        images: extractImageBlocks(message["content"]),
        timestamp,
      },
    ];
  }

  if (role === "bashExecution") {
    return [
      {
        role: "bash",
        content: (message["output"] as string) ?? "",
        command: (message["command"] as string) ?? "bash",
        exitCode: (message["exitCode"] as number) ?? 0,
        truncated: Boolean(message["truncated"]),
        fullOutputPath: (message["fullOutputPath"] as string | null) ?? null,
        timestamp,
      },
    ];
  }

  return [];
}

function renderWidgets(view: AgentPaneView): void {
  const render = (target: HTMLDivElement, widgets: Map<string, string[]>) => {
    target.innerHTML = "";
    for (const [key, lines] of widgets) {
      const card = document.createElement("div");
      card.className = "agent-widget";
      card.dataset["widgetKey"] = key;

      const hdr = document.createElement("div");
      hdr.className = "agent-widget-key";
      hdr.textContent = key;
      card.appendChild(hdr);

      const body = document.createElement("pre");
      body.className = "agent-widget-body";
      body.textContent = lines.join("\n");
      card.appendChild(body);
      target.appendChild(card);
    }
    target.style.display = widgets.size > 0 ? "grid" : "none";
  };

  render(view._elements.widgetsAboveEl, view._state.widgetsAbove);
  render(view._elements.widgetsBelowEl, view._state.widgetsBelow);
}

function showSessionStats(view: AgentPaneView): void {
  const el = view._elements;
  el.statsEl.classList.toggle("agent-stats-hidden");
  renderStats(view);
  if (!el.statsEl.classList.contains("agent-stats-hidden")) {
    dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
  }
}

function renderStats(view: AgentPaneView): void {
  const { statsEl } = view._elements;
  const st = view._state.sessionStats;
  if (!st || statsEl.classList.contains("agent-stats-hidden")) return;

  statsEl.innerHTML = "";

  const items: [string, string][] = [];
  if (st.sessionId) items.push(["Session ID", st.sessionId]);
  if (st.sessionFile) items.push(["Session File", st.sessionFile]);
  if (typeof st.userMessages === "number")
    items.push(["User", String(st.userMessages)]);
  if (typeof st.assistantMessages === "number")
    items.push(["Assistant", String(st.assistantMessages)]);
  if (typeof st.toolCalls === "number")
    items.push(["Tool Calls", String(st.toolCalls)]);
  if (typeof st.toolResults === "number")
    items.push(["Tool Results", String(st.toolResults)]);
  if (typeof st.totalMessages === "number")
    items.push(["Messages", String(st.totalMessages)]);
  if (st.tokens) {
    items.push(["Input", fmtK(st.tokens.input)]);
    items.push(["Output", fmtK(st.tokens.output)]);
    if (st.tokens.cacheRead)
      items.push(["Cache Read", fmtK(st.tokens.cacheRead)]);
    if (st.tokens.cacheWrite)
      items.push(["Cache Write", fmtK(st.tokens.cacheWrite)]);
    items.push(["Total", fmtK(st.tokens.total)]);
  }
  if (st.cost != null) items.push(["Cost", `$${st.cost.toFixed(4)}`]);
  if (st.contextUsage) {
    const cu = st.contextUsage;
    items.push(["Context", `${cu.percent ?? 0}% of ${fmtK(cu.contextWindow)}`]);
  }

  for (const [label, value] of items) {
    const item = document.createElement("div");
    item.className = "agent-stat-item";
    item.innerHTML = `<span class="agent-stat-label">${label}</span><span class="agent-stat-value">${value}</span>`;
    statsEl.appendChild(item);
  }
}

function showSettingsDialog(view: AgentPaneView): void {
  view._state.activeDialog = {
    id: "__settings__",
    method: "settings",
    title: "Agent settings",
    selectedIndex: 0,
    inputValue: "",
  };
  renderDialog(view);
}

function showSwitchSessionDialog(view: AgentPaneView, initialValue = ""): void {
  view._state.activeDialog = {
    id: "__switch_session__",
    method: "switch_session",
    title: "Open session",
    message:
      "Enter an absolute session file path (.jsonl) created by pi. You can also use /resume without arguments for the session browser.",
    placeholder: "/Users/you/.pi/agent/sessions/.../session.jsonl",
    defaultValue: initialValue,
    selectedIndex: 0,
    inputValue: initialValue,
  };
  renderDialog(view);
}

function showSessionBrowserDialog(view: AgentPaneView): void {
  view._state.activeDialog = {
    id: "__session_browser__",
    method: "session_browser",
    title: "Recent pi sessions",
    message: "Open a previous session or fall back to manual path entry.",
    selectedIndex: 0,
    inputValue: view._state.sessionListFilter,
  };
  renderDialog(view);
}

function showTreeDialog(view: AgentPaneView): void {
  view._state.activeDialog = {
    id: "__tree__",
    method: "tree_browser",
    title: "Session tree",
    message:
      "Browse the current session tree. Selecting a user node creates a forked session from that point.",
    selectedIndex: 0,
    inputValue: "",
  };
  renderDialog(view);
}

function showHotkeysMessage(view: AgentPaneView): void {
  const lines = [
    "Keyboard Shortcuts:",
    "  Enter          Send message",
    "  Shift+Enter    New line",
    "  Alt+Enter      Queue follow-up",
    "  Escape         Abort / dismiss",
    "  Ctrl+P         Cycle scoped models forward",
    "  Shift+Ctrl+P   Cycle scoped models backward",
    "  Shift+Tab      Cycle thinking level",
    "  /              Open command menu",
    "  !command       Execute bash command",
    "  Paste/drop     Attach image to next prompt",
  ];
  addSystemMessage(view, lines.join("\n"));
}

function showHelpMessage(view: AgentPaneView): void {
  const lines = view._state.commands.map(
    (c) => `  ${c.name.padEnd(14)} ${c.description}`,
  );
  addSystemMessage(view, "Available commands:\n" + lines.join("\n"));
}

function showForkDialog(
  view: AgentPaneView,
  entries: { entryId: string; text: string }[],
): void {
  view._state.activeDialog = {
    id: "__fork__",
    method: "select",
    title: "Fork from message",
    message: "Select a message to fork from:",
    options: entries.map((e) => ({
      label: e.text.slice(0, 80) + (e.text.length > 80 ? "\u2026" : ""),
      value: e.entryId,
      description: e.entryId,
    })),
    selectedIndex: 0,
    inputValue: "",
  };

  renderDialog(view);

  // Patch the dialog buttons to call fork instead of extension UI
  const overlay = view._elements.dialogOverlay;
  const buttons = overlay.querySelectorAll(".agent-dialog-option");
  buttons.forEach((btn, i) => {
    const clone = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(clone);
    clone.addEventListener("click", () => {
      const entry = entries[i];
      dispatch("ht-agent-fork", {
        agentId: view.agentId,
        entryId: entry.entryId,
      });
      addSystemMessage(view, `Forked from: ${entry.text.slice(0, 60)}`);
      view._state.activeDialog = null;
      overlay.classList.add("agent-dialog-hidden");
    });
  });
}

// ── DOM Helpers ──

function addSystemMessage(view: AgentPaneView, text: string): void {
  view._state.messages.push({
    role: "system",
    content: text,
    timestamp: Date.now(),
  });
  renderAllMessages(view);
}

const SEND_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
const STOP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;
