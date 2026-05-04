/**
 * `/ht-ask` slash command — manually pop a τ-mux modal from inside
 * pi. Useful when you (the human) want a structured prompt mid-
 * session that pi the agent isn't going to issue itself.
 *
 * Usage:
 *   /ht-ask <text>              → kind=text modal, returns the typed reply.
 *   /ht-ask yesno <title>       → yes/no modal.
 *   /ht-ask choice "<title>" a,b,c → choice modal with three options.
 *
 * The answer is `ctx.ui.notify`'d back into pi's UI rather than
 * delivered as a user message — this command is for the human's own
 * lookups, not steering the agent. Use the `ht_ask_user` tool when
 * pi (the agent) should receive the answer.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

export function registerAskCommand(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  pi.registerCommand("ht-ask", {
    description:
      "Pop a τ-mux modal: /ht-ask <text> | /ht-ask yesno <title> | /ht-ask choice <title> a,b,c",
    handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
      if (!surface.surfaceId) {
        ctx.ui.notify(
          "/ht-ask is only available inside a τ-mux pane.",
          "warning",
        );
        return;
      }

      const args = rawArgs.trim();
      if (!args) {
        ctx.ui.notify(
          "Usage: /ht-ask <text> | /ht-ask yesno <title> | /ht-ask choice <title> a,b,c",
          "warning",
        );
        return;
      }

      let payload: Record<string, unknown>;
      if (args.startsWith("yesno ")) {
        payload = { kind: "yesno", title: args.slice("yesno ".length).trim() };
      } else if (args.startsWith("choice ")) {
        const rest = args.slice("choice ".length).trim();
        const lastSpace = rest.lastIndexOf(" ");
        if (lastSpace < 0) {
          ctx.ui.notify(
            "Usage: /ht-ask choice <title> opt1,opt2,opt3",
            "warning",
          );
          return;
        }
        const title = rest.slice(0, lastSpace).trim();
        const choices = rest
          .slice(lastSpace + 1)
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
          .map((label) => ({ id: label, label }));
        if (choices.length < 2) {
          ctx.ui.notify("/ht-ask choice needs at least 2 options.", "warning");
          return;
        }
        payload = { kind: "choice", title, choices };
      } else {
        payload = { kind: "text", title: args };
      }

      try {
        const resp = await ht.call<{
          action: string;
          value?: string;
          reason?: string;
        }>(
          "agent.ask_user",
          {
            surface_id: surface.surfaceId,
            agent_id: surface.agentId,
            ...payload,
          },
          { timeoutMs: 0 },
        );
        if (resp.action === "ok") {
          ctx.ui.notify(`Answer: ${resp.value ?? ""}`, "info");
        } else if (resp.action === "timeout") {
          ctx.ui.notify("Modal timed out.", "warning");
        } else {
          ctx.ui.notify(
            `Modal cancelled${resp.reason ? `: ${resp.reason}` : ""}.`,
            "warning",
          );
        }
      } catch (err) {
        ctx.ui.notify(`/ht-ask failed: ${(err as Error).message}`, "error");
      }
    },
  });
}
