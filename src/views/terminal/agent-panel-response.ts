/**
 * Agent-panel RPC response dispatcher.
 *
 * Before this module existed, `handleResponse` in agent-panel.ts was a
 * 324-line sequence of `if (cmd === "...")` branches that all lived
 * inside the same function. Every branch reached into view state and
 * called 2–4 render/sync helpers, making it hard to reason about any
 * single command in isolation.
 *
 * The refactor does three things:
 *   1. Normalises each command into a `ResponseHandler` — a pure
 *      `(view, data, deps) => void` function. Each handler can be
 *      tested by instantiating a fake view + stub deps and invoking
 *      the one command.
 *   2. Collects the handlers into a `RESPONSE_HANDLERS` map, so the
 *      dispatch is a single table lookup rather than a long linear
 *      scan of `if`s.
 *   3. Keeps all the cross-module dependencies (render/sync helpers,
 *      dialog launchers, built-in command list, message converter)
 *      inside a single `ResponseDeps` bundle so wiring is explicit.
 */

import {
  applyModelLabel,
  applyThinkingLevel,
  scopedModelKey,
  toModelSummary,
} from "./agent-panel-model";
import type { ChatMessage } from "./agent-panel-messages";
import { dispatch } from "./agent-panel-utils";
import type {
  AgentPaneView,
  AgentPanelState,
  SlashCommand,
} from "./agent-panel";

/** Callbacks the response handlers need to reach back into the panel.
 *  Each entry is keyed to a single panel function so the dispatcher
 *  never needs to know how they're implemented — tests can stub any
 *  subset without mounting the real panel. */
export interface ResponseDeps {
  addSystemMessage: (text: string) => void;
  syncStreamingUI: () => void;
  syncFooter: () => void;
  renderModelMeta: () => void;
  renderDropdowns: () => void;
  renderStats: () => void;
  renderAllMessages: () => void;
  renderWidgets: () => void;
  showSessionBrowserDialog: () => void;
  showTreeDialog: () => void;
  showForkDialog: (entries: { entryId: string; text: string }[]) => void;
  convertAgentMessageToChatMessages: (
    m: Record<string, unknown>,
  ) => ChatMessage[];
  /** Built-in slash commands — merged with pi-provided ones on
   *  `get_commands`. Passed in rather than imported so the future
   *  slash-command extraction can move the list without this file
   *  caring. */
  builtinCommands: SlashCommand[];
}

type ResponseHandler = (
  view: AgentPaneView,
  data: Record<string, unknown> | undefined,
  deps: ResponseDeps,
) => void;

// ── Individual command handlers ────────────────────────────────────

const onGetState: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const s = view._state;
  const el = view._elements;
  if (data["model"]) {
    s.model = toModelSummary(data["model"] as Record<string, unknown>);
    applyModelLabel(el, s.model);
  }
  if (data["thinkingLevel"]) {
    s.thinkingLevel = data["thinkingLevel"] as string;
    applyThinkingLevel(el, s.thinkingLevel);
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
  deps.syncStreamingUI();
  deps.syncFooter();
  deps.renderModelMeta();
};

const onGetAvailableModels: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const s = view._state;
  const arr = (data as { models?: unknown[] }).models;
  if (!Array.isArray(arr)) return;
  s.availableModels = arr.map((m) =>
    toModelSummary(m as Record<string, unknown>),
  );
  if (s.scopedModelIds.size === 0) {
    for (const model of s.availableModels) {
      s.scopedModelIds.add(scopedModelKey(model));
    }
  }
  deps.renderDropdowns();
  deps.renderModelMeta();
};

const onSetModel: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const s = view._state;
  s.model = toModelSummary(data);
  applyModelLabel(view._elements, s.model);
  deps.addSystemMessage(`Model: ${s.model.name}`);
  deps.syncFooter();
  deps.renderModelMeta();
};

const onCycleModel: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const s = view._state;
  const el = view._elements;
  const m = data["model"] as Record<string, unknown> | undefined;
  if (m) {
    s.model = toModelSummary(m);
    applyModelLabel(el, s.model);
    deps.addSystemMessage(`Model: ${s.model.name}`);
  }
  if (data["thinkingLevel"]) {
    s.thinkingLevel = data["thinkingLevel"] as string;
    applyThinkingLevel(el, s.thinkingLevel);
  }
  deps.syncFooter();
  deps.renderModelMeta();
};

const onCycleThinkingLevel: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const s = view._state;
  if (data["level"]) {
    s.thinkingLevel = data["level"] as string;
    applyThinkingLevel(view._elements, s.thinkingLevel);
    deps.addSystemMessage(`Thinking: ${s.thinkingLevel}`);
  }
  deps.syncFooter();
};

