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

// ── Public interfaces ──

export interface AgentPanelCallbacks {
  onSendPrompt: (agentId: string, message: string) => void;
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

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool" | "bash";
  content: string;
  thinking?: string;
  toolName?: string;
  isError?: boolean;
  timestamp: number;
  /** For bash messages */
  command?: string;
  exitCode?: number;
}

interface ToolCallState {
  id: string;
  name: string;
  args: string;
  result?: string;
  isError?: boolean;
  isRunning: boolean;
  collapsed: boolean;
  startTime: number;
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

interface AgentPanelState {
  messages: ChatMessage[];
  currentText: string;
  currentThinking: string;
  isStreaming: boolean;
  isCompacting: boolean;
  model: { provider: string; id: string; name: string } | null;
  thinkingLevel: string;
  toolCalls: Map<string, ToolCallState>;
  availableModels: { provider: string; id: string; name: string }[] | null;
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
  } | null;
  autoScroll: boolean;
  showModelSelector: boolean;
  showThinkingSelector: boolean;
  retryState: { attempt: number; maxAttempts: number; delayMs: number } | null;
  turnCount: number;
  totalToolCalls: number;
  sessionName: string | null;
  steeringMode: string;
  followUpMode: string;
  pendingSteer: number;
  pendingFollowUp: number;
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
  inputWrap.appendChild(inputEl);

  // Input hint
  const inputHint = document.createElement("div");
  inputHint.className = "agent-input-hint";
  inputHint.innerHTML = `<kbd>Enter</kbd> send <kbd>Shift+Enter</kbd> newline <kbd>/</kbd> commands <kbd>Alt+Enter</kbd> follow-up`;
  inputWrap.appendChild(inputHint);

  inputBarEl.appendChild(inputWrap);

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
    steeringMode: "all",
    followUpMode: "all",
    pendingSteer: 0,
    pendingFollowUp: 0,
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

    case "compaction_end":
      s.isCompacting = false;
      if (!s.isStreaming)
        el.streamingIndicator.classList.add("agent-streaming-bar-hidden");
      addSystemMessage(view, "Context compacted successfully");
      syncFooter(view);
      break;

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
      syncFooter(view);
      break;

