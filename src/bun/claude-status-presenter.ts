/**
 * ClaudeStatusPresenter — registry state → sidebar pills + notifications
 * (august-plan M1 / WS1b+WS2).
 *
 * Subscribes to `ClaudeSessionRegistry.onChange` and drives the SAME RPC
 * methods the v1 bridge used to call from the outside (`sidebar.set_status`,
 * `sidebar.clear_status`, `notification.create`) — but from inside the bun
 * process, through the local dispatcher. That keeps workspace resolution
 * (surface_id → workspace via `resolveWorkspaceId`), notification fan-out,
 * sounds, persistence, and the web mirror all on their existing, tested
 * paths, and makes the registry the single notification chokepoint the
 * plan requires (no more double-firing bridge + app).
 *
 * Pill contract (unchanged from bridge v1, so muscle memory survives):
 *   key "Claude" — active label pill; phase drives color; cleared on idle.
 *   key "cc"     — persistent ticker; `model · ctx% · cost` once the
 *                  statusline feed reports, `turn N` before that.
 *
 * Known v1 limitation (documented in tracking): two live sessions in the
 * SAME workspace share the pill keys — last writer wins, and a session
 * ending clears the pill until the surviving session's next event
 * repaints it. Per-session keys arrive with the M4 sessions panel.
 */

import type { ClaudeSessionState } from "../shared/claude-types";
import {
  formatClaudeCost,
  formatClaudeDuration,
  sessionTitle,
} from "../shared/claude-types";
import type { ClaudeSessionRegistry } from "./claude-session-registry";