const onSetThinkingLevel: ResponseHandler = (view) => {
  dispatch("ht-agent-get-state", { agentId: view.agentId });
};

const onSetSteeringMode: ResponseHandler = (view, data, deps) => {
  const s = view._state;
  if (data?.["mode"]) s.steeringMode = data["mode"] as string;
  dispatch("ht-agent-get-state", { agentId: view.agentId });
  deps.addSystemMessage(`Steering delivery: ${s.steeringMode}`);
  deps.syncFooter();
};

const onSetFollowUpMode: ResponseHandler = (view, data, deps) => {
  const s = view._state;
  if (data?.["mode"]) s.followUpMode = data["mode"] as string;
  dispatch("ht-agent-get-state", { agentId: view.agentId });
  deps.addSystemMessage(`Follow-up delivery: ${s.followUpMode}`);
  deps.syncFooter();
};

const onSetAutoCompaction: ResponseHandler = (view, data, deps) => {
  const s = view._state;
  s.autoCompactionEnabled =
    typeof data?.["enabled"] === "boolean"
      ? Boolean(data["enabled"])
      : !s.autoCompactionEnabled;
  deps.addSystemMessage(
    `Auto compaction ${s.autoCompactionEnabled ? "enabled" : "disabled"}`,
  );
  dispatch("ht-agent-get-state", { agentId: view.agentId });
  deps.syncFooter();
};

const onSetAutoRetry: ResponseHandler = (view, data, deps) => {
  const s = view._state;
  s.autoRetryEnabled =
    typeof data?.["enabled"] === "boolean"
      ? Boolean(data["enabled"])
      : !s.autoRetryEnabled;
  deps.addSystemMessage(
    `Auto retry ${s.autoRetryEnabled ? "enabled" : "disabled"}`,
  );
  dispatch("ht-agent-get-state", { agentId: view.agentId });
  deps.syncFooter();
};

const onAbortRetry: ResponseHandler = (view, _data, deps) => {
  view._state.retryState = null;
  deps.addSystemMessage("Retry aborted");
};

const onGetSessionStats: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const s = view._state;
  s.sessionStats = data as AgentPanelState["sessionStats"];
  if (data["sessionFile"]) s.sessionFile = data["sessionFile"] as string;
  if (data["sessionId"]) s.sessionId = data["sessionId"] as string;
  if (typeof data["totalMessages"] === "number") {
    s.messageCount = data["totalMessages"] as number;
  }
  deps.syncFooter();
  deps.renderStats();
};

const onGetMessages: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const s = view._state;
  const messages = Array.isArray(data["messages"])
    ? (data["messages"] as Record<string, unknown>[])
    : [];
  s.messages = messages.flatMap(deps.convertAgentMessageToChatMessages);
  s.turnCount = s.messages.filter((m) => m.role === "assistant").length;
  s.totalToolCalls = s.messages.filter((m) => m.role === "tool").length;
  deps.renderAllMessages();
  deps.syncFooter();
};

const onNewSession: ResponseHandler = (view, _data, deps) => {
  const s = view._state;
  const el = view._elements;
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
  deps.renderWidgets();
  s.sessionFile = null;
  s.sessionId = null;
  s.messageCount = 0;
  el.sessionNameEl.textContent = "";
  deps.renderAllMessages();
  deps.syncFooter();
  deps.addSystemMessage("New session started");
  dispatch("ht-agent-get-state", { agentId: view.agentId });
  dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
  dispatch("ht-agent-get-messages", { agentId: view.agentId });
};

const onGetCommands: ResponseHandler = (view, data, deps) => {
  if (!data) return;
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
  const builtinNames = new Set(deps.builtinCommands.map((c) => c.name));
  view._state.commands = [
    ...deps.builtinCommands,
    ...piCmds.filter((c) => !builtinNames.has(c.name)),
  ];
};

const onGetLastAssistantText: ResponseHandler = (_view, data, deps) => {
  if (!data) return;
  const text = (data as { text?: string | null }).text;
  if (text) {
    void navigator.clipboard.writeText(text).then(() => {
      deps.addSystemMessage("Copied last response to clipboard");
    });
  } else {
    deps.addSystemMessage("No assistant message to copy");
  }
};

const onExportHtml: ResponseHandler = (_view, data, deps) => {
  if (!data) return;
  const path = (data as { path?: string }).path;
  deps.addSystemMessage(path ? `Exported to ${path}` : "Session exported");
};

