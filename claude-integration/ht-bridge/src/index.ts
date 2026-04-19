#!/usr/bin/env bun
/**
 * ht-bridge — Claude Code → τ-mux sidebar bridge.
 *
 * Mirrors the pi-extensions/ht-notify-summary shape for Claude Code's
 * shell-hook surface. Invoked by ~/.claude/settings.json with an event
 * kind as argv[2]; reads the hook JSON payload on stdin; shells out to
 * `ht` to update the sidebar pill or fire a notification.
 *
 * Events (argv[2]):
 *   prompt             UserPromptSubmit — set the active "Claude : <label>"
 *                      pill; remember prompt + started_at so Stop can build
 *                      a summary notification.
 *   stop               Stop — clear the active pill, parse the transcript
 *                      for tokens + cost, fire `ht notify` with the final
 *                      label, duration and spend; update the persistent
 *                      ticker pill with session totals.
 *   notify-idle        Notification matcher="idle_prompt" — orange pill
 *                      + sidebar notification asking for input.
 *   notify-permission  Notification matcher="permission_prompt" — red
 *                      pill + notification asking for approval.
 *
 * Between events we keep tiny per-session state files at
 *   $TMPDIR/ht-claude-bridge/<session_id>.json
 * Files older than 24 h are pruned on every invocation.
 *
 * Every `ht` call is fire-and-forget (no awaiting) — if τ-mux isn't
 * running the ht CLI just fails silently and the hook continues. Nothing
 * in this runner is allowed to block Claude Code's hook pipeline; set
 * HT_CLAUDE_DEBUG=1 to surface errors on stderr.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelCost {
  /** USD per million tokens. Matches pi-ai's model.cost convention. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface Config {
  enabled: boolean;
  htBinary: string;

  // Active label pill ("Claude : Fixing the bug").
  labelKey: string;
  labelIcon: string;
  labelColor: string;
  labelMaxChars: number;

  // State colors for idle / permission / error.
  idleColor: string;
  permissionColor: string;

  // Persistent ticker pill ("cc : turn 3 · 2.1 min · $0.034").
  tickerEnabled: boolean;
  tickerKey: string;
  tickerIcon: string;
  tickerColor: string;

  // Notification subtitle.
  notifySubtitle: string;

  // Pricing tables — $ per million tokens. Unknown models fall back to
  // a tier heuristic (opus / sonnet / haiku substring match).
  pricing: Record<string, ModelCost>;

  // Per-session state storage.
  stateDir: string;
  stateTTLMs: number;
}

interface SessionState {
  sessionId: string;
  /** First UserPromptSubmit we saw. Drives the ticker's "elapsed". */
  startedAt: number;
  /** Most recent UserPromptSubmit. Drives the Stop-notification "took N s". */
  promptStartedAt: number;
  currentLabel: string;
  currentPrompt: string;
  turnCount: number;
  lastModel: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostUSD: number;
  cwd: string;
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Config = {
  enabled: true,
  htBinary: "ht",
  labelKey: "Claude",
  labelIcon: "bolt",
  labelColor: "#f5c2e7",
  labelMaxChars: 40,
  idleColor: "#f9e2af",
  permissionColor: "#f38ba8",
  tickerEnabled: true,
  tickerKey: "cc",
  tickerIcon: "chart",
  tickerColor: "#89b4fa",
  notifySubtitle: "Claude Code",
  // Seed prices for the Claude 4.x family as of 2026-04. Unknown versions
  // fall back to a tier heuristic in `findFuzzyPrice`. Users can override
  // via config.json without touching this source.
  pricing: {
    "claude-opus-4-7": {
      input: 15,
      output: 75,
      cacheRead: 1.5,
      cacheWrite: 18.75,
    },
    "claude-opus-4-6": {
      input: 15,
      output: 75,
      cacheRead: 1.5,
      cacheWrite: 18.75,
    },
    "claude-opus-4-5": {
      input: 15,
      output: 75,
      cacheRead: 1.5,
      cacheWrite: 18.75,
    },
    "claude-sonnet-4-6": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    "claude-sonnet-4-5": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    "claude-haiku-4-5": {
      input: 0.8,
      output: 4,
      cacheRead: 0.08,
      cacheWrite: 1.0,
    },
  },
  stateDir: join(tmpdir(), "ht-claude-bridge"),
  stateTTLMs: 24 * 60 * 60 * 1000,
};

