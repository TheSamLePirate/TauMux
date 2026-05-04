/**
 * ht-bridge configuration.
 *
 * Loaded once at extension factory time. File at `config.json` next
 * to the extension is the base; env vars override individual fields
 * so a single install can be retargeted per shell. Field ordering
 * matches `config.json` so a diff against the JSON is readable.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  // ── Active label pill ("Pi : Fixing the bug") ─────────────────────
  enabled: boolean;
  provider: string;
  modelId: string;
  minWords: number;
  maxWords: number;
  htBinary: string;
  notifySubtitle?: string;
  statusKey: string;
  statusIcon: string;
  statusColor: string;

  // ── Token / cost ticker ───────────────────────────────────────────
  tickerEnabled: boolean;
  tickerStatusKey: string;
  tickerStatusIcon: string;
  tickerStatusColor: string;
  tickerShowCost: boolean;
  tickerCostDecimals: number;
  tickerCostUnit: number;
  tickerFormat: "compact" | "verbose";

  // ── Phase 2 observers (gated independently) ───────────────────────
  toolBadgeEnabled: boolean;
  toolBadgeStatusKey: string;
  toolBadgeStatusIcon: string;
  toolBadgeStatusColor: string;

  planMirrorEnabled: boolean;

  activityLogEnabled: boolean;
  activityLogSource: string;

  /** K2000-style sweeping scanner installed as pi's working
   *  indicator. Animates only while pi is streaming a response. */
  tuiHeartbeatEnabled: boolean;
  tuiHeartbeatIntervalMs: number;
  tuiHeartbeatLength: number;

  /** Footer pill announcing ht-bridge's load state — green when
   *  talking to a τ-mux pane (with workspace + surface id), red
   *  when running outside τ-mux. Always renders if true; the rest
   *  of the extension is short-circuited outside τ-mux regardless. */
  tuiStatusEnabled: boolean;

  // ── Phase 3 — interception + LLM-callable tools + system prompt ───
  /** "off" disables the bash-safety gate entirely;
   *  "confirmRisky" only prompts on matched risk patterns (default);
   *  "confirmAll" prompts on every bash invocation (paranoid). */
  bashSafetyMode: "off" | "confirmRisky" | "confirmAll";
  bashSafetyTimeoutMs: number;

  /** Master switch for `pi.registerTool({ name: "ht_*" })`. The
   *  individual flags below let the user opt in/out per tool family. */
  toolsEnabled: boolean;
  toolAskUserEnabled: boolean;
  toolPlanEnabled: boolean;
  toolBrowserEnabled: boolean;
  toolNotifyEnabled: boolean;
  toolScreenshotEnabled: boolean;
  /** Spawn long-running commands in a sibling τ-mux split. */
  toolRunInSplitEnabled: boolean;

  /** Inject a τ-mux primer into pi's system prompt at every turn,
   *  describing the registered ht_* tools + active surface metadata. */
  systemPromptPrimerEnabled: boolean;

  // ── Phase 4 — slash commands + lifecycle integrations ─────────────
  commandsEnabled: boolean;
  /** Show "Compacting…" pill while pi rolls a session into a summary. */
  lifecycleCompactionEnabled: boolean;
  /** Replay the last ht_plan_set on session_start{reason:"resume"|"fork"}. */
  lifecycleResumeEnabled: boolean;

  // ── Transport ─────────────────────────────────────────────────────
  /** Try the Unix socket first; fall back to ht CLI on failure. */
  socketEnabled: boolean;
  /** Empty string → resolve via $HT_SOCKET_PATH or /tmp/hyperterm.sock. */
  socketPath: string;
}

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  provider: "anthropic",
  modelId: "claude-haiku-4-5",
  minWords: 3,
  maxWords: 5,
  htBinary: "ht",
  notifySubtitle: "pi agent",
  statusKey: "Pi",
  statusIcon: "bolt",
  statusColor: "#a6e3a1",

  tickerEnabled: true,
  tickerStatusKey: "ctx",
  tickerStatusIcon: "chart",
  tickerStatusColor: "#89b4fa",
  tickerShowCost: true,
  tickerCostDecimals: 3,
  tickerCostUnit: 1_000_000,
  tickerFormat: "compact",

  toolBadgeEnabled: true,
  toolBadgeStatusKey: "pi_tool",
  toolBadgeStatusIcon: "tool",
  toolBadgeStatusColor: "#fab387",

  planMirrorEnabled: true,

  activityLogEnabled: true,
  activityLogSource: "pi",

  tuiHeartbeatEnabled: true,
  tuiHeartbeatIntervalMs: 80,
  tuiHeartbeatLength: 8,

  tuiStatusEnabled: true,

  bashSafetyMode: "confirmRisky",
  bashSafetyTimeoutMs: 60_000,

  toolsEnabled: true,
  toolAskUserEnabled: true,
  toolPlanEnabled: true,
  toolBrowserEnabled: true,
  toolNotifyEnabled: true,
  toolScreenshotEnabled: true,
  toolRunInSplitEnabled: true,

  systemPromptPrimerEnabled: true,

  commandsEnabled: true,
  lifecycleCompactionEnabled: true,
  lifecycleResumeEnabled: true,

  socketEnabled: true,
  socketPath: "",
};

