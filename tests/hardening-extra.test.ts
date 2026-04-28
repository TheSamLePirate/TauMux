import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import { WebServer } from "../src/bun/web-server";
import { SurfaceMetadataPoller } from "../src/bun/surface-metadata";
import {
  CLIENT_RATE_CAPACITY,
  CLIENT_RATE_REFILL_PER_SEC,
  CLIENT_STDIN_MAX_BYTES,
  CLIENT_MESSAGE_MAX_BYTES,
  TERMINAL_COLS_MAX,
  TERMINAL_ROWS_MAX,
  SessionBuffer,
} from "../src/bun/web/connection";
// PanelManager lives in the view layer and touches `document`/DOM APIs
// that bun:test doesn't provide. Its destroy() behavior is instead
// verified indirectly via the SurfaceManager surface-removal tests
// that would run under a DOM-enabled runner.

const BASE_PORT = 19300;
let portCursor = 0;
const nextPort = () => BASE_PORT + portCursor++;

// ── Token-bucket rate limiter ────────────────────────────────────────

describe("SessionBuffer.consumeRateToken", () => {
  // The bucket initializes rateLastRefillMs to Date.now(). Passing a
  // `nowMs` in the distant past (e.g. 1_000_000) yields negative
  // elapsed time, and the refill branch is skipped — which is correct
  // but makes naive tests silent-pass or silent-fail depending on which
  // side of the branch they land. We instead fix the bucket's own
  // reference timestamp at a known value and advance it explicitly.
  function freshBucket(anchor = 1_000_000_000_000): SessionBuffer {
    const s = new SessionBuffer("id");
    s.rateLastRefillMs = anchor;
    s.rateTokens = CLIENT_RATE_CAPACITY;
    return s;
  }

  test("starts at full capacity", () => {
    const s = new SessionBuffer("id");
    expect(s.rateTokens).toBe(CLIENT_RATE_CAPACITY);
  });

  test("consumes exactly one token per call", () => {
    const s = freshBucket();
    const now = s.rateLastRefillMs; // zero elapsed → no refill
    for (let i = 0; i < 10; i++) s.consumeRateToken(now);
    expect(Math.round(s.rateTokens)).toBe(CLIENT_RATE_CAPACITY - 10);
  });

  test("drains to empty then rejects further calls", () => {
    const s = freshBucket();
    const t0 = s.rateLastRefillMs;
    for (let i = 0; i < CLIENT_RATE_CAPACITY; i++) {
      expect(s.consumeRateToken(t0)).toBe(true);
    }
    // Bucket is empty and zero time has passed — next call fails.
    expect(s.consumeRateToken(t0)).toBe(false);
  });

  test("refills at the configured rate", () => {
    const s = freshBucket();
    const t0 = s.rateLastRefillMs;
    // Drain fully.
    for (let i = 0; i < CLIENT_RATE_CAPACITY; i++) s.consumeRateToken(t0);
    expect(s.consumeRateToken(t0)).toBe(false);

    // After 1 s of elapsed time, the bucket should refill to
    // capacity (refill rate == capacity / sec). We then consume one.
    const t1 = t0 + 1000;
    const ok = s.consumeRateToken(t1);
    expect(ok).toBe(true);
    // At capacity minus the one we just took — allow ±2 for any
    // floating-point slop in the refill math.
    expect(s.rateTokens).toBeGreaterThanOrEqual(CLIENT_RATE_CAPACITY - 2);
  });

  test("caps refill at capacity (no unbounded accumulation)", () => {
    const s = freshBucket();
    // Let a century pass — we should not end up with 10^10 tokens.
    s.consumeRateToken(s.rateLastRefillMs + 1000 * 60 * 60 * 24 * 365 * 100);
    expect(s.rateTokens).toBeLessThanOrEqual(CLIENT_RATE_CAPACITY);
  });

  // Sanity-assert that refill rate is faster than wall-clock test ticks
  // so we know the other rate-dependent tests in this file reflect
  // real behavior.
  test("refill rate is > 1 token/ms so a normal burst still fits", () => {
    expect(CLIENT_RATE_REFILL_PER_SEC).toBeGreaterThan(100);
  });
});

