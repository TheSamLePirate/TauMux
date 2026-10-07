import { WebSocket as NodeWS } from "ws";

/**
 * Buffered WS test client — the race-proof way to talk to the mirror
 * from e2e specs.
 *
 * The bug this kills: the server sends `hello` immediately on upgrade,
 * and it can ride in the SAME TCP segment as the 101 response. Node's
 * `ws` then emits `message` synchronously with `open` — so the
 * canonical spec pattern
 *
 *   const ws = await openWS(port);   // resolves on "open"
 *   ws.on("message", ...);           // attached a microtask later
 *
 * deterministically loses the hello on a loaded machine (CI, or a dev
 * box mid-build): the test times out with "no hello" while every
 * later-arriving message flows fine. This client attaches the message
 * listener at construction — before the upgrade completes — and
 * buffers every envelope from byte zero.
 *
 * Use `openWSBuffered` for any spec that awaits server-pushed
 * envelopes (hello, resume replay, seq accounting).
 */

export interface Envelope {
  v: number;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

export function parseEnvelope(raw: unknown): Envelope | null {
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

export interface BufferedWS {
  ws: NodeWS;
  /** Every envelope received since construction, in arrival order. */
  messages: Envelope[];
  /** Resolves with the first envelope of `type` — including one that
   *  already arrived before the call (no listen-after-the-fact race). */
  waitFor(type: string, timeoutMs?: number): Promise<Envelope>;
}

export async function openWSBuffered(
  port: number,
  /** Raw query string including the leading "?" — e.g. resume params. */
  query = "",
): Promise<BufferedWS> {
  const ws = new NodeWS(`ws://127.0.0.1:${port}/${query}`);
  const messages: Envelope[] = [];
  const waiters: Array<{
    type: string;
    resolve: (e: Envelope) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  // Attached BEFORE the upgrade completes — see the module header.
  ws.on("message", (raw) => {
    const env = parseEnvelope(raw);
    if (!env) return;
    messages.push(env);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i]!;
      if (w.type === env.type) {
        clearTimeout(w.timer);
        w.resolve(env);
        waiters.splice(i, 1);
      }
    }
  });

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

  return {
    ws,
    messages,
    waitFor: (type, timeoutMs = 5_000) =>
      new Promise<Envelope>((resolve, reject) => {
        const existing = messages.find((m) => m.type === type);
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timer === timer);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`no ${type}`));
        }, timeoutMs);
        waiters.push({ type, resolve, timer });
      }),
  };
}
