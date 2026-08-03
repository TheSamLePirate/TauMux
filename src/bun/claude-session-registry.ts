/**
 * ClaudeSessionRegistry — single source of truth for Claude Code session
 * state (august-plan M1 / WS1b).
 *
 * Two inputs, both arriving over the socket RPC (`rpc-handlers/claude.ts`):
 *
 *   applyEvent(ev)        ← ht-bridge hook events (event plane)
 *   applyStatusline(data) ← `ht claude statusline` tee (data plane)
 *
 * One output: `onChange(session, prev)` fires after every state change so
 * a presenter (`claude-status-presenter.ts`) can drive sidebar pills /
 * notifications. The registry itself renders nothing and never touches
 * the PTY — if it breaks, terminals keep working (same contract as the
 * metadata poller).
 *
 * Reducer functions are exported for direct unit testing; the class is a
 * thin shell around them (Map + pruning + change fan-out).
 */

import {
  type ClaudeBridgeEvent,
  type ClaudeSessionState,
  type ClaudeStatuslineData,
  firstClauseLabel,
  newClaudeSessionState,
} from "../shared/claude-types";

/** Sessions with no events for this long are pruned (mirrors the old
 *  bridge's 24 h state-file TTL). */
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
/** Ended sessions linger briefly so the presenter can clear UI, then go. */
const ENDED_TTL_MS = 5 * 60 * 1000;
/** Hard cap — a runaway producer can't grow the map unboundedly. */
const MAX_SESSIONS = 200;
/** Caps mirrored lists so a pathological session can't bloat RPC payloads. */
const MAX_TASKS = 100;
const MAX_SUBAGENTS = 50;
const MAX_PROMPT_CHARS = 2000;

/**
 * Apply one bridge event. Mutates and returns `state` (the registry owns
 * cloning for prev-snapshots; keeping the reducer mutation-style avoids
 * churning allocations at 1-event-per-hook rates).
 */