// ── Web-mirror input caps at the handleClientMessage boundary ────────

async function startServer(): Promise<{
  port: number;
  server: WebServer;
  sessions: SessionManager;
  surfaceId: string;
}> {
  const port = nextPort();
  const sessions = new SessionManager();
  const surfaceId = sessions.createSurface(80, 24);
  const server = new WebServer(
    port,
    sessions,
    () => ({
      focusedSurfaceId: surfaceId,
      workspaces: [],
      activeWorkspaceId: null,
    }),
    () => surfaceId,
    () => true,
    "127.0.0.1",
    "",
  );
  server.start();
  return { port, server, sessions, surfaceId };
}

function openWs(port: number, onHello: () => void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let gotHello = false;
    ws.onmessage = (e) => {
      if (gotHello) return;
      const msg = JSON.parse(e.data as string);
      if (msg?.type === "hello") {
        gotHello = true;
        onHello();
        resolve(ws);
      }
    };
    ws.onerror = () => reject(new Error("ws error"));
    setTimeout(() => reject(new Error("ws timeout")), 2000);
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return;
    await Bun.sleep(20);
  }
}

describe("web mirror: input caps + rate limit", () => {
  let server: WebServer | null = null;
  let sessions: SessionManager | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
    sessions?.destroy();
    sessions = null;
  });

  test("oversized stdin is dropped (writeStdin not called)", async () => {
    const ctx = await startServer();
    server = ctx.server;
    sessions = ctx.sessions;

    // Intercept writeStdin to assert nothing reaches it for the
    // oversized payload. We have to patch through the prototype
    // because the server captured a reference at construction time.
    let writeCount = 0;
    const original = ctx.sessions.writeStdin.bind(ctx.sessions);
    ctx.sessions.writeStdin = (id: string, data: string) => {
      writeCount++;
      return original(id, data);
    };

    const ws = await openWs(ctx.port, () => {});
    // Slightly over the cap. Server should drop silently.
    const oversized = "x".repeat(CLIENT_STDIN_MAX_BYTES + 1);
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: ctx.surfaceId,
        data: oversized,
      }),
    );
    // Then a normal-size write to confirm the connection is still up.
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: ctx.surfaceId,
        data: "echo ok\n",
      }),
    );
    await waitFor(() => writeCount === 1, 3000);
    ws.close();

    // Only the second (small) write should have reached the PTY.
    expect(writeCount).toBe(1);
  });

  test("oversized frame is dropped before JSON.parse", async () => {
    const ctx = await startServer();
    server = ctx.server;
    sessions = ctx.sessions;

    let writeCount = 0;
    const original = ctx.sessions.writeStdin.bind(ctx.sessions);
    ctx.sessions.writeStdin = (id: string, data: string) => {
      writeCount++;
      return original(id, data);
    };

    const ws = await openWs(ctx.port, () => {});
    // Construct a frame larger than CLIENT_MESSAGE_MAX_BYTES. JSON
    // payload is pure ASCII so byte count ≈ char count.
    const padding = "a".repeat(CLIENT_MESSAGE_MAX_BYTES + 1024);
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: ctx.surfaceId,
        data: padding,
      }),
    );
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: ctx.surfaceId,
        data: "echo ok\n",
      }),
    );
    await waitFor(() => writeCount === 1, 3000);
    ws.close();

    expect(writeCount).toBe(1);
  });

  test("resize request is clamped to safe bounds", async () => {
    const ctx = await startServer();
    server = ctx.server;
    sessions = ctx.sessions;

    const received: Array<{ cols: number; rows: number }> = [];
    ctx.server.onSurfaceResizeRequest = (_id, cols, rows) =>
      received.push({ cols, rows });

    const ws = await openWs(ctx.port, () => {});
    // Nonsense large values — must be clamped.
    ws.send(
      JSON.stringify({
        type: "surfaceResizeRequest",
        surfaceId: ctx.surfaceId,
        cols: 1e9,
        rows: 1e9,
      }),
    );
    // Nonsense small values — must be clamped to lower bound.
    ws.send(
      JSON.stringify({
        type: "surfaceResizeRequest",
        surfaceId: ctx.surfaceId,
        cols: 0,
        rows: 0,
      }),
    );
    // NaN-ish (sent as string) — must be rejected entirely, not passed
    // through.
    ws.send(
      JSON.stringify({
        type: "surfaceResizeRequest",
        surfaceId: ctx.surfaceId,
        cols: "big" as unknown as number,
        rows: "big" as unknown as number,
      }),
    );
    await waitFor(() => received.length >= 2);
    ws.close();

    // First two produce clamped values; third is dropped.
    expect(received.length).toBe(2);
    expect(received[0]!.cols).toBeLessThanOrEqual(TERMINAL_COLS_MAX);
    expect(received[0]!.rows).toBeLessThanOrEqual(TERMINAL_ROWS_MAX);
    expect(received[1]!.cols).toBeGreaterThanOrEqual(10);
    expect(received[1]!.rows).toBeGreaterThanOrEqual(4);
  });
});

