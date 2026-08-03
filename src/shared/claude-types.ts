/**
 * Claude Code integration — shared types (august-plan M1 / WS1b).
 *
 * Two planes feed the bun-side `ClaudeSessionRegistry`:
 *
 *  - the **event plane**: `claude-integration/ht-bridge` translates Claude
 *    Code shell hooks into small `ClaudeBridgeEvent` JSON blobs sent over
 *    `ht claude event` (→ `claude.event` RPC);
 *  - the **data plane**: `ht claude statusline` tees Claude Code's own
 *    statusline JSON (cost / context / rate limits / session title —
 *    computed by Claude Code itself) into `claude.statusline`.
 *
 * Everything τ-mux renders about a Claude session derives from these two.
 * Types live in `shared/` because the CLI (`src/cli/`), the bun registry,
 * and (later, M4) the webview sessions panel all consume them.
 */

/** Lifecycle phase of a Claude Code session as τ-mux understands it. */
export type ClaudePhase =
  | "idle" // registered, no turn in flight
  | "working" // between UserPromptSubmit and Stop
  | "waiting-input" // Notification: idle_prompt — Claude asked the user something
  | "waiting-approval" // Notification: permission_prompt — a tool needs consent
  | "compacting" // PreCompact seen, PostCompact not yet
  | "error" // StopFailure — API error ended the turn
  | "ended"; // SessionEnd — kept briefly for UI teardown, then pruned

/** Event types the bridge emits. One per hook we subscribe to, plus the
 *  task pair (ingested in M1, consumed by the plan-panel mirror in M2). */
export type ClaudeBridgeEventType =
  | "session-start"
  | "session-end"
  | "prompt"
  | "stop"
  | "stop-failure"
  | "subagent-start"
  | "subagent-stop"
  | "pre-compact"
  | "post-compact"
  | "cwd-changed"
  | "notify-idle"
  | "notify-permission"
  | "permission-request"
  | "permission-resolved"
  | "task-created"
  | "task-completed";

/**
 * One hook occurrence, normalized by the bridge. Every field except
 * `type`/`sessionId` is optional — hooks across Claude Code versions
 * carry different payloads and the registry must tolerate absence
 * (design principle: gate on field presence, never on CC version).
 */
export interface ClaudeBridgeEvent {
  type: ClaudeBridgeEventType;
  sessionId: string;
  /** Pane attribution — `HT_SURFACE` inherited from the pane's shell by
   *  the hook process. Absent when Claude Code runs outside τ-mux. */
  surfaceId?: string;
  cwd?: string;
  /** Bridge-side wall clock (ms). The registry prefers it over its own
   *  clock so replayed fixtures are deterministic. */
  ts?: number;
  /** session-start: startup | resume | clear | compact | fork. */
  source?: string;
  /** session-end: clear | logout | prompt_input_exit | other… */
  reason?: string;
  /** prompt: the user's prompt text (bridge truncates to a sane cap). */
  prompt?: string;
  /** stop-failure: rate_limit | overloaded | authentication_failed | … */
  errorType?: string;
  errorMessage?: string;
  /** subagent-start / subagent-stop. */
  agentType?: string;
  agentId?: string;
  /** notify-*: the human-readable message Claude Code attached. */
  message?: string;
  /** task-created / task-completed. */
  taskId?: string;
  taskName?: string;
  taskDescription?: string;
  /** Hook-universal context, forwarded when present. */
  permissionMode?: string;
  transcriptPath?: string;
}

/** Rate-limit meter data (statusline `rate_limits.*`). Percentages are
 *  0-100; `resetsAt` is unix epoch seconds. Null = not reported. */
export interface ClaudeRateLimits {
  fiveHourPct: number | null;
  fiveHourResetsAt: number | null;
  sevenDayPct: number | null;
  sevenDayResetsAt: number | null;
}

/**
 * The subset of Claude Code's statusline stdin JSON the registry keeps.
 * Field names mirror the upstream payload (snake_case flattened into
 * camelCase) so the mapping in `parseStatuslinePayload` stays obvious.
 */
export interface ClaudeStatuslineData {
  sessionId: string;
  surfaceId?: string;
  /** `session_name` — Claude's own AI-generated / user-set title. */
  sessionName?: string;
  modelId?: string;
  modelDisplayName?: string;
  cwd?: string;
  projectDir?: string;
  gitBranch?: string;
  costUsd?: number;
  durationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  contextUsedPct?: number;
  contextTokens?: number;
  contextWindowSize?: number;
  rateLimits?: Partial<ClaudeRateLimits>;
  permissionMode?: string;
  effortLevel?: string;
  outputStyle?: string;
  prNumber?: number;
  prUrl?: string;
  prReviewState?: string;
  transcriptPath?: string;
  ccVersion?: string;
  ts?: number;
}

/** Task mirrored from Claude Code's native task list (TaskCreated /
 *  TaskCompleted hooks). In-progress state is best-effort (no hook). */
export interface ClaudeTask {
  id: string;
  name: string;
  /** TaskCreated's `task_description` — longer context for tooltips /
   *  the sessions panel; absent when the hook didn't carry one. */
  description?: string;
  state: "pending" | "completed";
  createdAt: number;
  completedAt?: number;
}

