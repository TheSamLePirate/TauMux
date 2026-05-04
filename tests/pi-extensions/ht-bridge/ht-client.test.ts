/**
 * ht-client — protocol smoke tests.
 *
 * Spins up a tiny Unix-socket server that mimics τ-mux's framing
 * (newline-delimited JSON, reply shape `{id, result | error}`) and
 * exercises the client against it. Skips the CLI-fallback path —
 * that's covered indirectly by the "socket unreachable → reject"
 * case.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHtClient } from "../../../pi-extensions/ht-bridge/lib/ht-client";
import {
  DEFAULT_CONFIG,
  type Config,
} from "../../../pi-extensions/ht-bridge/lib/config";

interface FakeServer {
  socketPath: string;
  server: Server;
  /** All requests received by the fake (newline-delimited JSON parsed). */
  requests: any[];
  /** Override on a per-test basis to control what the server replies with. */
  reply: (req: any) => any;
  close: () => Promise<void>;
}

function startFakeTauMux(): Promise<FakeServer> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "ht-bridge-test-"));
    const socketPath = join(dir, "test.sock");
    const requests: any[] = [];
    const fake: FakeServer = {
      socketPath,
      server: null as unknown as Server,
      requests,
      reply: (req) => ({ id: req.id, result: "OK" }),
      close: () =>
        new Promise<void>((r) =>
          fake.server.close(() => {
            try {
              rmSync(dir, { recursive: true, force: true });
            } catch {
              /* idem */
            }
            r();
          }),
        ),
    };

    fake.server = createServer((sock) => {
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let req: any;
          try {
            req = JSON.parse(line);
          } catch {
            continue;
          }
          requests.push(req);
          const reply = fake.reply(req);
          if (reply !== undefined) sock.write(JSON.stringify(reply) + "\n");
        }
      });
      sock.on("error", () => {
        /* ignore */
      });
    });

    fake.server.once("error", reject);
    fake.server.listen(socketPath, () => resolve(fake));
  });
}

function makeConfig(overrides: Partial<Config>): Config {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe("ht-client", () => {
  let fake: FakeServer | null = null;

  beforeEach(async () => {
    fake = await startFakeTauMux();
  });

  afterEach(async () => {
    if (fake) await fake.close();
    fake = null;
  });

  test("call() resolves with the result field", async () => {
    fake!.reply = (req) => ({ id: req.id, result: { hello: "world" } });
    const ht = createHtClient(makeConfig({ socketPath: fake!.socketPath }));
    const out = await ht.call<{ hello: string }>("system.ping", {});
    expect(out).toEqual({ hello: "world" });
    expect(fake!.requests[0]).toMatchObject({
      method: "system.ping",
      params: {},
    });
  });

  test("call() rejects with the error string when the server returns one", async () => {
    fake!.reply = (req) => ({ id: req.id, error: "method not found" });
    const ht = createHtClient(makeConfig({ socketPath: fake!.socketPath }));
    await expect(ht.call("missing.method", {})).rejects.toThrow(
      "method not found",
    );
  });

  test("call() rejects on timeout when no reply arrives", async () => {
    fake!.reply = () => undefined; // never reply
    const ht = createHtClient(makeConfig({ socketPath: fake!.socketPath }));
    await expect(ht.call("slow.method", {}, { timeoutMs: 50 })).rejects.toThrow(
      /timed out/,
    );
  });

  test("call() rejects when AbortSignal is triggered", async () => {
    fake!.reply = () => undefined;
    const ht = createHtClient(makeConfig({ socketPath: fake!.socketPath }));
    const controller = new AbortController();
    const promise = ht.call(
      "blocking.method",
      {},
      {
        signal: controller.signal,
        timeoutMs: 0,
      },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toThrow(/aborted/);
  });

  test("call() rejects when socket path is missing and no CLI fallback wired", async () => {
    // socketEnabled: false + an unmapped method ⇒ both transports fail.
    const ht = createHtClient(
      makeConfig({
        socketEnabled: false,
        socketPath: "/tmp/does-not-exist.sock",
      }),
    );
    await expect(ht.call("unknown.method", {})).rejects.toThrow(
      /no CLI fallback wired/,
    );
  });

  test("callSoft() never rejects — even on transport failure", async () => {
    const ht = createHtClient(
      makeConfig({
        socketEnabled: false,
        socketPath: "/tmp/nope.sock",
      }),
    );
    // Should resolve immediately (it's fire-and-forget) and not throw
    // even though the underlying call rejects.
    expect(() => ht.callSoft("unknown.method", {})).not.toThrow();
    // Give the rejection time to fire so the test can fail if it
    // bubbled out as an unhandled rejection.
    await new Promise((r) => setTimeout(r, 10));
  });
});
