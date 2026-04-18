/**
 * ht-notify-summary
 *
 * Surfaces pi agent turns into HyperTerm Canvas:
 *
 *   before_agent_start → `ht set-status Pi "<3–5 word task>"` (sidebar pill)
 *   agent_end          → `ht clear-status Pi`
 *                       + `ht notify --title "Agent End : <3–5 word summary>"`
 *
 * Both summaries are generated with a fast model (default: Claude Haiku) with
 * `reasoningEffort: "off"` so they return quickly.
 *
 * Configuration:
 *   - `config.json` next to this file
 *   - Env overrides (take precedence):
 *       PI_HT_NOTIFY_ENABLED=0|1
 *       PI_HT_NOTIFY_PROVIDER=anthropic
 *       PI_HT_NOTIFY_MODEL=claude-haiku-4-5
 *       PI_HT_NOTIFY_MIN_WORDS=3
 *       PI_HT_NOTIFY_MAX_WORDS=5
 *       PI_HT_NOTIFY_HT_BIN=/absolute/path/to/ht
 *       PI_HT_NOTIFY_STATUS_KEY=Pi
 *       PI_HT_NOTIFY_STATUS_ICON=bolt
 *       PI_HT_NOTIFY_STATUS_COLOR=#a6e3a1
 *       PI_HT_NOTIFY_DEBUG=1
 */

import { complete, getModel } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Config {
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

	// Token / cost ticker
	tickerEnabled: boolean;
	tickerStatusKey: string;
	tickerStatusIcon: string;
	tickerStatusColor: string;
	tickerShowCost: boolean;
	tickerCostDecimals: number;
	tickerCostUnit: number; // divisor for model.cost units (pi-ai uses $/million tokens → 1_000_000)
	tickerFormat: "compact" | "verbose"; // compact = `34% · $0.012`  verbose = full line
}

const DEFAULT_CONFIG: Config = {
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
};

function loadConfig(): Config {
	const here = dirname(fileURLToPath(import.meta.url));
	const configPath = join(here, "config.json");
	let fromFile: Partial<Config> = {};
	try {
		fromFile = JSON.parse(readFileSync(configPath, "utf8"));
	} catch {
		/* no-op */
	}

	const env = process.env;
	const merged: Config = { ...DEFAULT_CONFIG, ...fromFile };

	if (env.PI_HT_NOTIFY_ENABLED !== undefined) {
		merged.enabled =
			env.PI_HT_NOTIFY_ENABLED !== "0" &&
			env.PI_HT_NOTIFY_ENABLED.toLowerCase() !== "false";
	}
	if (env.PI_HT_NOTIFY_PROVIDER) merged.provider = env.PI_HT_NOTIFY_PROVIDER;
	if (env.PI_HT_NOTIFY_MODEL) merged.modelId = env.PI_HT_NOTIFY_MODEL;
	if (env.PI_HT_NOTIFY_MIN_WORDS)
		merged.minWords = Math.max(1, parseInt(env.PI_HT_NOTIFY_MIN_WORDS, 10) || merged.minWords);
	if (env.PI_HT_NOTIFY_MAX_WORDS)
		merged.maxWords = Math.max(1, parseInt(env.PI_HT_NOTIFY_MAX_WORDS, 10) || merged.maxWords);
	if (env.PI_HT_NOTIFY_HT_BIN) merged.htBinary = env.PI_HT_NOTIFY_HT_BIN;
	if (env.PI_HT_NOTIFY_STATUS_KEY) merged.statusKey = env.PI_HT_NOTIFY_STATUS_KEY;
	if (env.PI_HT_NOTIFY_STATUS_ICON) merged.statusIcon = env.PI_HT_NOTIFY_STATUS_ICON;
	if (env.PI_HT_NOTIFY_STATUS_COLOR) merged.statusColor = env.PI_HT_NOTIFY_STATUS_COLOR;

	if (env.PI_HT_NOTIFY_TICKER_ENABLED !== undefined) {
		merged.tickerEnabled =
			env.PI_HT_NOTIFY_TICKER_ENABLED !== "0" &&
			env.PI_HT_NOTIFY_TICKER_ENABLED.toLowerCase() !== "false";
	}
	if (env.PI_HT_NOTIFY_TICKER_KEY) merged.tickerStatusKey = env.PI_HT_NOTIFY_TICKER_KEY;
	if (env.PI_HT_NOTIFY_TICKER_ICON) merged.tickerStatusIcon = env.PI_HT_NOTIFY_TICKER_ICON;
	if (env.PI_HT_NOTIFY_TICKER_COLOR) merged.tickerStatusColor = env.PI_HT_NOTIFY_TICKER_COLOR;
	if (env.PI_HT_NOTIFY_TICKER_COST !== undefined) {
		merged.tickerShowCost =
			env.PI_HT_NOTIFY_TICKER_COST !== "0" &&
			env.PI_HT_NOTIFY_TICKER_COST.toLowerCase() !== "false";
	}
	if (env.PI_HT_NOTIFY_TICKER_FORMAT === "compact" || env.PI_HT_NOTIFY_TICKER_FORMAT === "verbose") {
		merged.tickerFormat = env.PI_HT_NOTIFY_TICKER_FORMAT;
	}

	if (merged.minWords > merged.maxWords) merged.minWords = merged.maxWords;

	return merged;
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

type ContentBlock = { type?: string; text?: string };

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content as ContentBlock[]) {
		if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("\n").trim();
}

