/**
 * Claude Code statusline — parse + render (august-plan M1 / WS2).
 *
 * `ht claude statusline` is installed as the user's Claude Code statusline
 * command. Claude Code pipes a JSON session snapshot on stdin on every
 * assistant message / compact / mode change; we do two things with it:
 *
 *   1. render a status line back to Claude Code (this module — pure),
 *   2. tee the parsed subset to the τ-mux registry (`claude.statusline`).
 *
 * Both consumers share `parseStatuslinePayload` so the registry and the
 * rendered line can never disagree about a field. Everything is optional-
 * tolerant: fields missing on older Claude Code versions simply drop out
 * of the rendered line (design principle: gate on field presence).
 */

import type { ClaudeRateLimits, ClaudeStatuslineData } from "./claude-types";
import { formatClaudeCost } from "./claude-types";

// ---------------------------------------------------------------------------
// Parsing — raw statusline stdin JSON → ClaudeStatuslineData
// ---------------------------------------------------------------------------

function str(x: unknown): string | undefined {
  return typeof x === "string" && x ? x : undefined;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

/**
 * Parse Claude Code's statusline JSON into the subset τ-mux keeps.
 * Returns null when `session_id` is absent (nothing to attribute to).
 * `surfaceId` comes from the caller (HT_SURFACE in the statusline
 * process env), not the payload.
 */
export function parseStatuslinePayload(
  raw: Record<string, unknown>,
  surfaceId?: string,
): ClaudeStatuslineData | null {
  const sessionId = str(raw["session_id"]);
  if (!sessionId) return null;

  const model = obj(raw["model"]);
  const workspace = obj(raw["workspace"]);
  const cost = obj(raw["cost"]);
  const ctx = obj(raw["context_window"]);
  const rl = obj(raw["rate_limits"]);
  const fiveHour = obj(rl["five_hour"]);
  const sevenDay = obj(rl["seven_day"]);
  const pr = obj(raw["pr"]);
  const effort = obj(raw["effort"]);
  const outputStyle = obj(raw["output_style"]);

  const rateLimits: Partial<ClaudeRateLimits> = {
    fiveHourPct: num(fiveHour["used_percentage"]) ?? null,
    fiveHourResetsAt: num(fiveHour["resets_at"]) ?? null,
    sevenDayPct: num(sevenDay["used_percentage"]) ?? null,
    sevenDayResetsAt: num(sevenDay["resets_at"]) ?? null,
  };

  return {
    sessionId,
    surfaceId,
    sessionName: str(raw["session_name"]),
    modelId: str(model["id"]),
    modelDisplayName: str(model["display_name"]),
    cwd: str(workspace["current_dir"]) ?? str(raw["cwd"]),
    projectDir: str(workspace["project_dir"]),
    costUsd: num(cost["total_cost_usd"]),
    durationMs: num(cost["total_duration_ms"]),
    linesAdded: num(cost["total_lines_added"]),
    linesRemoved: num(cost["total_lines_removed"]),
    contextUsedPct: num(ctx["used_percentage"]),
    contextTokens:
      num(ctx["total_input_tokens"]) !== undefined ||
      num(ctx["total_output_tokens"]) !== undefined
        ? (num(ctx["total_input_tokens"]) ?? 0) +
          (num(ctx["total_output_tokens"]) ?? 0)
        : undefined,
    contextWindowSize: num(ctx["context_window_size"]),
    rateLimits,
    permissionMode: str(raw["permission_mode"]),
    effortLevel: str(effort["level"]),
    outputStyle: str(outputStyle["name"]),
    prNumber: num(pr["number"]),
    prUrl: str(pr["url"]),
    prReviewState: str(pr["review_state"]),
    transcriptPath: str(raw["transcript_path"]),
    ccVersion: str(raw["version"]),
  };
}

// ---------------------------------------------------------------------------
// Rendering — ClaudeStatuslineData → ANSI status line for Claude Code
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

/** Context meter thresholds — mirrored by the sidebar meter (WS2) so the
 *  terminal statusline and the τ-mux UI always agree on the color story. */
export const CONTEXT_WARN_PCT = 70;
export const CONTEXT_DANGER_PCT = 90;
/** Rate-limit segment only appears at/above this consumption. */
export const RATE_LIMIT_SHOW_PCT = 80;

function contextColor(pct: number): string {
  if (pct >= CONTEXT_DANGER_PCT) return RED;
  if (pct >= CONTEXT_WARN_PCT) return YELLOW;
  return GREEN;
}

function bar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function shortDir(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

function fmtResetTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export interface RenderStatuslineOptions {
  /** Bar width in cells. */
  barWidth?: number;
  /** `git branch --show-current` result, resolved by the caller (the
   *  renderer stays pure — no subprocesses here). */
  gitBranch?: string;
  /** Strip ANSI (tests / dumb terminals). */
  noColor?: boolean;
}

/**
 * Render the two-line τ-mux statusline. Line 1: identity (model, dir,
 * branch, mode). Line 2: meters (context bar, cost, lines, rate limits).
 * Segments with no data drop out; an empty payload renders just the model
 * fallback so the line never goes fully blank.
 */
export function renderStatusline(
  d: ClaudeStatuslineData,
  opts: RenderStatuslineOptions = {},
): string {
  const width = opts.barWidth ?? 14;
  const c = (code: string, s: string) =>
    opts.noColor ? s : `${code}${s}${RESET}`;

  // --- line 1: identity
  const id: string[] = [];
  id.push(c(BOLD + MAGENTA, d.modelDisplayName ?? "Claude"));
  if (d.effortLevel && d.effortLevel !== "medium") {
    id.push(c(DIM, d.effortLevel));
  }
  if (d.cwd) id.push(c(CYAN, shortDir(d.cwd)));
  if (opts.gitBranch) id.push(c(DIM, "⎇ " + opts.gitBranch));
  if (d.permissionMode && d.permissionMode !== "default") {
    const modeColor = d.permissionMode === "bypassPermissions" ? RED : YELLOW;
    id.push(c(modeColor, d.permissionMode));
  }
  if (d.prNumber != null) {
    const state = d.prReviewState ? ` ${d.prReviewState}` : "";
    id.push(c(DIM, `PR #${d.prNumber}${state}`));
  }

  // --- line 2: meters
  const meters: string[] = [];
  if (typeof d.contextUsedPct === "number") {
    const pct = d.contextUsedPct;
    meters.push(c(contextColor(pct), `${bar(pct, width)} ${Math.round(pct)}%`));
  }
  const costStr = formatClaudeCost(d.costUsd ?? null);
  if (costStr) meters.push(c(DIM, costStr));
  if (typeof d.linesAdded === "number" || typeof d.linesRemoved === "number") {
    const add = d.linesAdded ?? 0;
    const del = d.linesRemoved ?? 0;
    if (add > 0 || del > 0) {
      meters.push(`${c(GREEN, `+${add}`)} ${c(RED, `-${del}`)}`);
    }
  }
  for (const [label, pct, resetsAt] of [
    ["5h", d.rateLimits?.fiveHourPct, d.rateLimits?.fiveHourResetsAt],
    ["7d", d.rateLimits?.sevenDayPct, d.rateLimits?.sevenDayResetsAt],
  ] as const) {
    if (typeof pct === "number" && pct >= RATE_LIMIT_SHOW_PCT) {
      const reset =
        typeof resetsAt === "number" && resetsAt > 0
          ? ` → ${fmtResetTime(resetsAt)}`
          : "";
      meters.push(
        c(pct >= 95 ? RED : YELLOW, `⏳ ${label} ${Math.round(pct)}%${reset}`),
      );
    }
  }

  const line1 = id.join(c(DIM, " · "));
  if (meters.length === 0) return line1;
  return `${line1}\n${meters.join(c(DIM, " · "))}`;
}