export function reduceEvent(
  state: ClaudeSessionState,
  ev: ClaudeBridgeEvent,
  now: number,
): ClaudeSessionState {
  const ts = typeof ev.ts === "number" && ev.ts > 0 ? ev.ts : now;
  state.lastEventAt = ts;
  if (ev.surfaceId) state.surfaceId = ev.surfaceId;
  if (ev.cwd) state.cwd = ev.cwd;
  if (ev.permissionMode) state.permissionMode = ev.permissionMode;
  if (ev.transcriptPath) state.transcriptPath = ev.transcriptPath;

  switch (ev.type) {
    case "session-start":
      state.source = ev.source ?? "";
      state.ended = false;
      state.endedReason = "";
      if (state.phase === "ended") state.phase = "idle";
      break;

    case "session-end":
      state.ended = true;
      state.endedReason = ev.reason ?? "";
      state.phase = "ended";
      state.promptStartedAt = 0;
      state.subagents = [];
      break;

    case "prompt":
      state.approvalSource = null;
      state.approvalMessage = null;
      state.turnCount += 1;
      state.promptStartedAt = ts;
      state.currentPrompt = (ev.prompt ?? "").slice(0, MAX_PROMPT_CHARS);
      state.label = firstClauseLabel(state.currentPrompt);
      state.phase = "working";
      state.errorType = null;
      state.errorMessage = null;
      state.approvalMessage = null;
      break;

    case "stop":
      state.phase = "idle";
      state.promptStartedAt = 0;
      state.approvalMessage = null;
      state.approvalSource = null;
      break;

    case "stop-failure":
      state.phase = "error";
      state.errorType = ev.errorType ?? "unknown";
      state.errorMessage = ev.errorMessage ?? "";
      state.promptStartedAt = 0;
      break;

    case "subagent-start":
      if (ev.agentId && state.subagents.length < MAX_SUBAGENTS) {
        // Re-start of a known id replaces the entry rather than duping.
        state.subagents = state.subagents.filter(
          (s) => s.agentId !== ev.agentId,
        );
        state.subagents.push({
          agentId: ev.agentId,
          agentType: ev.agentType ?? "agent",
          startedAt: ts,
        });
      }
      break;

    case "subagent-stop":
      if (ev.agentId) {
        state.subagents = state.subagents.filter(
          (s) => s.agentId !== ev.agentId,
        );
      }
      break;

    case "pre-compact":
      state.phase = "compacting";
      break;

    case "post-compact":
      // Return to whatever the turn state implies. A compaction mid-turn
      // resumes "working"; a manual `/compact` while idle goes back to idle.
      state.phase = state.promptStartedAt > 0 ? "working" : "idle";
      break;

    case "cwd-changed":
      // cwd was already applied from the shared fields above.
      break;

    case "notify-idle":
      state.phase = "waiting-input";
      break;

    case "notify-permission":
      // Claude Code is showing its OWN prompt in the terminal. Bump the
      // sequence even when every other field is unchanged — back-to-back
      // prompts in one turn are otherwise indistinguishable from the
      // same prompt still being on screen.
      state.phase = "waiting-approval";
      state.approvalSource = "tty";
      state.approvalSeq += 1;
      if (ev.message) state.approvalMessage = ev.message;
      break;

    // WS3 — the PermissionRequest hook is being routed to a τ-mux ask
    // modal. `message` carries the tool name for the pill/notification.
    case "permission-request":
      // Routed to a τ-mux modal — there is no terminal prompt to answer.
      state.phase = "waiting-approval";
      state.approvalSource = "modal";
      state.approvalSeq += 1;
      state.approvalMessage = ev.message ?? null;
      break;

    // The modal answered (allow or deny) — back to the turn state. A
    // fall-through to Claude Code's own terminal prompt does NOT send
    // this; the Notification hook keeps the red pill in that case.
    case "permission-resolved":
      state.phase = state.promptStartedAt > 0 ? "working" : "idle";
      state.approvalMessage = null;
      state.approvalSource = null;
      break;

    case "task-created": {
      // TaskCreated fires while the task is *being* created, so `task_id`
      // may be absent on some Claude Code versions — the bridge then
      // synthesizes `name:<task_name>`. Dedup by id first, then by name.
      const id = ev.taskId ?? (ev.taskName ? `name:${ev.taskName}` : "");
      if (!id) break;
      const exists =
        state.tasks.some((t) => t.id === id) ||
        (ev.taskName != null &&
          state.tasks.some(
            (t) => t.state === "pending" && t.name === ev.taskName,
          ));
      if (!exists) {
        if (state.tasks.length >= MAX_TASKS) state.tasks.shift();
        state.tasks.push({
          id,
          name: ev.taskName ?? "",
          ...(ev.taskDescription ? { description: ev.taskDescription } : {}),
          state: "pending",
          createdAt: ts,
        });
      }
      break;
    }

    case "task-completed": {
      // Match by id, then by name (covers the synthesized-id case where
      // TaskCompleted carries the real id TaskCreated didn't have), and
      // finally record an already-completed task we never saw created —
      // a mirror must not silently drop completions.
      let t = ev.taskId
        ? state.tasks.find((x) => x.id === ev.taskId)
        : undefined;
      if (!t && ev.taskName) {
        t = state.tasks.find(
          (x) => x.state === "pending" && x.name === ev.taskName,
        );
      }
      if (t) {
        t.state = "completed";
        t.completedAt = ts;
        if (ev.taskId) t.id = ev.taskId;
        if (ev.taskName) t.name = ev.taskName;
        if (ev.taskDescription) t.description = ev.taskDescription;
      } else if (ev.taskId || ev.taskName) {
        if (state.tasks.length >= MAX_TASKS) state.tasks.shift();
        state.tasks.push({
          id: ev.taskId ?? `name:${ev.taskName}`,
          name: ev.taskName ?? "",
          ...(ev.taskDescription ? { description: ev.taskDescription } : {}),
          state: "completed",
          createdAt: ts,
          completedAt: ts,
        });
      }
      break;
    }
  }
  return state;
}

/** Apply one statusline tee. Data-plane fields only — the statusline
 *  never changes phase (that's the event plane's job). */
export function reduceStatusline(
  state: ClaudeSessionState,
  d: ClaudeStatuslineData,
  now: number,
): ClaudeSessionState {
  const ts = typeof d.ts === "number" && d.ts > 0 ? d.ts : now;
  state.lastEventAt = ts;
  if (d.surfaceId) state.surfaceId = d.surfaceId;
  if (d.cwd) state.cwd = d.cwd;
  if (d.sessionName) state.sessionName = d.sessionName;
  if (d.modelDisplayName) state.modelDisplayName = d.modelDisplayName;
  if (typeof d.costUsd === "number") state.costUsd = d.costUsd;
  if (typeof d.contextUsedPct === "number") {
    state.contextUsedPct = d.contextUsedPct;
  }
  if (typeof d.contextWindowSize === "number") {
    state.contextWindowSize = d.contextWindowSize;
  }
  if (typeof d.linesAdded === "number") state.linesAdded = d.linesAdded;
  if (typeof d.linesRemoved === "number") state.linesRemoved = d.linesRemoved;
  if (d.permissionMode) state.permissionMode = d.permissionMode;
  if (d.effortLevel) state.effortLevel = d.effortLevel;
  if (d.transcriptPath) state.transcriptPath = d.transcriptPath;
  if (d.rateLimits) {
    const r = d.rateLimits;
    if (typeof r.fiveHourPct === "number") {
      state.rateLimits.fiveHourPct = r.fiveHourPct;
    }
    if (typeof r.fiveHourResetsAt === "number") {
      state.rateLimits.fiveHourResetsAt = r.fiveHourResetsAt;
    }
    if (typeof r.sevenDayPct === "number") {
      state.rateLimits.sevenDayPct = r.sevenDayPct;
    }
    if (typeof r.sevenDayResetsAt === "number") {
      state.rateLimits.sevenDayResetsAt = r.sevenDayResetsAt;
    }
  }
  if (typeof d.prNumber === "number") state.prNumber = d.prNumber;
  if (d.prUrl) state.prUrl = d.prUrl;
  if (d.prReviewState) state.prReviewState = d.prReviewState;
  return state;
}