interface TurnSlice {
	userPrompt: string;
	assistantTail: string;
}

function sliceTurn(eventMessages: unknown): TurnSlice {
	const msgs: any[] = Array.isArray(eventMessages)
		? (eventMessages as any[])
		: Array.isArray((eventMessages as any)?.messages)
			? (eventMessages as any).messages
			: [];

	let userPrompt = "";
	let assistantTail = "";
	for (const m of msgs) {
		const role = m?.role ?? m?.message?.role;
		const content = m?.content ?? m?.message?.content;
		if (role === "user") {
			const t = extractText(content);
			if (t) userPrompt = t;
		} else if (role === "assistant") {
			const t = extractText(content);
			if (t) assistantTail = t;
		}
	}
	return { userPrompt, assistantTail };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const FALLBACK_START = "Working";
const FALLBACK_END = "Task complete";

function taskPrompt(cfg: Config, userText: string): string {
	const { minWords, maxWords } = cfg;
	return [
		`You write ultra-short active task labels.`,
		`In ${minWords}-${maxWords} words, describe what an AI assistant is ABOUT to do for the user.`,
		`Rules:`,
		`- Output ONLY the label. No quotes, no trailing punctuation, no prefix.`,
		`- Title Case.`,
		`- Present-continuous or gerund form when natural ("Fixing Login Bug", "Reading Config Files").`,
		`- Never exceed ${maxWords} words.`,
		``,
		`<user_request>`,
		userText || "(no user text)",
		`</user_request>`,
	].join("\n");
}

function donePrompt(cfg: Config, slice: TurnSlice): string {
	const { minWords, maxWords } = cfg;
	return [
		`You write ultra-short task summaries.`,
		`Summarize what the AI assistant just did for the user in ${minWords}-${maxWords} words.`,
		`Rules:`,
		`- Output ONLY the summary. No quotes, no trailing punctuation, no prefix.`,
		`- Title Case.`,
		`- Past-tense or noun-phrase ("Fixed Login Bug", "Added Payment Tests").`,
		`- Never exceed ${maxWords} words.`,
		``,
		`<user_request>`,
		slice.userPrompt || "(no user text)",
		`</user_request>`,
		``,
		`<assistant_reply_tail>`,
		slice.assistantTail.slice(-1200) || "(no assistant text)",
		`</assistant_reply_tail>`,
	].join("\n");
}

function cleanSummary(raw: string, cfg: Config, fallback: string): string {
	let s = (raw || "").trim();
	s = s.replace(/^["'`]+|["'`]+$/g, "");
	s = s.replace(/^(summary|label|title)\s*[:\-]\s*/i, "");
	s = s.split(/\s+/).filter(Boolean).slice(0, cfg.maxWords).join(" ");
	s = s.replace(/[.!?,;:]+$/g, "");
	return s || fallback;
}

async function callFastModel(
	cfg: Config,
	ctx: ExtensionContext,
	prompt: string,
	fallback: string,
): Promise<string> {
	const model = getModel(cfg.provider, cfg.modelId);
	if (!model) return fallback;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth?.ok || !auth.apiKey) return fallback;

	try {
		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				reasoningEffort: "off",
			},
		);

		const text = response.content
			.filter((c: any): c is { type: "text"; text: string } => c?.type === "text")
			.map((c: any) => c.text)
			.join(" ")
			.trim();

		return cleanSummary(text, cfg, fallback);
	} catch (err) {
		if (process.env.PI_HT_NOTIFY_DEBUG) {
			console.error(`[ht-notify-summary] model call failed: ${(err as Error).message}`);
		}
		return fallback;
	}
}

