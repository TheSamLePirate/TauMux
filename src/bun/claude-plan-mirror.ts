/**
 * ClaudePlanMirror — Claude Code's native task list → the τ-mux plan
 * panel (august-plan M2 / WS4).
 *
 * Replaces "hope the model runs `ht plan set`" with a deterministic
 * mirror: TaskCreated / TaskCompleted hooks land in the registry (M1),
 * and this module projects each session's task list into the PlanStore
 * under `agentId: "claude:<short-session>"` — the same store the pi
 * bridge and `ht plan` publish to, so the sidebar plan panel renders it
 * with zero webview changes.
 *
 * Fidelity note (plan §WS4): creation/completion are exact (hook-driven);
 * "in progress" has no hook, so the first non-completed task is shown
 * `active` as a best-effort cue. Session end clears the mirrored plan.
 */

import type { ClaudeSessionState, ClaudeTask } from "../shared/claude-types";
import type { PlanStep } from "../shared/types";
import type { ClaudeSessionRegistry } from "./claude-session-registry";
import type { PlanStore } from "./plan-store";

/** Pure: task list → plan steps. Completed → done; the first
 *  not-completed task → active; the rest → waiting. Titles prefer the
 *  task subject, then the description's first clause, then the id —
 *  a bare numeric id is what the panel showed before the real payload
 *  field (`task_subject`) was discovered, and it read as "empty plan". */
export function tasksToSteps(tasks: ClaudeTask[]): PlanStep[] {
  let activeAssigned = false;
  return tasks.map((t) => {
    let state: PlanStep["state"];
    if (t.state === "completed") {
      state = "done";
    } else if (!activeAssigned) {
      state = "active";
      activeAssigned = true;
    } else {
      state = "waiting";
    }
    const descClause = (t.description ?? "").split(/[.!?\n]/)[0]?.trim();
    let title = t.name || descClause || `task ${t.id}`;
    if (title.length > 80) title = title.slice(0, 79).trimEnd() + "…";
    return {
      id: t.id,
      title,
      state,
      ...(t.description ? { description: t.description } : {}),
    };
  });
}

export function mirrorAgentId(sessionId: string): string {
  return `claude:${sessionId.slice(0, 8)}`;
}

export interface ClaudePlanMirrorDeps {
  plans: PlanStore;
  /** surfaceId → owning workspaceId, or null when unresolvable (the
   *  session then has no panel to mirror into and is skipped). */
  resolveWorkspaceId: (surfaceId: string) => string | null;
}

export class ClaudePlanMirror {
  private deps: ClaudePlanMirrorDeps;
  /** sessionId → last published { workspaceId, fingerprint } so no-op
   *  registry emissions (statusline tees) don't hammer the store, and a
   *  workspace move republishes cleanly. */
  private published = new Map<
    string,
    { workspaceId: string; fingerprint: string }
  >();
  private unsubscribe: (() => void) | null = null;

  constructor(deps: ClaudePlanMirrorDeps) {
    this.deps = deps;
  }

  attach(registry: ClaudeSessionRegistry): void {
    this.unsubscribe?.();
    this.unsubscribe = registry.onChange((s) => {
      this.onChange(s);
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onChange(s: ClaudeSessionState): void {
    const agentId = mirrorAgentId(s.sessionId);
    const prev = this.published.get(s.sessionId);

    if (s.ended) {
      if (prev) {
        this.deps.plans.clear({ workspaceId: prev.workspaceId, agentId });
        this.published.delete(s.sessionId);
      }
      return;
    }

    if (s.tasks.length === 0) {
      // Nothing to mirror; retract an earlier publish (task list reset).
      if (prev) {
        this.deps.plans.clear({ workspaceId: prev.workspaceId, agentId });
        this.published.delete(s.sessionId);
      }
      return;
    }

    const workspaceId = s.surfaceId
      ? this.deps.resolveWorkspaceId(s.surfaceId)
      : null;
    if (!workspaceId) return;

    const fingerprint = JSON.stringify(s.tasks);
    if (
      prev &&
      prev.workspaceId === workspaceId &&
      prev.fingerprint === fingerprint
    ) {
      return;
    }
    // Workspace moved (pane dragged / session re-attributed) — retract
    // the stale panel entry before publishing under the new key.
    if (prev && prev.workspaceId !== workspaceId) {
      this.deps.plans.clear({ workspaceId: prev.workspaceId, agentId });
    }
    this.deps.plans.set({ workspaceId, agentId }, tasksToSteps(s.tasks));
    this.published.set(s.sessionId, { workspaceId, fingerprint });
  }
}