function loadConfig(): Config {
  const here = dirname(fileURLToPath(import.meta.url));
  const configPath = join(here, "..", "config.json");
  let fromFile: Partial<Config> = {};
  try {
    fromFile = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<Config>;
  } catch {
    /* optional — defaults stand */
  }

  const c: Config = { ...DEFAULT_CONFIG, ...fromFile };
  // Pricing merges per-entry so partial user overrides keep the baseline.
  if (fromFile.pricing) {
    c.pricing = { ...DEFAULT_CONFIG.pricing, ...fromFile.pricing };
  }

  // Env overrides — take precedence over config.json.
  const env = process.env;
  if (env.HT_CLAUDE_ENABLED !== undefined) {
    c.enabled =
      env.HT_CLAUDE_ENABLED !== "0" &&
      env.HT_CLAUDE_ENABLED.toLowerCase() !== "false";
  }
  if (env.HT_CLAUDE_HT_BIN) c.htBinary = env.HT_CLAUDE_HT_BIN;
  if (env.HT_CLAUDE_LABEL_KEY) c.labelKey = env.HT_CLAUDE_LABEL_KEY;
  if (env.HT_CLAUDE_TICKER_KEY) c.tickerKey = env.HT_CLAUDE_TICKER_KEY;
  if (env.HT_CLAUDE_TICKER_ENABLED !== undefined) {
    c.tickerEnabled =
      env.HT_CLAUDE_TICKER_ENABLED !== "0" &&
      env.HT_CLAUDE_TICKER_ENABLED.toLowerCase() !== "false";
  }
  return c;
}

// ---------------------------------------------------------------------------
// State — tiny per-session JSON blobs under $TMPDIR/ht-claude-bridge/
// ---------------------------------------------------------------------------

function newState(sessionId: string): SessionState {
  return {
    sessionId,
    startedAt: 0,
    promptStartedAt: 0,
    currentLabel: "",
    currentPrompt: "",
    turnCount: 0,
    lastModel: "",
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCostUSD: 0,
    cwd: "",
  };
}

function loadState(cfg: Config, sessionId: string): SessionState {
  try {
    const file = join(cfg.stateDir, `${sessionId}.json`);
    const raw = readFileSync(file, "utf-8");
    return { ...newState(sessionId), ...JSON.parse(raw) };
  } catch {
    return newState(sessionId);
  }
}

function saveState(cfg: Config, state: SessionState): void {
  if (!existsSync(cfg.stateDir)) mkdirSync(cfg.stateDir, { recursive: true });
  const file = join(cfg.stateDir, `${state.sessionId}.json`);
  // Atomic write: tmpfile + rename so a crash mid-write never produces
  // a half-written JSON blob that the next hook can't parse.
  const tmp = `${file}.tmp${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file);
}

function pruneOldState(cfg: Config): void {
  try {
    if (!existsSync(cfg.stateDir)) return;
    const cutoff = Date.now() - cfg.stateTTLMs;
    for (const f of readdirSync(cfg.stateDir)) {
      if (!f.endsWith(".json")) continue;
      const fp = join(cfg.stateDir, f);
      try {
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      } catch {
        /* race with another hook — fine */
      }
    }
  } catch {
    /* best-effort janitor — never fail a hook because of cleanup */
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** One-line active task label. Prefers the first clause of the user's
 *  prompt; falls back to a hard char cap so the sidebar pill never wraps. */
function truncateLabel(prompt: string, max: number): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Working";
  const firstClause = trimmed.split(/[.!?\n]/)[0]!.trim() || trimmed;
  if (firstClause.length <= max) return firstClause;
  return firstClause.slice(0, max - 1).trimEnd() + "…";
}

function truncateBody(s: string, max = 240): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function formatDuration(ms: number): string {
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

function formatCost(cost: number): string {
  if (cost <= 0) return "";
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  // Strip meaningless trailing zeros but keep one decimal so `$0.10`
  // doesn't collapse to `$0.1`.
  const fixed = cost.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
  return `$${fixed}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ---------------------------------------------------------------------------
// Transcript parsing — compute cumulative token + cost from the JSONL
// file Claude Code writes incrementally during the session.
// ---------------------------------------------------------------------------

interface TranscriptTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  lastModel: string;
}

function parseTranscript(path: string): TranscriptTotals {
  const totals: TranscriptTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    lastModel: "",
  };
  try {
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let obj: {
        message?: { model?: string; usage?: Record<string, unknown> };
      };
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = obj.message;
      if (!msg || typeof msg !== "object") continue;
      if (typeof msg.model === "string" && msg.model)
        totals.lastModel = msg.model;
      const u = msg.usage;
      if (!u) continue;
      totals.inputTokens += numOrZero(u["input_tokens"]);
      totals.outputTokens += numOrZero(u["output_tokens"]);
      totals.cacheReadTokens += numOrZero(u["cache_read_input_tokens"]);
      totals.cacheWriteTokens += numOrZero(u["cache_creation_input_tokens"]);
    }
  } catch {
    /* transcript missing / unreadable — zeros are fine */
  }
  return totals;
}

