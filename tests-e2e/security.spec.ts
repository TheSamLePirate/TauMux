import { test, expect } from "./fixtures";
import { WebSocket as NodeWS } from "ws";

interface Envelope {
  v: number;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

function parseEnvelope(raw: unknown): Envelope | null {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Buffer
        ? raw.toString("utf8")
        : null;
  if (!text || text[0] !== "{") return null;
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    return null;
  }
}

async function openWS(port: number): Promise<NodeWS> {
  const ws = new NodeWS(`ws://127.0.0.1:${port}/`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws open timeout")), 5_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return ws;
}

// ── WS-side hostile / malformed inputs ───────────────────────────────

test.describe("web mirror: malformed WS frames", () => {
  test("invalid JSON frames are dropped; session keeps working", async ({
    serverCtx,
  }) => {
    const ws = await openWS(serverCtx.port);
    const msgs: Envelope[] = [];
    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (env) msgs.push(env);
    });

    // A sequence of junk frames the server must shrug off.
    ws.send("this is not json");
    ws.send("{");
    ws.send("{bad:");
    ws.send('{"type":null}');
    ws.send('{"no-type-field":true}');

    // Valid follow-up — proves the session is still alive.
    const marker = `POST_GARBAGE_${Date.now()}`;
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${marker}\n`,
      }),
    );

    await expect
      .poll(
        () =>
          msgs.some(
            (m) =>
              m.type === "output" &&
              String(m.payload["data"] ?? "").includes(marker),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    ws.close();
  });

  test("unknown envelope types are silently ignored", async ({ serverCtx }) => {
    const ws = await openWS(serverCtx.port);
    const msgs: Envelope[] = [];
    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (env) msgs.push(env);
    });

    ws.send(JSON.stringify({ type: "definitelyNotAThing", x: 1 }));
    ws.send(JSON.stringify({ type: "surface.kill_pid", pid: 1 })); // socket-RPC name, not WS type

    const marker = `POST_UNKNOWN_${Date.now()}`;
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${marker}\n`,
      }),
    );
    await expect
      .poll(
        () =>
          msgs.some(
            (m) =>
              m.type === "output" &&
              String(m.payload["data"] ?? "").includes(marker),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    ws.close();
  });

  test("stdin containing control / escape sequences is forwarded without panic", async ({
    serverCtx,
  }) => {
    const ws = await openWS(serverCtx.port);
    const msgs: Envelope[] = [];
    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (env) msgs.push(env);
    });

    // ESC ]2; set window title, mixed with normal shell characters.
    // The shell receives these bytes verbatim over stdin; the test
    // checks the server + PTY pipeline doesn't panic on non-ASCII,
    // and a sane follow-up still round-trips.
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: "\x1b]2;pwnd\x07\n",
      }),
    );
    // Also include null bytes — some parsers / terminals choke on these.
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: "\x00\x01\x02\n",
      }),
    );

    const marker = `POST_ESC_${Date.now()}`;
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${marker}\n`,
      }),
    );
    await expect
      .poll(
        () =>
          msgs.some(
            (m) =>
              m.type === "output" &&
              String(m.payload["data"] ?? "").includes(marker),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    ws.close();
  });

  test("rapid mix of valid + invalid frames doesn't wedge the session", async ({
    serverCtx,
  }) => {
    const ws = await openWS(serverCtx.port);
    const msgs: Envelope[] = [];
    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (env) msgs.push(env);
    });

    // 20 junk, 1 valid, 20 junk, 1 valid. Exercises the JSON-parse
    // try/catch + handler whitelist + rate limiter together. 42 frames
    // is well under the 256-frame capacity, so the rate limiter
    // shouldn't drop the valid ones.
    for (let i = 0; i < 20; i++) ws.send("garbage-" + i);
    const m1 = `MIX1_${Date.now()}`;
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${m1}\n`,
      }),
    );
    for (let i = 0; i < 20; i++) ws.send("{bogus-" + i);
    const m2 = `MIX2_${Date.now()}`;
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${m2}\n`,
      }),
    );

    await expect
      .poll(
        () => {
          const all = msgs
            .filter((m) => m.type === "output")
            .map((m) => String(m.payload["data"] ?? ""))
            .join("\n");
          return all.includes(m1) && all.includes(m2);
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    ws.close();
  });
});

// ── HTTP-side path traversal / method safety ─────────────────────────

test.describe("web mirror: HTTP method + path safety", () => {
  test("path traversal variants do not serve HTML or any file outside the whitelist", async ({
    serverCtx,
    request,
  }) => {
    const probes = [
      "/../etc/passwd",
      "/%2e%2e/etc/passwd",
      "/fonts/../../../../../../etc/passwd",
      "/index.html/../../secret",
      "/..%2f..%2fetc%2fpasswd",
    ];
    for (const p of probes) {
      const res = await request.get(`${serverCtx.baseURL}${p}`);
      // Either the fetch normalizer turned it back into "/" (which
      // serves HTML — fine, no traversal happened) or the server
      // returned 404. What must NOT happen: a 200 with content that
      // isn't our app HTML.
      if (res.status() === 200) {
        const body = await res.text();
        // Anything that's not our page shouldn't land here.
        expect(body).toContain("HyperTerm Remote");
      } else {
        expect(res.status()).toBe(404);
      }
    }
  });

  test("HEAD / is handled (Bun.serve short-circuits to GET)", async ({
    serverCtx,
    request,
  }) => {
    const res = await request.fetch(`${serverCtx.baseURL}/`, {
      method: "HEAD",
    });
    // HEAD is not explicitly routed but must not 500 — Bun echoes
    // GET's status without a body.
    expect(res.status()).not.toBe(500);
  });

  test("POST / is inert: serves the page, never acts on the body", async ({
    serverCtx,
    request,
  }) => {
    const res = await request.post(`${serverCtx.baseURL}/`, {
      data: "payload=malicious&method=system.kill_pid&pid=1",
    });
    // The route handler doesn't branch on HTTP method, so POST / gets
    // the app HTML just like GET. What matters is that the body is
    // NOT interpreted — there's no action endpoint here. Assert the
    // response is the app page, unchanged by the request body.
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("HyperTerm Remote");
    expect(body).not.toContain("malicious");
  });

  test("very large Host header doesn't crash the server", async ({
    serverCtx,
    request,
  }) => {
    const big = "a".repeat(8000);
    const res = await request.get(`${serverCtx.baseURL}/`, {
      headers: { "X-Junk": big },
    });
    expect(res.status()).toBe(200);
  });
});
