/**
 * On `session_start { reason: "resume" | "fork" }`, replay the most-
 * recent published `ht_plan_set` tool result back into τ-mux's plan panel so
 * the user can continue from where they left off — useful after a
 * τ-mux restart, or when pi opens the same session in a new pane.
 *
 * Declined / discussion-only proposals are ignored. No-op for
 * "startup" / "new" / "reload" — those don't carry plan state forward.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import { debugEnabled } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

interface PlanStep {
  id: string;
  title: string;
  state?: string;
}

/** Walk the session entries newest-to-oldest, return the steps from
 *  the latest published `ht_plan_set` toolResult, or null if none found. */
export function findLastPlanSet(entries: any[]): PlanStep[] | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type !== "message") continue;
    const msg = e.message;
    if (msg?.role !== "toolResult") continue;
    if (msg.toolName !== "ht_plan_set") continue;
    const details = msg.details ?? {};
    if (details.published === false) continue;
    const approval = details.approval?.action;
    if (approval === "decline" || approval === "discuss") continue;
    const steps = details.steps;
    if (Array.isArray(steps) && steps.length > 0) return steps as PlanStep[];
  }
  return null;
}

export function registerResumeRestoration(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  pi.on("session_start", (event: any, ctx: ExtensionContext) => {
    const reason = event?.reason;
    if (reason !== "resume" && reason !== "fork") return;

    try {
      const entries = ctx.sessionManager?.getEntries?.() ?? [];
      const steps = findLastPlanSet(entries as any[]);
      if (!steps) return;
      ht.callSoft("plan.set", {
        agent_id: surface.agentId,
        surface_id: surface.surfaceId || undefined,
        steps,
      });
    } catch (err) {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] resume restoration failed: ${(err as Error).message}`,
        );
      }
    }
  });
}
