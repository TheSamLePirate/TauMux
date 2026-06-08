/**
 * `ht` CLI JSON-RPC transport + socket/token resolution — split out of
 * `bin/ht` (§6.5). One single-shot round-trip over the unix socket.
 */

import { connect } from "net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { CONFIG_DIR_NAME, SOCKET_BASENAME } from "../shared/brand";

/** Default config dir, mirroring how the app places its socket
 *  (`HT_CONFIG_DIR ?? Electrobun Utils.paths.config / CONFIG_DIR_NAME`). The
 *  CLI can't import Electrobun, so we replicate the per-OS config base. */
function defaultConfigDir(): string {
  const explicit = process.env["HT_CONFIG_DIR"];
  if (explicit) return explicit;
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", CONFIG_DIR_NAME);
  }
  // Linux / other: XDG base dir (Electrobun resolves config there too).
  return join(
    process.env["XDG_CONFIG_HOME"] || join(home, ".config"),
    CONFIG_DIR_NAME,
  );
}

// W4-SOCKET-PATH — the default is now the REAL socket the app binds
// (`<config>/hyperterm.sock`), not the legacy `/tmp/hyperterm.sock`. Without
// this, `ht` run from a shell the app didn't spawn (a separate Terminal.app
// that never inherited `HT_SOCKET_PATH`) failed to connect. `HT_SOCKET_PATH`
// still overrides; `ht doctor` self-diagnoses any remaining drift.
export const SOCKET_PATH =
  process.env["HT_SOCKET_PATH"] || join(defaultConfigDir(), SOCKET_BASENAME);

// W2 (full_app_review_2026-05.md §6.1) — the app writes a per-boot RPC token
// to `socket.token` beside the socket. We always present it; the app only
// ENFORCES it when the user enables "Require RPC socket token". Reading it is
// best-effort — if the file is absent (token disabled / old app), we send no
// token and read-only verbs still work. `HT_RPC_TOKEN_PATH` overrides.
const RPC_TOKEN_PATH =
  process.env["HT_RPC_TOKEN_PATH"] ||
  join(dirname(SOCKET_PATH), "socket.token");
function readRpcToken(): string {
  try {
    return readFileSync(RPC_TOKEN_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}
export const RPC_TOKEN = readRpcToken();

/** One JSON-RPC round-trip over the unix socket. Resolves to the
 *  decoded `result`, rejects on transport failure / server error /
 *  timeout. Single-shot — opens, sends, closes on first response.
 *
 *  `timeoutMs` defaults to 5000 (the original watchdog so a stuck
 *  app doesn't hang the CLI forever). Plan #10's `agent.ask_user`
 *  RPC is long-pending — pass 0 to disable the watchdog and wait
 *  for the bun-side response. */
export function runRpc(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number = 5000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req: Record<string, unknown> = { id: "1", method, params };
    if (RPC_TOKEN) req["__token"] = RPC_TOKEN;
    const payload = JSON.stringify(req) + "\n";
    const sock = connect(SOCKET_PATH);
    let buf = "";
    let done = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (done) return;
            done = true;
            sock.end();
            reject(
              new Error(
                `no response from HyperTerm within ${timeoutMs}ms (method=${method}). The app may be unresponsive. Socket: ${SOCKET_PATH}`,
              ),
            );
          }, timeoutMs)
        : null;

    sock.on("connect", () => sock.write(payload));
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const res = JSON.parse(line);
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          sock.end();
          if (res.error) reject(new Error(String(res.error)));
          else resolve(res.result);
          return;
        } catch {
          /* unparseable line — keep buffering */
        }
      }
      buf = lines[lines.length - 1];
    });
    sock.on("error", (err: Error & { code?: string }) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
