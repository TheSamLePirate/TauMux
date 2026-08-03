/**
 * ClaudeAutoApprove — accept Claude Code's terminal permission prompt by
 * sending Enter to the pane it is showing in.
 *
 * Claude Code's prompt ("Do you want to proceed?" with "1. Yes" as the
 * highlighted default) accepts on a bare CR. The `Notification`/`permission_prompt`
 * hook tells us the prompt is on screen and `HT_SURFACE` tells us which
 * pane, so no screen scraping is involved.
 *
 * Two entry points:
 *   approveNow(surfaceId?) — explicit, always available (palette entry,
 *                            `ht claude approve`). Answers the oldest
 *                            waiting session, or a named surface.
 *   auto-approve            — opt-in (`claudeAutoApprove`), fires once per
 *                            announced tty prompt (`approvalSeq`), NOT per
 *                            phase transition: Claude Code has no
 *                            prompt-resolved hook, so a session stays in
 *                            `waiting-approval` between back-to-back
 *                            prompts in one turn.
 *
 * Safety rules, all enforced here rather than trusted to the caller:
 *   1. `approvalSource === "tty"` only. A modal-routed approval (WS3) has
 *      NO terminal prompt — typing Enter there would go into whatever is
 *      on screen (a shell, an editor…).
 *   2. Terminal panes only: never `claude-agent:` (the native pane
 *      answers through its own modal) and never a pane we can't name.
 *   3. Burst guard: more than MAX_BURST approvals inside BURST_WINDOW_MS
 *      pauses auto-approve for that session and notifies. A prompt storm
 *      means something is wrong; a human should look.
 *   4. Every send is logged to the sidebar so there is an audit trail of
 *      what was approved unattended.
 */

import type { ClaudeSessionState } from "../shared/claude-types";
import type { ClaudeSessionRegistry } from "./claude-session-registry";

/** More than this many auto-approvals inside the window pauses the
 *  session — a prompt storm is not something to rubber-stamp. */
const MAX_BURST = 8;
const BURST_WINDOW_MS = 60_000;

