/**
 * Claude Code integration assembly (august-plan M1).
 *
 * One-call construction for the pieces `bun/index.ts` wires together —
 * kept out of index.ts on purpose (module-size ratchet: new code goes in
 * new modules; index.ts gets wiring lines only).
 *
 * Lifecycle: `createClaudeIntegration()` before `createRpcHandler` (the
 * `claude.*` handlers need the registry), then `attachPresenter(handler)`
 * after, because the presenter renders by calling back through the local
 * dispatcher (`sidebar.set_status` / `notification.create`) — reusing
 * workspace resolution, persistence, sounds, and web-mirror fan-out.
 */

import { ClaudeSessionRegistry } from "./claude-session-registry";
import { ClaudeStatusPresenter } from "./claude-status-presenter";

export interface ClaudeIntegration {
  registry: ClaudeSessionRegistry;
  attachPresenter(
    callRpc: (
      method: string,
      params: Record<string, unknown>,
    ) => unknown | Promise<unknown>,
    enabled?: () => boolean,
  ): ClaudeStatusPresenter;
}

export function createClaudeIntegration(): ClaudeIntegration {
  const registry = new ClaudeSessionRegistry();
  return {
    registry,
    attachPresenter(callRpc, enabled) {
      const presenter = new ClaudeStatusPresenter({ callRpc, enabled });
      presenter.attach(registry);
      return presenter;
    },
  };
}