// ---------------------------------------------------------------------------
// ht CLI wrappers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Human-friendly duration: "0.4s", "12.3s", "45s", "2 min", "1h 04m".
 */
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

function runHt(cfg: Config, args: string[]): void {
	const child = execFile(cfg.htBinary, args, { timeout: 3000 }, (err) => {
		if (err && process.env.PI_HT_NOTIFY_DEBUG) {
			console.error(`[ht-notify-summary] ht ${args[0]} failed: ${err.message}`);
		}
	});
	child.on("error", (err) => {
		if (process.env.PI_HT_NOTIFY_DEBUG) {
			console.error(`[ht-notify-summary] ht ${args[0]} spawn error: ${err.message}`);
		}
	});
}

function htSetStatus(cfg: Config, value: string): void {
	runHt(cfg, [
		"set-status",
		cfg.statusKey,
		value,
		"--icon",
		cfg.statusIcon,
		"--color",
		cfg.statusColor,
	]);
}

function htClearStatus(cfg: Config): void {
	runHt(cfg, ["clear-status", cfg.statusKey]);
}

function htSetStatusKeyed(
	cfg: Config,
	key: string,
	value: string,
	icon: string,
	color: string,
): void {
	runHt(cfg, ["set-status", key, value, "--icon", icon, "--color", color]);
}

function htClearStatusKeyed(cfg: Config, key: string): void {
	runHt(cfg, ["clear-status", key]);
}

// ---------------------------------------------------------------------------
// Token / cost ticker
// ---------------------------------------------------------------------------

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * Extract token usage from an assistant message. pi-ai emits slightly
 * different field names depending on provider, so we check several aliases.
 */
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
	if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return null;
	return { input, output, cacheRead, cacheWrite };
}

function numOrZero(x: unknown): number {
	return typeof x === "number" && Number.isFinite(x) ? x : 0;
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
	// Collapse trailing zeros so `$0.010` renders as `$0.01`, but keep at
	// least one decimal so `$0` never shows up next to real money.
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
		// Compact: "Pi" prefix + context size + cost. Fits in one pill.
		//   "Pi · 34% · $0.012"          (when ctx % is known)
		//   "Pi · 12.3k · $0.012"        (fallback: raw token count)
		//   "Pi · 34%"                    (no cost data)
		const parts: string[] = ["Pi"];
		if (typeof ctxPct === "number") {
			parts.push(`${ctxPct}%`);
		} else if (ctxTokens > 0) {
			parts.push(fmtTokensShort(ctxTokens));
		}
		if (costStr) parts.push(costStr);
		return parts.length > 1 ? parts.join(" · ") : `Pi · turn ${turn}`;
	}

	// Verbose: the original full line.
	const parts: string[] = [`pi · turn ${turn}`];
	if (usage) {
		const inTotal = usage.input + usage.cacheRead + usage.cacheWrite;
		parts.push(`${fmtNum(inTotal)} in / ${fmtNum(usage.output)} out`);
	}
	if (typeof ctxPct === "number") parts.push(`ctx ${ctxPct}%`);
	if (costStr) parts.push(costStr);
	return parts.join(" · ");
}

