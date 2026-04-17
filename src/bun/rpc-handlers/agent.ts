import type { Handler, HandlerDeps } from "./types";

export function registerAgent(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch, piAgentManager } = deps;

  return {
    "agent.create": () => {
      dispatch("createAgentSurface", {});
      return "OK";
    },

    "agent.create_split": (params) => {
      const dir = params["direction"] as string;
      const direction =
        dir === "down" || dir === "vertical" ? "vertical" : "horizontal";
      dispatch("splitAgentSurface", { direction });
      return "OK";
    },

    /** Read-only roster of live agents. Empty array when no agent has been
     *  created in this process. Tests use this to wait for `agent.create`
     *  to take effect without round-tripping through the webview. */
    "agent.list": () => {
      if (!piAgentManager) return [];
      // Ids only — `PiAgentInstance.getState()` is async and would need a
      // Promise.all roundtrip the agent-pane RPCs don't pay elsewhere.
      // Callers that need state can use the existing per-agent RPCs.
      return piAgentManager.getAllAgents().map((a) => ({ id: a.id }));
    },

    /** Count of live agents — cheaper than `agent.list` for simple polling. */
    "agent.count": () => piAgentManager?.agentCount ?? 0,

    /** Close an agent by id. Mirrors the bun-side handling in the
     *  `closeSurface` webview message: remove the agent from
     *  PiAgentManager, then notify the webview so it drops the pane from
     *  its layout. The webview doesn't have a `closeSurface` socketAction
     *  handler (closing is webview → bun), so we do both sides here. */
    "agent.close": (params) => {
      const id =
        (params["agent_id"] as string | undefined) ??
        (params["surface_id"] as string | undefined);
      if (!id) throw new Error("agent_id or surface_id required");
      if (!piAgentManager?.isAgentSurface(id)) {
        throw new Error(`no agent with id ${id}`);
      }
      piAgentManager.removeAgent(id);
      dispatch("agentSurfaceClosed", { surfaceId: id });
      return "OK";
    },
  };
}
