import type { Handler, HandlerDeps } from "./types";

export function registerAgent(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch } = deps;

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
  };
}
