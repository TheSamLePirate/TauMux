/**
 * `claude.*` RPC handlers — ingestion + observability for the Claude Code
 * integration (august-plan M1 / WS1).
 *
 * Producers:
 *   - `claude-integration/ht-bridge` → `ht claude event` → `claude.event`
 *   - `ht claude statusline` (tee)   → `claude.statusline`
 * Consumers:
 *   - `ht claude sessions` / doctor / tests → `claude.sessions`
 *
 * Ingestion is deliberately forgiving: malformed payloads return an error
 * string instead of throwing, because the producers are fire-and-forget
 * hooks that will never read the response — a throw would only pollute
 * the socket audit log.
 */

import type {
  ClaudeBridgeEvent,
  ClaudeStatuslineData,
} from "../../shared/claude-types";
import type { ClaudeSessionRegistry } from "../claude-session-registry";
import type { Handler, HandlerDeps } from "./types";

export function registerClaude(
  _deps: HandlerDeps,
  registry: ClaudeSessionRegistry,
): Record<string, Handler> {
  return {
    "claude.event": (params) => {
      const ev = params["event"];
      if (!ev || typeof ev !== "object") return "ERR: missing event";
      const applied = registry.applyEvent(ev as ClaudeBridgeEvent);
      return applied ? "OK" : "ERR: invalid event";
    },

    "claude.statusline": (params) => {
      const data = params["data"];
      if (!data || typeof data !== "object") return "ERR: missing data";
      const applied = registry.applyStatusline(data as ClaudeStatuslineData);
      return applied ? "OK" : "ERR: invalid data";
    },

    "claude.sessions": (params) => {
      const all = params["all"] === true;
      return {
        sessions: all ? registry.listAll() : registry.list(),
      };
    },
  };
}
