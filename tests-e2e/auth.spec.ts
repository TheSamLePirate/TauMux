import { test, expect } from "./fixtures";
import { connect } from "node:net";

/** Send a raw WebSocket upgrade request and return the HTTP status
 *  line the server writes. Node's fetch refuses `upgrade: websocket`
 *  on the grounds that HTTP/1 upgrades aren't proper fetch requests,
 *  so we hand-write the bytes. We don't care about completing the
 *  101 handshake — only the initial status, which is what the
 *  origin/auth gates control. */
async function probeUpgrade(
  port: number,
  headers: Record<string, string>,
): Promise<number> {
  const defaults: Record<string, string> = {
    Host: `127.0.0.1:${port}`,
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version": "13",
  };
  const merged = { ...defaults, ...headers };
  const reqLines = [
    "GET / HTTP/1.1",
    ...Object.entries(merged).map(([k, v]) => `${k}: ${v}`),
    "",
    "",
  ];
  const raw = reqLines.join("\r\n");

  return await new Promise<number>((resolve, reject) => {
    const sock = connect({ host: "127.0.0.1", port });
    let buf = "";
    const done = (status: number | Error) => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      if (status instanceof Error) reject(status);
      else resolve(status);
    };
    const timer = setTimeout(
      () => done(new Error("upgrade probe timeout")),
      5_000,
    );
    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const firstLine = buf.split("\r\n", 1)[0] ?? "";
      const m = /^HTTP\/1\.\d\s+(\d+)/.exec(firstLine);
      if (m) {
        clearTimeout(timer);
        done(Number(m[1]));
      }
    });
    sock.on("error", (err) => {
      clearTimeout(timer);
      done(err);
    });
    sock.on("close", () => {
      // Some servers close without sending anything on reject.
      if (!buf) {
        clearTimeout(timer);
        done(new Error("server closed connection without status"));
      }
    });
    sock.on("connect", () => sock.write(raw));
  });
}

test.describe("web mirror: HTTP auth", () => {
  test("open access (no token): GET / serves HTML", async ({
    serverCtx,
    request,
  }) => {
    const res = await request.get(`${serverCtx.baseURL}/`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("HyperTerm Remote");
  });

  test("token required: GET / without token returns 401", async ({
    boot,
    request,
  }) => {
    const ctx = await boot({ token: "s3cret" });
    const res = await request.get(`${ctx.baseURL}/`);
    expect(res.status()).toBe(401);
  });

  test("token required: wrong token returns 401", async ({ boot, request }) => {
    const ctx = await boot({ token: "s3cret" });
    const res = await request.get(`${ctx.baseURL}/?t=nope`);
    expect(res.status()).toBe(401);
  });

  test("token required: correct token via query serves HTML", async ({
    boot,
    request,
  }) => {
    const ctx = await boot({ token: "s3cret" });
    const res = await request.get(`${ctx.baseURL}/?t=s3cret`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("HyperTerm Remote");
  });

  test("token required: Authorization: Bearer header is accepted", async ({
    boot,
    request,
  }) => {
    const ctx = await boot({ token: "s3cret" });
    const res = await request.get(`${ctx.baseURL}/`, {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe("web mirror: WS origin validation", () => {
  test("no-Origin upgrade (native clients) gets past the origin gate", async ({
    serverCtx,
  }) => {
    const status = await probeUpgrade(serverCtx.port, {});
    // 101 = upgraded, anything in 4xx indicates a gate rejection.
    // The only statuses the gates produce are 401 (auth) and 403
    // (origin). A successful handshake is 101.
    expect(status).toBe(101);
  });

  test("same-host Origin header upgrades cleanly", async ({ serverCtx }) => {
    const status = await probeUpgrade(serverCtx.port, {
      Origin: `http://127.0.0.1:${serverCtx.port}`,
    });
    expect(status).toBe(101);
  });

  test("cross-origin WS upgrade is rejected (403)", async ({ serverCtx }) => {
    const status = await probeUpgrade(serverCtx.port, {
      Origin: "http://evil.example.com",
    });
    expect(status).toBe(403);
  });

  test("cross-origin is rejected even with valid token", async ({ boot }) => {
    const ctx = await boot({ token: "s3cret" });
    const status = await probeUpgrade(ctx.port, {
      Origin: "http://evil.example.com",
      // Token in URL wouldn't matter here, but include it in header
      // form — it still shouldn't bypass the origin gate.
      Authorization: "Bearer s3cret",
    });
    expect(status).toBe(403);
  });
});
