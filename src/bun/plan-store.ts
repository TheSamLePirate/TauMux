/**
 * Plan store (Plan #09 commit A).
 *
 * Holds the active multi-step plan for each `(workspaceId, agentId)`
 * pair. Agents publish a plan via `ht plan set …`; the store keeps
 * an in-memory copy and emits change events so the webview / web
 * mirror can render it without polling. Wholly process-local — no
 * persistence; a restart blanks every plan.
 *
 * Why a store at all (and not just per-status-key state):
 *   - Plan #02's `plan_array` smart-key works for ad-hoc one-off
 *     checklists, but it's stringly-typed (JSON in a status value).
 *   - The auto-continue heuristic (Plan #09 §B) needs to inspect the
 *     plan's step states programmatically without re-parsing the
 *     status grid every time.
 *   - Multiple agents can share one workspace; keying by agent id
 *     means each plan has its own row even when they coexist.
 *
 * The store is intentionally small: set, update one step, mark
 * complete, clear, list. Mutations beyond that are the agent's
 * problem — we don't ship "insert step at position N" or similar
 * because no realistic agent flow requires it.
 */

import type { Plan, PlanStep, PlanStepState } from "../shared/types";

export type { Plan, PlanStep, PlanStepState };

/** Composite key — a workspace can host more than one agent and
 *  each agent's plan lives independently. `agentId` is optional so
 *  workspace-level plans (single-agent workspaces, or scripts that
 *  don't bother with attribution) get a clean wire too. */
export interface PlanKey {
  workspaceId: string;
  agentId?: string;
}

function keyOf(k: PlanKey): string {
  return k.agentId ? `${k.workspaceId}|${k.agentId}` : k.workspaceId;
}

export class PlanStore {
  private plans = new Map<string, Plan>();
  private subscribers = new Set<(plans: Plan[]) => void>();
  private now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Replace the plan for a `(workspaceId, agentId)` pair. The new
   *  plan is normalised — every step gets a defined `state`, ids
   *  are deduplicated (later wins), and trailing whitespace in
   *  titles is trimmed. */
  set(key: PlanKey, steps: PlanStep[]): Plan {
    const previous = this.plans.get(keyOf(key));
    const plan: Plan = {
      workspaceId: key.workspaceId,
      agentId: key.agentId,
      steps: normalizeSteps(steps, previous?.steps, this.now()),
      updatedAt: this.now(),
    };
    this.plans.set(keyOf(key), plan);
    this.notify();
    return plan;
  }

  /** Mutate a single step. Returns `null` when the plan or step
   *  doesn't exist (rather than throwing — a script firing
   *  `ht plan update` against a stale plan shouldn't crash the
   *  app). */
  update(
    key: PlanKey,
    stepId: string,
    patch: Partial<Pick<PlanStep, "title" | "state">>,
  ): Plan | null {
    const plan = this.plans.get(keyOf(key));
    if (!plan) return null;
    const idx = plan.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return null;
    const step = plan.steps[idx]!;
    const next: PlanStep = stampStep(
      step,
      {
        // Spread first so fields this patch doesn't address survive —
        // notably `description`, which an `ht plan update --state done`
        // used to silently delete out from under the panel's detail row.
        ...step,
        title: patch.title !== undefined ? patch.title.trim() : step.title,
        state: patch.state ?? step.state,
      },
      this.now(),
    );
    const nextPlan: Plan = {
      ...plan,
      steps: plan.steps.with(idx, next),
      updatedAt: this.now(),
    };
    this.plans.set(keyOf(key), nextPlan);
    this.notify();
    return nextPlan;
  }

  /** Mark every step as `done` and stamp `updatedAt`. Returns the
   *  plan; null when no plan was registered for the key. */
  complete(key: PlanKey): Plan | null {
    const plan = this.plans.get(keyOf(key));
    if (!plan) return null;
    const now = this.now();
    const next: Plan = {
      ...plan,
      steps: plan.steps.map((s) =>
        stampStep(s, { ...s, state: "done" as const }, now),
      ),
      updatedAt: now,
    };
    this.plans.set(keyOf(key), next);
    this.notify();
    return next;
  }