export interface ClaudePresenterDeps {
  /** Local RPC dispatcher (the function `createRpcHandler` returns). */
  callRpc: (
    method: string,
    params: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  /** Master switch — flipped by settings (M2). Read per change so a
   *  settings toggle applies without re-subscribing. */
  enabled?: () => boolean;
}

const LABEL_KEY = "Claude";
const TICKER_KEY = "cc";
const LABEL_ICON = "bolt";
const TICKER_ICON = "chart";

const COLOR_WORKING = "#f5c2e7";
const COLOR_IDLE_INPUT = "#f9e2af";
const COLOR_PERMISSION = "#f38ba8";
const COLOR_ERROR = "#f38ba8";
const COLOR_NEUTRAL = "#cdd6f4";
const COLOR_TICKER = "#89b4fa";

const NOTIFY_SUBTITLE = "Claude Code";

interface RenderedPills {
  label: { value: string; color: string } | null;
  ticker: string | null;
}

/** Pure: what the pills should say for a session state. Exported for
 *  direct unit testing (the presenter shell just diffs + dispatches). */
export function renderPills(s: ClaudeSessionState): RenderedPills {
  let label: RenderedPills["label"] = null;
  switch (s.phase) {
    case "working":
      label = { value: sessionTitle(s), color: COLOR_WORKING };
      break;
    case "waiting-input":
      label = { value: "Waiting for input", color: COLOR_IDLE_INPUT };
      break;
    case "waiting-approval":
      label = { value: "Approval needed", color: COLOR_PERMISSION };
      break;
    case "compacting":
      label = { value: "Compacting…", color: COLOR_NEUTRAL };
      break;
    case "error":
      label = {
        value: prettyErrorType(s.errorType),
        color: COLOR_ERROR,
      };
      break;
    case "idle":
    case "ended":
      label = null;
      break;
  }

  let ticker: string | null = null;
  if (s.ended) {
    ticker = null;
  } else {
    const parts: string[] = [];
    if (s.modelDisplayName) parts.push(s.modelDisplayName);
    if (typeof s.contextUsedPct === "number") {
      parts.push(`${Math.round(s.contextUsedPct)}% ctx`);
    }
    const cost = formatClaudeCost(s.costUsd);
    if (cost) parts.push(cost);
    if (parts.length === 0 && s.turnCount > 0) {
      parts.push(`turn ${s.turnCount}`);
    }
    ticker = parts.length > 0 ? parts.join(" · ") : null;
  }
  return { label, ticker };
}

export function prettyErrorType(errorType: string | null): string {
  switch (errorType) {
    case "rate_limit":
      return "Rate limited";
    case "overloaded":
      return "API overloaded";
    case "authentication_failed":
      return "Auth failed";
    default:
      return errorType ? `Error: ${errorType}` : "Error";
  }
}

/** Pure: should this transition fire a notification, and which one?
 *  Exported for unit tests. */
export function decideNotification(
  s: ClaudeSessionState,
  prev: ClaudeSessionState | null,
  now: number,
): { title: string; body: string } | null {
  if (!prev) return null;

  // Turn completed: prompt was in flight, now it isn't, and we didn't
  // fail. (waiting-input → stop also lands here, which is correct — the
  // turn is over either way.)
  const turnEnded =
    prev.promptStartedAt > 0 &&
    s.promptStartedAt === 0 &&
    s.phase === "idle" &&
    !s.ended;
  if (turnEnded) {
    const title = `Claude · ${sessionTitle(s)}`;
    const meta: string[] = [];
    const dur = now - prev.promptStartedAt;
    if (dur > 0) meta.push(formatClaudeDuration(dur));
    const cost = formatClaudeCost(s.costUsd);
    if (cost) meta.push(cost);
    const bodyLines: string[] = [];
    if (s.currentPrompt) bodyLines.push(truncate(s.currentPrompt, 240));
    if (meta.length) bodyLines.push(meta.join(" · "));
    return { title, body: bodyLines.join("\n") };
  }

  // Turn failed on an API error.
  if (s.phase === "error" && prev.phase !== "error") {
    return {
      title: `Claude Code · ${prettyErrorType(s.errorType).toLowerCase()}`,
      body: s.errorMessage || "The turn ended on an API error.",
    };
  }

  // A tool needs consent — the one mid-turn state worth interrupting for.
  if (s.phase === "waiting-approval" && prev.phase !== "waiting-approval") {
    return {
      title: "Claude Code · approval needed",
      body: s.approvalMessage
        ? `${s.approvalMessage} — answer the modal or check the pane.`
        : "A tool needs permission — check the pane.",
    };
  }

  // waiting-input intentionally does NOT notify (bridge-v1 Plan #03 §C:
  // the pill is enough; a toast on every pause is noise).
  return null;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

export class ClaudeStatusPresenter {
  private deps: ClaudePresenterDeps;
  /** Last rendered pill payloads per session — skip no-op dispatches
   *  (the registry emits on every event AND every statusline tee). */
  private lastRendered = new Map<string, string>();
  private unsubscribe: (() => void) | null = null;
  private readonly now: () => number;

  constructor(deps: ClaudePresenterDeps, now: () => number = Date.now) {
    this.deps = deps;
    this.now = now;
  }

  attach(registry: ClaudeSessionRegistry): void {
    this.unsubscribe?.();
    this.unsubscribe = registry.onChange((s, prev) => {
      this.onChange(s, prev);
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onChange(
    s: ClaudeSessionState,
    prev: ClaudeSessionState | null,
  ): void {
    if (this.deps.enabled && !this.deps.enabled()) return;

    const pills = renderPills(s);
    const fingerprint = JSON.stringify(pills);
    const changed = this.lastRendered.get(s.sessionId) !== fingerprint;
    if (changed) {
      this.lastRendered.set(s.sessionId, fingerprint);
      const base: Record<string, unknown> = {};
      if (s.surfaceId) base["surface_id"] = s.surfaceId;

      if (pills.label) {
        this.call("sidebar.set_status", {
          ...base,
          key: LABEL_KEY,
          value: pills.label.value,
          icon: LABEL_ICON,
          color: pills.label.color,
        });
      } else {
        this.call("sidebar.clear_status", { ...base, key: LABEL_KEY });
      }

      if (pills.ticker) {
        this.call("sidebar.set_status", {
          ...base,
          key: TICKER_KEY,
          value: pills.ticker,
          icon: TICKER_ICON,
          color: COLOR_TICKER,
        });
      } else if (s.ended) {
        this.call("sidebar.clear_status", { ...base, key: TICKER_KEY });
      }
    }

    if (s.ended) this.lastRendered.delete(s.sessionId);

    const notif = decideNotification(s, prev, this.now());
    if (notif) {
      this.call("notification.create", {
        title: notif.title,
        body: notif.body,
        subtitle: NOTIFY_SUBTITLE,
        ...(s.surfaceId ? { surface_id: s.surfaceId } : {}),
      });
    }
  }

  private call(method: string, params: Record<string, unknown>): void {
    try {
      const r = this.deps.callRpc(method, params);
      if (r instanceof Promise) {
        r.catch((err) => {
          console.error(
            `[claude-presenter] ${method} rejected: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    } catch (err) {
      // Presentation must never poison registry ingestion.
      console.error(
        `[claude-presenter] ${method} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
