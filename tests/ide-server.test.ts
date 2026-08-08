/**
 * The Claude Code IDE bridge.
 *
 * The protocol here was not documented — it was recovered by running
 * Claude Code 2.1.225 against an instrumented server
 * (`scripts/ide-spike.ts`) and reading what it actually sent. These
 * tests pin the parts that are *its* contract rather than ours, because
 * getting any of them wrong means the connection silently never happens:
 *
 *   - the auth header name
 *   - the `mcp` subprotocol
 *   - the lock file living at `<dir>/<port>.lock` with the port in the
 *     *filename*
 *   - the `FILE_SAVED` / `DIFF_REJECTED` / `TAB_CLOSED` response shapes,
 *     where Claude reads `[0].text` as the verdict and `[1].text` as the
 *     content to apply
 *
 * A live end-to-end connect was verified by hand (see the tracking doc);
 * this suite is what keeps it working.
 */
import { describe, test, expect, afterEach } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IDE_AUTH_HEADER,
  IDE_SUBPROTOCOL,
  IDE_TOOLS,
  IdeServer,
  encodeDiffOutcome,
  ideLockDir,
  type DiffOutcome,
  type OpenDiffRequest,
} from "../src/bun/ide-server";

const dirs: string[] = [];
function tmpLockDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ht-ide-"));
  dirs.push(d);
  return d;
}

const servers: IdeServer[] = [];
function makeServer(
  over: Partial<{
    reviewDiff: (r: OpenDiffRequest) => Promise<DiffOutcome>;
    closeDiff: (t: string) => void;
    workspaceFolders: () => string[];
  }> = {},
) {
  const lockDir = tmpLockDir();
  const s = new IdeServer(
    {
      workspaceFolders: over.workspaceFolders ?? (() => ["/tmp/project"]),
      reviewDiff:
        over.reviewDiff ??
        (async () => ({ verdict: "DIFF_REJECTED" }) as DiffOutcome),
      closeDiff: over.closeDiff ?? (() => {}),
      log: () => {},
    },
    lockDir,
  );
  servers.push(s);
  s.start();
  return { server: s, lockDir };
}

afterEach(() => {
  for (const s of servers.splice(0)) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Minimal MCP client speaking exactly what Claude Code speaks. */
async function connect(server: IdeServer, lockDir: string) {
  const lockFile = readdirSync(lockDir).find((f) => f.endsWith(".lock"))!;
  const lock = JSON.parse(readFileSync(join(lockDir, lockFile), "utf-8"));
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, {
    // Bun's WebSocket accepts headers + protocol like Claude Code does.
    headers: { [IDE_AUTH_HEADER]: lock.authToken },
    protocol: IDE_SUBPROTOCOL,
  } as unknown as string[]);

  const inbox: Record<string, unknown>[] = [];
  ws.addEventListener("message", (e) => {
    inbox.push(JSON.parse(String((e as MessageEvent).data)));
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("ws open timeout")), 5000);
  });

  let nextId = 0;
  const call = async (method: string, params?: unknown) => {
    const id = ++nextId;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const hit = inbox.find((m) => m["id"] === id);
      if (hit) return hit;
      await Bun.sleep(10);
    }
    throw new Error(`timed out waiting for ${method}`);
  };
  const notify = (method: string, params?: unknown) =>
    ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));

  return { ws, call, notify, inbox, lock };
}

