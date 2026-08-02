#!/usr/bin/env bun
/**
 * ht-bridge v2 — Claude Code → τ-mux hook bridge (august-plan M1 / WS1).
 *
 * Invoked by ~/.claude/settings.json with an event name as argv[2];
 * reads the hook JSON payload on stdin; forwards one small normalized
 * event to the running app via `ht claude event`. That's the whole job.
 *
 * The app-side ClaudeSessionRegistry owns ALL state (phase, turn
 * counting, labels, task mirror) and the presenter owns ALL rendering
 * (sidebar pills, notifications). v1's per-session temp-file state,
 * transcript/cost parsing, pricing table, and `pi` title sidecar are
 * deleted — cost / context / rate limits / session title now come from
 * `ht claude statusline` (data Claude Code computes itself).
 *
 * Contract with Claude Code's hook pipeline:
 *   - fire-and-forget: the `ht` spawn is never awaited; a dead τ-mux
 *     means the CLI fails silently and Claude Code never notices.
 *   - exit 0 always; hook stderr only with HT_CLAUDE_DEBUG=1.
 *   - unknown event names are ignored (installer may be newer than us).
 *
 * Config (all optional), via config.json next to src/ or env:
 *   { "enabled": true, "htBinary": "ht" }
 *   HT_CLAUDE_ENABLED=0   disable everything
 *   HT_CLAUDE_HT_BIN=…    path to the ht binary
 *   HT_CLAUDE_DEBUG=1     surface errors on stderr
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBridgeEvent } from "./build-event";
import {
  DEFAULT_ASK_TIMEOUT_MS,
  PERMISSION_CHOICES,
  buildPermissionDecision,
  decisionFromAskResult,
  formatPermissionAsk,
} from "./permission";

interface Config {
  enabled: boolean;
  htBinary: string;
  /** WS3 — route PermissionRequest to the τ-mux ask modal. The real
   *  opt-in is wiring the hook at all; this flag is the escape hatch
   *  that turns an installed hook into a pure pass-through. */
  approvalsEnabled: boolean;
  approvalTimeoutMs: number;
}

const DEFAULT_CONFIG: Config = {
  enabled: true,
  htBinary: "ht",
  approvalsEnabled: true,
  approvalTimeoutMs: DEFAULT_ASK_TIMEOUT_MS,
};

function loadConfig(): Config {
  const here = dirname(fileURLToPath(import.meta.url));
  let fromFile: Partial<Config> = {};
  try {
    fromFile = JSON.parse(
      readFileSync(join(here, "..", "config.json"), "utf-8"),
    ) as Partial<Config>;
  } catch {
    /* optional — defaults stand */
  }
  const c: Config = { ...DEFAULT_CONFIG, ...fromFile };
  const env = process.env;
  if (env["HT_CLAUDE_ENABLED"] !== undefined) {
    c.enabled =
      env["HT_CLAUDE_ENABLED"] !== "0" &&
      env["HT_CLAUDE_ENABLED"].toLowerCase() !== "false";
  }
  if (env["HT_CLAUDE_HT_BIN"]) c.htBinary = env["HT_CLAUDE_HT_BIN"];
  if (env["HT_CLAUDE_APPROVALS"] !== undefined) {
    c.approvalsEnabled =
      env["HT_CLAUDE_APPROVALS"] !== "0" &&
      env["HT_CLAUDE_APPROVALS"].toLowerCase() !== "false";
  }
  const t = Number(env["HT_CLAUDE_APPROVAL_TIMEOUT_MS"]);
  if (Number.isFinite(t) && t > 0) c.approvalTimeoutMs = t;
  return c;
}

function debugLog(msg: string): void {
  if (process.env["HT_CLAUDE_DEBUG"]) {
    console.error(`[ht-bridge] ${msg}`);
  }
}

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

/** Fire-and-forget `ht claude event`. Exit code ignored by design. */
function sendEvent(cfg: Config, event: Record<string, unknown>): void {
  try {
    const child = spawn(
      cfg.htBinary,
      ["claude", "event", "--json", JSON.stringify(event)],
      { stdio: "ignore" },
    );
    child.on("error", (err) => debugLog(`ht spawn: ${err.message}`));
  } catch (err) {
    debugLog(
      `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * WS3 — the one SYNCHRONOUS path. Routes Claude Code's PermissionRequest
 * to the τ-mux ask modal (which also forwards to Telegram when
 * configured) and prints the decision JSON on stdout. Prints NOTHING on
 * timeout / no τ-mux / "Answer in terminal" / any error, which hands the
 * question back to Claude Code's own prompt — the gate can only ever
 * add an answer path, never remove one.
 */
async function handlePermissionRequest(
  cfg: Config,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!cfg.approvalsEnabled) return;
  // Outside a τ-mux pane there is no modal to route to.
  if (!process.env["HT_SURFACE"]) return;
  const ask = formatPermissionAsk(payload);
  if (!ask) return;

  // Shadow event: pill → red "Approval needed" while the modal is up.
  const shadow = buildBridgeEvent(
    "permission-request",
    payload,
    process.env,
    Date.now(),
  );
  if (shadow) sendEvent(cfg, shadow);

  const { exitCode, stdout } = await runHtAskChoice(cfg, ask.title, ask.body);
  const behavior = decisionFromAskResult(exitCode, stdout);
  if (behavior) {
    process.stdout.write(buildPermissionDecision(behavior));
    const resolved = buildBridgeEvent(
      "permission-resolved",
      payload,
      process.env,
      Date.now(),
    );
    if (resolved) sendEvent(cfg, resolved);
  }
  // No decision → no output; Claude Code's Notification hook will keep
  // the pill red when its own prompt appears.
}

/** Blocking `ht ask choice` with a hard watchdog slightly past the ask
 *  timeout, so a wedged app can never hold the hook to Claude Code's
 *  own limit. */
function runHtAskChoice(
  cfg: Config,
  title: string,
  body: string,
): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, stdout });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        cfg.htBinary,
        [
          "ask",
          "choice",
          "--title",
          title,
          "--body",
          body,
          "--choices",
          PERMISSION_CHOICES,
          "--timeout",
          String(cfg.approvalTimeoutMs),
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch (err) {
      debugLog(
        `ask spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return finish(null);
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      finish(null);
    }, cfg.approvalTimeoutMs + 5_000);
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      debugLog(`ask error: ${err.message}`);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code);
    });
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const eventName = process.argv[2];
  if (!eventName) {
    debugLog("missing event argv[2]");
    return;
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await readStdin();
  } catch {
    /* nothing on stdin — fine */
  }

  try {
    if (eventName === "permission-request") {
      await handlePermissionRequest(cfg, payload);
      return;
    }
    const event = buildBridgeEvent(eventName, payload, process.env, Date.now());
    if (event) sendEvent(cfg, event);
    else debugLog(`skipped event: ${eventName}`);
  } catch (err) {
    debugLog(
      `${eventName} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

void main();