/** Resolve the config.json that sits one directory above `lib/`. */
function configPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "config.json");
}

export function loadConfig(): Config {
  let fromFile: Partial<Config> = {};
  try {
    fromFile = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    /* missing/invalid config.json — defaults are fine */
  }

  const env = process.env;
  const merged: Config = { ...DEFAULT_CONFIG, ...fromFile };

  // Older env-var prefix kept for compatibility — these vars predate
  // the rename to ht-bridge and remain the documented public surface.
  if (env.PI_HT_NOTIFY_ENABLED !== undefined) {
    merged.enabled =
      env.PI_HT_NOTIFY_ENABLED !== "0" &&
      env.PI_HT_NOTIFY_ENABLED.toLowerCase() !== "false";
  }
  if (env.PI_HT_NOTIFY_PROVIDER) merged.provider = env.PI_HT_NOTIFY_PROVIDER;
  if (env.PI_HT_NOTIFY_MODEL) merged.modelId = env.PI_HT_NOTIFY_MODEL;
  if (env.PI_HT_NOTIFY_MIN_WORDS)
    merged.minWords = Math.max(
      1,
      parseInt(env.PI_HT_NOTIFY_MIN_WORDS, 10) || merged.minWords,
    );
  if (env.PI_HT_NOTIFY_MAX_WORDS)
    merged.maxWords = Math.max(
      1,
      parseInt(env.PI_HT_NOTIFY_MAX_WORDS, 10) || merged.maxWords,
    );
  if (env.PI_HT_NOTIFY_HT_BIN) merged.htBinary = env.PI_HT_NOTIFY_HT_BIN;
  if (env.PI_HT_NOTIFY_STATUS_KEY)
    merged.statusKey = env.PI_HT_NOTIFY_STATUS_KEY;
  if (env.PI_HT_NOTIFY_STATUS_ICON)
    merged.statusIcon = env.PI_HT_NOTIFY_STATUS_ICON;
  if (env.PI_HT_NOTIFY_STATUS_COLOR)
    merged.statusColor = env.PI_HT_NOTIFY_STATUS_COLOR;

  if (env.PI_HT_NOTIFY_TICKER_ENABLED !== undefined) {
    merged.tickerEnabled =
      env.PI_HT_NOTIFY_TICKER_ENABLED !== "0" &&
      env.PI_HT_NOTIFY_TICKER_ENABLED.toLowerCase() !== "false";
  }
  if (env.PI_HT_NOTIFY_TICKER_KEY)
    merged.tickerStatusKey = env.PI_HT_NOTIFY_TICKER_KEY;
  if (env.PI_HT_NOTIFY_TICKER_ICON)
    merged.tickerStatusIcon = env.PI_HT_NOTIFY_TICKER_ICON;
  if (env.PI_HT_NOTIFY_TICKER_COLOR)
    merged.tickerStatusColor = env.PI_HT_NOTIFY_TICKER_COLOR;
  if (env.PI_HT_NOTIFY_TICKER_COST !== undefined) {
    merged.tickerShowCost =
      env.PI_HT_NOTIFY_TICKER_COST !== "0" &&
      env.PI_HT_NOTIFY_TICKER_COST.toLowerCase() !== "false";
  }
  if (
    env.PI_HT_NOTIFY_TICKER_FORMAT === "compact" ||
    env.PI_HT_NOTIFY_TICKER_FORMAT === "verbose"
  ) {
    merged.tickerFormat = env.PI_HT_NOTIFY_TICKER_FORMAT;
  }

  // Phase 2 env overrides — namespaced under PI_HT_BRIDGE_* so the
  // older PI_HT_NOTIFY_* prefix can stay frozen for back-compat.
  const bool = (v: string | undefined): boolean | undefined =>
    v === undefined ? undefined : v !== "0" && v.toLowerCase() !== "false";

  const tb = bool(env.PI_HT_BRIDGE_TOOL_BADGE);
  if (tb !== undefined) merged.toolBadgeEnabled = tb;
  const pm = bool(env.PI_HT_BRIDGE_PLAN_MIRROR);
  if (pm !== undefined) merged.planMirrorEnabled = pm;
  const al = bool(env.PI_HT_BRIDGE_ACTIVITY_LOG);
  if (al !== undefined) merged.activityLogEnabled = al;
  if (env.PI_HT_BRIDGE_ACTIVITY_LOG_SOURCE)
    merged.activityLogSource = env.PI_HT_BRIDGE_ACTIVITY_LOG_SOURCE;

  const hb = bool(env.PI_HT_BRIDGE_TUI_HEARTBEAT);
  if (hb !== undefined) merged.tuiHeartbeatEnabled = hb;
  const hbi = parseInt(env.PI_HT_BRIDGE_TUI_HEARTBEAT_INTERVAL_MS ?? "", 10);
  if (Number.isFinite(hbi) && hbi >= 16) merged.tuiHeartbeatIntervalMs = hbi;
  const hbl = parseInt(env.PI_HT_BRIDGE_TUI_HEARTBEAT_LENGTH ?? "", 10);
  if (Number.isFinite(hbl) && hbl >= 3 && hbl <= 32)
    merged.tuiHeartbeatLength = hbl;
  const ts = bool(env.PI_HT_BRIDGE_TUI_STATUS);
  if (ts !== undefined) merged.tuiStatusEnabled = ts;

  const so = bool(env.PI_HT_BRIDGE_SOCKET);
  if (so !== undefined) merged.socketEnabled = so;
  if (env.PI_HT_BRIDGE_SOCKET_PATH)
    merged.socketPath = env.PI_HT_BRIDGE_SOCKET_PATH;

  // Phase 3 env overrides.
  if (
    env.PI_HT_BRIDGE_BASH_SAFETY === "off" ||
    env.PI_HT_BRIDGE_BASH_SAFETY === "confirmRisky" ||
    env.PI_HT_BRIDGE_BASH_SAFETY === "confirmAll"
  ) {
    merged.bashSafetyMode = env.PI_HT_BRIDGE_BASH_SAFETY;
  }
  const bst = parseInt(env.PI_HT_BRIDGE_BASH_SAFETY_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(bst) && bst > 0) merged.bashSafetyTimeoutMs = bst;

  const tools = bool(env.PI_HT_BRIDGE_TOOLS);
  if (tools !== undefined) merged.toolsEnabled = tools;
  const tau = bool(env.PI_HT_BRIDGE_TOOL_ASK_USER);
  if (tau !== undefined) merged.toolAskUserEnabled = tau;
  const tpl = bool(env.PI_HT_BRIDGE_TOOL_PLAN);
  if (tpl !== undefined) merged.toolPlanEnabled = tpl;
  const tbr = bool(env.PI_HT_BRIDGE_TOOL_BROWSER);
  if (tbr !== undefined) merged.toolBrowserEnabled = tbr;
  const tn = bool(env.PI_HT_BRIDGE_TOOL_NOTIFY);
  if (tn !== undefined) merged.toolNotifyEnabled = tn;
  const tss = bool(env.PI_HT_BRIDGE_TOOL_SCREENSHOT);
  if (tss !== undefined) merged.toolScreenshotEnabled = tss;
  const tris = bool(env.PI_HT_BRIDGE_TOOL_RUN_IN_SPLIT);
  if (tris !== undefined) merged.toolRunInSplitEnabled = tris;

  const sp = bool(env.PI_HT_BRIDGE_SYSTEM_PROMPT_PRIMER);
  if (sp !== undefined) merged.systemPromptPrimerEnabled = sp;

  const cmds = bool(env.PI_HT_BRIDGE_COMMANDS);
  if (cmds !== undefined) merged.commandsEnabled = cmds;
  const lc = bool(env.PI_HT_BRIDGE_LIFECYCLE_COMPACTION);
  if (lc !== undefined) merged.lifecycleCompactionEnabled = lc;
  const lr = bool(env.PI_HT_BRIDGE_LIFECYCLE_RESUME);
  if (lr !== undefined) merged.lifecycleResumeEnabled = lr;

  if (merged.minWords > merged.maxWords) merged.minWords = merged.maxWords;

  return merged;
}

/** Set true via PI_HT_NOTIFY_DEBUG=1; surfaced as a single check
 *  used by every module that wants to log on failure. */
export const debugEnabled = (): boolean =>
  Boolean(process.env.PI_HT_NOTIFY_DEBUG);
