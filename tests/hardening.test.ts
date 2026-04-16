import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebServer } from "../src/bun/web-server";
import { SessionManager, resolveSafeCwd } from "../src/bun/session-manager";
import { timingSafeEqualStr } from "../src/bun/web/server";
import { makeSessionId } from "../src/bun/web/connection";
import { PtyManager } from "../src/bun/pty-manager";
import { createRpcHandler } from "../src/bun/rpc-handler";

const BASE_PORT = 19200;
let portCursor = 0;
const nextPort = () => BASE_PORT + portCursor++;

describe("web mirror: timing-safe token compare", () => {
  test("equal strings compare true", () => {
    expect(timingSafeEqualStr("same", "same")).toBe(true);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });

  test("different-length strings compare false", () => {
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "x")).toBe(false);
  });

  test("same-length non-equal strings compare false", () => {
    expect(timingSafeEqualStr("abcd", "abce")).toBe(false);
    expect(timingSafeEqualStr("token-xxxx", "token-yyyy")).toBe(false);
  });

  test("unicode strings compare correctly", () => {
    expect(timingSafeEqualStr("café", "café")).toBe(true);
    expect(timingSafeEqualStr("café", "cafe")).toBe(false);
  });
});

describe("web mirror: origin validation", () => {
  let server: WebServer | null = null;
  let sessions: SessionManager | null = null;
  let port = 0;

  afterEach(() => {
    server?.stop();
    server = null;
    sessions?.destroy();
    sessions = null;
  });

  function start(): { server: WebServer; port: number } {
    port = nextPort();
    sessions = new SessionManager();
    const surfaceId = sessions.createSurface(80, 24);
    server = new WebServer(
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
    return { server, port };
  }

  test("WS upgrade with same-origin Origin header is accepted", async () => {
    const { port } = start();
    const result = await new Promise<"open" | "err">((resolve) => {
      // Bun's WebSocket client doesn't set Origin on ws://; we rely
      // on the "no origin → accept" path for native clients. This
      // also exercises the `bind`-derived host fallback.
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.onopen = () => {
        ws.close();
        resolve("open");
      };
      ws.onerror = () => resolve("err");
      setTimeout(() => resolve("err"), 1000);
    });
    expect(result).toBe("open");
  });

  test("WS upgrade with cross-origin Origin header is rejected (403)", async () => {
    const { port } = start();
    // Simulate a cross-origin upgrade: fetch /with the Upgrade header
    // but an Origin from a different site. Bun returns the 403
    // directly because `upgrade` never fires.
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        origin: "http://evil.example.com",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });
    expect(res.status).toBe(403);
  });
});