function numOrZero(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function calcCost(cfg: Config, t: TranscriptTotals): number {
  if (!t.lastModel) return 0;
  const price = cfg.pricing[t.lastModel] ?? findFuzzyPrice(cfg, t.lastModel);
  if (!price) return 0;
  return (
    (price.input * t.inputTokens) / 1_000_000 +
    (price.output * t.outputTokens) / 1_000_000 +
    (price.cacheRead * t.cacheReadTokens) / 1_000_000 +
    (price.cacheWrite * t.cacheWriteTokens) / 1_000_000
  );
}

function findFuzzyPrice(cfg: Config, model: string): ModelCost | null {
  // Dated variants like `claude-opus-4-7-20260118` → match on prefix.
  for (const [key, p] of Object.entries(cfg.pricing)) {
    if (model.startsWith(key)) return p;
  }
  // Tier heuristic — covers future point releases before the user adds
  // an explicit entry to config.json.
  if (model.includes("opus")) return cfg.pricing["claude-opus-4-7"] ?? null;
  if (model.includes("sonnet")) return cfg.pricing["claude-sonnet-4-6"] ?? null;
  if (model.includes("haiku")) return cfg.pricing["claude-haiku-4-5"] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// ht CLI wrappers — fire-and-forget; exit code is ignored.
// ---------------------------------------------------------------------------

function runHt(cfg: Config, args: string[]): void {
  try {
    const child = spawn(cfg.htBinary, args, { stdio: "ignore" });
    child.on("error", (err) => {
      if (process.env.HT_CLAUDE_DEBUG) {
        console.error(`[ht-bridge] ht ${args[0]}: ${err.message}`);
      }
    });
  } catch (err) {
    if (process.env.HT_CLAUDE_DEBUG) {
      console.error(
        `[ht-bridge] spawn ht failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function htSetStatus(
  cfg: Config,
  key: string,
  value: string,
  icon: string,
  color: string,
): void {
  runHt(cfg, ["set-status", key, value, "--icon", icon, "--color", color]);
}

function htClearStatus(cfg: Config, key: string): void {
  runHt(cfg, ["clear-status", key]);
}

function htNotify(cfg: Config, title: string, body: string): void {
  const args = ["notify", "--title", title, "--body", body];
  if (cfg.notifySubtitle) args.push("--subtitle", cfg.notifySubtitle);
  runHt(cfg, args);
}

// ---------------------------------------------------------------------------
// Ticker — composes the persistent "cc" pill from session totals.
// ---------------------------------------------------------------------------

function tickerLine(state: SessionState, fallback: string): string {
  const parts: string[] = [];
  if (state.turnCount > 0) parts.push(`turn ${state.turnCount}`);
  const elapsed = state.startedAt > 0 ? Date.now() - state.startedAt : 0;
  if (elapsed >= 1500) parts.push(formatDuration(elapsed));
  if (state.totalCostUSD > 0) {
    parts.push(formatCost(state.totalCostUSD));
  } else if (state.totalOutputTokens > 0) {
    parts.push(`${formatTokens(state.totalOutputTokens)} out`);
  }
  if (parts.length === 0) parts.push(fallback);
  return parts.join(" · ");
}

function setTicker(cfg: Config, state: SessionState, fallback: string): void {
  if (!cfg.tickerEnabled) return;
  htSetStatus(
    cfg,
    cfg.tickerKey,
    tickerLine(state, fallback),
    cfg.tickerIcon,
    cfg.tickerColor,
  );
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handlePrompt(cfg: Config, payload: Record<string, unknown>): void {
  const sessionId = (payload["session_id"] as string) || "unknown";
  const state = loadState(cfg, sessionId);
  state.sessionId = sessionId;
  if (state.startedAt === 0) state.startedAt = Date.now();
  state.promptStartedAt = Date.now();
  state.turnCount += 1;
  state.currentPrompt =
    typeof payload["prompt"] === "string" ? (payload["prompt"] as string) : "";
  state.currentLabel = truncateLabel(state.currentPrompt, cfg.labelMaxChars);
  if (typeof payload["cwd"] === "string") state.cwd = payload["cwd"] as string;
  saveState(cfg, state);

  htSetStatus(
    cfg,
    cfg.labelKey,
    state.currentLabel,
    cfg.labelIcon,
    cfg.labelColor,
  );
  setTicker(cfg, state, state.currentLabel);
}

function handleStop(cfg: Config, payload: Record<string, unknown>): void {
  const sessionId = (payload["session_id"] as string) || "unknown";
  const state = loadState(cfg, sessionId);
  state.sessionId = sessionId;

  // Pull the authoritative token totals from the transcript Claude Code
  // maintains. Cheaper than asking the user to wire a separate usage
  // tracker, and resilient to us missing intermediate hook events.
  const transcriptPath = payload["transcript_path"];
  if (typeof transcriptPath === "string" && transcriptPath) {
    const totals = parseTranscript(transcriptPath);
    state.totalInputTokens = totals.inputTokens;
    state.totalOutputTokens = totals.outputTokens;
    state.totalCacheReadTokens = totals.cacheReadTokens;
    state.totalCacheWriteTokens = totals.cacheWriteTokens;
    if (totals.lastModel) state.lastModel = totals.lastModel;
    state.totalCostUSD = calcCost(cfg, totals);
  }

  const turnMs =
    state.promptStartedAt > 0 ? Date.now() - state.promptStartedAt : 0;
  saveState(cfg, state);

  htClearStatus(cfg, cfg.labelKey);

  // Build the notification. Title carries the label so the sidebar row
  // is scannable; body carries the original prompt + metadata.
  const title = state.currentLabel
    ? `Claude · ${state.currentLabel}`
    : "Claude done";
  const metaParts: string[] = [];
  if (turnMs > 0) metaParts.push(formatDuration(turnMs));
  if (state.totalCostUSD > 0) metaParts.push(formatCost(state.totalCostUSD));
  else if (state.totalOutputTokens > 0)
    metaParts.push(`${formatTokens(state.totalOutputTokens)} out`);
  const bodyLines: string[] = [];
  if (state.currentPrompt) bodyLines.push(truncateBody(state.currentPrompt));
  if (metaParts.length) bodyLines.push(metaParts.join(" · "));
  htNotify(cfg, title, bodyLines.join("\n"));

  // Refresh the persistent ticker with the final totals.
  setTicker(cfg, state, "Done");
}

function handleNotifyIdle(cfg: Config, payload: Record<string, unknown>): void {
  const sessionId = (payload["session_id"] as string) || "unknown";
  const state = loadState(cfg, sessionId);
  // Don't bump turnCount — this is a mid-turn signal, not a new turn.
  saveState(cfg, state);

  htSetStatus(
    cfg,
    cfg.labelKey,
    "Waiting for input",
    cfg.labelIcon,
    cfg.idleColor,
  );
  const msg = (payload["message"] as string) || "Awaiting your prompt";
  htNotify(cfg, "Claude Code · waiting", msg);
}

function handleNotifyPermission(
  cfg: Config,
  payload: Record<string, unknown>,
): void {
  const sessionId = (payload["session_id"] as string) || "unknown";
  const state = loadState(cfg, sessionId);
  saveState(cfg, state);

  htSetStatus(
    cfg,
    cfg.labelKey,
    "Approval needed",
    cfg.labelIcon,
    cfg.permissionColor,
  );
  const msg = (payload["message"] as string) || "A tool needs permission";
  htNotify(cfg, "Claude Code · approval needed", msg);
}

// ---------------------------------------------------------------------------
// stdin reader — Claude Code pipes the hook payload as JSON on stdin.
// Returns `{}` on TTY / empty / parse failure so the dispatcher can
// still run with reasonable fallbacks.
// ---------------------------------------------------------------------------

async function readStdin(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const event = process.argv[2];
  if (!event) {
    if (process.env.HT_CLAUDE_DEBUG) {
      console.error("[ht-bridge] missing event argv[2]");
    }
    return;
  }

  pruneOldState(cfg);

  let payload: Record<string, unknown> = {};
  try {
    payload = await readStdin();
  } catch {
    /* nothing on stdin — fine */
  }

  try {
    switch (event) {
      case "prompt":
        handlePrompt(cfg, payload);
        break;
      case "stop":
        handleStop(cfg, payload);
        break;
      case "notify-idle":
        handleNotifyIdle(cfg, payload);
        break;
      case "notify-permission":
        handleNotifyPermission(cfg, payload);
        break;
      default:
        if (process.env.HT_CLAUDE_DEBUG) {
          console.error(`[ht-bridge] unknown event: ${event}`);
        }
    }
  } catch (err) {
    if (process.env.HT_CLAUDE_DEBUG) {
      console.error(
        `[ht-bridge] ${event} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

void main();
