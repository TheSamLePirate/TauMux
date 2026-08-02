import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";
import type { ClaudeAgentSessionWire } from "../../shared/types";

type Keys =
  | "claudeAgentCreate"
  | "claudeAgentPrompt"
  | "claudeAgentInterrupt"
  | "claudeAgentSetModel"
  | "claudeAgentSetMode"
  | "claudeAgentListSessions"
  | "claudeAgentNewSession"
  | "claudeAgentClose"
  | "claudeApprove";

/** Native Claude Code pane (august-plan M3 / WS5) — webview ↔ bun
 *  bridge over the ClaudeAgentManager. Event flow back to the pane is
 *  wired at agent-creation time in `createClaudeWorkspaceSurface`
 *  (bun/index.ts): every SDKMessage → `claudeAgentEvent`, stream end →
 *  `claudeAgentExit`. */
export function registerClaudeWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  const mgr = () => ctx.claudeAgentManager;
  return {
    claudeAgentCreate: (payload) => {
      ctx.createClaudeWorkspaceSurface(payload);
    },
    claudeAgentPrompt: (payload) => {
      mgr().get(payload.surfaceId)?.prompt(payload.text);
    },
    claudeAgentInterrupt: (payload) => {
      void mgr().get(payload.surfaceId)?.interrupt();
    },
    claudeAgentSetModel: (payload) => {
      void mgr().get(payload.surfaceId)?.setModel(payload.model);
    },
    claudeAgentSetMode: (payload) => {
      void mgr().get(payload.surfaceId)?.setPermissionMode(payload.mode);
    },
    claudeAgentListSessions: (payload) => {
      void (async () => {
        let sessions: ClaudeAgentSessionWire[] = [];
        try {
          sessions = await ctx.listClaudeSessions(payload.cwd);
        } catch {
          /* SDK missing / no sessions dir — empty list is a fine answer */
        }
        ctx.rpc.send("claudeAgentSessions", { sessions });
      })();
    },
    claudeAgentNewSession: (payload) => {
      void ctx.claudeNewSession(payload.surfaceId, {
        resume: payload.resume,
        fork: payload.fork,
      });
    },
    claudeAgentClose: (payload) => {
      void mgr().close(payload.surfaceId);
    },
    claudeApprove: (payload) => {
      ctx.claudeApprove(payload.surfaceId);
    },
  };
}
