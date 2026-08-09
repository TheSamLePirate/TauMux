/**
 * Webview mirror of the bun `PlanStore`.
 *
 * Fed by the `restorePlans` push. `PlanPanel` keeps its own copy for the
 * sidebar; this store exists so views that are *not* the sidebar can read
 * plans too — specifically the Atlas graph, which hides the sidebar and
 * would otherwise make every agent plan invisible the moment you pick
 * that layout.
 *
 * Same shape as `claude-session-store`: a snapshot, one index, and a
 * subscribe hook. No reducers — consumers shape it themselves.
 */
import type { Plan } from "../../shared/types";

type Listener = (plans: readonly Plan[]) => void;

let plans: readonly Plan[] = [];
let byWorkspace = new Map<string, Plan[]>();
const listeners = new Set<Listener>();

export function setPlans(next: readonly Plan[]): void {
  plans = next;
  const index = new Map<string, Plan[]>();
  for (const plan of next) {
    const list = index.get(plan.workspaceId);
    if (list) list.push(plan);
    else index.set(plan.workspaceId, [plan]);
  }
  byWorkspace = index;
  for (const fn of listeners) {
    try {
      fn(plans);
    } catch (err) {
      console.error("[plan-store] listener failed", err);
    }
  }
}

export function getPlans(): readonly Plan[] {
  return plans;
}

/** Plans belonging to `workspaceId`, most-recently-updated first. */
export function plansForWorkspace(workspaceId: string): Plan[] {
  const list = byWorkspace.get(workspaceId);
  if (!list) return [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function subscribePlans(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam. */
export function resetPlans(): void {
  plans = [];
  byWorkspace = new Map();
  listeners.clear();
}
