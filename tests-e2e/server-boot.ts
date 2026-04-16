#!/usr/bin/env bun
/**
 * Per-test WebServer bootstrap.
 *
 * Playwright test workers run under Node.js, but our WebServer +
 * SessionManager depend on Bun-native modules (@xterm/headless,
 * Bun.spawn with terminal: true, etc.). To bridge that, each test
 * spawns this file as a Bun child process, which owns the real
 * WebServer and SessionManager, and prints a single `READY ...` line
 * to stdout once listening. The Node-side fixture reads that line to
 * learn the port, then hits the server over HTTP/WS like any normal
 * client.
 *
 * CLI:
 *   bun tests-e2e/server-boot.ts [--token=<token>]
 *
 * Protocol:
 *   stdout:   "READY port=<n> token=<t>"  (single line, once)
 *   stdout:   everything else (shell output) — ignored by fixture
 *   stdin:    close to request graceful shutdown
 *   SIGTERM:  same as stdin close
 */

import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";

function parseFlag(name: string, fallback = ""): string {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

const token = parseFlag("token");

async function pickFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("no port"));
        return;
      }
      const p = addr.port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

const sessions = new SessionManager("/bin/sh");
const surfaceId = sessions.createSurface(80, 24);

const port = await pickFreePort();
const server = new WebServer(
  port,
  sessions,
  () => ({
    focusedSurfaceId: surfaceId,
    workspaces: [
      {
        id: "ws:1",
        name: "e2e",
        color: "#89b4fa",
        surfaceIds: [surfaceId],
        focusedSurfaceId: surfaceId,
        layout: { type: "leaf", surfaceId },
      },
    ],
    activeWorkspaceId: "ws:1",
  }),
  () => surfaceId,
  () => true,
  "127.0.0.1",
  token,
);
// Wire the same callback topology the real app sets up in
// src/bun/index.ts. Without this, shell stdout never reaches the web
// mirror's broadcast pipeline and every e2e stdin round-trip would
// hang waiting for output that has nowhere to go. We also forward
// surface-close so tests that close a shell observe the notification.
sessions.onStdout = (id, data) => {
  server.broadcastStdout(id, data);
};
sessions.onSurfaceClosed = (id) => {
  server.sendSurfaceClosed(id);
};
sessions.onSurfaceExit = (id, code) => {
  server.sendSurfaceExited(id, code);
};

server.start();

process.stdout.write(
  `READY port=${port} token=${token} surfaceId=${surfaceId}\n`,
);

function shutdown() {
  try {
    server.stop();
  } catch {
    /* ignore */
  }
  try {
    sessions.destroy();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

// Teardown signals from the fixture: stdin close or SIGTERM.
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// Keep the process alive even when stdin is a pipe that never sends
// data (Playwright never writes to this pipe; we only use end-of-input
// as a shutdown signal).
process.stdin.resume();
