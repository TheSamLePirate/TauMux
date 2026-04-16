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

test.describe("web mirror: rate limiter", () => {
  test("flood of >256 frames drops some but keeps the connection alive", async ({
    serverCtx,
  }) => {
    const ws = await openWS(serverCtx.port);
    const outputs: string[] = [];
    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (env?.type === "output") {
        outputs.push(String(env.payload["data"] ?? ""));
      }
    });

    // The token bucket holds CLIENT_RATE_CAPACITY = 256 tokens and
    // refills at 256/sec. A synchronous burst of 1000 frames in one
    // tick will drain the bucket and cause the tail to be dropped by
    // the server. We send stdin for each with a distinct marker; the
    // number of markers actually observed in the output must be
    // significantly less than 1000 but more than zero.
    const markers: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const m = `FLOOD_${i}`;
      markers.push(m);
      ws.send(
        JSON.stringify({
          type: "stdin",
          surfaceId: serverCtx.surfaceId,
          data: `echo ${m}\n`,
        }),
      );
    }

    // Give the server time to process whatever it didn't drop.
    await new Promise((r) => setTimeout(r, 2_000));

    // Wait until the bucket refills (1 sec is enough — 256/sec), then
    // send a sentinel to prove the connection is still up.
    const sentinel = `SENTINEL_${Date.now()}`;
    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${sentinel}\n`,
      }),
    );

    await expect
      .poll(() => outputs.some((o) => o.includes(sentinel)), {
        timeout: 10_000,
      })
      .toBe(true);

    // Sanity: some of the FLOOD markers should have landed, but the
    // bucket should have prevented ALL of them from reaching the
    // shell. We verify the rate limiter actually dropped work by
    // checking we didn't see every marker.
    const seenMarkers = markers.filter((m) =>
      outputs.some((o) => o.includes(m)),
    );
    expect(seenMarkers.length).toBeGreaterThan(0);
    expect(seenMarkers.length).toBeLessThan(1000);

    ws.close();
  });
});

test.describe("web mirror: rapid reconnect cycle", () => {
  /** Open a fresh WS and wait for the hello envelope. Attaches the
   *  message listener synchronously *before* awaiting open so we
   *  never miss a hello that arrives in the same microtask as the
   *  upgrade completion. */
  async function openAndHello(port: number): Promise<NodeWS> {
    const ws = new NodeWS(`ws://127.0.0.1:${port}/`);
    const helloP = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no hello")), 5_000);
      ws.on("message", (raw) => {
        const env = parseEnvelope(raw);
        if (env?.type === "hello") {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    await helloP;
    return ws;
  }

  test("10 sequential open/close cycles leave the server healthy", async ({
    serverCtx,
  }) => {
    for (let i = 0; i < 10; i++) {
      const ws = await openAndHello(serverCtx.port);
      ws.close();
    }
    const final = await openAndHello(serverCtx.port);
    final.close();
    // Reaching here means all 11 opens saw a hello — the server's
    // session bookkeeping survived the churn.
    expect(true).toBe(true);
  });
});

test.describe("web mirror: sustained burst integrity", () => {
  test("seq numbers stay monotonically increasing during a 30-message burst", async ({
    serverCtx,
  }) => {
    const ws = await openWS(serverCtx.port);
    const seqs: number[] = [];
    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (env) seqs.push(env.seq);
    });

    // 30 spaced messages (50 ms each) — under the rate-limit capacity
    // but above the coalesce window, so every stdin should produce a
    // distinct output envelope.
    for (let i = 0; i < 30; i++) {
      ws.send(
        JSON.stringify({
          type: "stdin",
          surfaceId: serverCtx.surfaceId,
          data: `echo BURST_${i}\n`,
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
    }

    // Wait for the last expected output to arrive before sealing.
    await expect
      .poll(
        async () => {
          // Collect current output bodies.
          return seqs.length;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(10);

    // Invariant: seq is strictly increasing by 1 over the entire
    // captured prefix. Any gap or reordering under load would show up
    // here.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }

    ws.close();
  });
});
