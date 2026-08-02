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
import { ClaudePlanMirror } from "./claude-plan-mirror";
import { ClaudeSessionRegistry } from "./claude-session-registry";
import { ClaudeStatusPresenter } from "./claude-status-presenter";
import type { PlanStore } from "./plan-store";

export interface ClaudeIntegration {
  registry: ClaudeSessionRegistry;
  attach(
    callRpc: (
      method: string,
      params: Record<string, unknown>,
    ) => unknown | Promise<unknown>,
    plans?: PlanStore,
    getState?: () => AppState,
  ): void;
}

export function createClaudeIntegration(): ClaudeIntegration {
  const registry = new ClaudeSessionRegistry();
  return {
    registry,
    attach(callRpc, plans, getState) {
      new ClaudeStatusPresenter({ callRpc }).attach(registry);
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