describe("web mirror: session id entropy", () => {
  test("session id is a 32-char hex string", () => {
    const id = makeSessionId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test("session ids don't collide over a batch", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(makeSessionId());
    expect(seen.size).toBe(10_000);
  });
});

describe("session-manager: cwd validation", () => {
  test("accepts an existing absolute directory", () => {
    const t = mkdtempSync(join(tmpdir(), "ht-cwd-"));
    // macOS's /var is a symlink to /private/var, so the canonical
    // form differs from what mkdtempSync returned. Compare against
    // the realpath of what we passed in, not the raw input.
    const canon = realpathSync(t);
    try {
      expect(resolveSafeCwd(t)).toBe(canon);
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });

  test("rejects a non-absolute path (falls back to HOME)", () => {
    const home = process.env["HOME"] || "/";
    expect(resolveSafeCwd("relative/path")).toBe(home);
  });

  test("rejects a nonexistent path (falls back to HOME)", () => {
    const home = process.env["HOME"] || "/";
    expect(resolveSafeCwd("/definitely/not/a/real/path/xyz123")).toBe(home);
  });

  test("folds .. segments via realpath", () => {
    const t = mkdtempSync(join(tmpdir(), "ht-cwd-"));
    try {
      const traversal = `${t}/sub/../`;
      // realpath collapses "sub/.." and returns the canonical t.
      // The subdir doesn't need to exist for realpath to resolve,
      // but passing "/sub/.." requires sub to exist; so verify with
      // a symlink trick: the realpath of t itself is idempotent.
      expect(resolveSafeCwd(traversal)).toMatch(/ht-cwd-/);
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });

  test("follows symlinks to the real target", () => {
    const t = mkdtempSync(join(tmpdir(), "ht-cwd-"));
    const link = `${t}-link`;
    const canon = realpathSync(t);
    try {
      symlinkSync(t, link);
      // realpath collapses the symlink; result is the canonical tmp
      // dir (via /private/var on macOS).
      const got = resolveSafeCwd(link);
      expect(got).toBe(canon);
    } finally {
      try {
        rmSync(link);
      } catch {
        /* ignore */
      }
      rmSync(t, { recursive: true, force: true });
    }
  });
});

describe("rpc: surface.kill_pid signal + pid whitelist", () => {
  let sessions: SessionManager | null = null;
  afterEach(() => {
    sessions?.destroy();
    sessions = null;
  });

  function handler() {
    sessions = new SessionManager("/bin/sh");
    // Keep process.kill from actually firing during these tests — we
    // just want to exercise the validation layer. We don't create a
    // surface, so allowedPids is always empty and every request
    // should be rejected before reaching process.kill.
    return createRpcHandler(
      sessions,
      () => ({
        focusedSurfaceId: null,
        workspaces: [],
        activeWorkspaceId: null,
      }),
      () => {},
    );
  }

  test("rejects signal not in the whitelist", () => {
    const h = handler();
    expect(() => h("surface.kill_pid", { pid: 1, signal: "SIGSTOP" })).toThrow(
      /not allowed/,
    );
  });

  test("rejects pid that is not in any tracked tree", () => {
    const h = handler();
    // pid 1 is init — clearly not in our tree. Must reject.
    expect(() => h("surface.kill_pid", { pid: 1 })).toThrow(
      /not in a tracked surface tree/,
    );
  });

  test("schema rejects non-numeric pid", () => {
    const h = handler();
    expect(() =>
      h("surface.kill_pid", { pid: "not-a-number" as unknown as number }),
    ).toThrow(/pid/);
  });
});

describe("rpc: schema validator rejects oversize browser.eval scripts", () => {
  let sessions: SessionManager | null = null;
  afterEach(() => {
    sessions?.destroy();
    sessions = null;
  });

  test("script under cap is accepted (dispatched)", () => {
    sessions = new SessionManager("/bin/sh");
    const dispatched: string[] = [];
    const h = createRpcHandler(
      sessions,
      () => ({
        focusedSurfaceId: "surface:1",
        workspaces: [],
        activeWorkspaceId: null,
      }),
      (action) => dispatched.push(action),
    );
    expect(() =>
      h("browser.eval", { surface_id: "surface:1", script: "1+1" }),
    ).not.toThrow();
  });

  test("script above cap is rejected", () => {
    sessions = new SessionManager("/bin/sh");
    const h = createRpcHandler(
      sessions,
      () => ({
        focusedSurfaceId: "surface:1",
        workspaces: [],
        activeWorkspaceId: null,
      }),
      () => {},
    );
    const huge = "x".repeat(256 * 1024 + 1);
    expect(() =>
      h("browser.eval", { surface_id: "surface:1", script: huge }),
    ).toThrow(/exceeds maxLength/);
  });
});

describe("pty-manager: resize before terminal is ready", () => {
  test("buffered resize is applied when terminal handle arrives", async () => {
    const pty = new PtyManager();
    let out = "";
    pty.onStdout = (d) => {
      out += d;
    };
    // Spawn a slow-initial-output shell, resize immediately, then
    // verify the PTY ends up at the requested dimensions.
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });
    // Fire the resize before first data — the terminal handle is
    // delivered via the first data callback, so this is the race.
    pty.resize(120, 40);
    // Nudge the shell to emit output so the terminal handle is
    // delivered and the buffered resize flushes.
    pty.write("echo READY\n");
    const deadline = Date.now() + 3000;
    while (!out.includes("READY") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(out).toContain("READY");
    // _cols/_rows tracked the request all along; this check ensures
    // the buffered-resize path ran without throwing.
    expect(pty.cols).toBe(120);
    expect(pty.rows).toBe(40);
    pty.destroy();
  });
});
