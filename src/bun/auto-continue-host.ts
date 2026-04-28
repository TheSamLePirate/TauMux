/**
 * Auto-continue host helpers (Plan #09 commit C).
 *
 * Plan #09 commit B placed `lookupPlanForSurface`, `lookupSurfaceTail`,
 * and `dispatchAutoContinueForNotification` as locals inside the bun
 * bootstrap. Commit C exposes a manual `ht autocontinue fire <surface>`
 * RPC that needs the same lookup pipeline. Lifting the helpers here
 * keeps a single source of truth for "what does the engine see for
 * surface X" and lets the RPC handler stay decoupled from session /
 * workspace internals.
 *
 * Behavior is unchanged from commit B — this is a refactor.
 */

import type { AutoContinueEngine } from "./auto-continue-engine";
import type { PlanStore } from "./plan-store";
import type { Plan } from "../shared/types";

export interface AutoContinueHostDeps {
  engine: AutoContinueEngine;
  plans: PlanStore;
  /** Walk all workspaces and return the one that owns the surface. */
  getWorkspaceForSurface: (surfaceId: string) => { id: string } | null;
  /** PTY output buffer for the surface. May return `""` when unknown. */
  getOutputHistory: (surfaceId: string) => string | null | undefined;
}

export interface AutoContinueHost {
  /** Pick the plan to consult for a notification on `surfaceId` —
   *  most-recently-updated plan in the owning workspace, or null. */
  lookupPlanForSurface: (surfaceId: string) => Plan | null;
  /** Return the last 12 ANSI-stripped lines from the surface, capped
   *  at 3 KiB of trailing buffer. The heuristic and the LLM prompt
   *  both consume this. */
  lookupSurfaceTail: (surfaceId: string) => string[];
  /** Engine dispatch driven by a `notification.create` event. */
  dispatchForNotification: (notification: {
    surfaceId?: string;
    title: string;
    body: string;
  }) => void;
  /** Manual fire — used by `autocontinue.fire` RPC and `ht
   *  autocontinue fire <surface>`. Returns the engine outcome so the
   *  CLI can display it. */
  fireNow: (surfaceId: string, notificationText?: string) => Promise<unknown>;
}

const SURFACE_TAIL_BYTE_CAP = 3072;
const SURFACE_TAIL_LINE_CAP = 12;

export function createAutoContinueHost(
  deps: AutoContinueHostDeps,
): AutoContinueHost {
  function lookupPlanForSurface(surfaceId: string): Plan | null {
    const owning = deps.getWorkspaceForSurface(surfaceId);
    if (!owning) return null;
    const candidates = deps.plans
      .list()
      .filter((p) => p.workspaceId === owning.id)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return candidates[0] ?? null;
  }

  function lookupSurfaceTail(surfaceId: string): string[] {
    let history: string;
    try {
      history = deps.getOutputHistory(surfaceId) ?? "";
    } catch {
      return [];
    }
    if (!history) return [];
    const slice =
      history.length > SURFACE_TAIL_BYTE_CAP
        ? history.slice(-SURFACE_TAIL_BYTE_CAP)
        : history;
    return slice
      .split(/\r?\n/)
      .map((line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""))
      .slice(-SURFACE_TAIL_LINE_CAP);
  }

  function dispatchForNotification(notification: {
    surfaceId?: string;
    title: string;
    body: string;
  }): void {
    const surfaceId = notification.surfaceId;
    if (!surfaceId) return;
    const plan = lookupPlanForSurface(surfaceId);
    const surfaceTail = lookupSurfaceTail(surfaceId);
    const notificationText = [notification.title, notification.body]
      .filter((t) => t && t.length > 0)
      .join(" — ");
    void deps.engine
      .dispatch({
        surfaceId,
        agentId: plan?.agentId,
        plan,
        surfaceTail,
        notificationText,
      })
      .catch((err) => {
        console.warn(
          `[auto-continue] dispatch failed for ${surfaceId}: ${(err as Error).message}`,
        );
      });
  }

  async function fireNow(
    surfaceId: string,
    notificationText = "manual fire via ht autocontinue",
  ): Promise<unknown> {
    const plan = lookupPlanForSurface(surfaceId);
    const surfaceTail = lookupSurfaceTail(surfaceId);
    return deps.engine.dispatch({
      surfaceId,
      agentId: plan?.agentId,
      plan,
      surfaceTail,
      notificationText,
    });
  }

  return {
    lookupPlanForSurface,
    lookupSurfaceTail,
    dispatchForNotification,
    fireNow,
  };
}