/** Live subagent entry (SubagentStart without a matching SubagentStop). */
export interface ClaudeSubagent {
  agentId: string;
  agentType: string;
  startedAt: number;
}

/** Everything τ-mux knows about one Claude Code session. Plain JSON —
 *  serialized as-is over `claude.sessions` and (M4) to the webview. */
export interface ClaudeSessionState {
  sessionId: string;
  surfaceId: string | null;
  phase: ClaudePhase;
  cwd: string;
  /** How the session started (session-start `source`), "" until seen. */
  source: string;
  /** First event wall-clock (ms). */
  startedAt: number;
  lastEventAt: number;
  /** Set on `prompt`, zeroed on `stop`/`stop-failure`. */
  promptStartedAt: number;
  turnCount: number;
  /** First clause of the latest prompt — immediate label while the
   *  statusline `sessionName` hasn't arrived. */
  label: string;
  /** Latest prompt text (truncated) — notification body material. */
  currentPrompt: string;
  /** Claude's own session title (statusline `session_name`). Wins over
   *  `label` wherever both exist. */
  sessionName: string;
  modelDisplayName: string;
  costUsd: number | null;
  contextUsedPct: number | null;
  contextWindowSize: number | null;
  rateLimits: ClaudeRateLimits;
  linesAdded: number | null;
  linesRemoved: number | null;
  permissionMode: string;
  effortLevel: string;
  prNumber: number | null;
  prUrl: string | null;
  prReviewState: string | null;
  /** What is waiting for approval (tool name / prompt message) while
   *  phase === "waiting-approval". Cleared on resolution or next turn. */
  approvalMessage: string | null;
  /** Where the pending approval is being answered.
   *  `"tty"`  — Claude Code is showing its own prompt in the pane's
   *             terminal (Notification/permission_prompt). Enter accepts.
   *  `"modal"`— the PermissionRequest hook routed it to a τ-mux modal /
   *             Telegram; NO terminal prompt exists, so sending keys to
   *             the pane would type into whatever is on screen.
   *  Auto-approve only ever acts on `"tty"`. */
  approvalSource: "tty" | "modal" | null;
  /** Bumped once per permission-prompt ANNOUNCEMENT. Claude Code has no
   *  "prompt resolved" hook, so answering a prompt moves nothing: the
   *  session sits in `waiting-approval` and the next prompt reduces to a
   *  byte-identical state. Without a discriminator, a consumer that
   *  (correctly) acts only on the transition into a prompt fires for the
   *  first prompt of a turn and goes deaf for every one after it. This
   *  counter is what makes "another prompt is up" observable. */
  approvalSeq: number;
  errorType: string | null;
  errorMessage: string | null;
  subagents: ClaudeSubagent[];
  tasks: ClaudeTask[];
  /** session-end seen; pruned by the registry after a grace period. */
  ended: boolean;
  endedReason: string;
  transcriptPath: string;
}

export const EMPTY_RATE_LIMITS: ClaudeRateLimits = {
  fiveHourPct: null,
  fiveHourResetsAt: null,
  sevenDayPct: null,
  sevenDayResetsAt: null,
};

/** Fresh state for a session first seen at `now`. */
export function newClaudeSessionState(
  sessionId: string,
  now: number,
): ClaudeSessionState {
  return {
    sessionId,
    surfaceId: null,
    phase: "idle",
    cwd: "",
    source: "",
    startedAt: now,
    lastEventAt: now,
    promptStartedAt: 0,
    turnCount: 0,
    label: "",
    currentPrompt: "",
    sessionName: "",
    modelDisplayName: "",
    costUsd: null,
    contextUsedPct: null,
    contextWindowSize: null,
    rateLimits: { ...EMPTY_RATE_LIMITS },
    linesAdded: null,
    linesRemoved: null,
    permissionMode: "",
    effortLevel: "",
    prNumber: null,
    prUrl: null,
    prReviewState: null,
    approvalMessage: null,
    approvalSource: null,
    approvalSeq: 0,
    errorType: null,
    errorMessage: null,
    subagents: [],
    tasks: [],
    ended: false,
    endedReason: "",
    transcriptPath: "",
  };
}

/** One-line label from a prompt: first clause, hard char cap, never
 *  wraps a sidebar pill. (Moved from bridge v1 so registry + tests share
 *  one implementation.) */
export function firstClauseLabel(prompt: string, max = 40): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Working";
  const firstClause = trimmed.split(/[.!?\n]/)[0]!.trim() || trimmed;
  if (firstClause.length <= max) return firstClause;
  return firstClause.slice(0, max - 1).trimEnd() + "…";
}

/** Best display title for a session: Claude's own title > prompt clause
 *  > generic fallback. */
export function sessionTitle(s: ClaudeSessionState): string {
  return s.sessionName || s.label || "Claude";
}

export function formatClaudeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const sec = ms / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatClaudeCost(cost: number | null): string {
  if (cost == null || cost <= 0) return "";
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  const fixed = cost.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
  return `$${fixed}`;
}