describe("lock file", () => {
  test("is named for the port, because Claude reads the port from the filename", () => {
    const { server, lockDir } = makeServer();
    const files = readdirSync(lockDir);
    expect(files).toEqual([`${server.port}.lock`]);
  });

  test("carries the fields Claude Code destructures", () => {
    const { lockDir } = makeServer({
      workspaceFolders: () => ["/a", "/b"],
    });
    const lock = JSON.parse(
      readFileSync(join(lockDir, readdirSync(lockDir)[0]!), "utf-8"),
    );
    expect(lock.pid).toBe(process.pid);
    expect(lock.workspaceFolders).toEqual(["/a", "/b"]);
    expect(lock.ideName).toBe("tau-mux");
    // "ws" is what selects ws:// over http://…/sse.
    expect(lock.transport).toBe("ws");
    expect(lock.runningInWindows).toBe(false);
    expect(typeof lock.authToken).toBe("string");
    expect(lock.authToken.length).toBeGreaterThan(16);
  });

  test("carries our own pid — Claude only trusts an ancestor's", () => {
    // bun → shell → claude, so τ-mux's pid is in claude's ancestor set.
    // A lock with a foreign pid is ignored; with a dead pid, deleted.
    const { lockDir } = makeServer();
    const lock = JSON.parse(
      readFileSync(join(lockDir, readdirSync(lockDir)[0]!), "utf-8"),
    );
    expect(lock.pid).toBe(process.pid);
  });

  test("is 0600 — the token in it is the only access control", () => {
    const { lockDir } = makeServer();
    const file = join(lockDir, readdirSync(lockDir)[0]!);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("is removed on stop", () => {
    const { server, lockDir } = makeServer();
    const file = join(lockDir, `${server.port}.lock`);
    expect(existsSync(file)).toBe(true);
    server.stop();
    expect(existsSync(file)).toBe(false);
  });

  test("each launch gets a fresh token", () => {
    const a = makeServer();
    const b = makeServer();
    const read = (d: string) =>
      JSON.parse(readFileSync(join(d, readdirSync(d)[0]!), "utf-8")).authToken;
    expect(read(a.lockDir)).not.toBe(read(b.lockDir));
  });

  test("the default lock directory is the one Claude Code scans", () => {
    expect(ideLockDir("/home/me")).toBe("/home/me/.claude/ide");
  });
});

describe("authentication", () => {
  test("an upgrade without the token is rejected", async () => {
    const { server } = makeServer();
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(401);
  });

  test("an upgrade with the wrong token is rejected", async () => {
    const { server } = makeServer();
    const res = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: { [IDE_AUTH_HEADER]: "not-the-token" },
    });
    expect(res.status).toBe(401);
  });

  test("binds loopback only", () => {
    const { server } = makeServer();
    // Nothing off-machine can reach it regardless of the token.
    expect(server.running).toBe(true);
    expect(server.port).toBeGreaterThan(0);
  });
});

describe("MCP handshake", () => {
  test("initialize echoes the client's protocol version", async () => {
    const { server, lockDir } = makeServer();
    const c = await connect(server, lockDir);
    const res = (await c.call("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1.225" },
    })) as { result: Record<string, unknown> };
    expect(res.result["protocolVersion"]).toBe("2025-11-25");
    expect(res.result["capabilities"]).toEqual({ tools: {} });
    c.ws.close();
  });

  test("ide_connected records Claude's pid and is not answered", async () => {
    // It arrives as a notification (no id); replying to it would be a
    // protocol error.
    const { server, lockDir } = makeServer();
    const c = await connect(server, lockDir);
    c.notify("ide_connected", { pid: 4242 });
    await Bun.sleep(120);
    expect(server.connectedPid).toBe(4242);
    expect(server.connected).toBe(true);
    expect(c.inbox.length).toBe(0);
    c.ws.close();
  });

  test("notifications/initialized is silently accepted", async () => {
    const { server, lockDir } = makeServer();
    const c = await connect(server, lockDir);
    c.notify("notifications/initialized");
    await Bun.sleep(120);
    expect(c.inbox.length).toBe(0);
    c.ws.close();
  });

  test("tools/list advertises openDiff, close_tab and getDiagnostics", async () => {
    const { server, lockDir } = makeServer();
    const c = await connect(server, lockDir);
    const res = (await c.call("tools/list")) as {
      result: { tools: { name: string }[] };
    };
    expect(res.result.tools.map((t) => t.name).sort()).toEqual([
      "close_tab",
      "getDiagnostics",
      "openDiff",
    ]);
    c.ws.close();
  });

  test("an unknown request is answered, never left hanging", async () => {
    // A silent drop would leave Claude Code waiting on an id forever.
    const { server, lockDir } = makeServer();
    const c = await connect(server, lockDir);
    const res = (await c.call("does/notExist")) as {
      error?: { message: string };
    };
    expect(res.error?.message).toContain("unknown method");
    c.ws.close();
  });
});

