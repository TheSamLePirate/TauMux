/**
 * Auto-continue engine (Plan #09 commit B).
 *
 * Wraps the pure heuristic in `auto-continue.ts` with the host
 * concerns the heuristic deliberately stays out of:
 *
 *   - settings: engine mode (off / heuristic / model / hybrid),
 *     dryRun, cooldownMs, maxConsecutive, model provider details
 *   - per-surface state: last-fire timestamp, consecutive
 *     auto-continue counter, runaway-detection latch
 *   - LLM provider: thin Anthropic Messages API caller, used in
 *     `model` / `hybrid` modes; falls back to the heuristic on
 *     network / parse failure so a flaky API never blocks the user
 *   - decision audit: in-memory ring of the last 50 decisions for
 *     the user to inspect via `ht autocontinue audit`
 *
 * The engine never throws. Every public method returns a structured
 * outcome the host can log / surface; provider failures degrade
 * silently to the heuristic with a noted reason.
 */

import {
  decideAutoContinue,
  type AutoContinueDecision,
  type AutoContinueInput,
} from "./auto-continue";
import type { AutoContinueSettings } from "../shared/settings";
import type { AutoContinueAuditEntry } from "../shared/types";

export type { AutoContinueAuditEntry };

export type AutoContinueOutcome =
  | { kind: "fired"; decision: AutoContinueDecision; instruction: string }
  | { kind: "dry-run"; decision: AutoContinueDecision; instruction: string }
  | { kind: "skipped"; reason: string; decision?: AutoContinueDecision };

export interface AutoContinueEngineDeps {
  /** Read-only settings accessor — re-read on every dispatch so
   *  changes from the settings panel apply immediately. */
  getSettings: () => AutoContinueSettings;
  /** Send the agreed-upon instruction text into the surface. The
   *  engine appends a newline before the call so the host doesn't
   *  have to remember. Optional in tests. */
  sendText?: (surfaceId: string, text: string) => void;
  /** LLM caller hook — pluggable so tests can inject a stub. The
   *  default uses `callAnthropicAutoContinue` from this module. */
  callModel?: ModelCaller;
  /** Wall-clock injection for hermetic tests. */
  now?: () => number;
  /** P7 S6 — optional hook fired whenever the paused-surfaces set
   *  changes (pause / resume / resetAll). The host wires this to a
   *  debounced disk writer so the user's explicit pauses survive a
   *  restart. */
  onPausedChange?: (paused: string[]) => void;
}

export interface ModelCallerInput {
  plan: AutoContinueInput["plan"];
  surfaceTail: readonly string[];
  notificationText?: string;
  settings: AutoContinueSettings;
}

export type ModelCaller = (
  input: ModelCallerInput,
) => Promise<AutoContinueDecision | null>;

interface PerSurfaceState {
  lastFireAt: number;
  consecutive: number;
  loopWarned: boolean;
}

const AUDIT_CAP = 50;

export class AutoContinueEngine {
  private state = new Map<string, PerSurfaceState>();
  private pausedSurfaces = new Set<string>();
  private audit: AutoContinueAuditEntry[] = [];
  private now: () => number;
  private subscribers = new Set<(audit: AutoContinueAuditEntry[]) => void>();

