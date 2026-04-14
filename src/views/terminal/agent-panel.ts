/**
 * Agent Panel — a beautiful chat UI for the pi coding agent that lives
 * inside a surface pane alongside terminals and browser panes.
 *
 * Renders streaming text, thinking blocks, tool calls/results,
 * and provides an input bar for sending prompts. Fully integrated with
 * the HyperTerm Canvas glass aesthetic.
 */

import { createIcon } from "./icons";

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
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  thinking?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  timestamp: number;
}

interface ToolCallState {
  id: string;
  name: string;
  args: string;
  result?: string;
  isError?: boolean;
  isRunning: boolean;
}

export interface AgentPaneView {
  agentId: string;
  surfaceId: string;
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  // Internal state for rendering
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
    tokens?: { input: number; output: number; total: number };
    cost?: number;
    contextUsage?: { tokens: number; contextWindow: number; percent: number };
  } | null;
  autoScroll: boolean;
  showModelSelector: boolean;
  retryState: { attempt: number; maxAttempts: number; delayMs: number } | null;
}

interface AgentPanelElements {
  messagesEl: HTMLDivElement;
  inputEl: HTMLTextAreaElement;
  inputBarEl: HTMLDivElement;
  statusEl: HTMLDivElement;
  sendBtn: HTMLButtonElement;
  modelBtn: HTMLButtonElement;
  thinkingBtn: HTMLButtonElement;
  modelSelectorEl: HTMLDivElement;
  toolbarEl: HTMLDivElement;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;

export function createAgentPaneView(
  surfaceId: string,
  agentId: string,
  callbacks: AgentPanelCallbacks,
): AgentPaneView {
  const container = document.createElement("div");
  container.className = "surface-container agent-surface";
  container.dataset["surfaceId"] = surfaceId;
  container.style.display = "none";

  // ── Status bar (matches terminal surface bar) ──
  const bar = document.createElement("div");
  bar.className = "surface-bar";

  const barTitleWrap = document.createElement("div");
  barTitleWrap.className = "surface-bar-title-wrap";
  const barIcon = createIcon("command", "surface-bar-icon", 12);
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

  const splitRightBtn = document.createElement("button");
  splitRightBtn.className = "surface-bar-btn";
  splitRightBtn.title = "Split Right";
  splitRightBtn.append(createIcon("splitHorizontal"));
  splitRightBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onSplit(surfaceId, "horizontal");
  });
  barActions.appendChild(splitRightBtn);

  const splitDownBtn = document.createElement("button");
  splitDownBtn.className = "surface-bar-btn";
  splitDownBtn.title = "Split Down";
  splitDownBtn.append(createIcon("splitVertical"));
  splitDownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onSplit(surfaceId, "vertical");
  });
  barActions.appendChild(splitDownBtn);

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

  // ── Main agent body ──
  const body = document.createElement("div");
  body.className = "agent-body";

  // ── Toolbar ──
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "agent-toolbar";

  const modelBtn = document.createElement("button");
  modelBtn.className = "agent-toolbar-btn agent-model-btn";
  modelBtn.textContent = "Loading model…";
  modelBtn.title = "Select model";
  modelBtn.addEventListener("click", () => {
    state.showModelSelector = !state.showModelSelector;
    renderModelSelector(view);
    if (state.showModelSelector) {
      callbacks.onGetModels(agentId);
    }
  });
  toolbarEl.appendChild(modelBtn);

  const thinkingBtn = document.createElement("button");
  thinkingBtn.className = "agent-toolbar-btn agent-thinking-btn";
  thinkingBtn.textContent = "thinking: off";
  thinkingBtn.title = "Cycle thinking level";
  thinkingBtn.addEventListener("click", () => {
    const idx = THINKING_LEVELS.indexOf(
      state.thinkingLevel as (typeof THINKING_LEVELS)[number],
    );
    const next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
    callbacks.onSetThinking(agentId, next);
  });
  toolbarEl.appendChild(thinkingBtn);

  const newSessionBtn = document.createElement("button");
  newSessionBtn.className = "agent-toolbar-btn";
  newSessionBtn.textContent = "New Session";
  newSessionBtn.title = "Start a fresh conversation";
  newSessionBtn.addEventListener("click", () => {
    callbacks.onNewSession(agentId);
  });
  toolbarEl.appendChild(newSessionBtn);

  const compactBtn = document.createElement("button");
  compactBtn.className = "agent-toolbar-btn";
  compactBtn.textContent = "Compact";
  compactBtn.title = "Compact conversation context";
  compactBtn.addEventListener("click", () => {
    callbacks.onCompact(agentId);
  });
  toolbarEl.appendChild(compactBtn);

  body.appendChild(toolbarEl);

  // Model selector dropdown
  const modelSelectorEl = document.createElement("div");
  modelSelectorEl.className = "agent-model-selector hidden";
  body.appendChild(modelSelectorEl);

  // ── Messages area ──
  const messagesEl = document.createElement("div");
  messagesEl.className = "agent-messages";

  // Welcome message
  const welcome = document.createElement("div");
  welcome.className = "agent-welcome";
  welcome.innerHTML = `
    <div class="agent-welcome-icon">✦</div>
    <div class="agent-welcome-title">Pi Agent</div>
    <div class="agent-welcome-sub">AI coding assistant running inside HyperTerm Canvas.<br>
    Equipped with read, write, edit, and bash tools plus the ht-cli skill.</div>
  `;
  messagesEl.appendChild(welcome);

  body.appendChild(messagesEl);

  // ── Status bar ──
  const statusEl = document.createElement("div");
  statusEl.className = "agent-status";
  statusEl.textContent = "Ready";
  body.appendChild(statusEl);

  // ── Input bar ──
  const inputBarEl = document.createElement("div");
  inputBarEl.className = "agent-input-bar";

  const inputEl = document.createElement("textarea");
  inputEl.className = "agent-input";
  inputEl.placeholder = "Ask the agent anything…";
  inputEl.rows = 1;
  inputEl.addEventListener("input", () => {
    autoResizeTextarea(inputEl);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text) {
        if (state.isStreaming) {
          // During streaming, steer
          callbacks.onSendPrompt(agentId, text);
        } else {
          callbacks.onSendPrompt(agentId, text);
        }
        inputEl.value = "";
        autoResizeTextarea(inputEl);
      }
    }
    if (e.key === "Escape" && state.isStreaming) {
      e.preventDefault();
      callbacks.onAbort(agentId);
    }
  });
  inputBarEl.appendChild(inputEl);

  const sendBtn = document.createElement("button");
  sendBtn.className = "agent-send-btn";
  sendBtn.title = "Send (Enter)";
  sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
  sendBtn.addEventListener("click", () => {
    const text = inputEl.value.trim();
    if (text) {
      if (state.isStreaming) {
        callbacks.onSendPrompt(agentId, text);
      } else {
        callbacks.onSendPrompt(agentId, text);
      }
      inputEl.value = "";
      autoResizeTextarea(inputEl);
    } else if (state.isStreaming) {
      callbacks.onAbort(agentId);
    }
  });
  inputBarEl.appendChild(sendBtn);

  body.appendChild(inputBarEl);
  container.appendChild(body);

  // Focus on click
  container.addEventListener("mousedown", () => {
    callbacks.onFocus(surfaceId);
  });

  // Auto-scroll on messages area scroll
  messagesEl.addEventListener("scroll", () => {
    const isAtBottom =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
      40;
    state.autoScroll = isAtBottom;
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
    retryState: null,
  };

  const elements: AgentPanelElements = {
    messagesEl,
    inputEl,
    inputBarEl,
    statusEl,
    sendBtn,
    modelBtn,
    thinkingBtn,
    modelSelectorEl,
    toolbarEl,
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

  // Request initial state
  setTimeout(() => callbacks.onGetState(agentId), 100);

  return view;
}

/** Handle an event from the pi agent RPC process. */
export function agentPanelHandleEvent(
  view: AgentPaneView,
  event: Record<string, unknown>,
): void {
  const state = view._state;
  const els = view._elements;

  switch (event["type"]) {
    case "agent_start":
      state.isStreaming = true;
      state.currentText = "";
      state.currentThinking = "";
      state.toolCalls.clear();
      updateStreamingUI(view);
      break;

    case "agent_end":
      state.isStreaming = false;
      if (state.currentText) {
        state.messages.push({
          role: "assistant",
          content: state.currentText,
          thinking: state.currentThinking || undefined,
          timestamp: Date.now(),
        });
        state.currentText = "";
        state.currentThinking = "";
      }
      renderMessages(view);
      updateStreamingUI(view);
      break;

    case "message_update": {
      const delta = event["assistantMessageEvent"] as Record<string, unknown>;
      if (!delta) break;
      if (delta["type"] === "text_delta") {
        state.currentText += delta["delta"] as string;
        renderStreamingMessage(view);
      } else if (delta["type"] === "thinking_delta") {
        state.currentThinking += delta["delta"] as string;
        renderStreamingThinking(view);
      }
      break;
    }

    case "tool_execution_start": {
      const tcId = event["toolCallId"] as string;
      const toolName = event["toolName"] as string;
      const args = event["args"]
        ? JSON.stringify(event["args"], null, 2)
        : "";
      state.toolCalls.set(tcId, {
        id: tcId,
        name: toolName,
        args: truncateToolArgs(args),
        isRunning: true,
      });
      renderToolCall(view, tcId);
      break;
    }

    case "tool_execution_update": {
      const tcId = event["toolCallId"] as string;
      const tc = state.toolCalls.get(tcId);
      if (tc) {
        const partial = event["partialResult"] as Record<string, unknown> | undefined;
        if (partial?.["content"]) {
          const content = partial["content"] as Array<{ text?: string }>;
          tc.result = content
            .map((c) => c.text ?? "")
            .join("")
            .slice(0, 2000);
        }
        renderToolCall(view, tcId);
      }
      break;
    }

    case "tool_execution_end": {
      const tcId = event["toolCallId"] as string;
      const tc = state.toolCalls.get(tcId);
      if (tc) {
        tc.isRunning = false;
        tc.isError = event["isError"] as boolean;
        const result = event["result"] as Record<string, unknown> | undefined;
        if (result?.["content"]) {
          const content = result["content"] as Array<{ text?: string }>;
          tc.result = content
            .map((c) => c.text ?? "")
            .join("")
            .slice(0, 4000);
        }
        renderToolCall(view, tcId);
      }
      break;
    }

    case "compaction_start":
      state.isCompacting = true;
      els.statusEl.textContent = "Compacting context…";
      els.statusEl.classList.add("agent-status-busy");
      break;

    case "compaction_end":
      state.isCompacting = false;
      els.statusEl.classList.remove("agent-status-busy");
      updateStatus(view);
      break;

    case "auto_retry_start": {
      state.retryState = {
        attempt: event["attempt"] as number,
        maxAttempts: event["maxAttempts"] as number,
        delayMs: event["delayMs"] as number,
      };
      els.statusEl.textContent = `Retrying (${state.retryState.attempt}/${state.retryState.maxAttempts})…`;
      els.statusEl.classList.add("agent-status-busy");
      break;
    }

    case "auto_retry_end":
      state.retryState = null;
      els.statusEl.classList.remove("agent-status-busy");
      updateStatus(view);
      break;

    case "queue_update":
      break;

    case "response": {
      const cmd = event["command"] as string;
      if (cmd === "get_state" && event["success"] && event["data"]) {
        const data = event["data"] as Record<string, unknown>;
        if (data["model"]) {
          state.model = data["model"] as AgentPanelState["model"];
          els.modelBtn.textContent = state.model?.name ?? state.model?.id ?? "No model";
        }
        if (data["thinkingLevel"]) {
          state.thinkingLevel = data["thinkingLevel"] as string;
          els.thinkingBtn.textContent = `thinking: ${state.thinkingLevel}`;
        }
        state.isStreaming = data["isStreaming"] as boolean;
        updateStreamingUI(view);
        updateStatus(view);
      }
      if (cmd === "get_available_models" && event["success"] && event["data"]) {
        const data = event["data"] as { models: Array<Record<string, unknown>> };
        state.availableModels = (data.models ?? []).map((m) => ({
          provider: (m["provider"] as string) ?? "",
          id: (m["id"] as string) ?? "",
          name: (m["name"] as string) ?? (m["id"] as string) ?? "",
        }));
        renderModelSelector(view);
      }
      if (cmd === "set_model" && event["success"] && event["data"]) {
        const data = event["data"] as Record<string, unknown>;
        state.model = {
          provider: (data["provider"] as string) ?? "",
          id: (data["id"] as string) ?? "",
          name: (data["name"] as string) ?? (data["id"] as string) ?? "",
        };
        els.modelBtn.textContent = state.model.name;
        state.showModelSelector = false;
        renderModelSelector(view);
      }
      if (cmd === "set_thinking_level" && event["success"]) {
        // The level was set in the send call
      }
      if (cmd === "get_session_stats" && event["success"] && event["data"]) {
        state.sessionStats = event["data"] as AgentPanelState["sessionStats"];
        updateStatus(view);
      }
      if (cmd === "prompt" && event["success"]) {
        // Prompt accepted — already handling via events
      }
      if (cmd === "new_session" && event["success"]) {
        state.messages = [];
        state.currentText = "";
        state.currentThinking = "";
        state.toolCalls.clear();
        renderMessages(view);
        updateStatus(view);
      }
      break;
    }

    case "agent_stderr": {
      // Show as system message
      const text = event["text"] as string;
      if (text && !text.includes("Debugger") && !text.includes("node --inspect")) {
        state.messages.push({
          role: "system",
          content: text,
          timestamp: Date.now(),
        });
        renderMessages(view);
      }
      break;
    }

    case "extension_ui_request":
      // Handle extension UI requests (select, confirm, etc.)
      handleExtensionUIRequest(view, event);
      break;
  }
}

/** Set the available models list from the agent state response. */
export function agentPanelSetModels(
  view: AgentPaneView,
  models: Array<{ provider: string; id: string; name: string }>,
): void {
  view._state.availableModels = models;
  renderModelSelector(view);
}

/** Set model info on the panel. */
export function agentPanelSetModel(
  view: AgentPaneView,
  model: { provider: string; id: string; name: string } | null,
): void {
  view._state.model = model;
  view._elements.modelBtn.textContent = model?.name ?? model?.id ?? "No model";
}

/** Set thinking level. */
export function agentPanelSetThinking(
  view: AgentPaneView,
  level: string,
): void {
  view._state.thinkingLevel = level;
  view._elements.thinkingBtn.textContent = `thinking: ${level}`;
}

/** Add a user message to the display. */
export function agentPanelAddUserMessage(
  view: AgentPaneView,
  text: string,
): void {
  view._state.messages.push({
    role: "user",
    content: text,
    timestamp: Date.now(),
  });
  renderMessages(view);
}

/** Focus the input. */
export function agentPanelFocusInput(view: AgentPaneView): void {
  view._elements.inputEl.focus();
}

// ── Private rendering helpers ──

function renderMessages(view: AgentPaneView): void {
  const { messagesEl } = view._elements;
  const { messages, autoScroll, toolCalls } = view._state;

  // Preserve welcome if no messages
  if (messages.length === 0) {
    messagesEl.innerHTML = "";
    const welcome = document.createElement("div");
    welcome.className = "agent-welcome";
    welcome.innerHTML = `
      <div class="agent-welcome-icon">✦</div>
      <div class="agent-welcome-title">Pi Agent</div>
      <div class="agent-welcome-sub">AI coding assistant running inside HyperTerm Canvas.<br>
      Equipped with read, write, edit, and bash tools plus the ht-cli skill.</div>
    `;
    messagesEl.appendChild(welcome);
    return;
  }

  // Clear and re-render all messages
  messagesEl.innerHTML = "";

  for (const msg of messages) {
    const msgEl = createMessageElement(msg);
    messagesEl.appendChild(msgEl);
  }

  // Render active tool calls
  for (const [, tc] of toolCalls) {
    const tcEl = createToolCallElement(tc);
    messagesEl.appendChild(tcEl);
  }

  if (autoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderStreamingMessage(view: AgentPaneView): void {
  const { messagesEl } = view._elements;
  const { currentText, autoScroll } = view._state;

  let streamEl = messagesEl.querySelector(
    ".agent-msg-streaming",
  ) as HTMLDivElement | null;
  if (!streamEl) {
    streamEl = document.createElement("div");
    streamEl.className = "agent-msg agent-msg-assistant agent-msg-streaming";
    messagesEl.appendChild(streamEl);
  }
  streamEl.innerHTML = "";

  const contentEl = document.createElement("div");
  contentEl.className = "agent-msg-content";
  contentEl.innerHTML = renderMarkdownLite(currentText);
  streamEl.appendChild(contentEl);

  // Cursor blink
  const cursor = document.createElement("span");
  cursor.className = "agent-streaming-cursor";
  cursor.textContent = "▊";
  contentEl.appendChild(cursor);

  if (autoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderStreamingThinking(view: AgentPaneView): void {
  const { messagesEl } = view._elements;
  const { currentThinking, autoScroll } = view._state;

  let thinkEl = messagesEl.querySelector(
    ".agent-thinking-streaming",
  ) as HTMLDivElement | null;
  if (!thinkEl) {
    thinkEl = document.createElement("div");
    thinkEl.className = "agent-thinking agent-thinking-streaming";
    // Insert before streaming message if it exists
    const streamMsg = messagesEl.querySelector(".agent-msg-streaming");
    if (streamMsg) {
      messagesEl.insertBefore(thinkEl, streamMsg);
    } else {
      messagesEl.appendChild(thinkEl);
    }
  }

  const header = document.createElement("div");
  header.className = "agent-thinking-header";
  header.textContent = "💭 Thinking…";

  const body = document.createElement("div");
  body.className = "agent-thinking-body";
  body.textContent = currentThinking.slice(-500);

  thinkEl.replaceChildren(header, body);

  if (autoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderToolCall(view: AgentPaneView, tcId: string): void {
  const { messagesEl } = view._elements;
  const { autoScroll, toolCalls } = view._state;
  const tc = toolCalls.get(tcId);
  if (!tc) return;

  let el = messagesEl.querySelector(
    `[data-tool-call-id="${tcId}"]`,
  ) as HTMLDivElement | null;
  if (!el) {
    el = createToolCallElement(tc);
    el.dataset["toolCallId"] = tcId;
    // Insert before streaming message
    const streamMsg = messagesEl.querySelector(".agent-msg-streaming");
    if (streamMsg) {
      messagesEl.insertBefore(el, streamMsg);
    } else {
      messagesEl.appendChild(el);
    }
  } else {
    // Update in place
    const newEl = createToolCallElement(tc);
    newEl.dataset["toolCallId"] = tcId;
    el.replaceWith(newEl);
  }

  if (autoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderModelSelector(view: AgentPaneView): void {
  const { modelSelectorEl } = view._elements;
  const { showModelSelector, availableModels } = view._state;

  if (!showModelSelector) {
    modelSelectorEl.classList.add("hidden");
    return;
  }

  modelSelectorEl.classList.remove("hidden");
  modelSelectorEl.innerHTML = "";

  if (!availableModels) {
    const loading = document.createElement("div");
    loading.className = "agent-model-loading";
    loading.textContent = "Loading models…";
    modelSelectorEl.appendChild(loading);
    return;
  }

  // Group by provider
  const byProvider = new Map<string, typeof availableModels>();
  for (const m of availableModels) {
    const group = byProvider.get(m.provider) ?? [];
    group.push(m);
    byProvider.set(m.provider, group);
  }

  for (const [provider, models] of byProvider) {
    const header = document.createElement("div");
    header.className = "agent-model-group-header";
    header.textContent = provider;
    modelSelectorEl.appendChild(header);

    for (const m of models) {
      const item = document.createElement("button");
      item.className = "agent-model-item";
      if (
        view._state.model?.provider === m.provider &&
        view._state.model?.id === m.id
      ) {
        item.classList.add("agent-model-item-active");
      }
      item.textContent = m.name || m.id;
      item.addEventListener("click", () => {
        view._state.showModelSelector = false;
        // The callbacks are attached to the view via closure
        const agentId = view.agentId;
        // Emit a custom event that the parent will handle
        window.dispatchEvent(
          new CustomEvent("ht-agent-set-model", {
            detail: { agentId, provider: m.provider, modelId: m.id },
          }),
        );
      });
      modelSelectorEl.appendChild(item);
    }
  }
}

function updateStreamingUI(view: AgentPaneView): void {
  const { sendBtn, inputEl, statusEl } = view._elements;
  const { isStreaming } = view._state;

  if (isStreaming) {
    sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
    sendBtn.title = "Stop (Escape)";
    sendBtn.classList.add("agent-send-btn-stop");
    inputEl.placeholder = "Steer the agent… (Escape to stop)";
    statusEl.textContent = "Streaming…";
    statusEl.classList.add("agent-status-busy");
  } else {
    sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
    sendBtn.title = "Send (Enter)";
    sendBtn.classList.remove("agent-send-btn-stop");
    inputEl.placeholder = "Ask the agent anything…";
    statusEl.classList.remove("agent-status-busy");
    updateStatus(view);
    // Remove streaming elements
    const messagesEl = view._elements.messagesEl;
    messagesEl.querySelector(".agent-msg-streaming")?.remove();
    messagesEl.querySelector(".agent-thinking-streaming")?.remove();
  }
}

function updateStatus(view: AgentPaneView): void {
  const { statusEl } = view._elements;
  const { model, thinkingLevel, isStreaming, sessionStats } = view._state;

  if (isStreaming) return; // Don't overwrite streaming status

  const parts: string[] = [];
  if (model) parts.push(model.name || model.id);
  if (thinkingLevel !== "off") parts.push(`thinking: ${thinkingLevel}`);
  if (sessionStats?.cost !== undefined && sessionStats.cost !== null) {
    parts.push(`$${sessionStats.cost.toFixed(4)}`);
  }
  if (sessionStats?.contextUsage?.percent !== undefined) {
    parts.push(`ctx: ${sessionStats.contextUsage.percent}%`);
  }

  statusEl.textContent = parts.length > 0 ? parts.join(" · ") : "Ready";
}

function createMessageElement(msg: ChatMessage): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `agent-msg agent-msg-${msg.role}`;

  if (msg.thinking) {
    const thinkEl = document.createElement("details");
    thinkEl.className = "agent-thinking-block";
    const summary = document.createElement("summary");
    summary.className = "agent-thinking-summary";
    summary.textContent = "💭 Thinking";
    thinkEl.appendChild(summary);
    const body = document.createElement("div");
    body.className = "agent-thinking-body";
    body.textContent = msg.thinking;
    thinkEl.appendChild(body);
    el.appendChild(thinkEl);
  }

  const contentEl = document.createElement("div");
  contentEl.className = "agent-msg-content";
  if (msg.role === "user") {
    contentEl.textContent = msg.content;
  } else if (msg.role === "system") {
    contentEl.textContent = msg.content;
  } else {
    contentEl.innerHTML = renderMarkdownLite(msg.content);
  }
  el.appendChild(contentEl);

  return el;
}

function createToolCallElement(tc: ToolCallState): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `agent-tool-call${tc.isRunning ? " agent-tool-running" : ""}${tc.isError ? " agent-tool-error" : ""}`;

  const header = document.createElement("div");
  header.className = "agent-tool-header";

  const icon = document.createElement("span");
  icon.className = "agent-tool-icon";
  icon.textContent = tc.isRunning ? "⟳" : tc.isError ? "✗" : "✓";
  header.appendChild(icon);

  const name = document.createElement("span");
  name.className = "agent-tool-name";
  name.textContent = tc.name;
  header.appendChild(name);

  if (tc.args) {
    const args = document.createElement("span");
    args.className = "agent-tool-args";
    args.textContent = tc.args.slice(0, 100);
    header.appendChild(args);
  }

  el.appendChild(header);

  if (tc.result) {
    const resultEl = document.createElement("pre");
    resultEl.className = "agent-tool-result";
    resultEl.textContent = tc.result.slice(0, 2000);
    el.appendChild(resultEl);
  }

  return el;
}

function handleExtensionUIRequest(
  view: AgentPaneView,
  event: Record<string, unknown>,
): void {
  const method = event["method"] as string;
  const id = event["id"] as string;
  if (!method || !id) return;

  // For fire-and-forget methods, just display
  if (method === "notify") {
    view._state.messages.push({
      role: "system",
      content: `[${(event["notifyType"] as string) ?? "info"}] ${event["message"] as string}`,
      timestamp: Date.now(),
    });
    renderMessages(view);
    return;
  }

  if (method === "setStatus") {
    // Update chips
    const key = event["statusKey"] as string;
    const text = event["statusText"] as string | undefined;
    if (key && text) {
      renderAgentChip(view, key, text);
    }
    return;
  }

  // For dialog methods, auto-cancel for now (user can enhance later)
  // In a full implementation these would show dialogs
  window.dispatchEvent(
    new CustomEvent("ht-agent-extension-ui-response", {
      detail: { agentId: view.agentId, id, cancelled: true },
    }),
  );
}

function renderAgentChip(
  view: AgentPaneView,
  key: string,
  text: string,
): void {
  const existing = view.chipsEl.querySelector(
    `[data-chip-key="${key}"]`,
  ) as HTMLSpanElement | null;
  if (existing) {
    existing.textContent = text;
  } else {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-agent-status";
    chip.dataset["chipKey"] = key;
    chip.textContent = text;
    view.chipsEl.appendChild(chip);
  }
}

function autoResizeTextarea(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function truncateToolArgs(args: string): string {
  if (args.length <= 200) return args;
  return args.slice(0, 197) + "…";
}

/**
 * Very lightweight Markdown-to-HTML for assistant messages.
 * Handles code blocks, inline code, bold, links. Not a full parser.
 */
function renderMarkdownLite(text: string): string {
  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, lang, code) =>
      `<pre class="agent-code-block"${lang ? ` data-lang="${lang}"` : ""}><code>${code.trim()}</code></pre>`,
  );

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="agent-inline-code">$1</code>',
  );

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Line breaks
  html = html.replace(/\n/g, "<br>");

  return html;
}
