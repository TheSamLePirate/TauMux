/**
 * Claude pane host — everything bun/index.ts would otherwise inline for
 * the native Claude Code pane (august-plan M3/WS5, pane v2 in M4): the
 * agent manager with its canUseTool → ask-user bridge, the surface
 * factory with event fan-out, in-place session swapping (new / resume,
 * with history replay), and the SDK-backed session lister. index.ts
 * keeps wiring lines only (module-size ratchet).
 */

import {
  getSessionMessages,
  listSessions as sdkListSessions,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeAgentSessionWire } from "../shared/types";
import type { AskUserQueue } from "./ask-user-queue";
import {
  ClaudeAgentManager,
  type ClaudeAgentInstance,
} from "./claude-agent-manager";

export interface ClaudePaneHostDeps {
  askUser: AskUserQueue;
  /** Late-bound webview push (`rpc.send`) — called only after the RPC
   *  bridge exists, so a thunk closing over the later const is safe. */
  send: (message: string, payload: unknown) => void;
  /** Focus bookkeeping (`app.focusedSurfaceId = id`). */
  setFocused: (surfaceId: string) => void;
  /** Split origin — the pane focused when a split is requested. */
  getFocused: () => string | null;
  /** cwd of the currently-focused pane (metadata poller) — new Claude
   *  panes inherit it so sessions start where the user is working, not
   *  wherever the app process happens to live. */
  getDefaultCwd?: () => string | undefined;
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
  /** In-place session swap for an existing pane: fresh session, or
   *  resume/fork of a previous one (history replayed to the pane). */
  newSession: (
    surfaceId: string,
    opts: { resume?: string; fork?: boolean },
  ) => Promise<void>;
  listClaudeSessions: (cwd?: string) => Promise<ClaudeAgentSessionWire[]>;
}

export function createClaudePaneHost(deps: ClaudePaneHostDeps): ClaudePaneHost {
  // canUseTool → the same ask-user modal + Telegram forward WS3 uses for
  // hook-level approvals. Timeout → null → the manager denies with a
  // "timed out" message (the SDK requires a resolution either way).
  // Synthetic `__tau_permission` events bracket the wait so the pane can
  // show an inline "waiting for approval" row next to the tool card.
  const manager = new ClaudeAgentManager({
    askUser: async ({ agentId, toolName, input }) => {
      const body = JSON.stringify(input, null, 2);
      deps.send("claudeAgentEvent", {
        surfaceId: agentId,
        event: { type: "__tau_permission", status: "pending", toolName },
      });
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
      const behavior =
        r.action === "ok" && (r.value === "allow" || r.value === "deny")
          ? r.value
          : r.action === "cancel"
            ? "deny"
            : null;
      deps.send("claudeAgentEvent", {
        surfaceId: agentId,
        event: {
          type: "__tau_permission",
          status: "resolved",
          toolName,
          behavior: behavior ?? "timeout",
        },
      });
      return behavior;
    },
  });

  function wireInstance(inst: ClaudeAgentInstance): void {
    const surfaceId = inst.id;
    inst.onEvent = (event) => {
      deps.send("claudeAgentEvent", { surfaceId, event });
    };
    inst.onExit = (error) => {
      deps.send("claudeAgentExit", { surfaceId, error });
    };
  }

  function createClaudeWorkspaceSurface(opts: ClaudePaneCreateOpts): void {
    const splitFrom = opts.split ? (deps.getFocused() ?? undefined) : undefined;
    const cwd = opts.cwd ?? deps.getDefaultCwd?.();
    const inst = manager.create({
      cwd,
      model: opts.model,
      resume: opts.resume,
      forkSession: opts.fork,
    });
    wireInstance(inst);
    deps.setFocused(inst.id);
    deps.send("claudeAgentSurfaceCreated", {
      surfaceId: inst.id,
      splitFrom,
      direction:
        opts.direction === "down" || opts.direction === "up"
          ? ("vertical" as const)
          : opts.direction
            ? ("horizontal" as const)
            : undefined,
      cwd,
    });
  }

  async function newSession(
    surfaceId: string,
    opts: { resume?: string; fork?: boolean },
  ): Promise<void> {
    const old = manager.get(surfaceId);
    const cwd = old?.config.cwd ?? deps.getDefaultCwd?.();
    const inst = await manager.replace(surfaceId, {
      cwd,
      resume: opts.resume,
      forkSession: opts.fork,
    });
    wireInstance(inst);

    // Resuming: replay the persisted transcript so the pane shows the
    // conversation so far. Main-thread messages only — subagent noise
    // would swamp the transcript.
    if (opts.resume) {
      try {
        const messages = await getSessionMessages(opts.resume);
        deps.send("claudeAgentHistory", {
          surfaceId,
          sessionId: opts.resume,
          messages: messages.filter(
            (m) => m.parent_tool_use_id === null && m.parent_agent_id === null,
          ),
        });
      } catch {
        // History is a nicety — the resumed session still has its full
        // context server-side; the pane just starts visually empty.
        deps.send("claudeAgentHistory", {
          surfaceId,
          sessionId: opts.resume,
          messages: [],
        });
      }
    }
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

  return {
    manager,
    createClaudeWorkspaceSurface,
    newSession,
    listClaudeSessions,
  };
}
