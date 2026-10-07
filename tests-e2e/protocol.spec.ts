import { test, expect } from "./fixtures";
import { WEB_PROTOCOL_VERSION } from "../src/shared/web-protocol";
import { openWSBuffered } from "./ws-client";

test.describe("web mirror: hello envelope shape", () => {
  test("hello carries protocolVersion, hex sessionId, snapshot", async ({
    serverCtx,
  }) => {
    const { ws, waitFor } = await openWSBuffered(serverCtx.port);
    const hello = await waitFor("hello");

    expect(hello.v).toBe(WEB_PROTOCOL_VERSION);
    expect(hello.seq).toBe(0);

    const payload = hello.payload;
    // sessionId is 32-char hex per makeSessionId (M8 hardening).
    expect(payload["sessionId"]).toMatch(/^[0-9a-f]{32}$/);
    expect(payload["serverInstanceId"]).toMatch(/^[0-9a-f]{32}$/);
    expect(payload["protocolVersion"]).toBe(WEB_PROTOCOL_VERSION);

    const snapshot = payload["snapshot"] as Record<string, unknown>;
    expect(snapshot).toBeTruthy();
    expect(Array.isArray(snapshot["workspaces"])).toBe(true);
    expect((snapshot["workspaces"] as unknown[]).length).toBe(1);
    expect(snapshot["activeWorkspaceId"]).toBe("ws:1");
    expect(snapshot["focusedSurfaceId"]).toBe(serverCtx.surfaceId);

    ws.close();
  });

  test("serverInstanceId is unique per boot", async ({ boot }) => {
    const ctx1 = await boot();
    const ctx2 = await boot();

    async function grabInstanceId(port: number): Promise<string> {
      const { ws, waitFor } = await openWSBuffered(port);
      const hello = await waitFor("hello");
      ws.close();
      return hello.payload["serverInstanceId"] as string;
    }

    const [a, b] = await Promise.all([
      grabInstanceId(ctx1.port),
      grabInstanceId(ctx2.port),
    ]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
  });
});

test.describe("web mirror: seq monotonicity", () => {
  test("every envelope has a strictly-increasing seq starting at 0", async ({
    serverCtx,
  }) => {
    const { ws, messages } = await openWSBuffered(serverCtx.port);

    // Space the echoes beyond the 16 ms OUTPUT_COALESCE_MS window so
    // they produce distinct output envelopes rather than being merged
    // into one. 50 ms is safely above the coalesce timer.
    for (let i = 0; i < 3; i++) {
      ws.send(
        JSON.stringify({
          type: "stdin",
          surfaceId: serverCtx.surfaceId,
          data: `echo SEQ_BURST_${i}\n`,
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
    }

    await expect
      .poll(() => messages.length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3); // hello + at least 2 spaced outputs
    const seqs = messages.map((m) => m.seq);

    // Seq starts at 0 (hello) and increments by exactly 1. Coalesced
    // outputs still get a new seq — the semantic is "per enqueued
    // envelope".
    expect(seqs[0]).toBe(0);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }

    ws.close();
  });
});

test.describe("web mirror: asset routes", () => {
  test("nerd-regular.ttf served as font/ttf", async ({
    serverCtx,
    request,
  }) => {
    const res = await request.get(
      `${serverCtx.baseURL}/fonts/nerd-regular.ttf`,
    );
    // Fonts only ship when the bundler embeds them; accept 200 (with
    // font type) OR 404 (no font bundled into this build) — but not
    // e.g. HTML spillover.
    if (res.status() === 200) {
      expect(res.headers()["content-type"]).toContain("font/ttf");
      const buf = await res.body();
      expect(buf.byteLength).toBeGreaterThan(1000);
    } else {
      expect(res.status()).toBe(404);
    }
  });

  test("nerd-bold.ttf served as font/ttf (or 404)", async ({
    serverCtx,
    request,
  }) => {
    const res = await request.get(`${serverCtx.baseURL}/fonts/nerd-bold.ttf`);
    if (res.status() === 200) {
      expect(res.headers()["content-type"]).toContain("font/ttf");
    } else {
      expect(res.status()).toBe(404);
    }
  });

  test("sourcemap paths return a stub 200 (xterm.js source maps)", async ({
    serverCtx,
    request,
  }) => {
    const res = await request.get(`${serverCtx.baseURL}/xterm.js.map`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.text();
    // Minimal valid sourcemap skeleton.
    expect(() => JSON.parse(body)).not.toThrow();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed["version"]).toBe(3);
  });

  test("random unknown path returns 404", async ({ serverCtx, request }) => {
    const res = await request.get(`${serverCtx.baseURL}/totally-not-a-route`);
    expect(res.status()).toBe(404);
  });
});

test.describe("web mirror: subscribe / history replay", () => {
  test("subscribeSurface triggers a history envelope for that surface", async ({
    serverCtx,
  }) => {
    const { ws, messages: seen } = await openWSBuffered(serverCtx.port);

    // Produce some shell output so the surface has history to replay.
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo HIST_BEFORE_RESUB\n`,
      }),
    );

    await expect
      .poll(
        () =>
          seen.some(
            (m) =>
              m.type === "output" &&
              String(m.payload["data"] ?? "").includes("HIST_BEFORE_RESUB"),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Clear local receive log and explicitly re-subscribe — the server
    // responds with a fresh `history` envelope bearing the terminal's
    // current serialized state.
    seen.length = 0;
    ws.send(
      JSON.stringify({
        type: "subscribeSurface",
        surfaceId: serverCtx.surfaceId,
      }),
    );

    await expect
      .poll(
        () =>
          seen.some(
            (m) =>
              m.type === "history" &&
              m.payload["surfaceId"] === serverCtx.surfaceId,
          ),
        { timeout: 5_000 },
      )
      .toBe(true);

    const hist = seen.find((m) => m.type === "history")!;
    // History is the xterm SerializeAddon output — a non-empty string.
    expect(typeof hist.payload["data"]).toBe("string");

    ws.close();
  });
});
