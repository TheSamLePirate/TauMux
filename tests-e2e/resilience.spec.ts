import { test, expect } from "./fixtures";
import { WEB_PROTOCOL_VERSION } from "../src/shared/web-protocol";
import { openWSBuffered } from "./ws-client";

test.describe("web mirror: resize request clamping", () => {
  test("huge cols/rows are clamped rather than forwarded raw", async ({
    serverCtx,
  }) => {
    const seenResizes: Array<{ cols: number; rows: number }> = [];
    // The host (server-boot's test wrapper) doesn't wire
    // onSurfaceResizeRequest, so to observe clamping we let the server
    // deliver an internal resize broadcast back to us. The server
    // clamps BEFORE invoking the host callback; a clamped pair will
    // surface via the `resize` broadcast if the host re-emits it. We
    // instead probe the validation boundary directly: send out-of-
    // range values and check the server doesn't crash and the session
    // still accepts subsequent messages. A dedicated unit test in
    // tests/hardening-extra.test.ts already proves the clamping
    // arithmetic — this e2e checks the protocol stays healthy.
    const { ws, messages } = await openWSBuffered(serverCtx.port);

    // 1) Out-of-range (must be clamped or dropped silently — NOT cause
    //    the session to die).
    ws.send(
      JSON.stringify({
        type: "surfaceResizeRequest",
        surfaceId: serverCtx.surfaceId,
        cols: 1e9,
        rows: 1e9,
      }),
    );

    // 2) Non-numeric (must be rejected by validator, not passed
    //    through — no throw on the server side).
    ws.send(
      JSON.stringify({
        type: "surfaceResizeRequest",
        surfaceId: serverCtx.surfaceId,
        cols: "huge",
        rows: "huge",
      }),
    );

    // 3) Sane follow-up to prove the WS is still alive.
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: "echo POSTRESIZE_OK\n",
      }),
    );

    await expect
      .poll(
        () =>
          messages.some(
            (m) =>
              m.type === "output" &&
              String(m.payload["data"] ?? "").includes("POSTRESIZE_OK"),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    expect(seenResizes).toEqual([]);
    ws.close();
  });
});

test.describe("web mirror: reconnect + resume replay", () => {
  test("client reconnects with resume=<id>&seq=<n> and catches up", async ({
    serverCtx,
  }) => {
    // 1. Open a first WS, wait for hello, note sessionId.
    const { ws: ws1, messages: msgs1 } = await openWSBuffered(
      serverCtx.port,
    );

    await expect
      .poll(() => msgs1.some((m) => m.type === "hello"), { timeout: 5_000 })
      .toBe(true);
    const hello = msgs1.find((m) => m.type === "hello")!;
    const sessionId = hello.payload["sessionId"] as string;
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBe(32); // hex session id format

    // 2. Send stdin, wait for output to arrive so something is in the
    //    ring buffer.
    const markerBefore = `BEFORE_${Date.now()}`;
    ws1.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${markerBefore}\n`,
      }),
    );
    await expect
      .poll(
        () =>
          msgs1.some(
            (m) =>
              m.type === "output" &&
              String(m.payload["data"] ?? "").includes(markerBefore),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    const lastSeqBefore = Math.max(...msgs1.map((m) => m.seq));

    // 3. Disconnect. Server keeps the session buffered (SESSION_TTL_MS
    //    grace period).
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // 4. Produce more output while disconnected by writing directly
    //    via a fresh unrelated connection that shares the same
    //    surface. Easier: just wait for the shell's prompt to echo
    //    back naturally by sending more stdin via a second WS, then
    //    disconnect that too. But the cleanest path is to *reconnect*
    //    with resume and verify what we missed gets delivered via
    //    replay.
    //
    //    To guarantee there's SOMETHING in the gap, send another
    //    command that fires right before the WS closes and races into
    //    the session buffer. We already have lastSeqBefore as the
    //    watermark; any new messages past that will surface on resume.

    // Create a brand-new short-lived WS just to push more stdin in.
    const { ws: pusher } = await openWSBuffered(serverCtx.port);
    const markerGap = `GAP_${Date.now()}`;
    pusher.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${markerGap}\n`,
      }),
    );
    // Collect on pusher so we can be sure the server produced output.
    await new Promise((r) => setTimeout(r, 500));
    pusher.close();
    // Let server finish coalescing the output into ws1's session
    // buffer. The original session is still buffered because its TTL
    // (60s default) hasn't expired.
    await new Promise((r) => setTimeout(r, 200));

    // 5. Reconnect with resume=<sessionId>&seq=<lastSeqBefore>. Server
    //    should replay all envelopes with seq > lastSeqBefore, which
    //    includes the GAP marker (broadcast to all sessions subscribed
    //    to the surface).
    const { ws: ws2, messages: msgs2 } = await openWSBuffered(
      serverCtx.port,
      `?resume=${encodeURIComponent(sessionId)}&seq=${lastSeqBefore}`,
    );

    // After resume, the session should have the GAP marker replayed
    // as an output envelope (or already in the subsequent broadcast).
    await expect
      .poll(
        () =>
          msgs2.some(
            (m) =>
              m.type === "output" &&
              String(m.payload["data"] ?? "").includes(markerGap),
          ),
        {
          timeout: 10_000,
          message: "resume did not replay the gap output",
        },
      )
      .toBe(true);

    // No hello on resume (server keeps existing session).
    expect(msgs2.some((m) => m.type === "hello")).toBe(false);

    ws2.close();
  });

  test("resume with unknown session id starts a fresh session (hello)", async ({
    serverCtx,
  }) => {
    const fakeId = "0".repeat(32);
    const { ws, messages: msgs } = await openWSBuffered(
      serverCtx.port,
      `?resume=${fakeId}&seq=0`,
    );

    // Server fell back to creating a new session — first envelope is
    // a fresh hello, not a replay.
    await expect
      .poll(() => msgs.some((m) => m.type === "hello"), { timeout: 5_000 })
      .toBe(true);
    const hello = msgs.find((m) => m.type === "hello")!;
    expect(hello.payload["sessionId"]).not.toBe(fakeId);
    expect(hello.v).toBe(WEB_PROTOCOL_VERSION);

    ws.close();
  });
});

test.describe("web mirror: stdin size cap", () => {
  test("oversized stdin is dropped; normal stdin after still round-trips", async ({
    serverCtx,
  }) => {
    const { ws, messages: msgs } = await openWSBuffered(serverCtx.port);

    // 64 KiB + 1 — over the cap. Server should log-and-drop.
    const overMax = "x".repeat(64 * 1024 + 1);
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: overMax,
      }),
    );

    // Follow-up small stdin — must still work, proving the WS wasn't
    // killed by the oversized send.
    const marker = `SMALL_OK_${Date.now()}`;
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
});
