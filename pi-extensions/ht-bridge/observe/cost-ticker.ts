/**
 * Cost / token / context-window ticker — the persistent "ctx · 34% ·
 * $0.012" pill that updates after every turn.
 *
 *   session_start    → reset counters, clear ticker pill.
 *   turn_end         → bump turn counter, accrue cost, refresh pill.
 *   session_shutdown → clear ticker pill so it never lingers.
 *
 * pi-ai's `model.cost` is per-million-tokens, so we divide by
 * `cfg.tickerCostUnit` (1_000_000 by default).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import { debugEnabled } from "../lib/config";
import type { HtClient } from "../lib/ht-client";

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function numOrZero(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/** Pi-ai emits slightly different field names depending on provider —
 *  check every alias rather than committing to one. */
function extractUsage(message: any): Usage | null {
  const u = message?.usage ?? message?.message?.usage;
  if (!u || typeof u !== "object") return null;
  const input =
    numOrZero(u.input) ||
    numOrZero(u.inputTokens) ||
    numOrZero(u.promptTokens) ||
    numOrZero(u.input_tokens);
  const output =
    numOrZero(u.output) ||
    numOrZero(u.outputTokens) ||
    numOrZero(u.completionTokens) ||
    numOrZero(u.output_tokens);
  const cacheRead =
    numOrZero(u.cacheRead) ||
    numOrZero(u.cacheReadInputTokens) ||
    numOrZero(u.cache_read_input_tokens);
  const cacheWrite =
    numOrZero(u.cacheWrite) ||
    numOrZero(u.cacheCreationInputTokens) ||
    numOrZero(u.cache_creation_input_tokens);
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0)
    return null;
  return { input, output, cacheRead, cacheWrite };
}

function turnCost(cfg: Config, model: any, usage: Usage): number {
  const c = model?.cost;
  if (!c) return 0;
  const unit = cfg.tickerCostUnit || 1_000_000;
  return (
    (numOrZero(c.input) * usage.input) / unit +
    (numOrZero(c.output) * usage.output) / unit +
    (numOrZero(c.cacheRead) * usage.cacheRead) / unit +
    (numOrZero(c.cacheWrite) * usage.cacheWrite) / unit
  );
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtTokensShort(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtCost(cost: number, decimals: number): string {
  // Collapse trailing zeros so `$0.010` renders as `$0.01`, but keep
  // at least one decimal so `$0` never appears next to real money.
  if (cost < 0.01) return `$${cost.toFixed(Math.max(decimals, 3))}`;
  const fixed = cost.toFixed(decimals);
  return `$${fixed.replace(/0+$/, "").replace(/\.$/, ".0")}`;
}

function buildTickerLine(
  cfg: Config,
  turn: number,
  usage: Usage | null,
  ctxTokens: number,
  ctxPct: number | undefined,
  totalCost: number,
): string {
  const showCost = cfg.tickerShowCost && totalCost > 0;
  const costStr = showCost ? fmtCost(totalCost, cfg.tickerCostDecimals) : "";

  if (cfg.tickerFormat === "compact") {
    // "Pi · 34% · $0.012"          (when ctx % is known)
    // "Pi · 12.3k · $0.012"        (fallback: raw token count)
    // "Pi · turn 3"                (no usage data yet)
    const parts: string[] = ["Pi"];
    if (typeof ctxPct === "number") {
      parts.push(`${ctxPct}%`);
    } else if (ctxTokens > 0) {
      parts.push(fmtTokensShort(ctxTokens));
    }
    if (costStr) parts.push(costStr);
    return parts.length > 1 ? parts.join(" · ") : `Pi · turn ${turn}`;
  }

  const parts: string[] = [`pi · turn ${turn}`];
  if (usage) {
    const inTotal = usage.input + usage.cacheRead + usage.cacheWrite;
    parts.push(`${fmtNum(inTotal)} in / ${fmtNum(usage.output)} out`);
  }
  if (typeof ctxPct === "number") parts.push(`ctx ${ctxPct}%`);
  if (costStr) parts.push(costStr);
  return parts.join(" · ");
}

export function registerCostTicker(
  pi: ExtensionAPI,
  cfg: Config,
  ht: HtClient,
): void {
  let turnCount = 0;
  let totalCost = 0;

  const reset = () => {
    turnCount = 0;
    totalCost = 0;
  };
  const clearTicker = () => {
    ht.callSoft("sidebar.clear_status", { key: cfg.tickerStatusKey });
  };

  pi.on("session_start", () => {
    reset();
    clearTicker();
  });

  pi.on("turn_end", (event: any, ctx: ExtensionContext) => {
    try {
      turnCount++;
      const usage = extractUsage(event?.message);
      if (usage) totalCost += turnCost(cfg, (ctx as any).model, usage);

      let ctxPct: number | undefined;
      let ctxTokens = 0;
      try {
        const u: any = ctx.getContextUsage?.();
        ctxTokens = numOrZero(u?.tokens);
        const max =
          numOrZero(u?.max) ||
          numOrZero(u?.maxTokens) ||
          numOrZero(u?.contextWindow) ||
          numOrZero((ctx as any).model?.contextWindow);
        if (ctxTokens > 0 && max > 0) {
          ctxPct = Math.min(
            100,
            Math.max(0, Math.round((ctxTokens / max) * 100)),
          );
        }
      } catch {
        /* best effort — context-window introspection is provider-specific */
      }

      const line = buildTickerLine(
        cfg,
        turnCount,
        usage,
        ctxTokens,
        ctxPct,
        totalCost,
      );
      ht.callSoft("sidebar.set_status", {
        key: cfg.tickerStatusKey,
        value: line,
        icon: cfg.tickerStatusIcon,
        color: cfg.tickerStatusColor,
      });
    } catch (err) {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] cost ticker failed: ${(err as Error).message}`,
        );
      }
    }
  });

  pi.on("session_shutdown", () => {
    clearTicker();
  });
}