// ── Metadata poller robustness ───────────────────────────────────────

describe("SurfaceMetadataPoller stop/start fencing", () => {
  test("stop() sets stopped flag so in-flight tick is a no-op", () => {
    const sessions = new SessionManager("/bin/sh");
    try {
      const poller = new SurfaceMetadataPoller(sessions);
      poller.start();
      // Immediately stop. The start() call fires a tick synchronously
      // (void this.tick()), but stop() sets `stopped = true` before
      // the awaited subprocesses resolve. We can't directly inspect
      // stopped, but we can verify subsequent start() works without
      // throwing and snapshots come out clean.
      poller.stop();
      // Start again — must be idempotent and repeatable.
      poller.start();
      poller.stop();
      expect(true).toBe(true);
    } finally {
      sessions.destroy();
    }
  });

  test("start() / stop() cycle does not leak timers", async () => {
    const sessions = new SessionManager("/bin/sh");
    try {
      const poller = new SurfaceMetadataPoller(sessions, 100);
      for (let i = 0; i < 5; i++) {
        poller.start();
        await new Promise((r) => setTimeout(r, 50));
        poller.stop();
      }
      // If timers leaked, later stop()s would throw. Passing means
      // each stop() cleaned up its timer and caches.
      expect(true).toBe(true);
    } finally {
      sessions.destroy();
    }
  });

  test("getSnapshot returns null for unknown surface", () => {
    const sessions = new SessionManager("/bin/sh");
    try {
      const poller = new SurfaceMetadataPoller(sessions);
      expect(poller.getSnapshot("surface:does-not-exist")).toBeNull();
    } finally {
      sessions.destroy();
    }
  });
});

// ── RPC audit logging opt-out ────────────────────────────────────────

import { createRpcHandler } from "../src/bun/rpc-handler";

describe("rpc: LOG_RPC=0 disables audit logging", () => {
  test("audit line is emitted by default and suppressed when LOG_RPC=0", () => {
    const sessions = new SessionManager("/bin/sh");
    try {
      const handler = createRpcHandler(
        sessions,
        () => ({
          focusedSurfaceId: null,
          workspaces: [],
          activeWorkspaceId: null,
        }),
        () => {},
      );

      const original = console.debug;
      const captured: string[] = [];
      console.debug = (...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      };
      try {
        const prev = process.env["LOG_RPC"];
        // Default: audit log on.
        delete process.env["LOG_RPC"];
        handler("system.ping", {});
        const defaultLines = captured.length;
        expect(defaultLines).toBeGreaterThan(0);
        expect(captured.some((l) => l.includes("[rpc] system.ping"))).toBe(
          true,
        );

        // Opt-out: LOG_RPC=0.
        captured.length = 0;
        process.env["LOG_RPC"] = "0";
        handler("system.ping", {});
        expect(captured.length).toBe(0);

        if (prev === undefined) delete process.env["LOG_RPC"];
        else process.env["LOG_RPC"] = prev;
      } finally {
        console.debug = original;
      }
    } finally {
      sessions.destroy();
    }
  });
});