    case "queue_update": {
      s.pendingSteer = (event["pendingSteer"] as number) ?? 0;
      s.pendingFollowUp = (event["pendingFollowUp"] as number) ?? 0;
      updateChips(view);
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
): void {
  view._state.messages.push({
    role: "user",
    content: text,
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
    if (text && s.isStreaming) {
      dispatch("ht-agent-follow-up", { agentId: view.agentId, message: text });
      addSystemMessage(view, `Queued follow-up: ${text}`);
      view._elements.inputEl.value = "";
      autoResize(view._elements.inputEl);
    } else if (text) {
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

  // Ctrl+P: cycle model
  if (e.key === "p" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    dispatch("ht-agent-cycle-model", { agentId: view.agentId });
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
  if (!text) return;

  hideSlashMenu(view);

  if (view._state.isStreaming) {
    // During streaming, submit acts as steer
    dispatch("ht-agent-steer", { agentId: view.agentId, message: text });
    addSystemMessage(view, `Steering: ${text}`);
  } else {
    cb.onSendPrompt(view.agentId, text);
  }
  view._elements.inputEl.value = "";
  autoResize(view._elements.inputEl);
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
      dispatch("ht-agent-get-fork-messages", { agentId });
      addSystemMessage(view, "Loading session tree\u2026");
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
    // Render as a system message for now
    const content = ev["content"] as string;
    if (content) addSystemMessage(view, content);
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
    const options =
      (ev["options"] as {
        label: string;
        value: string;
        description?: string;
      }[]) ?? [];
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
          response: { value },
        });
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      });
      actions.appendChild(btn);
    }
    modal.appendChild(actions);
  }

  if (d.method === "input") {
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
        dispatch("ht-agent-extension-ui-response", {
          agentId: view.agentId,
          id: d.id,
          response: { value: input.value },
        });
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
    okBtn.textContent = "OK";
    okBtn.addEventListener("click", () => {
      dispatch("ht-agent-extension-ui-response", {
        agentId: view.agentId,
        id: d.id,
        response: { value: input.value },
      });
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
    dispatch("ht-agent-extension-ui-response", {
      agentId: view.agentId,
      id: d.id,
      response: { cancelled: true },
    });
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
  const { model, thinkingLevel, sessionStats, turnCount, totalToolCalls } =
    view._state;
  const txt = footerEl.querySelector(".agent-footer-text") as HTMLElement;

  const parts: string[] = [];
  if (model) parts.push(model.name || model.id);
  if (thinkingLevel !== "off") parts.push(`thinking:${thinkingLevel}`);
  if (turnCount > 0) parts.push(`${turnCount} turns`);
  if (totalToolCalls > 0) parts.push(`${totalToolCalls} tools`);
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
    messagesEl.appendChild(createMsgEl(msg));
  }

  for (const [, tc] of view._state.toolCalls) {
    messagesEl.appendChild(buildToolCallEl(tc));
  }

  if (autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderStream(view: AgentPaneView): void {
  const { messagesEl } = view._elements;
  const { currentText, autoScroll } = view._state;

  let el = messagesEl.querySelector(".agent-msg-live") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "agent-msg agent-msg-assistant agent-msg-live";
    messagesEl.appendChild(el);
  }
  const contentEl = document.createElement("div");
  contentEl.className = "agent-msg-content";
  contentEl.innerHTML = mdLite(currentText);
  const cursor = document.createElement("span");
  cursor.className = "agent-cursor";
  contentEl.appendChild(cursor);
  el.replaceChildren(contentEl);

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
  const el = buildToolCallEl(tc);
  if (existing) {
    existing.replaceWith(el);
  } else {
    const liveMsg = messagesEl.querySelector(".agent-msg-live");
    if (liveMsg) messagesEl.insertBefore(el, liveMsg);
    else messagesEl.appendChild(el);
  }

  if (view._state.autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function buildToolCallEl(tc: ToolCallState): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `agent-tc${tc.isRunning ? " agent-tc-run" : ""}${tc.isError ? " agent-tc-err" : " agent-tc-ok"}`;
  el.dataset["tcid"] = tc.id;

  const hdr = document.createElement("div");
  hdr.className = "agent-tc-hdr";

  const icon = document.createElement("span");
  icon.className = "agent-tc-icon";
  icon.textContent = tc.isRunning ? "\u27f3" : tc.isError ? "\u2717" : "\u2713";
  hdr.appendChild(icon);

  const name = document.createElement("span");
  name.className = "agent-tc-name";
  name.textContent = tc.name;
  hdr.appendChild(name);

  if (tc.args) {
    const args = document.createElement("span");
    args.className = "agent-tc-args";
    args.textContent =
      tc.args.length > 80 ? tc.args.slice(0, 77) + "\u2026" : tc.args;
    args.title = tc.args;
    hdr.appendChild(args);
  }

  if (!tc.isRunning) {
    const elapsed = document.createElement("span");
    elapsed.className = "agent-tc-elapsed";
    elapsed.textContent = `${((Date.now() - tc.startTime) / 1000).toFixed(1)}s`;
    hdr.appendChild(elapsed);
  }

  const toggle = document.createElement("button");
  toggle.className = "agent-tc-toggle";
  toggle.textContent = tc.collapsed ? "\u25b8" : "\u25be";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    tc.collapsed = !tc.collapsed;
    const body = el.querySelector(".agent-tc-body") as HTMLDivElement | null;
    if (body) body.classList.toggle("agent-tc-body-hidden", tc.collapsed);
    toggle.textContent = tc.collapsed ? "\u25b8" : "\u25be";
  });
  hdr.appendChild(toggle);

  el.appendChild(hdr);

  if (tc.result !== undefined) {
    const body = document.createElement("pre");
    body.className = `agent-tc-body${tc.collapsed ? " agent-tc-body-hidden" : ""}`;
    // Highlight diffs
    if (tc.name === "Edit" || tc.name === "Write") {
      body.innerHTML = highlightDiff(tc.result.slice(0, 4000));
    } else {
      body.textContent = tc.result.slice(0, 4000);
    }
    el.appendChild(body);
  }

  return el;
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
          item.className = "agent-dd-item";
          if (s.model?.provider === m.provider && s.model?.id === m.id) {
            item.classList.add("agent-dd-item-active");
          }
          item.textContent = m.name || m.id;
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

function handleResponse(
  view: AgentPaneView,
  ev: Record<string, unknown>,
): void {
  const s = view._state;
  const el = view._elements;
  const cmd = ev["command"] as string;
  const ok = ev["success"] as boolean;
  const data = ev["data"] as Record<string, unknown> | undefined;

  if (cmd === "get_state" && ok && data) {
    if (data["model"]) {
      s.model = data["model"] as AgentPanelState["model"];
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
    if (data["sessionName"]) {
      s.sessionName = data["sessionName"] as string;
      el.sessionNameEl.textContent = s.sessionName;
    }
    if (data["steeringMode"]) s.steeringMode = data["steeringMode"] as string;
    if (data["followUpMode"]) s.followUpMode = data["followUpMode"] as string;
    s.isStreaming = (data["isStreaming"] as boolean) ?? false;
    syncStreamingUI(view);
  }

  if (cmd === "get_available_models" && ok && data) {
    const arr = (data as { models?: unknown[] }).models;
    if (Array.isArray(arr)) {
      s.availableModels = arr.map((m: unknown) => {
        const rec = m as Record<string, unknown>;
        return {
          provider: (rec["provider"] as string) ?? "",
          id: (rec["id"] as string) ?? "",
          name: (rec["name"] as string) ?? (rec["id"] as string) ?? "",
        };
      });
      renderDropdowns(view);
    }
  }

  if (cmd === "set_model" && ok && data) {
    s.model = {
      provider: (data["provider"] as string) ?? "",
      id: (data["id"] as string) ?? "",
      name: (data["name"] as string) ?? (data["id"] as string) ?? "",
    };
    el.modelBtnLabel.textContent = s.model.name;
    addSystemMessage(view, `Model: ${s.model.name}`);
    syncFooter(view);
  }

  if (cmd === "cycle_model" && ok && data) {
    const m = data["model"] as Record<string, unknown> | undefined;
    if (m) {
      s.model = {
        provider: (m["provider"] as string) ?? "",
        id: (m["id"] as string) ?? "",
        name: (m["name"] as string) ?? (m["id"] as string) ?? "",
      };
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
  }

  if (cmd === "cycle_thinking_level" && ok && data) {
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

  if (cmd === "set_thinking_level" && ok) {
    // Updated via get_state
  }

  if (cmd === "get_session_stats" && ok && data) {
    s.sessionStats = data as AgentPanelState["sessionStats"];
    syncFooter(view);
    renderStats(view);
  }

  if (cmd === "new_session" && ok) {
    s.messages = [];
    s.currentText = "";
    s.currentThinking = "";
    s.toolCalls.clear();
    s.turnCount = 0;
    s.totalToolCalls = 0;
    s.sessionStats = null;
    s.sessionName = null;
    el.sessionNameEl.textContent = "";
    renderAllMessages(view);
    syncFooter(view);
    addSystemMessage(view, "New session started");
  }

  if (cmd === "get_commands" && ok && data) {
    const arr = data as unknown;
    if (Array.isArray(arr)) {
      const piCmds: SlashCommand[] = (arr as Record<string, unknown>[]).map(
        (c) => ({
          name: `/${c["name"] as string}`,
          description: (c["description"] as string) ?? "",
          source: (c["source"] as SlashCommand["source"]) ?? "extension",
        }),
      );
      // Merge with builtins, avoiding duplicates
      const builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.name));
      s.commands = [
        ...BUILTIN_COMMANDS,
        ...piCmds.filter((c) => !builtinNames.has(c.name)),
      ];
    }
  }

  if (cmd === "get_last_assistant_text" && ok && data) {
    const text = (data as { text?: string }).text;
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        addSystemMessage(view, "Copied last response to clipboard");
      });
    } else {
      addSystemMessage(view, "No assistant message to copy");
    }
  }

  if (cmd === "export_html" && ok && data) {
    const path = (data as { path?: string }).path;
    addSystemMessage(view, path ? `Exported to ${path}` : "Session exported");
  }

  if (cmd === "get_fork_messages" && ok && data) {
    const arr = data as unknown;
    if (Array.isArray(arr) && arr.length > 0) {
      showForkDialog(view, arr as { entryId: string; text: string }[]);
    } else {
      addSystemMessage(view, "No fork points available");
    }
  }

  if (cmd === "set_session_name" && ok) {
    const name = ev["name"] as string;
    if (name) {
      s.sessionName = name;
      el.sessionNameEl.textContent = name;
    }
  }

  if (cmd === "bash" && ok && data) {
    const output = (data as { output?: string }).output ?? "";
    const exitCode = (data as { exitCode?: number }).exitCode ?? 0;
    s.messages.push({
      role: "bash",
      content: output,
      exitCode,
      command: (data as { command?: string }).command,
      timestamp: Date.now(),
    });
    renderAllMessages(view);
  }
}