export type ClaudeSessionChangeListener = (
  session: ClaudeSessionState,
  prev: ClaudeSessionState | null,
) => void;

export class ClaudeSessionRegistry {
  private sessions = new Map<string, ClaudeSessionState>();
  private listeners: ClaudeSessionChangeListener[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  onChange(fn: ClaudeSessionChangeListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  applyEvent(ev: ClaudeBridgeEvent): ClaudeSessionState | null {
    if (!ev || typeof ev.sessionId !== "string" || !ev.sessionId) return null;
    if (typeof ev.type !== "string") return null;
    const t = this.now();
    this.prune(t);
    const { state, prev } = this.upsert(ev.sessionId, t);
    reduceEvent(state, ev, t);
    this.emit(state, prev);
    return state;
  }

  applyStatusline(d: ClaudeStatuslineData): ClaudeSessionState | null {
    if (!d || typeof d.sessionId !== "string" || !d.sessionId) return null;
    const t = this.now();
    this.prune(t);
    const { state, prev } = this.upsert(d.sessionId, t);
    reduceStatusline(state, d, t);
    this.emit(state, prev);
    return state;
  }

  /** Seed a session straight into the map (persistence restore only).
   *  Bypasses the reducer — the caller is responsible for handing over a
   *  state that is already safe to show; see
   *  `claude-registry-persistence.sanitizeForRestore`. Never overwrites a
   *  session the current process has already heard from. */
  restore(state: ClaudeSessionState): void {
    if (!state?.sessionId || this.sessions.has(state.sessionId)) return;
    this.sessions.set(state.sessionId, state);
  }

  get(sessionId: string): ClaudeSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /** Live sessions, most-recently-active first. Excludes ended ones. */
  list(): ClaudeSessionState[] {
    return [...this.sessions.values()]
      .filter((s) => !s.ended)
      .sort((a, b) => b.lastEventAt - a.lastEventAt);
  }

  /** All sessions including recently-ended (doctor / tests). */
  listAll(): ClaudeSessionState[] {
    return [...this.sessions.values()].sort(
      (a, b) => b.lastEventAt - a.lastEventAt,
    );
  }

  /** Latest live session attributed to a surface, or null. */
  forSurface(surfaceId: string): ClaudeSessionState | null {
    return this.list().find((s) => s.surfaceId === surfaceId) ?? null;
  }

  private upsert(
    sessionId: string,
    t: number,
  ): { state: ClaudeSessionState; prev: ClaudeSessionState | null } {
    let state = this.sessions.get(sessionId);
    let prev: ClaudeSessionState | null = null;
    if (state) {
      prev = structuredClone(state);
    } else {
      // Evict the oldest entry rather than refuse — a burst of sessions
      // beyond the cap should degrade, not wedge.
      if (this.sessions.size >= MAX_SESSIONS) {
        const oldest = [...this.sessions.values()].sort(
          (a, b) => a.lastEventAt - b.lastEventAt,
        )[0];
        if (oldest) this.sessions.delete(oldest.sessionId);
      }
      state = newClaudeSessionState(sessionId, t);
      this.sessions.set(sessionId, state);
    }
    return { state, prev };
  }

  private prune(t: number): void {
    for (const [id, s] of this.sessions) {
      const ttl = s.ended ? ENDED_TTL_MS : STALE_TTL_MS;
      if (t - s.lastEventAt > ttl) this.sessions.delete(id);
    }
  }

  private emit(
    session: ClaudeSessionState,
    prev: ClaudeSessionState | null,
  ): void {
    for (const fn of this.listeners) {
      try {
        fn(session, prev);
      } catch (err) {
        // A broken presenter must never poison event ingestion.
        console.error(
          `[claude-registry] listener failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