describe("openDiff", () => {
  test("an accepted review returns FILE_SAVED plus the content", async () => {
    const seen: OpenDiffRequest[] = [];
    const { server, lockDir } = makeServer({
      reviewDiff: async (r) => {
        seen.push(r);
        return { verdict: "FILE_SAVED", content: r.newContents };
      },
    });
    const c = await connect(server, lockDir);
    const res = (await c.call("tools/call", {
      name: "openDiff",
      arguments: {
        old_file_path: "/p/a.ts",
        new_file_path: "/p/a.ts",
        new_file_contents: "next\n",
        tab_name: "a.ts ✻",
      },
    })) as { result: { content: { type: string; text: string }[] } };

    expect(seen[0]).toMatchObject({
      oldPath: "/p/a.ts",
      newPath: "/p/a.ts",
      newContents: "next\n",
      tabName: "a.ts ✻",
    });
    // Claude reads [0].text as the verdict and [1].text as the content
    // to apply. Both, in that order, or the edit is dropped.
    expect(res.result.content).toEqual([
      { type: "text", text: "FILE_SAVED" },
      { type: "text", text: "next\n" },
    ]);
    c.ws.close();
  });

  test("a rejected review returns DIFF_REJECTED", async () => {
    const { server, lockDir } = makeServer({
      reviewDiff: async () => ({ verdict: "DIFF_REJECTED" }),
    });
    const c = await connect(server, lockDir);
    const res = (await c.call("tools/call", {
      name: "openDiff",
      arguments: { new_file_contents: "x", tab_name: "t" },
    })) as { result: { content: unknown[] } };
    expect(res.result.content).toEqual([
      { type: "text", text: "DIFF_REJECTED" },
    ]);
    c.ws.close();
  });

  test("a review that throws produces an error, not a false approval", async () => {
    // The dangerous failure: an exception reported as success would
    // apply an edit nobody approved.
    const { server, lockDir } = makeServer({
      reviewDiff: async () => {
        throw new Error("editor pane exploded");
      },
    });
    const c = await connect(server, lockDir);
    const res = (await c.call("tools/call", {
      name: "openDiff",
      arguments: { new_file_contents: "x" },
    })) as { error?: { message: string } };
    expect(res.error?.message).toContain("editor pane exploded");
    c.ws.close();
  });

  test("close_tab reaches the host", async () => {
    const closed: string[] = [];
    const { server, lockDir } = makeServer({
      closeDiff: (t) => closed.push(t),
    });
    const c = await connect(server, lockDir);
    await c.call("tools/call", {
      name: "close_tab",
      arguments: { tab_name: "a.ts" },
    });
    expect(closed).toEqual(["a.ts"]);
    c.ws.close();
  });

  test("getDiagnostics reports none rather than inventing any", async () => {
    const { server, lockDir } = makeServer();
    const c = await connect(server, lockDir);
    const res = (await c.call("tools/call", {
      name: "getDiagnostics",
      arguments: {},
    })) as { result: { content: { text: string }[] } };
    expect(res.result.content[0]!.text).toBe("[]");
    c.ws.close();
  });

  test("an unknown tool errors", async () => {
    const { server, lockDir } = makeServer();
    const c = await connect(server, lockDir);
    const res = (await c.call("tools/call", {
      name: "executeCode",
      arguments: {},
    })) as { error?: { message: string } };
    // executeCode means "run in the active Jupyter kernel"; advertising
    // it and failing every call would be worse than not offering it.
    expect(res.error?.message).toContain("unknown tool");
    c.ws.close();
  });
});

describe("encodeDiffOutcome", () => {
  test("FILE_SAVED carries the content as the second item", () => {
    expect(
      encodeDiffOutcome({ verdict: "FILE_SAVED", content: "abc" }),
    ).toEqual([
      { type: "text", text: "FILE_SAVED" },
      { type: "text", text: "abc" },
    ]);
  });

  test("rejections are a single item", () => {
    expect(encodeDiffOutcome({ verdict: "DIFF_REJECTED" })).toEqual([
      { type: "text", text: "DIFF_REJECTED" },
    ]);
    expect(encodeDiffOutcome({ verdict: "TAB_CLOSED" })).toEqual([
      { type: "text", text: "TAB_CLOSED" },
    ]);
  });
});

describe("advertised tools", () => {
  test("executeCode is deliberately absent", () => {
    expect(IDE_TOOLS.map((t) => t.name)).not.toContain("executeCode");
  });

  test("every tool declares an input schema", () => {
    for (const t of IDE_TOOLS) {
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.description).toBe("string");
    }
  });
});

describe("lifecycle", () => {
  test("start is idempotent", () => {
    const { server, lockDir } = makeServer();
    const port = server.port;
    server.start();
    expect(server.port).toBe(port);
    expect(readdirSync(lockDir).length).toBe(1);
  });

  test("stop then start rebinds and rewrites the lock", () => {
    const { server, lockDir } = makeServer();
    server.stop();
    expect(readdirSync(lockDir).length).toBe(0);
    server.start();
    expect(server.running).toBe(true);
    expect(readdirSync(lockDir)).toEqual([`${server.port}.lock`]);
  });

  test("stop on a stopped server is safe", () => {
    const { server } = makeServer();
    server.stop();
    expect(() => server.stop()).not.toThrow();
    expect(server.running).toBe(false);
  });
});