  constructor(private deps: AutoContinueEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Reset a surface's runaway counter — call when the user types
   *  into the surface (an unprovoked human input means the auto-
   *  continue chain ended naturally). */
  notifyHumanInput(surfaceId: string): void {
    const s = this.state.get(surfaceId);
    if (!s) return;
    s.consecutive = 0;
    s.loopWarned = false;
  }

  /** Pause auto-continue for a single surface. Subsequent dispatches
   *  short-circuit with a `paused` skip until `resume` is called. */
  pause(surfaceId: string, reason = "manual pause via ht/UI"): void {
    if (this.pausedSurfaces.has(surfaceId)) return;
    this.pausedSurfaces.add(surfaceId);
    this.notifyPausedChange();
    this.pushAudit({
      at: this.now(),
      surfaceId,
      outcome: "paused",
      reason,
      engine: this.deps.getSettings().engine,
      modelConsulted: false,
    });
  }

  /** Resume a paused surface. Also resets the runaway counter so the
   *  next legitimate auto-continue can fire without colliding with a
   *  stale "looped" gate. */
  resume(surfaceId: string, reason = "manual resume via ht/UI"): void {
    if (!this.pausedSurfaces.has(surfaceId)) return;
    this.pausedSurfaces.delete(surfaceId);
    this.notifyPausedChange();
    const s = this.state.get(surfaceId);
    if (s) {
      s.consecutive = 0;
      s.loopWarned = false;
    }
    this.pushAudit({
      at: this.now(),
      surfaceId,
      outcome: "resumed",
      reason,
      engine: this.deps.getSettings().engine,
      modelConsulted: false,
    });
  }

  /** P7 S6 — hydrate the paused set from a previously-saved snapshot.
   *  Called once at boot before any dispatch can fire. Does NOT push
   *  audit entries (the user didn't just press pause) and does NOT
   *  re-broadcast through `onPausedChange` (caller already has the
   *  snapshot — would otherwise immediately echo back to disk). */
  hydratePaused(ids: readonly string[]): void {
    for (const id of ids) this.pausedSurfaces.add(id);
  }

  private notifyPausedChange(): void {
    try {
      this.deps.onPausedChange?.([...this.pausedSurfaces]);
    } catch {
      /* a buggy persister must not break pause/resume */
    }
  }

  isPaused(surfaceId: string): boolean {
    return this.pausedSurfaces.has(surfaceId);
  }

  listPaused(): string[] {
    return [...this.pausedSurfaces];
  }

  /** Drop all per-surface counters (e.g. on session reset). */
  resetAll(): void {
    this.state.clear();
    const hadPaused = this.pausedSurfaces.size > 0;
    this.pausedSurfaces.clear();
    if (hadPaused) this.notifyPausedChange();
  }

  /** Snapshot the audit ring for inspection / RPC export. */
  getAudit(): AutoContinueAuditEntry[] {
    return this.audit.slice();
  }

  subscribeAudit(fn: (audit: AutoContinueAuditEntry[]) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Decide and (when authorized) act for one turn-end event. */
  async dispatch(args: {
    surfaceId: string;
    agentId?: string;
    plan: AutoContinueInput["plan"];
    surfaceTail: readonly string[];
    notificationText?: string;
  }): Promise<AutoContinueOutcome> {
    const settings = this.deps.getSettings();
    if (settings.engine === "off") {
      return this.record(
        args,
        {
          kind: "skipped",
          reason: "engine disabled",
        },
        settings,
        false,
      );
    }

    if (this.pausedSurfaces.has(args.surfaceId)) {
      return this.record(
        args,
        {
          kind: "skipped",
          reason: "paused",
        },
        settings,
        false,
      );
    }

    // 1. Run the heuristic — the cheapest, always-on path. The
    //    `hybrid` and `model` modes consult the model only when the
    //    heuristic's reason indicates the host can't decide alone.
    const heuristic = decideAutoContinue({
      plan: args.plan,
      surfaceTail: args.surfaceTail,
      notificationText: args.notificationText,
    });

    // 2. Cheap deterministic gates run BEFORE any paid model call (H8).
    //    A chatty agent firing faster than `cooldownMs`, or a runaway
    //    surface past `maxConsecutive`, must never trigger a billed
    //    Anthropic round-trip — those are exactly the scenarios the
    //    engine exists to contain, so consulting the model first was
    //    the opposite of intent. The heuristic above is free; the model
    //    is consulted only once a notification clears both gates.
    const surfaceState = this.surfaceState(args.surfaceId);
    // The first fire on a surface has lastFireAt === 0; without this
    // guard the cooldown gate would block it because `now - 0` is
    // always ≥ cooldownMs once the clock has been running. Skip the
    // gate when we've never fired before.
    const sinceLast = this.now() - surfaceState.lastFireAt;
    if (surfaceState.lastFireAt > 0 && sinceLast < settings.cooldownMs) {
      return this.record(
        args,
        {
          kind: "skipped",
          reason: `cooldown — ${settings.cooldownMs - sinceLast}ms remaining`,
          decision: heuristic,
        },
        settings,
        false,
      );
    }

    // Runaway gate — skip after maxConsecutive auto-continues with no
    // intervening human input. `loopWarned` latches so the "paused —
    // looped" audit fires only once per loop episode instead of on
    // every subsequent notification (10.2 — previously dead state,
    // written but never read). notifyHumanInput()/resume() clear it, so
    // a real human intervention re-arms auto-continue and a fresh loop
    // re-emits the warning. Either way no model is consulted while
    // looping.
    if (surfaceState.consecutive >= settings.maxConsecutive) {
      const firstTrip = !surfaceState.loopWarned;
      surfaceState.loopWarned = true;
      const skipped: AutoContinueOutcome = {
        kind: "skipped",
        reason: `paused — agent looped (${surfaceState.consecutive} auto-continues without user input)`,
        decision: heuristic,
      };
      return firstTrip ? this.record(args, skipped, settings, false) : skipped;
    }

    // 3. Both cheap gates passed — now (and only now) consult the model.
    let decision = heuristic;
    let modelConsulted = false;

    if (settings.engine === "model") {
      const model = await this.tryModel(args, settings);
      if (model) {
        decision = model;
        modelConsulted = true;
      } else {
        decision = {
          ...heuristic,
          reason: `model unavailable; heuristic: ${heuristic.reason}`,
        };
      }
    } else if (settings.engine === "hybrid" && shouldEscalate(heuristic)) {
      const model = await this.tryModel(args, settings);
      if (model) {
        decision = model;
        modelConsulted = true;
      }
    }

    if (decision.action === "wait") {
      // Wait paths reset nothing — the runaway counter cares about
      // *fires*, not waits.
      return this.record(
        args,
        {
          kind: "skipped",
          reason: decision.reason,
          decision,
        },
        settings,
        modelConsulted,
      );
    }

    const instruction = decision.instruction
      ? `${decision.instruction.replace(/\n+$/, "")}\n`
      : "Continue\n";

    if (settings.dryRun) {
      return this.record(
        args,
        {
          kind: "dry-run",
          decision,
          instruction,
        },
        settings,
        modelConsulted,
      );
    }

    // 4. Fire.
    try {
      this.deps.sendText?.(args.surfaceId, instruction);
    } catch {
      return this.record(
        args,
        {
          kind: "skipped",
          reason: "sendText threw — host transport unavailable",
          decision,
        },
        settings,
        modelConsulted,
      );
    }
    surfaceState.lastFireAt = this.now();
    surfaceState.consecutive += 1;
    return this.record(
      args,
      {
        kind: "fired",
        decision,
        instruction,
      },
      settings,
      modelConsulted,
    );
  }

  private surfaceState(surfaceId: string): PerSurfaceState {
    let s = this.state.get(surfaceId);
    if (!s) {
      s = { lastFireAt: 0, consecutive: 0, loopWarned: false };
      this.state.set(surfaceId, s);
    }
    return s;
  }

  private async tryModel(
    args: {
      surfaceId: string;
      plan: AutoContinueInput["plan"];
      surfaceTail: readonly string[];
      notificationText?: string;
    },
    settings: AutoContinueSettings,
  ): Promise<AutoContinueDecision | null> {
    const caller = this.deps.callModel ?? callAnthropicAutoContinue;
    try {
      return await caller({
        plan: args.plan,
        surfaceTail: args.surfaceTail,
        notificationText: args.notificationText,
        settings,
      });
    } catch {
      return null;
    }
  }

  private record(
    args: { surfaceId: string; agentId?: string },
    outcome: AutoContinueOutcome,
    settings: AutoContinueSettings,
    modelConsulted: boolean,
  ): AutoContinueOutcome {
    const reason =
      outcome.kind === "skipped"
        ? outcome.reason
        : (outcome.decision.reason ?? outcome.kind);
    this.pushAudit({
      at: this.now(),
      surfaceId: args.surfaceId,
      agentId: args.agentId,
      outcome: outcome.kind,
      reason,
      engine: settings.engine,
      modelConsulted,
    });
    return outcome;
  }

  private pushAudit(entry: AutoContinueAuditEntry): void {
    this.audit.push(entry);
    while (this.audit.length > AUDIT_CAP) this.audit.shift();
    for (const fn of this.subscribers) {
      try {
        fn(this.audit.slice());
      } catch {
        /* don't let a buggy subscriber take down the engine */
      }
    }
  }
}

/** Pure: decide whether `hybrid` mode should consult the LLM. The
 *  heuristic's `wait` decisions vary in confidence — "agent asked a
 *  question" or "notification mentions an error" are clear waits;
 *  "no plan published" is exactly the case where a model can read
 *  intent from the surface tail and decide better. */
export function shouldEscalate(decision: AutoContinueDecision): boolean {
  if (decision.action === "continue") return false;
  const r = decision.reason.toLowerCase();
  // Confident waits — don't escalate.
  if (r.includes("error")) return false;
  if (r.includes("question")) return false;
  if (r.includes("looped")) return false;
  // Plan-driven "no remaining steps" — don't escalate either; the
  // agent finished, no use prompting the model to invent more work.
  if (r.includes("remaining")) return false;
  // Everything else (no plan published, ambiguous) — escalate.
  return true;
}

// ── Anthropic LLM caller ─────────────────────────────────────

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Default `ModelCaller` — calls the Anthropic Messages API with a
 *  short structured prompt. Returns the parsed decision, or null on
 *  any failure (no API key in the env, network error, parse error).
 *  The engine wraps the null path so the heuristic still acts. */
export const callAnthropicAutoContinue: ModelCaller = async (input) => {
  const apiKey = process.env[input.settings.modelApiKeyEnv ?? ""];
  if (!apiKey) return null;
  const prompt = buildAutoContinuePrompt(input);
  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: input.settings.modelName,
        max_tokens: 256,
        temperature: 0,
        system:
          'You are an automation gate. Output ONLY a JSON object with keys: action ("continue" | "wait"), reason (short sentence), and optional instruction (string to send to the agent). No prose.',
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  let body: { content?: { type: string; text?: string }[] };
  try {
    body = (await resp.json()) as typeof body;
  } catch {
    return null;
  }
  const text = body?.content?.find((c) => c.type === "text")?.text ?? "";
  return parseModelResponse(text);
};

/** Pure: render the prompt the model sees. Exported for tests so we
 *  can pin the contract — agents reading this in the audit log
 *  should see exactly what the model saw. */
export function buildAutoContinuePrompt(input: ModelCallerInput): string {
  const parts: string[] = [];
  parts.push("Decide whether to auto-continue an agent's multi-step plan.");
  parts.push("Respond ONLY as JSON; do not explain.");
  parts.push(
    "Schema: { action: 'continue'|'wait', reason: string, instruction?: string }",
  );
  if (input.plan && input.plan.steps.length > 0) {
    parts.push("\nPlan steps:");
    for (const s of input.plan.steps) {
      parts.push(`- [${s.state}] ${s.id}: ${s.title}`);
    }
  } else {
    parts.push("\nPlan: (no plan published)");
  }
  if (input.notificationText) {
    parts.push(`\nTurn-end notification: ${input.notificationText}`);
  }
  if (input.surfaceTail.length > 0) {
    parts.push("\nLast lines of agent surface:");
    for (const line of input.surfaceTail.slice(-12)) {
      parts.push(`> ${line}`);
    }
  }
  return parts.join("\n");
}

/** Pure: parse a model response into a structured decision. Returns
 *  null on any deviation from the contract — the engine then falls
 *  back to the heuristic. */
export function parseModelResponse(text: string): AutoContinueDecision | null {
  if (!text) return null;
  // Try JSON-prefix extraction — Claude occasionally wraps in
  // markdown fences despite the system prompt.
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }
  const action = obj["action"];
  if (action !== "continue" && action !== "wait") return null;
  const reason =
    typeof obj["reason"] === "string" && obj["reason"].length > 0
      ? (obj["reason"] as string).slice(0, 200)
      : action === "continue"
        ? "model continue"
        : "model wait";
  const out: AutoContinueDecision = { action, reason };
  if (
    action === "continue" &&
    typeof obj["instruction"] === "string" &&
    (obj["instruction"] as string).length > 0
  ) {
    out.instruction = (obj["instruction"] as string).slice(0, 240);
  }
  return out;
}
