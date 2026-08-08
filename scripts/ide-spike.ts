#!/usr/bin/env bun
/**
 * Probe for the Claude Code IDE handshake — NOT part of the app.
 *
 * τ-mux wants to be an IDE host: Claude Code discovers an IDE by
 * scanning `~/.claude/ide/<port>.lock`, connecting to `ws://host:port`
 * as an MCP server, and then speaking `openDiff`, `selection_changed`
 * and `at_mentioned`. τ-mux already has a WebSocket server, an editor
 * pane, and the RPC to drive it — see
 * `doc/tracking_best_terminal_for_claude_code.md` § Phase 3.
 *
 * Three details could not be recovered from the shipped binary: the
 * auth header name carrying `authToken`, the lock-file key that maps to
 * `useWebSocket`, and the tool schemas. This script answers all three at
 * once by being an IDE and logging what Claude Code actually sends.
 *
 * It writes a lock file, serves a minimal MCP-over-WS endpoint, spawns
 * `claude` as its own child (so the `process.ppid === lock.pid`
 * validation passes), prints every upgrade header and frame, then
 * removes the lock.
 *
 * Blocked when this was written: `claude` exits with "Credit balance is
 * too low" before attempting any IDE connection. Re-run it on an account
 * with credit.
 *
 *   bun scripts/ide-spike.ts
 */

import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = 45999;
const TOKEN = "spike-token-abc123";
const lockDir = join(homedir(), ".claude", "ide");
mkdirSync(lockDir, { recursive: true });
const lockPath = join(lockDir, `${PORT}.lock`);

const log: string[] = [];
const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const hdrs: Record<string, string> = {};
    req.headers.forEach((v, k) => (hdrs[k] = v));
    log.push("UPGRADE headers: " + JSON.stringify(hdrs, null, 1));
    if (srv.upgrade(req)) return;
    return new Response("no", { status: 400 });
  },
  websocket: {
    open() {
      log.push("WS OPEN");
    },
    message(ws, raw) {
      const text = String(raw);
      log.push("RECV: " + text.slice(0, 600));
      try {
        const msg = JSON.parse(text);
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "tau-mux-spike", version: "0.0.1" },
              },
            }),
          );
        } else if (msg.method === "tools/list") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { tools: [] },
            }),
          );
        } else if (msg.id !== undefined) {
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
        }
      } catch {
        /* ignore */
      }
    },
    close() {
      log.push("WS CLOSE");
    },
  },
});

writeFileSync(
  lockPath,
  JSON.stringify({
    pid: process.pid,
    workspaceFolders: [process.cwd()],
    ideName: "tau-mux-spike",
    transport: "ws",
    runningInWindows: false,
    authToken: TOKEN,
  }),
  "utf-8",
);

const proc = Bun.spawn(
  ["claude", "-p", "reply with the single word OK", "--debug"],
  {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: (() => { const e = { ...process.env, CLAUDE_CODE_AUTO_CONNECT_IDE: "true" }; delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN; return e; })(),
  },
);
const timer = setTimeout(() => {
  try {
    proc.kill();
  } catch {}
}, 60000);
const [so, se] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
]);
clearTimeout(timer);
await Bun.sleep(300);

console.log("======== SPIKE LOG ========");
console.log(log.join("\n") || "(nothing — claude never connected)");
console.log("======== claude stderr (ide lines) ========");
console.log(
  se
    .split("\n")
    .filter((l) => /ide|IDE|mcp|lock/i.test(l))
    .slice(0, 25)
    .join("\n"),
);
console.log("======== claude stdout ========");
console.log(so.slice(0, 300));

server.stop(true);
try {
  unlinkSync(lockPath);
} catch {}
process.exit(0);
