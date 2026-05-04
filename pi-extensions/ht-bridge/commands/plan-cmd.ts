/**
 * `/ht-plan` slash command — manual driver for the τ-mux plan panel
 * from inside pi's interactive prompt.
 *
 * Usage:
 *   /ht-plan show              → ctx.ui.notify with current plan rows.
 *   /ht-plan set <json-array>  → push a fresh plan via plan.set RPC.
 *   /ht-plan clear             → drop the plan for this agent.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

export function registerPlanCommand(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  pi.registerCommand("ht-plan", {
    description: "τ-mux plan panel: /ht-plan show | set <json-steps> | clear",
    handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
      const args = rawArgs.trim();
      if (!args || args === "show") {
        try {
          const plans = await ht.call<any>("plan.list", {
            agent_id: surface.agentId,
          });
          const list = Array.isArray(plans) ? plans : (plans?.plans ?? []);
          if (list.length === 0) {
            ctx.ui.notify("No plan published for this agent.", "info");
            return;
          }
          const formatted = list
            .map((p: any) => {
              const steps = Array.isArray(p.steps) ? p.steps : [];
              const summary = steps
                .map(
                  (s: any) =>
                    `  ${stateGlyph(s.state)} ${s.id ?? "?"} · ${s.title ?? ""}`,
                )
                .join("\n");
              return `${p.workspaceId ?? ""} ${p.agentId ?? ""}\n${summary}`;
            })
            .join("\n\n");
          ctx.ui.notify(formatted, "info");
        } catch (err) {
          ctx.ui.notify(
            `/ht-plan show failed: ${(err as Error).message}`,
            "error",
          );
        }
        return;
      }

      if (args === "clear") {
        try {
          await ht.call("plan.clear", {
            agent_id: surface.agentId,
            surface_id: surface.surfaceId || undefined,
          });
          ctx.ui.notify("Plan cleared.", "info");
        } catch (err) {
          ctx.ui.notify(
            `/ht-plan clear failed: ${(err as Error).message}`,
            "error",
          );
        }
        return;
      }

      if (args.startsWith("set ")) {
        const json = args.slice(4).trim();
        let steps: unknown;
        try {
          steps = JSON.parse(json);
        } catch (e) {
          ctx.ui.notify(
            `/ht-plan set: invalid JSON — ${(e as Error).message}`,
            "error",
          );
          return;
        }
        if (!Array.isArray(steps)) {
          ctx.ui.notify("/ht-plan set: payload must be a JSON array.", "error");
          return;
        }
        try {
          await ht.call("plan.set", {
            agent_id: surface.agentId,
            surface_id: surface.surfaceId || undefined,
            steps,
          });
          ctx.ui.notify(`Plan set — ${steps.length} step(s).`, "info");
        } catch (err) {
          ctx.ui.notify(
            `/ht-plan set failed: ${(err as Error).message}`,
            "error",
          );
        }
        return;
      }

      ctx.ui.notify(
        "Usage: /ht-plan show | set <json-array> | clear",
        "warning",
      );
    },
  });
}

function stateGlyph(state: unknown): string {
  switch (state) {
    case "done":
      return "✓";
    case "active":
      return "●";
    case "err":
      return "✗";
    default:
      return "○";
  }
}
