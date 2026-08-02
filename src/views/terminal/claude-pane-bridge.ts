/**
 * claude-pane-bridge.ts — window event-bus → Electrobun RPC bridges for
 * the native Claude Code pane (august-plan M3 / WS5). Kept out of
 * views/terminal/index.ts (module-size ratchet: wiring lines only).
 */

interface ClaudeBridgeRpc {
  send(
    message: "claudeAgentCreate",
    payload: {
      cwd?: string;
      model?: string;
      resume?: string;
      fork?: boolean;
      split?: boolean;
      direction?: "right" | "down" | "left" | "up";
    },
  ): void;
  send(
    message: "claudeAgentPrompt",
    payload: { surfaceId: string; text: string },
  ): void;
  send(message: "claudeAgentInterrupt", payload: { surfaceId: string }): void;
  send(
    message: "claudeAgentSetMode",
    payload: { surfaceId: string; mode: string },
  ): void;
  send(message: "claudeAgentListSessions", payload: { cwd?: string }): void;
  send(message: "claudeAgentClose", payload: { surfaceId: string }): void;
}

export function wireClaudePaneBridge(rpc: ClaudeBridgeRpc): void {
  window.addEventListener("ht-claude-agent-create", (e: Event) => {
    const d = (e as CustomEvent).detail as
      | {
          cwd?: string;
          model?: string;
          resume?: string;
          fork?: boolean;
          split?: boolean;
          direction?: "right" | "down" | "left" | "up";
        }
      | undefined;
    rpc.send("claudeAgentCreate", { ...(d ?? {}) });
  });
  window.addEventListener("ht-claude-agent-prompt", (e: Event) => {
    const d = (e as CustomEvent).detail as
      { surfaceId?: string; text?: string } | undefined;
    if (!d?.surfaceId || !d.text) return;
    rpc.send("claudeAgentPrompt", { surfaceId: d.surfaceId, text: d.text });
  });
  window.addEventListener("ht-claude-agent-interrupt", (e: Event) => {
    const d = (e as CustomEvent).detail as { surfaceId?: string } | undefined;
    if (d?.surfaceId) {
      rpc.send("claudeAgentInterrupt", { surfaceId: d.surfaceId });
    }
  });
  window.addEventListener("ht-claude-agent-set-mode", (e: Event) => {
    const d = (e as CustomEvent).detail as
      { surfaceId?: string; mode?: string } | undefined;
    if (!d?.surfaceId || !d.mode) return;
    rpc.send("claudeAgentSetMode", { surfaceId: d.surfaceId, mode: d.mode });
  });
  window.addEventListener("ht-claude-agent-list-sessions", () => {
    rpc.send("claudeAgentListSessions", {});
  });
  window.addEventListener("ht-claude-agent-close", (e: Event) => {
    const d = (e as CustomEvent).detail as { surfaceId?: string } | undefined;
    if (d?.surfaceId) rpc.send("claudeAgentClose", { surfaceId: d.surfaceId });
  });
}
