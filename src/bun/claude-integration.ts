/**
 * Claude Code integration assembly (august-plan M1+M2).
 *
 * One-call construction for the pieces `bun/index.ts` wires together —
 * kept out of index.ts on purpose (module-size ratchet: new code goes in
 * new modules; index.ts gets wiring lines only).
 *
 * Lifecycle: `createClaudeIntegration()` before `createRpcHandler` (the
 * `claude.*` handlers need the registry), then `attach(...)` after,
 * because the presenter renders by calling back through the local
 * dispatcher (`sidebar.set_status` / `notification.create`) — reusing
 * workspace resolution, persistence, sounds, and web-mirror fan-out.
 * `attach` also mounts the plan mirror (WS4) when a PlanStore is given.
 */

import type { AppState } from "./rpc-handlers/types";
import { ClaudeAutoApprove } from "./claude-auto-approve";
import { ClaudePlanMirror } from "./claude-plan-mirror";
import { ClaudeSessionRegistry } from "./claude-session-registry";
import {
  createDebouncedPersister,
  loadInto,
} from "./claude-registry-persistence";
import { ClaudeStatusPresenter } from "./claude-status-presenter";
import { ClaudeTeamWatcher } from "./claude-team-watcher";
import { attachClaudeSessionMirror } from "./claude-session-mirror";
import type { ClaudeSessionState } from "../shared/claude-types";
import type { PlanStore } from "./plan-store";

export interface ClaudeIntegration {
  registry: ClaudeSessionRegistry;
  /** Permission auto-approve engine — also the manual `approveNow`
   *  entry point behind `claude.approve` / the command palette. */
  autoApprove: ClaudeAutoApprove;
  attach(
    callRpc: (
      method: string,
      params: Record<string, unknown>,
    ) => unknown | Promise<unknown>,
    plans?: PlanStore,
    getState?: () => AppState,
    settings?: {
      autoApprove: () => boolean;
      autoApproveDelayMs: () => number;
      /** Push structured session state to the webview. Given, the
       *  registry is mirrored through `attachClaudeSessionMirror`. */
      mirrorSessions?: (sessions: ClaudeSessionState[]) => void;
    },
  ): void;
}

export function createClaudeIntegration(
  /** When given, the registry is seeded from this file on boot and
   *  re-written (debounced) on every change, so an app restart does not
   *  lose a live session's mirrored task list. */
  persistencePath?: string,
): ClaudeIntegration {
  const registry = new ClaudeSessionRegistry();
  if (persistencePath) {
    loadInto(persistencePath, registry);
    const persist = createDebouncedPersister(persistencePath, registry);
    registry.onChange(() => persist());
  }
  // Constructed eagerly (never auto-fires until `attach` supplies the
  // settings readers) so `claude.approve` can be wired before attach.
  let autoApprove!: ClaudeAutoApprove;
  return {
    registry,
    get autoApprove() {
      return autoApprove;
    },
    attach(callRpc, plans, getState, settings) {
      autoApprove = new ClaudeAutoApprove({
        callRpc,
        isEnabled: settings?.autoApprove ?? (() => false),
        delayMs: settings?.autoApproveDelayMs ?? (() => 700),
      });
      autoApprove.attach(registry);
      new ClaudeStatusPresenter({ callRpc }).attach(registry);
      // M4 / WS6 — passive agent-teams pill. Reads ~/.claude/teams on a
      // slow poll; silent (one stat per tick) when the experimental
      // feature is unused.
      new ClaudeTeamWatcher({ callRpc }).start();
      if (settings?.mirrorSessions) {
        attachClaudeSessionMirror({ registry, send: settings.mirrorSessions });
      }
      if (plans && getState) {
        new ClaudePlanMirror({
          plans,
          resolveWorkspaceId: (surfaceId) =>
            getState().workspaces.find((w) => w.surfaceIds.includes(surfaceId))
              ?.id ?? null,
        }).attach(registry);
      }
    },
  };
}
