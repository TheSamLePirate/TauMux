/**
 * Claude pane host — everything bun/index.ts would otherwise inline for
 * the native Claude Code pane (august-plan M3 / WS5): the agent manager
 * with its canUseTool → ask-user bridge, the surface factory with event
 * fan-out, and the SDK-backed session lister. index.ts keeps wiring
 * lines only (module-size ratchet).
 */

import { listSessions as sdkListSessions } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeAgentSessionWire } from "../shared/types";
import type { AskUserQueue } from "./ask-user-queue";
import { ClaudeAgentManager } from "./claude-agent-manager";

export interface ClaudePaneHostDeps {
  askUser: AskUserQueue;
  /** Late-bound webview push (`rpc.send`) — called only after the RPC
   *  bridge exists, so a thunk closing over the later const is safe. */
  send: (message: string, payload: unknown) => void;
  /** Focus bookkeeping (`app.focusedSurfaceId = id`). */
  setFocused: (surfaceId: string) => void;
  /** Split origin — the pane focused when a split is requested. */
  getFocused: () => string | null;
}

export interface ClaudePaneCreateOpts {
  cwd?: string;
  model?: string;
  resume?: string;
  fork?: boolean;
  split?: boolean;
  direction?: "right" | "down" | "left" | "up";
}

export interface ClaudePaneHost {
  manager: ClaudeAgentManager;
  createClaudeWorkspaceSurface: (opts: ClaudePaneCreateOpts) => void;
  listClaudeSessions: (cwd?: string) => Promise<ClaudeAgentSessionWire[]>;
}

export function createClaudePaneHost(deps: ClaudePaneHostDeps): ClaudePaneHost {
  // canUseTool → the same ask-user modal + Telegram forward WS3 uses for
  // hook-level approvals. Timeout → null → the manager denies with a
  // "timed out" message (the SDK requires a resolution either way).
  const manager = new ClaudeAgentManager({
    askUser: async ({ agentId, toolName, input }) => {
      const body = JSON.stringify(input, null, 2);
      const { response } = deps.askUser.create({
        surface_id: agentId,
        kind: "choice",
        title: `Claude Code · ${toolName}`,
        body: body.length > 900 ? body.slice(0, 899) + "…" : body,
        choices: [
          { id: "allow", label: "Allow" },
          { id: "deny", label: "Deny" },
        ],
        timeout_ms: 570_000,
      });
      const r = await response;
      if (r.action === "ok" && (r.value === "allow" || r.value === "deny")) {
        return r.value;
      }
      return r.action === "cancel" ? "deny" : null;
    },
  });

  function createClaudeWorkspaceSurface(opts: ClaudePaneCreateOpts): void {
    const splitFrom = opts.split ? (deps.getFocused() ?? undefined) : undefined;
    const inst = manager.create({
      cwd: opts.cwd,
      model: opts.model,
      resume: opts.resume,
      forkSession: opts.fork,
    });
    const surfaceId = inst.id;
    inst.onEvent = (event) => {
      deps.send("claudeAgentEvent", { surfaceId, event });
    };
    inst.onExit = (error) => {
      deps.send("claudeAgentExit", { surfaceId, error });
    };
    deps.setFocused(surfaceId);
    deps.send("claudeAgentSurfaceCreated", {
      surfaceId,
      splitFrom,
      direction:
        opts.direction === "down" || opts.direction === "up"
          ? ("vertical" as const)
          : opts.direction
            ? ("horizontal" as const)
            : undefined,
      cwd: opts.cwd,
    });
  }

  async function listClaudeSessions(
    cwd?: string,
  ): Promise<ClaudeAgentSessionWire[]> {
    const infos = await sdkListSessions({
      ...(cwd ? { dir: cwd } : {}),
      limit: 30,
    });
    return infos.map((s) => ({
      sessionId: s.sessionId,
      summary: (s.customTitle || s.summary) ?? null,
      firstPrompt: s.firstPrompt ?? null,
      cwd: s.cwd ?? null,
      gitBranch: s.gitBranch ?? null,
      lastModified:
        new Date(s.lastModified as unknown as string).getTime() || 0,
    }));
  }

  return { manager, createClaudeWorkspaceSurface, listClaudeSessions };
}