export interface ClaudeAutoApproveDeps {
  callRpc: (
    method: string,
    params: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  /** Live settings read (so a toggle applies without re-subscribing). */
  isEnabled: () => boolean;
  delayMs: () => number;
  /** Injected in tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
}

/** Can this session's pending approval be answered by pressing Enter in
 *  its pane? Pure — the whole safety rule set in one testable place. */
export function canAutoApprove(s: ClaudeSessionState): boolean {
  if (s.phase !== "waiting-approval") return false;
  if (s.approvalSource !== "tty") return false;
  if (s.ended) return false;
  const id = s.surfaceId;
  if (!id) return false;
  // The native Claude pane owns no tty; it answers through canUseTool.
  if (id.startsWith("claude-agent:")) return false;
  return true;
}

export class ClaudeAutoApprove {
  private deps: ClaudeAutoApproveDeps;
  private unsubscribe: (() => void) | null = null;
  /** sessionId → recent auto-approval timestamps (burst guard). */
  private recent = new Map<string, number[]>();
  /** Sessions paused by the burst guard until the next turn. */
  private paused = new Set<string>();
  /** sessionId → the `approvalSeq` we have already scheduled/sent an
   *  approval for. Keyed by seq rather than a bare flag so a NEW prompt
   *  arriving while the previous one is still settling is not mistaken
   *  for a duplicate of it. */
  private inFlightSeq = new Map<string, number>();
  private registry: ClaudeSessionRegistry | null = null;

  constructor(deps: ClaudeAutoApproveDeps) {
    this.deps = deps;
  }

  attach(registry: ClaudeSessionRegistry): void {
    this.registry = registry;
    this.unsubscribe?.();
    this.unsubscribe = registry.onChange((s, prev) => {
      // Any move away from a pending tty approval re-arms the session.
      if (!canAutoApprove(s)) {
        this.inFlightSeq.delete(s.sessionId);
        if (s.phase === "working" || s.phase === "idle") {
          this.paused.delete(s.sessionId);
        }
        return;
      }
      // Act once per PROMPT, not once per event: a statusline tee that
      // arrives while the prompt is still up leaves `approvalSeq` alone
      // and must not re-fire, but a second prompt in the same turn bumps
      // it and must. Comparing phases instead (the obvious "only on the
      // transition into waiting-approval" test) silently wedges after
      // the first prompt — Claude Code has no prompt-resolved hook, so
      // the session never leaves `waiting-approval` in between, and
      // every later prompt looks like the first one still being up.
      const seq = s.approvalSeq;
      if (prev != null && prev.approvalSeq === seq) return;
      // A new prompt supersedes any approval still in flight for the
      // previous one; otherwise the latch below blocks it forever.
      if (this.inFlightSeq.get(s.sessionId) === seq) return;
      // Claim the seq only AFTER the gates below: a refusal must not
      // consume it, or flipping auto-approve on mid-prompt would do
      // nothing until the next prompt arrives.
      if (!this.deps.isEnabled()) return;
      if (this.paused.has(s.sessionId)) return;
      if (this.burst(s.sessionId)) {
        this.paused.add(s.sessionId);
        this.notifyPaused(s);
        return;
      }
      this.inFlightSeq.set(s.sessionId, seq);
      const sessionId = s.sessionId;
      const fire = () => {
        // Re-check against LIVE state: during the delay the user may have
        // answered the prompt themselves, or the turn may have moved on.
        // Sending a stray Enter into a pane that is now at a shell (or
        // showing a different prompt) is exactly what must not happen.
        const fresh = this.registry?.get(sessionId);
        if (!fresh || !canAutoApprove(fresh)) {
          this.inFlightSeq.delete(sessionId);
          return;
        }
        this.send(fresh.surfaceId!, fresh, true);
      };
      const setTimer = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
      setTimer(fire, Math.max(0, this.deps.delayMs()));
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Explicit approve — the manual path. Answers `surfaceId` when given,
   * otherwise the longest-waiting tty approval. Returns what happened so
   * the CLI can report it.
   */
  approveNow(surfaceId?: string): {
    ok: boolean;
    surfaceId?: string;
    reason?: string;
  } {
    const reg = this.registry;
    if (!reg) return { ok: false, reason: "registry not wired" };
    const waiting = reg.list().filter((s) => canAutoApprove(s));
    const target = surfaceId
      ? waiting.find((s) => s.surfaceId === surfaceId)
      : // Oldest prompt first — the one that has been blocking longest.
        waiting.sort((a, b) => a.lastEventAt - b.lastEventAt)[0];
    if (!target) {
      return {
        ok: false,
        reason: surfaceId
          ? `no Claude Code terminal prompt waiting in ${surfaceId}`
          : "no Claude Code terminal prompt is waiting",
      };
    }
    this.send(target.surfaceId!, target, false);
    return { ok: true, surfaceId: target.surfaceId! };
  }

  /** True when this session has exceeded the burst budget. */
  private burst(sessionId: string): boolean {
    const now = (this.deps.now ?? Date.now)();
    const hits = (this.recent.get(sessionId) ?? []).filter(
      (t) => now - t < BURST_WINDOW_MS,
    );
    hits.push(now);
    this.recent.set(sessionId, hits);
    return hits.length > MAX_BURST;
  }

  private send(
    surfaceId: string,
    s: ClaudeSessionState,
    automatic: boolean,
  ): void {
    const what = s.approvalMessage || "a permission prompt";
    this.call("surface.send_key", { surface_id: surfaceId, key: "enter" });
    // Audit trail — an unattended approval must be visible after the fact.
    this.call("sidebar.log", {
      surface_id: surfaceId,
      level: "info",
      source: "claude",
      message: `${automatic ? "auto-approved" : "approved"}: ${what}`,
    });
  }

  private notifyPaused(s: ClaudeSessionState): void {
    this.call("notification.create", {
      title: "Claude Code · auto-approve paused",
      body: `More than ${MAX_BURST} permission prompts in a minute — approve the rest yourself.`,
      subtitle: "Claude Code",
      ...(s.surfaceId ? { surface_id: s.surfaceId } : {}),
    });
  }

  private call(method: string, params: Record<string, unknown>): void {
    try {
      const r = this.deps.callRpc(method, params);
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* approving is best-effort; never destabilize ingestion */
    }
  }
}
