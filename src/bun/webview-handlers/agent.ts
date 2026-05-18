import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "createAgentSurface"
  | "splitAgentSurface"
  | "agentPrompt"
  | "agentAbort"
  | "agentSetModel"
  | "agentSetThinking"
  | "agentNewSession"
  | "agentCompact"
  | "agentGetModels"
  | "agentGetState"
  | "agentExtensionUIResponse"
  | "agentSteer"
  | "agentFollowUp"
  | "agentBash"
  | "agentAbortBash"
  | "agentCycleModel"
  | "agentCycleThinking"
  | "agentGetCommands"
  | "agentGetSessionStats"
  | "agentGetMessages"
  | "agentListSessions"
  | "agentGetSessionTree"
  | "agentGetForkMessages"
  | "agentGetLastAssistantText"
  | "agentSetSteeringMode"
  | "agentSetFollowUpMode"
  | "agentSetAutoCompaction"
  | "agentSetAutoRetry"
  | "agentAbortRetry"
  | "agentSetSessionName"
  | "agentSwitchSession"
  | "agentFork"
  | "agentExportHtml";

/** Pi agent surface lifecycle + the long tail of message routes that
 *  forward webview UI events into the per-agent JSON-RPC subprocess.
 *
 *  Every `agent*` handler follows the same shape: fetch the agent by
 *  id (returns `undefined` after an exit, which the manager evicts on
 *  the `onExit` hook), and `sendNoWait` the typed wire message. We do
 *  not validate the agent's response here — that comes back as an
 *  `agent_event` and is fanned out via `sendWebviewAction`. */
export function registerAgentWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  const { piAgentManager } = ctx;
  return {
    createAgentSurface: (payload) => {
      ctx.createAgentWorkspaceSurface(payload);
    },
    splitAgentSurface: (payload) => {
      ctx.splitAgentSurface(payload.direction, payload);
    },
    agentPrompt: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "prompt",
          message: payload.message,
          ...(payload.images?.length ? { images: payload.images } : {}),
        });
    },
    agentAbort: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "abort" });
    },
    agentSetModel: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "set_model",
          provider: payload.provider,
          modelId: payload.modelId,
        });
    },
    agentSetThinking: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "set_thinking_level",
          level: payload.level,
        });
    },
    agentNewSession: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "new_session" });
    },
    agentCompact: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "compact" });
    },
    agentGetModels: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "get_available_models" });
    },
    agentGetState: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "get_state" });
    },
    agentExtensionUIResponse: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.respondToExtensionUI(payload.id, payload.response);
    },
    agentSteer: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "steer",
          message: payload.message,
          ...(payload.images?.length ? { images: payload.images } : {}),
        });
    },
    agentFollowUp: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "follow_up",
          message: payload.message,
          ...(payload.images?.length ? { images: payload.images } : {}),
        });
    },
    agentBash: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "bash",
          command: payload.command,
          ...(payload.timeout != null ? { timeout: payload.timeout } : {}),
        });
    },
    agentAbortBash: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.abortBash();
    },
    agentCycleModel: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "cycle_model" });
    },
    agentCycleThinking: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "cycle_thinking_level" });
    },
    agentGetCommands: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "get_commands" });
    },
    agentGetSessionStats: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "get_session_stats" });
    },
    agentGetMessages: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "get_messages" });
    },
    agentListSessions: (payload) => {
      ctx.sendWebviewAction("agentEvent", {
        agentId: payload.agentId,
        event: {
          type: "response",
          command: "list_sessions",
          success: true,
          data: { sessions: ctx.listPiSessions() },
        },
      });
    },
    agentGetSessionTree: (payload) => {
      ctx.sendWebviewAction("agentEvent", {
        agentId: payload.agentId,
        event: {
          type: "response",
          command: "get_session_tree",
          success: true,
          data: {
            tree: ctx.readPiSessionTree(payload.sessionPath),
          },
        },
      });
    },
    agentGetForkMessages: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "get_fork_messages" });
    },
    agentGetLastAssistantText: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "get_last_assistant_text" });
    },
    agentSetSteeringMode: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({ type: "set_steering_mode", mode: payload.mode });
    },
    agentSetFollowUpMode: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({ type: "set_follow_up_mode", mode: payload.mode });
    },
    agentSetAutoCompaction: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "set_auto_compaction",
          enabled: payload.enabled,
        });
    },
    agentSetAutoRetry: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "set_auto_retry",
          enabled: payload.enabled,
        });
    },
    agentAbortRetry: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.abortRetry();
    },
    agentSetSessionName: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({ type: "set_session_name", name: payload.name });
    },
    agentSwitchSession: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "switch_session",
          sessionPath: payload.sessionPath,
        });
    },
    agentFork: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent) agent.sendNoWait({ type: "fork", entryId: payload.entryId });
    },
    agentExportHtml: (payload) => {
      const agent = piAgentManager.getAgent(payload.agentId);
      if (agent)
        agent.sendNoWait({
          type: "export_html",
          ...(payload.outputPath ? { outputPath: payload.outputPath } : {}),
        });
    },
  };
}