  /** Drop the plan. Idempotent. Returns whether a plan was actually
   *  removed (cheap signal for the CLI / RPC to print "ok" vs
   *  "nothing to clear"). */
  clear(key: PlanKey): boolean {
    const had = this.plans.delete(keyOf(key));
    if (had) this.notify();
    return had;
  }

  /** Read a single plan by key. */
  get(key: PlanKey): Plan | null {
    return this.plans.get(keyOf(key)) ?? null;
  }

  /** Snapshot every plan in registration order. The wire shape used
   *  by `plan.list` and the `restorePlans` push channel. */
  list(): Plan[] {
    return [...this.plans.values()];
  }

  /** Subscribe to change events. The callback receives the full
   *  snapshot on every set / update / complete / clear; a non-fatal
   *  throw from the subscriber is swallowed so a buggy consumer
   *  can't poison the store. Returns an unsubscribe handle. */
  subscribe(fn: (plans: Plan[]) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const fn of this.subscribers) {
      try {
        fn(snapshot);
      } catch {
        /* don't let a buggy subscriber take down the store */
      }
    }
  }
}

function normalizeSteps(
  steps: PlanStep[],
  previous: readonly PlanStep[] | undefined,
  now: number,
): PlanStep[] {
  const before = new Map((previous ?? []).map((s) => [s.id, s]));
  const seen = new Map<string, PlanStep>();
  for (const raw of steps) {
    if (!raw || typeof raw.id !== "string" || raw.id.length === 0) continue;
    const state = isStepState(raw.state) ? raw.state : "waiting";
    const next: PlanStep = {
      id: raw.id,
      title: typeof raw.title === "string" ? raw.title.trim() : raw.id,
      state,
      ...(typeof raw.description === "string" && raw.description.trim()
        ? { description: raw.description.trim() }
        : {}),
      // A publisher that knows better wins — Claude's task list carries
      // real `createdAt` / `completedAt` and those beat our clock.
      ...(typeof raw.startedAt === "number" ? { startedAt: raw.startedAt } : {}),
      ...(typeof raw.endedAt === "number" ? { endedAt: raw.endedAt } : {}),
    };
    seen.set(raw.id, stampStep(before.get(raw.id), next, now));
  }
  return [...seen.values()];
}

/**
 * Carry a step's timestamps across a change.
 *
 * The rules, and why each one:
 *
 *  - **`waiting` clears both.** A step reset to waiting has no history
 *    left to claim, and a `startedAt` on something that has not started
 *    would put a bar on CHRONO's axis for work nobody did.
 *  - **`active` keeps or assigns `startedAt`, clears `endedAt`.**
 *    Re-opening a finished step means it is running again.
 *  - **`done` / `err` keep or assign both.** A step that jumped straight
 *    from waiting to done still happened at a moment; giving it the same
 *    start and end draws a tick rather than a lie about duration.
 *  - **Existing stamps always win.** `ht plan set` re-publishes the whole
 *    list on every change, so re-deriving would reset a plan's entire
 *    history each time an agent ticked one box.
 */
export function stampStep(
  previous: PlanStep | undefined,
  next: PlanStep,
  now: number,
): PlanStep {
  if (next.state === "waiting") {
    const { startedAt: _s, endedAt: _e, ...rest } = next;
    return rest;
  }
  const startedAt = next.startedAt ?? previous?.startedAt ?? now;
  if (next.state === "active") {
    const { endedAt: _e, ...rest } = next;
    return { ...rest, startedAt };
  }
  return {
    ...next,
    startedAt,
    endedAt: next.endedAt ?? previous?.endedAt ?? now,
  };
}

function isStepState(s: unknown): s is PlanStepState {
  return s === "done" || s === "active" || s === "waiting" || s === "err";
}