const onSwitchSession: ResponseHandler = (view, data, deps) => {
  const cancelled = Boolean(data?.["cancelled"]);
  deps.addSystemMessage(
    cancelled ? "Session switch cancelled" : "Session switched",
  );
  if (!cancelled) {
    dispatch("ht-agent-get-state", { agentId: view.agentId });
    dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
    dispatch("ht-agent-get-messages", { agentId: view.agentId });
    dispatch("ht-agent-get-session-tree", { agentId: view.agentId });
  }
};

const onListSessions: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  view._state.sessionList = Array.isArray(data["sessions"])
    ? (data["sessions"] as AgentPanelState["sessionList"])
    : [];
  deps.showSessionBrowserDialog();
};

const onGetSessionTree: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  view._state.sessionTree = Array.isArray(data["tree"])
    ? (data["tree"] as AgentPanelState["sessionTree"])
    : [];
  deps.showTreeDialog();
};

const onGetForkMessages: ResponseHandler = (_view, data, deps) => {
  if (!data) return;
  const arr = Array.isArray(data["messages"])
    ? (data["messages"] as { entryId: string; text: string }[])
    : Array.isArray(data)
      ? (data as unknown as { entryId: string; text: string }[])
      : [];
  if (arr.length > 0) deps.showForkDialog(arr);
  else deps.addSystemMessage("No fork points available");
};

const onFork: ResponseHandler = (view, data, deps) => {
  const cancelled = Boolean(data?.["cancelled"]);
  const text = (data?.["text"] as string) ?? "";
  deps.addSystemMessage(
    cancelled
      ? "Fork cancelled"
      : `Forked session${text ? ` from: ${text.slice(0, 80)}` : ""}`,
  );
  if (!cancelled) {
    dispatch("ht-agent-get-state", { agentId: view.agentId });
    dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
    dispatch("ht-agent-get-messages", { agentId: view.agentId });
  }
};

const onSetSessionName: ResponseHandler = (view, data, deps) => {
  const name =
    (data?.["name"] as string) ??
    ((view._state as unknown as Record<string, unknown>)["name"] as string) ??
    "";
  view._state.sessionName = name || null;
  view._elements.sessionNameEl.textContent = name;
  deps.syncFooter();
};

const onBash: ResponseHandler = (view, data, deps) => {
  if (!data) return;
  const output = (data as { output?: string }).output ?? "";
  const exitCode = (data as { exitCode?: number }).exitCode ?? 0;
  view._state.messages.push({
    role: "bash",
    content: output,
    exitCode,
    command: (data as { command?: string }).command ?? undefined,
    truncated: Boolean((data as { truncated?: boolean }).truncated),
    fullOutputPath:
      (data as { fullOutputPath?: string | null }).fullOutputPath ?? null,
    timestamp: Date.now(),
  });
  deps.renderAllMessages();
};

// ── Dispatch table ────────────────────────────────────────────────

export const RESPONSE_HANDLERS: Record<string, ResponseHandler> = {
  get_state: onGetState,
  get_available_models: onGetAvailableModels,
  set_model: onSetModel,
  cycle_model: onCycleModel,
  cycle_thinking_level: onCycleThinkingLevel,
  set_thinking_level: onSetThinkingLevel,
  set_steering_mode: onSetSteeringMode,
  set_follow_up_mode: onSetFollowUpMode,
  set_auto_compaction: onSetAutoCompaction,
  set_auto_retry: onSetAutoRetry,
  abort_retry: onAbortRetry,
  get_session_stats: onGetSessionStats,
  get_messages: onGetMessages,
  new_session: onNewSession,
  get_commands: onGetCommands,
  get_last_assistant_text: onGetLastAssistantText,
  export_html: onExportHtml,
  switch_session: onSwitchSession,
  list_sessions: onListSessions,
  get_session_tree: onGetSessionTree,
  get_fork_messages: onGetForkMessages,
  fork: onFork,
  set_session_name: onSetSessionName,
  bash: onBash,
};

/** Route an agent RPC response event to the matching handler, or log
 *  an error system message if the response reports failure. */
export function handleAgentResponse(
  view: AgentPaneView,
  ev: Record<string, unknown>,
  deps: ResponseDeps,
): void {
  const cmd = ev["command"] as string;
  const ok = ev["success"] as boolean;
  const data = ev["data"] as Record<string, unknown> | undefined;

  if (!ok) {
    const error = (ev["error"] as string) ?? `Command failed: ${cmd}`;
    deps.addSystemMessage(error);
    return;
  }

  const handler = RESPONSE_HANDLERS[cmd];
  if (handler) handler(view, data, deps);
}