function htNotify(cfg: Config, title: string, body: string): void {
	const args = ["notify", "--title", title, "--body", body];
	if (cfg.notifySubtitle) args.push("--subtitle", cfg.notifySubtitle);
	runHt(cfg, args);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	const cfg = loadConfig();
	if (!cfg.enabled) return;

	// Incrementing token so late-arriving status updates from a previous turn
	// never overwrite the status of a newer turn.
	let turnToken = 0;
	let turnStartMs = 0;

	// Ticker state — per-session totals, reset on session_start.
	let turnCount = 0;
	let totalCost = 0;

	const resetTicker = () => {
		turnCount = 0;
		totalCost = 0;
	};

	pi.on("session_start", () => {
		resetTicker();
		if (cfg.tickerEnabled) htClearStatusKeyed(cfg, cfg.tickerStatusKey);
	});

	// Show an immediate placeholder status the instant the user submits,
	// then upgrade it asynchronously once the fast model returns.
	pi.on("before_agent_start", (event: any, ctx) => {
		const myToken = ++turnToken;
		turnStartMs = Date.now();
		const userText = typeof event?.prompt === "string" ? event.prompt : "";

		htSetStatus(cfg, "Thinking…");

		// Fire and forget — don't block the agent loop on the summarizer.
		(async () => {
			const label = await callFastModel(cfg, ctx, taskPrompt(cfg, userText), FALLBACK_START);
			if (myToken === turnToken) htSetStatus(cfg, label);
		})().catch(() => {
			/* swallowed */
		});
	});

	// Clear status and send the completion notification.
	pi.on("agent_end", async (event: any, ctx) => {
		const elapsedMs = turnStartMs > 0 ? Date.now() - turnStartMs : 0;
		turnStartMs = 0;
		turnToken++; // invalidate any pending start-status update
		htClearStatus(cfg);

		try {
			const slice = sliceTurn(event?.messages ?? event);
			const summary = await callFastModel(cfg, ctx, donePrompt(cfg, slice), FALLBACK_END);
			const title = `Agent End : ${summary}`;
			const duration = elapsedMs > 0 ? formatDuration(elapsedMs) : "";
			const prompt = truncate(slice.userPrompt || "Agent finished", 140);
			const body = duration ? `${prompt}\nTook ${duration}` : prompt;
			htNotify(cfg, title, body);
		} catch (err) {
			if (process.env.PI_HT_NOTIFY_DEBUG) {
				console.error(`[ht-notify-summary] agent_end fatal: ${(err as Error).message}`);
			}
		}
	});

	// Token / cost ticker — updates the `ctx` status pill after every turn.
	// Uses `turn_end` (not `after_provider_response`) because usage lands on
	// the finalized assistant message, not on the raw HTTP response.
	if (cfg.tickerEnabled) {
		pi.on("turn_end", (event: any, ctx) => {
			try {
				turnCount++;
				const usage = extractUsage(event?.message);

				if (usage) {
					totalCost += turnCost(cfg, (ctx as any).model, usage);
				}

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
						ctxPct = Math.min(100, Math.max(0, Math.round((ctxTokens / max) * 100)));
					}
				} catch {
					/* best effort */
				}

				const line = buildTickerLine(cfg, turnCount, usage, ctxTokens, ctxPct, totalCost);
				htSetStatusKeyed(
					cfg,
					cfg.tickerStatusKey,
					line,
					cfg.tickerStatusIcon,
					cfg.tickerStatusColor,
				);
			} catch (err) {
				if (process.env.PI_HT_NOTIFY_DEBUG) {
					console.error(`[ht-notify-summary] ticker failed: ${(err as Error).message}`);
				}
			}
		});
	}

	// Safety net: clear statuses on shutdown so stale pills don't linger.
	// The ticker pill is ONLY cleared here (persists across turns within a
	// session, by design).
	pi.on("session_shutdown", () => {
		htClearStatus(cfg);
		if (cfg.tickerEnabled) htClearStatusKeyed(cfg, cfg.tickerStatusKey);
	});
}