// ── Special views ──

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
  const s = view._state;
  const lines: string[] = [
    `Model: ${s.model?.name ?? "none"}`,
    `Thinking: ${s.thinkingLevel}`,
    `Steering: ${s.steeringMode}`,
    `Follow-up: ${s.followUpMode}`,
    "",
    "Use /model, /compact, or toolbar buttons to change settings.",
    "Ctrl+P to cycle models, Shift+Tab to cycle thinking.",
  ];
  addSystemMessage(view, lines.join("\n"));
}

function showHotkeysMessage(view: AgentPaneView): void {
  const lines = [
    "Keyboard Shortcuts:",
    "  Enter          Send message",
    "  Shift+Enter    New line",
    "  Alt+Enter      Queue follow-up",
    "  Escape         Abort / dismiss",
    "  Ctrl+P         Cycle model",
    "  Shift+Tab      Cycle thinking level",
    "  /              Open command menu",
    "  !command       Execute bash command",
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

function appendWelcome(parent: HTMLDivElement): void {
  const el = document.createElement("div");
  el.className = "agent-welcome";
  el.innerHTML = `
    <div class="agent-welcome-glyph">\u2726</div>
    <div class="agent-welcome-title">Pi Agent</div>
    <div class="agent-welcome-desc">AI coding assistant with full tool access and the HyperTerm Canvas skill.</div>
    <div class="agent-welcome-shortcuts">
      <div class="agent-welcome-shortcut"><kbd>/</kbd><span>Commands</span></div>
      <div class="agent-welcome-shortcut"><kbd>Enter</kbd><span>Send</span></div>
      <div class="agent-welcome-shortcut"><kbd>Ctrl+P</kbd><span>Model</span></div>
      <div class="agent-welcome-shortcut"><kbd>Shift+Tab</kbd><span>Thinking</span></div>
      <div class="agent-welcome-shortcut"><kbd>Alt+Enter</kbd><span>Follow-up</span></div>
      <div class="agent-welcome-shortcut"><kbd>Esc</kbd><span>Abort</span></div>
    </div>
    <div class="agent-welcome-actions">
      <button class="agent-welcome-btn" data-cmd="/help">Show commands</button>
      <button class="agent-welcome-btn" data-cmd="/session">Session info</button>
    </div>
  `;
  parent.appendChild(el);

  // Wire welcome action buttons
  el.querySelectorAll(".agent-welcome-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = (btn as HTMLElement).dataset["cmd"];
      if (cmd) {
        const input = parent
          .closest(".agent-body")
          ?.querySelector(".agent-input") as HTMLTextAreaElement | null;
        if (input) {
          input.value = cmd;
          input.dispatchEvent(new Event("input"));
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        }
      }
    });
  });
}

