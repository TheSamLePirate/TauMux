/**
 * Status-key → PlanStore bridge (Plan #09 commit C).
 *
 * Plan #02 ships a smart `array` status-key renderer; agents that
 * emit checklists via `ht set-status` get a sidebar widget for free.
 * Plan #09 commit A ships a typed `PlanStore` with a richer panel
 * (active step animation, audit ring, click-to-focus). Until commit
 * C, the two channels were unrelated — agents had to choose one.
 *
 * The bridge translates plan-shaped status updates into
 * `PlanStore.set` calls so any agent emitting `ht set-status
 * <plan-key> '<json-array-of-steps>'` lights up the typed plan panel
 * without changing its publishing code.
 *
 * The match is intentionally narrow:
 *
 *   1. Key name contains "plan" (case-insensitive).
 *   2. Value is a JSON string parsing to an array of objects with at
 *      least { id, title } and an optional state.
 *
 * Anything outside that contract passes through silently — the
 * regular smart-key renderer still handles it.
 */

import type { PlanStore } from "./plan-store";
import type { PlanStep, PlanStepState } from "../shared/types";

export interface SetStatusPayload {
  workspaceId?: string;
  surfaceId?: string;
  key?: unknown;
  value?: unknown;
}

export interface PlanStatusBridgeDeps {
  plans: PlanStore;
}

export interface PlanStatusBridge {
  /** Inspect a setStatus payload. Returns true when the bridge
   *  consumed the update (and wrote to PlanStore); false otherwise.
   *  The caller (the sidebar dispatcher) does not need to branch —
   *  it can keep emitting the regular sidebar action either way. */
  handle: (payload: SetStatusPayload) => boolean;
}

export function createPlanStatusBridge(
  deps: PlanStatusBridgeDeps,
): PlanStatusBridge {
  return {
    handle(payload) {
      const key = payload.key;
      if (typeof key !== "string" || !key.toLowerCase().includes("plan")) {
        return false;
      }
      const workspaceId = payload.workspaceId;
      if (!workspaceId) return false;
      const steps = parsePlanValue(payload.value);
      if (!steps) return false;
      const agentId = payload.surfaceId
        ? `status:${payload.surfaceId}`
        : `status:${key}`;
      deps.plans.set({ workspaceId, agentId }, steps);
      return true;
    },
  };
}

/** Pure: try to coerce a status `value` into a `PlanStep[]`. Returns
 *  null when the input doesn't look plan-shaped. Exported for tests. */
export function parsePlanValue(raw: unknown): PlanStep[] | null {
  // Status values typically arrive as strings — `ht set-status` sends
  // them through the socket as text. Tolerate both raw arrays (when
  // a programmatic caller passes one directly) and JSON strings.
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("[")) return null;
    try {
      arr = JSON.parse(trimmed);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out: PlanStep[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    const id = r["id"];
    if (typeof id !== "string" || id.length === 0) return null;
    const title = typeof r["title"] === "string" ? (r["title"] as string) : id;
    const stateRaw = r["state"];
    const state: PlanStepState =
      stateRaw === "done" ||
      stateRaw === "active" ||
      stateRaw === "err" ||
      stateRaw === "waiting"
        ? stateRaw
        : "waiting";
    out.push({ id, title, state });
  }
  return out;
}
