import type { Handler, HandlerDeps } from "./types";
import type { PlanStep } from "../../shared/types";
import type { PlanStore } from "../plan-store";
import { resolveWorkspaceId } from "./shared";

/** RPC handlers for the Plan #09 PlanStore. The store is process-
 *  local; these handlers expose its API to the socket layer (so the
 *  `ht plan` CLI can drive it) and uniformly return the freshest
 *  snapshot — the broadcast channel still pushes too, but a CLI
 *  caller doesn't have to wait for the next push to confirm the
 *  write landed. */
export function registerPlan(
  deps: HandlerDeps,
  plans: PlanStore,
): Record<string, Handler> {
  /** Plan calls accept either `workspace_id` (explicit, wins) or
   *  `surface_id` (the CLI auto-forwards `HT_SURFACE` from a τ-mux
   *  pane, so scripts running inside a pane don't need to pass any
   *  workspace flag). When neither resolves we throw — unlike the
   *  sidebar handlers, plan writes have no meaningful "active
   *  workspace" fallback. */
  function requireWorkspaceId(
    method: string,
    params: Record<string, unknown>,
  ): string {
    const id = resolveWorkspaceId(params, deps.getState().workspaces);
    if (!id) {
      throw new Error(
        `${method}: workspace_id required (or surface_id from a τ-mux pane)`,
      );
    }
    return id;
  }

  return {
    /** Replace the plan for `(workspace_id, agent_id?)`. Steps come
     *  in as a JSON array — the CLI parses the user's `--json` arg
     *  and forwards it verbatim. Returns the normalised plan. */
    "plan.set": (params) => {
      const workspaceId = requireWorkspaceId("plan.set", params);
      const agentId = optionalString(params, "agent_id");
      const stepsRaw = params["steps"];
      if (!Array.isArray(stepsRaw)) {
        throw new Error("plan.set: steps must be an array");
      }
      const steps = (stepsRaw as unknown[])
        .map((s) => coerceStep(s))
        .filter((s): s is PlanStep => s !== null);
      return plans.set({ workspaceId, agentId }, steps);
    },

    /** Patch a single step. `step_id` is required; `state` and/or
     *  `title` may change. Returns the updated plan, or `null` when
     *  the plan / step doesn't exist (caller decides whether to
     *  treat that as an error — the CLI prints a one-line warning). */
    "plan.update": (params) => {
      const workspaceId = requireWorkspaceId("plan.update", params);
      const agentId = optionalString(params, "agent_id");
      const stepId = stringOrThrow(params, "step_id");
      const patch: { title?: string; state?: PlanStep["state"] } = {};
      if (typeof params["title"] === "string") {
        patch.title = params["title"];
      }
      if (typeof params["state"] === "string") {
        // Phase 7 — share the allow-list with plan.set so the two
        // handlers can't drift. isPlanState narrows the type AND
        // surfaces the typo as an explicit throw.
        const s = params["state"];
        if (!isPlanState(s)) {
          throw new Error(
            `plan.update: invalid state "${s}" (expect ${PLAN_STATE_VALUES.join("|")})`,
          );
        }
        patch.state = s;
      }
      const updated = plans.update({ workspaceId, agentId }, stepId, patch);
      return updated ?? null;
    },

    /** Mark every step as done. Used as the "agent finished" signal —
     *  combined with `plan.clear` it gives scripts a clean
     *  finish-and-tear-down path. */
    "plan.complete": (params) => {
      const workspaceId = requireWorkspaceId("plan.complete", params);
      const agentId = optionalString(params, "agent_id");
      const completed = plans.complete({ workspaceId, agentId });
      return completed ?? null;
    },

    /** Drop a plan. Returns `{ removed: boolean }` so the CLI can
     *  print "(no plan to clear)" when nothing was registered. */
    "plan.clear": (params) => {
      const workspaceId = requireWorkspaceId("plan.clear", params);
      const agentId = optionalString(params, "agent_id");
      const removed = plans.clear({ workspaceId, agentId });
      return { removed };
    },

    /** Snapshot every active plan in registration order. Cheap —
     *  no shell-out, no async work. */
    "plan.list": () => ({ plans: plans.list() }),
  };
}

function stringOrThrow(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`plan: missing required string param "${key}"`);
  }
  return v;
}

function optionalString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Allow-list of valid PlanStep.state values. Kept in sync with the
 *  `PlanStep["state"]` literal-string union in `src/shared/types.ts`.
 *  Phase 7 — a single source of truth so the validator below and
 *  any future plan.* handler use the same set. */
const PLAN_STATE_VALUES = ["done", "active", "waiting", "err"] as const;
type PlanState = (typeof PLAN_STATE_VALUES)[number];

function isPlanState(s: unknown): s is PlanState {
  return (
    typeof s === "string" &&
    (PLAN_STATE_VALUES as readonly string[]).includes(s)
  );
}

/** Best-effort coercion of an arbitrary JSON value into a `PlanStep`.
 *  Returns null when the input doesn't look like a step at all so
 *  the caller can drop it.
 *
 *  Phase 7 — validate `state` UP FRONT. Previously the function
 *  silently normalised any unknown string to "waiting", which hid
 *  typos like `state: "complete"` (a common mistake). Missing
 *  state still defaults to "waiting"; a present-but-wrong state
 *  throws so the CLI surfaces the typo. */
function coerceStep(raw: unknown): PlanStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r["id"];
  if (typeof id !== "string" || id.length === 0) return null;
  const title = typeof r["title"] === "string" ? (r["title"] as string) : id;
  let state: PlanState = "waiting";
  if (r["state"] !== undefined && r["state"] !== null) {
    if (!isPlanState(r["state"])) {
      throw new Error(
        `plan.set: step "${id}" has invalid state ${JSON.stringify(r["state"])} ` +
          `(expect ${PLAN_STATE_VALUES.join("|")})`,
      );
    }
    state = r["state"];
  }
  return { id, title, state };
}
