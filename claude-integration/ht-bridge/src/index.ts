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

interface Config {
  enabled: boolean;
  htBinary: string;
}

const DEFAULT_CONFIG: Config = {
  enabled: true,
  htBinary: "ht",
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
