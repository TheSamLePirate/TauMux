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
 *
 * Answering also RETRACTS the alert: the presenter's "approval needed"
 * notification carries `key: claude:approval:<sessionId>`, and every send
 * dismisses it by that key — clearing the overlay card, the sidebar entry,
 * and (via the host) the forwarded Telegram message. An alert that nobody
 * needs to act on is worse than no alert, because it trains the user to
 * ignore the next real one. Note the ordering: the notification is only
 * retracted when a send actually happens, so a prompt that is refused by
 * the rules above — or paused by the burst guard — still shouts.
 */

import type { ClaudeSessionState } from "../shared/claude-types";
import { claudeApprovalNotificationKey } from "../shared/claude-types";
import type { ClaudeSessionRegistry } from "./claude-session-registry";

/** More than this many auto-approvals inside the window pauses the
 *  session — a prompt storm is not something to rubber-stamp. */
const MAX_BURST = 8;
const BURST_WINDOW_MS = 60_000;

/** Content gate for auto-approve (improvement_analysis_2026-10 §1.9).
 *  The burst guard bounds the VOLUME of unattended approvals; this
 *  list bounds their BLAST RADIUS — a single `rm -rf ~` needs only one
 *  prompt. A match never deletes or blocks anything: it forces the
 *  human path (the tty prompt stays up / the modal is shown), so a
 *  false positive costs one prompt and a false negative is what's
 *  actually expensive. Patterns therefore err generous. */
const APPROVAL_DENY_LIST: Array<{ re: RegExp; label: string }> = [
  { re: /\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*(?:rf|fr)\b/, label: "rm -rf" },
  { re: /\bsudo\b/, label: "sudo" },
  { re: /\s--force\b/, label: "--force" },
  {
    re: /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z|fi)?sh\b/,
    label: "download piped to a shell",
  },
  { re: />\s*\/dev\//, label: "write to /dev" },
  { re: /\bdd\b[^|]*\bof=\/dev\//, label: "dd onto a device" },
  { re: /\bmkfs\b/, label: "mkfs" },
  { re: /\bshutdown\b|\breboot\b/, label: "shutdown/reboot" },
  {
    re: /\.ssh\/id_|\.aws\/credentials|\.netrc|\.gnupg\//,
    label: "credential file access",
  },
];

/** Does the pending approval's text ask for something no automation
 *  should rubber-stamp? Returns the matched rule's label, or null.
 *  Pure + exported for tests. */
export function deniedApprovalReason(
  message: string | null | undefined,
): string | null {
  if (!message) return null;
  for (const rule of APPROVAL_DENY_LIST) {
    if (rule.re.test(message)) return rule.label;
  }
  return null;
}

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
  // A question addressed to the HUMAN is on screen. Claude Code raises
  // the same permission_prompt notification for AskUserQuestion and
  // ExitPlanMode as for "may I run this command", with the same generic
  // message — so without this the engine answers the user's own
  // multiple-choice question by taking its default option. Consent to
  // run a command is not consent to have your answer chosen for you.
  if (s.awaitingUserChoice) return false;
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
  /** Sessions already told their prompt was deny-listed. Cleared when
   *  the session re-arms (leaves waiting-approval), so a refusal is
   *  announced once per stuck-prompt episode — never spammed per hook
   *  re-fire, never silent in the next turn either. */
  private deniedNotified = new Set<string>();
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
        this.deniedNotified.delete(s.sessionId);
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
      // Content gate BEFORE the burst accounting: a deny-listed prompt
      // is routed to the human without consuming a burst slot (it was
      // never approved, attended or not).
      const denied = deniedApprovalReason(s.approvalMessage);
      if (denied) {
        if (!this.deniedNotified.has(s.sessionId)) {
          this.deniedNotified.add(s.sessionId);
          this.notifyDenied(s, denied);
        }
        return;
      }
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
   * Should a `PermissionRequest` be allowed without asking the human?
   *
   * The bridge routes tool-permission requests to a τ-mux modal. With
   * auto-approve on, that modal is pure friction: the user has already
   * said "accept these", and a dialog that will be accepted anyway just
   * blocks the turn until they dismiss it.
   *
   * The decision has to live HERE rather than in the bridge, because the
   * safety rules that make auto-approve tolerable — the burst guard and
   * the per-session pause — are stateful and belong to this engine. A
   * bridge that decided for itself would approve without a ceiling.
   *
   * Deliberately NOT gated on `canAutoApprove`: that predicate answers a
   * different question (can Enter be typed into this pane's tty). A
   * PermissionRequest is answered by the hook's stdout, so a native
   * Claude pane or a session with no tty is still eligible here.
   *
   * Calling this consumes a burst slot (via `burst()`), so the ceiling
   * counts modal-routed approvals alongside tty ones.
   */
  decidePermission(sessionId: string): {
    decision: "allow" | "ask";
    reason: string;
  } {
    if (!this.deps.isEnabled()) {
      return { decision: "ask", reason: "auto-approve off" };
    }
    if (this.paused.has(sessionId)) {
      return { decision: "ask", reason: "paused by burst guard" };
    }
    if (this.burst(sessionId)) {
      this.paused.add(sessionId);
      const s = this.registry?.get(sessionId);
      if (s) this.notifyPaused(s);
      return { decision: "ask", reason: "burst guard tripped" };
    }
    // A question addressed to the human is never auto-answered — the
    // same rule `canAutoApprove` enforces for the tty path.
    const session = this.registry?.get(sessionId);
    if (session?.awaitingUserChoice) {
      return { decision: "ask", reason: "question addressed to the user" };
    }
    // Content gate — same list as the tty path. Volume is not the only
    // risk axis; one dangerous command needs one prompt.
    const denied = deniedApprovalReason(session?.approvalMessage);
    if (denied) {
      return { decision: "ask", reason: `deny-listed content: ${denied}` };
    }
    // `burst()` already recorded this attempt, so the ceiling counts
    // modal-routed approvals alongside tty ones.
    return { decision: "allow", reason: "auto-approve on" };
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
    // Retract the "approval needed" alert the presenter raised for this
    // prompt: the question has been answered, so the card, the sidebar
    // entry, and any forwarded Telegram message are now asking the user
    // to act on something that is already settled. Keyed dismissal is a
    // no-op when nothing matches — notifications disabled, an approval
    // that predates the key, or a prompt the user cleared themselves.
    // The `sidebar.log` line above survives it: the audit trail is the
    // record, the notification was only the interrupt.
    this.call("notification.dismiss", {
      key: claudeApprovalNotificationKey(s.sessionId),
      resolution: automatic ? "auto-approved by τ-mux" : "approved in τ-mux",
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

  /** A deny-listed prompt is left for the human — say so once per
   *  prompt (keyed by seq, like the approval latch) so the refusal is
   *  visible rather than a silently-unanswered prompt. */
  private notifyDenied(s: ClaudeSessionState, label: string): void {
    this.call("notification.create", {
      title: "Claude Code · auto-approve refused",
      body: `Prompt mentions ${label} — left for you to decide.`,
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