function createMsgEl(msg: ChatMessage): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `agent-msg agent-msg-${msg.role}`;

  // Timestamp
  const time = document.createElement("span");
  time.className = "agent-msg-time";
  time.textContent = formatTime(msg.timestamp);

  if (msg.role === "tool") {
    const hdr = document.createElement("div");
    hdr.className = `agent-tc-inline-hdr${msg.isError ? " agent-tc-inline-err" : ""}`;
    hdr.textContent = `${msg.isError ? "\u2717" : "\u2713"} ${msg.toolName ?? "tool"}`;
    hdr.appendChild(time);
    el.appendChild(hdr);
    if (msg.content) {
      const body = document.createElement("pre");
      body.className = "agent-tc-inline-body";
      body.textContent = msg.content.slice(0, 2000);
      el.appendChild(body);
    }
    return el;
  }

  if (msg.role === "bash") {
    const hdr = document.createElement("div");
    hdr.className = `agent-tc-inline-hdr${msg.exitCode !== 0 ? " agent-tc-inline-err" : ""}`;
    hdr.innerHTML = `<span class="agent-bash-prompt">$</span> ${escapeHtml(msg.command ?? "bash")}`;
    hdr.appendChild(time);
    el.appendChild(hdr);
    if (msg.content) {
      const body = document.createElement("pre");
      body.className = "agent-tc-inline-body";
      body.textContent = msg.content.slice(0, 4000);
      el.appendChild(body);
    }
    return el;
  }

  if (msg.thinking) {
    const details = document.createElement("details");
    details.className = "agent-think-block";
    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="agent-think-icon">\u25c8</span> Thinking`;
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "agent-think-body";
    body.textContent = msg.thinking;
    details.appendChild(body);
    el.appendChild(details);
  }

  if (msg.role === "user") {
    el.appendChild(time);
  }

  const content = document.createElement("div");
  content.className = "agent-msg-content";
  if (msg.role === "assistant") {
    content.innerHTML = mdLite(msg.content);
  } else if (msg.role === "system") {
    content.innerHTML = `<pre class="agent-sys-pre">${escapeHtml(msg.content)}</pre>`;
  } else {
    content.textContent = msg.content;
  }
  el.appendChild(content);
  return el;
}

function formatArgs(args: unknown): string {
  if (!args) return "";
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    const parsed = JSON.parse(s);
    if (parsed.command) return parsed.command;
    if (parsed.path) return parsed.path;
    if (parsed.file_path) return parsed.file_path;
    if (parsed.pattern) return parsed.pattern;
    return s.length > 120 ? s.slice(0, 117) + "\u2026" : s;
  } catch {
    return String(args).slice(0, 120);
  }
}

function extractContent(content: unknown): string {
  if (!Array.isArray(content)) return String(content);
  return content.map((c: { text?: string }) => c.text ?? "").join("");
}

function autoResize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

function mdLite(text: string): string {
  let h = escapeHtml(text);
  // Code blocks with language labels
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langLabel = lang
      ? `<span class="agent-code-lang">${lang}</span>`
      : "";
    return `<div class="agent-code-wrap">${langLabel}<pre class="agent-code"><code>${code.trim()}</code></pre></div>`;
  });
  h = h.replace(/`([^`]+)`/g, '<code class="agent-ic">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Headers
  h = h.replace(/^### (.+)$/gm, '<div class="agent-md-h3">$1</div>');
  h = h.replace(/^## (.+)$/gm, '<div class="agent-md-h2">$1</div>');
  h = h.replace(/^# (.+)$/gm, '<div class="agent-md-h1">$1</div>');
  // Lists
  h = h.replace(/^- (.+)$/gm, '<div class="agent-md-li">\u2022 $1</div>');
  h = h.replace(/^\d+\. (.+)$/gm, '<div class="agent-md-li">$&</div>');
  h = h.replace(/\n/g, "<br>");
  return h;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightDiff(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return `<span class="agent-diff-add">${escapeHtml(line)}</span>`;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return `<span class="agent-diff-del">${escapeHtml(line)}</span>`;
      }
      return escapeHtml(line);
    })
    .join("\n");
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function dispatch(event: string, detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(event, { detail }));
}

const SEND_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
const STOP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;
