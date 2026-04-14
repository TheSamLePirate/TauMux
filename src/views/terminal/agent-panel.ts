/**
 * Agent Panel — a glass-style chat UI for the pi coding agent that lives
 * inside a surface pane. Fully integrated with HyperTerm Canvas theme system,
 * real-time streaming with animations, collapsible tool calls, thinking blocks,
 * model selector, session stats, and interactive controls.
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
  collapsed: boolean;
  startTime: number;
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
    tokens?: { input: number; output: number; total: number };
    cost?: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null;
  autoScroll: boolean;
  showModelSelector: boolean;
  showThinkingSelector: boolean;
  retryState: { attempt: number; maxAttempts: number; delayMs: number } | null;
  turnCount: number;
  totalToolCalls: number;
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
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
const THINKING_COLORS: Record<string, string> = {
  off: "var(--text-dim)",
  minimal: "var(--text-muted)",
  low: "#67e8f9",
  medium: "var(--accent-secondary)",
  high: "#f97316",
};

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

  // Model button
  const modelBtn = document.createElement("button");
  modelBtn.className = "agent-tb-btn agent-tb-model";
  const modelDot = document.createElement("span");
  modelDot.className = "agent-tb-dot agent-tb-dot-model";
  modelBtn.appendChild(modelDot);
  const modelBtnLabel = document.createElement("span");
  modelBtnLabel.textContent = "Loading…";
  modelBtn.appendChild(modelBtnLabel);
  const modelChevron = document.createElement("span");
  modelChevron.className = "agent-tb-chevron";
  modelChevron.textContent = "▾";
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
  const thinkDot = document.createElement("span");
  thinkDot.className = "agent-tb-dot";
  thinkDot.style.background = THINKING_COLORS["off"];
  thinkingBtn.appendChild(thinkDot);
  const thinkingBtnLabel = document.createElement("span");
  thinkingBtnLabel.textContent = "off";
  thinkingBtn.appendChild(thinkingBtnLabel);
  const thinkChevron = document.createElement("span");
  thinkChevron.className = "agent-tb-chevron";
  thinkChevron.textContent = "▾";
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

  // New session
  const newBtn = document.createElement("button");
  newBtn.className = "agent-tb-btn agent-tb-action";
  newBtn.title = "New session";
  newBtn.textContent = "↻ New";
  newBtn.addEventListener("click", () => callbacks.onNewSession(agentId));
  toolbarEl.appendChild(newBtn);

  // Compact
  const compactBtn = document.createElement("button");
  compactBtn.className = "agent-tb-btn agent-tb-action";
  compactBtn.title = "Compact context";
  compactBtn.textContent = "⊘ Compact";
  compactBtn.addEventListener("click", () => callbacks.onCompact(agentId));
  toolbarEl.appendChild(compactBtn);

  body.appendChild(toolbarEl);

  // ── Dropdowns ──
  const modelSelectorEl = document.createElement("div");
  modelSelectorEl.className = "agent-dropdown agent-dropdown-hidden";
  body.appendChild(modelSelectorEl);

  const thinkingSelectorEl = document.createElement("div");
  thinkingSelectorEl.className = "agent-dropdown agent-dropdown-hidden";
  body.appendChild(thinkingSelectorEl);

  // ── Streaming indicator ──
  const streamingIndicator = document.createElement("div");
  streamingIndicator.className = "agent-streaming-bar agent-streaming-bar-hidden";
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

  // ── Input bar ──
  const inputBarEl = document.createElement("div");
  inputBarEl.className = "agent-input-bar";

  const inputEl = document.createElement("textarea");
  inputEl.className = "agent-input";
  inputEl.placeholder = "Message pi agent…";
  inputEl.rows = 1;
  inputEl.addEventListener("input", () => autoResize(inputEl));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitInput(view, callbacks);
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
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 50;
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

  setTimeout(() => callbacks.onGetState(agentId), 200);

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
      const d = event["assistantMessageEvent"] as Record<string, unknown> | undefined;
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
        const pr = event["partialResult"] as Record<string, unknown> | undefined;
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
        if (r?.["content"]) tc.result = extractContent(r["content"]).slice(0, 6000);
        tc.collapsed = true; // auto-collapse on completion
        renderToolCall(view, tcId);
        updateChips(view);
      }
      break;
    }

    case "compaction_start":
      s.isCompacting = true;
      el.streamingIndicator.classList.remove("agent-streaming-bar-hidden");
      (el.streamingIndicator.querySelector(".agent-streaming-bar-label") as HTMLElement).textContent = "Compacting context…";
      break;

    case "compaction_end":
      s.isCompacting = false;
      if (!s.isStreaming) el.streamingIndicator.classList.add("agent-streaming-bar-hidden");
      syncFooter(view);
      break;

    case "auto_retry_start":
      s.retryState = {
        attempt: event["attempt"] as number,
        maxAttempts: event["maxAttempts"] as number,
        delayMs: event["delayMs"] as number,
      };
      el.streamingIndicator.classList.remove("agent-streaming-bar-hidden");
      (el.streamingIndicator.querySelector(".agent-streaming-bar-label") as HTMLElement).textContent =
        `Retrying (${s.retryState.attempt}/${s.retryState.maxAttempts})…`;
      break;

    case "auto_retry_end":
      s.retryState = null;
      if (!s.isStreaming) el.streamingIndicator.classList.add("agent-streaming-bar-hidden");
      syncFooter(view);
      break;

    case "queue_update":
      break;

    case "response":
      handleResponse(view, event);
      break;

    case "agent_stderr": {
      const text = event["text"] as string;
      if (text && !text.includes("Debugger") && !text.includes("inspector")) {
        s.messages.push({ role: "system", content: text, timestamp: Date.now() });
        renderAllMessages(view);
      }
      break;
    }

    case "extension_ui_request":
      handleExtUI(view, event);
      break;

    case "agent_exit": {
      s.isStreaming = false;
      flushStreaming(view);
      s.messages.push({ role: "system", content: `Agent process exited (code ${event["code"] ?? "?"})`, timestamp: Date.now() });
      renderAllMessages(view);
      syncStreamingUI(view);
      break;
    }
  }
}

export function agentPanelAddUserMessage(view: AgentPaneView, text: string): void {
  view._state.messages.push({ role: "user", content: text, timestamp: Date.now() });
  renderAllMessages(view);
}

export function agentPanelFocusInput(view: AgentPaneView): void {
  view._elements.inputEl.focus();
}

// ── Private helpers ──

function submitInput(view: AgentPaneView, cb: AgentPanelCallbacks): void {
  const text = view._elements.inputEl.value.trim();
  if (!text) return;
  cb.onSendPrompt(view.agentId, text);
  view._elements.inputEl.value = "";
  autoResize(view._elements.inputEl);
}

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
  // Flush completed tool calls into messages
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
    inputEl.placeholder = "Steer the agent… (Esc to stop)";
    streamingIndicator.classList.remove("agent-streaming-bar-hidden");
    (streamingIndicator.querySelector(".agent-streaming-bar-label") as HTMLElement).textContent = "Generating…";
  } else {
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.title = "Send (Enter)";
    sendBtn.classList.remove("agent-send-stop");
    inputEl.placeholder = "Message pi agent…";
    streamingIndicator.classList.add("agent-streaming-bar-hidden");
  }
  syncFooter(view);
}

function syncFooter(view: AgentPaneView): void {
  const { footerEl, contextMeterFill, contextMeterLabel } = view._elements;
  const { model, thinkingLevel, sessionStats, turnCount, totalToolCalls } = view._state;
  const txt = footerEl.querySelector(".agent-footer-text") as HTMLElement;

  const parts: string[] = [];
  if (model) parts.push(model.name || model.id);
  if (thinkingLevel !== "off") parts.push(`thinking:${thinkingLevel}`);
  if (turnCount > 0) parts.push(`${turnCount} turns`);
  if (totalToolCalls > 0) parts.push(`${totalToolCalls} tools`);
  if (sessionStats?.cost != null) parts.push(`$${sessionStats.cost.toFixed(4)}`);
  txt.textContent = parts.length ? parts.join(" · ") : "Ready";

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
  chipsEl.replaceChildren();

  const running = [...view._state.toolCalls.values()].filter((tc) => tc.isRunning);
  if (running.length > 0) {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-agent-tool";
    chip.textContent = `⟳ ${running[0].name}${running.length > 1 ? ` +${running.length - 1}` : ""}`;
    chipsEl.appendChild(chip);
  }

  if (view._state.isStreaming) {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-agent-streaming";
    chip.textContent = "streaming";
    chipsEl.appendChild(chip);
  }
}

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

  // Show active tool calls
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

  let el = messagesEl.querySelector(".agent-think-live") as HTMLDivElement | null;
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
  hdr.textContent = "💭 Thinking…";
  el.appendChild(hdr);
  const body = document.createElement("div");
  body.className = "agent-think-body";
  body.textContent = currentThinking.length > 600 ? "…" + currentThinking.slice(-600) : currentThinking;
  el.appendChild(body);

  if (autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderToolCall(view: AgentPaneView, tcId: string): void {
  const { messagesEl } = view._elements;
  const tc = view._state.toolCalls.get(tcId);
  if (!tc) return;

  const existing = messagesEl.querySelector(`[data-tcid="${tcId}"]`) as HTMLDivElement | null;
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
  icon.textContent = tc.isRunning ? "⟳" : tc.isError ? "✗" : "✓";
  hdr.appendChild(icon);

  const name = document.createElement("span");
  name.className = "agent-tc-name";
  name.textContent = tc.name;
  hdr.appendChild(name);

  if (tc.args) {
    const args = document.createElement("span");
    args.className = "agent-tc-args";
    args.textContent = tc.args.length > 80 ? tc.args.slice(0, 77) + "…" : tc.args;
    hdr.appendChild(args);
  }

  if (!tc.isRunning) {
    const elapsed = document.createElement("span");
    elapsed.className = "agent-tc-elapsed";
    elapsed.textContent = `${((Date.now() - tc.startTime) / 1000).toFixed(1)}s`;
    hdr.appendChild(elapsed);
  }

  // Toggle collapse
  const toggle = document.createElement("button");
  toggle.className = "agent-tc-toggle";
  toggle.textContent = tc.collapsed ? "▸" : "▾";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    tc.collapsed = !tc.collapsed;
    const body = el.querySelector(".agent-tc-body") as HTMLDivElement | null;
    if (body) body.classList.toggle("agent-tc-body-hidden", tc.collapsed);
    toggle.textContent = tc.collapsed ? "▸" : "▾";
  });
  hdr.appendChild(toggle);

  el.appendChild(hdr);

  if (tc.result !== undefined) {
    const body = document.createElement("pre");
    body.className = `agent-tc-body${tc.collapsed ? " agent-tc-body-hidden" : ""}`;
    body.textContent = tc.result.slice(0, 3000);
    el.appendChild(body);
  }

  return el;
}

function renderDropdowns(view: AgentPaneView): void {
  const { modelSelectorEl, thinkingSelectorEl } = view._elements;
  const s = view._state;

  // Model dropdown
  if (s.showModelSelector) {
    modelSelectorEl.classList.remove("agent-dropdown-hidden");
    modelSelectorEl.innerHTML = "";
    if (!s.availableModels) {
      const ld = document.createElement("div");
      ld.className = "agent-dd-loading";
      ld.textContent = "Loading models…";
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
            window.dispatchEvent(new CustomEvent("ht-agent-set-model", {
              detail: { agentId: view.agentId, provider: m.provider, modelId: m.id },
            }));
          });
          modelSelectorEl.appendChild(item);
        }
      }
    }
  } else {
    modelSelectorEl.classList.add("agent-dropdown-hidden");
  }

  // Thinking dropdown
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
        window.dispatchEvent(new CustomEvent("ht-agent-set-thinking", {
          detail: { agentId: view.agentId, level: lvl },
        }));
      });
      thinkingSelectorEl.appendChild(item);
    }
  } else {
    thinkingSelectorEl.classList.add("agent-dropdown-hidden");
  }
}

function handleResponse(view: AgentPaneView, ev: Record<string, unknown>): void {
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
      const dot = el.toolbarEl.querySelector(".agent-tb-thinking .agent-tb-dot") as HTMLElement | null;
      if (dot) dot.style.background = THINKING_COLORS[s.thinkingLevel] ?? "var(--text-dim)";
    }
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
    syncFooter(view);
  }

  if (cmd === "set_thinking_level" && ok) {
    // thinkingLevel updated via the set-thinking event
  }

  if (cmd === "get_session_stats" && ok && data) {
    s.sessionStats = data as AgentPanelState["sessionStats"];
    syncFooter(view);
  }

  if (cmd === "new_session" && ok) {
    s.messages = [];
    s.currentText = "";
    s.currentThinking = "";
    s.toolCalls.clear();
    s.turnCount = 0;
    s.totalToolCalls = 0;
    s.sessionStats = null;
    renderAllMessages(view);
    syncFooter(view);
  }
}

function handleExtUI(view: AgentPaneView, ev: Record<string, unknown>): void {
  const method = ev["method"] as string;
  const id = ev["id"] as string;
  if (!method || !id) return;

  if (method === "notify") {
    const level = (ev["notifyType"] as string) ?? "info";
    const msg = ev["message"] as string;
    view._state.messages.push({ role: "system", content: `[${level}] ${msg}`, timestamp: Date.now() });
    renderAllMessages(view);
    return;
  }

  if (method === "setStatus") {
    const key = ev["statusKey"] as string;
    const text = ev["statusText"] as string | undefined;
    if (key && text) {
      const existing = view.chipsEl.querySelector(`[data-ck="${key}"]`) as HTMLSpanElement | null;
      if (existing) { existing.textContent = text; }
      else {
        const chip = document.createElement("span");
        chip.className = "surface-chip chip-agent-status";
        chip.dataset["ck"] = key;
        chip.textContent = text;
        view.chipsEl.appendChild(chip);
      }
    }
    return;
  }

  // Auto-cancel dialog methods
  window.dispatchEvent(new CustomEvent("ht-agent-extension-ui-response", {
    detail: { agentId: view.agentId, id, cancelled: true },
  }));
}

// ── DOM Helpers ──

function appendWelcome(parent: HTMLDivElement): void {
  const el = document.createElement("div");
  el.className = "agent-welcome";
  el.innerHTML = `
    <div class="agent-welcome-glyph">✦</div>
    <div class="agent-welcome-title">Pi Agent</div>
    <div class="agent-welcome-desc">AI coding assistant with read, write, edit, bash tools and the HyperTerm Canvas skill.<br>
    <kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline · <kbd>Esc</kbd> abort</div>
  `;
  parent.appendChild(el);
}

function createMsgEl(msg: ChatMessage): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `agent-msg agent-msg-${msg.role}`;

  if (msg.role === "tool") {
    const hdr = document.createElement("div");
    hdr.className = `agent-tc-inline-hdr${msg.isError ? " agent-tc-inline-err" : ""}`;
    hdr.textContent = `${msg.isError ? "✗" : "✓"} ${msg.toolName ?? "tool"}`;
    el.appendChild(hdr);
    if (msg.content) {
      const body = document.createElement("pre");
      body.className = "agent-tc-inline-body";
      body.textContent = msg.content.slice(0, 2000);
      el.appendChild(body);
    }
    return el;
  }

  if (msg.thinking) {
    const details = document.createElement("details");
    details.className = "agent-think-block";
    const summary = document.createElement("summary");
    summary.textContent = "💭 Thinking";
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "agent-think-body";
    body.textContent = msg.thinking;
    details.appendChild(body);
    el.appendChild(details);
  }

  const content = document.createElement("div");
  content.className = "agent-msg-content";
  if (msg.role === "assistant") {
    content.innerHTML = mdLite(msg.content);
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
    // Show the first meaningful param
    const parsed = JSON.parse(s);
    if (parsed.command) return parsed.command;
    if (parsed.path) return parsed.path;
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
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
  let h = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre class="agent-code"${lang ? ` data-lang="${lang}"` : ""}><code>${code.trim()}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code class="agent-ic">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\n/g, "<br>");
  return h;
}

const SEND_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
const STOP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;
