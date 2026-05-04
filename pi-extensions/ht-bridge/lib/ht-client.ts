/**
 * τ-mux RPC client — direct Unix-socket JSON-RPC with `ht` CLI fallback.
 *
 * Protocol (per `src/bun/socket-server.ts`):
 *   - Newline-delimited JSON.
 *   - Request:  `{"id":<n>,"method":"…","params":{…}}\n`
 *   - Response: `{"id":<n>,"result":…}\n` or `{"id":<n>,"error":"…"}\n`
 *   - 1 MB hard cap on per-connection buffer.
 *   - Socket is mode 0600; only the owning user can connect.
 *
 * One connection per call (Unix sockets are cheap; pooling would force
 * us to deal with stuck pendings on half-closed peers). Keeping it
 * simple here makes the failure modes obvious: connect fails ⇒ fall
 * back to the `ht` CLI; reply timeout ⇒ destroy + reject.
 *
 * Two surfaces:
 *   - `call(method, params)` — typed Promise; throws on transport
 *     failure or RPC error. Use for blocking ops (`agent.ask_user`).
 *   - `callSoft(method, params)` — fire-and-forget; never throws.
 *     Use for hot-path observability calls (`sidebar.set_status`,
 *     `sidebar.log`, `notification.create`).
 */

import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import type { Config } from "./config";
import { debugEnabled } from "./config";

export interface HtCallOptions {
  /** Reject if no reply arrives within this many ms. Default 5_000.
   *  Pass `0` to disable (use for `agent.ask_user`, which blocks
   *  until the user answers). */
  timeoutMs?: number;
  /** Cancel the in-flight call. The socket is destroyed on abort. */
  signal?: AbortSignal;
}

export interface HtClient {
  call<T = unknown>(
    method: string,
    params?: object,
    opts?: HtCallOptions,
  ): Promise<T>;
  callSoft(method: string, params?: object): void;
  /** True if the socket appears to be reachable. Resolves the path
   *  but does not perform a probe — actual connect failures fall
   *  back to the CLI inside each call. */
  socketAvailable(): boolean;
}

/** Distinguish transport-layer failures (connect refused, EPIPE,
 *  socket closed before reply) from protocol-level outcomes (server
 *  returned `error`, our own timeout, AbortSignal). The former should
 *  trigger CLI fallback; the latter should propagate as-is — we
 *  don't want to retry a "method not found" reply against `ht`. */
class HtTransportError extends Error {
  readonly transport = true as const;
  constructor(cause: unknown) {
    super(
      `ht-client transport: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function isTransportError(e: unknown): boolean {
  return Boolean((e as { transport?: boolean } | undefined)?.transport);
}

function resolveSocketPath(cfg: Config): string {
  if (cfg.socketPath) return cfg.socketPath;
  return process.env.HT_SOCKET_PATH || "/tmp/hyperterm.sock";
}

/** Run an `ht` CLI verb as a fallback when the socket isn't reachable.
 *  RPC params don't have a clean 1:1 mapping to CLI flags so this is
 *  best-effort: we cover the few RPC methods we actually invoke from
 *  the Phase 1/2 observers. Anything else returns a rejected promise
 *  so the caller can decide whether to swallow or propagate. */
function callViaCli<T>(
  cfg: Config,
  method: string,
  params: Record<string, any>,
): Promise<T> {
  const args = mapMethodToCliArgs(method, params);
  if (!args) {
    return Promise.reject(
      new Error(`ht-client: no CLI fallback wired for ${method}`),
    );
  }
  return new Promise<T>((resolve, reject) => {
    execFile(cfg.htBinary, args, { timeout: 3000 }, (err, stdout) => {
      if (err) return reject(err);
      // CLI verbs we map here don't return structured payloads; we
      // resolve with the trimmed stdout so callers can at least see
      // the success line.
      resolve(stdout.toString().trim() as unknown as T);
    });
  });
}

/** Best-effort RPC-method → CLI-argv translator. Add cases as new
 *  callers land. Unsupported methods return null so the caller can
 *  reject with a clear error. */
function mapMethodToCliArgs(
  method: string,
  p: Record<string, any>,
): string[] | null {
  switch (method) {
    case "sidebar.set_status": {
      const args = ["set-status", String(p.key ?? ""), String(p.value ?? "")];
      if (p.icon) args.push("--icon", String(p.icon));
      if (p.color) args.push("--color", String(p.color));
      return args;
    }
    case "sidebar.clear_status":
      return ["clear-status", String(p.key ?? "")];
    case "sidebar.log": {
      const args = ["log", String(p.message ?? "")];
      if (p.level) args.push("--level", String(p.level));
      if (p.source) args.push("--source", String(p.source));
      return args;
    }
    case "notification.create": {
      const args = ["notify"];
      if (p.title) args.push("--title", String(p.title));
      if (p.body) args.push("--body", String(p.body));
      if (p.subtitle) args.push("--subtitle", String(p.subtitle));
      if (p.icon) args.push("--icon", String(p.icon));
      if (p.color) args.push("--color", String(p.color));
      return args;
    }
    case "plan.set":
      // plan.set takes a JSON array; ht plan set --json '<json>'.
      return ["plan", "set", "--json", JSON.stringify(p.steps ?? [])];
    case "plan.update":
      return [
        "plan",
        "update",
        String(p.step_id ?? ""),
        "--state",
        String(p.state ?? "active"),
      ];
    case "plan.complete":
      return ["plan", "complete"];
    case "plan.clear":
      return ["plan", "clear"];
    default:
      return null;
  }
}

/** Open a socket, send one request, await one reply, close.
 *  Returns the parsed `result` field, or rejects with the `error`
 *  string from the server (or an Error from the transport). */
function callViaSocket<T>(
  socketPath: string,
  method: string,
  params: object,
  opts: HtCallOptions,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const socket = createConnection(socketPath);
    let buf = "";
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            settle(() => {
              try {
                socket.destroy();
              } catch {
                /* idem */
              }
              reject(
                new Error(
                  `ht-client: ${method} timed out after ${timeoutMs}ms`,
                ),
              );
            });
          }, timeoutMs)
        : null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    const onAbort = () => {
      settle(() => {
        cleanup();
        try {
          socket.destroy();
        } catch {
          /* idem */
        }
        reject(new Error("ht-client: aborted"));
      });
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    socket.once("connect", () => {
      const payload = JSON.stringify({ id: 1, method, params }) + "\n";
      socket.write(payload);
    });

    socket.on("data", (chunk: Buffer | string) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx < 0) return;
      const line = buf.slice(0, idx).trim();
      try {
        const reply = JSON.parse(line);
        settle(() => {
          cleanup();
          try {
            socket.end();
          } catch {
            /* idem */
          }
          if (reply.error) {
            reject(new Error(String(reply.error)));
          } else {
            resolve(reply.result as T);
          }
        });
      } catch (e) {
        settle(() => {
          cleanup();
          try {
            socket.destroy();
          } catch {
            /* idem */
          }
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      }
    });

    socket.on("error", (err) => {
      settle(() => {
        cleanup();
        reject(new HtTransportError(err));
      });
    });

    socket.on("close", () => {
      settle(() => {
        cleanup();
        reject(new HtTransportError(new Error("socket closed before reply")));
      });
    });
  });
}

export function createHtClient(cfg: Config): HtClient {
  const path = resolveSocketPath(cfg);

  async function call<T>(
    method: string,
    params: object = {},
    opts: HtCallOptions = {},
  ): Promise<T> {
    if (cfg.socketEnabled) {
      try {
        return await callViaSocket<T>(path, method, params, opts);
      } catch (err) {
        if (!isTransportError(err)) {
          // Server returned error, request timed out, or call was
          // aborted — none of these get retried via the CLI.
          throw err;
        }
        if (debugEnabled()) {
          console.error(
            `[ht-bridge] socket ${method} unreachable (${(err as Error).message}); falling back to CLI`,
          );
        }
        // Transport failure → CLI fallback.
      }
    }
    return callViaCli<T>(cfg, method, params as Record<string, any>);
  }

  function callSoft(method: string, params: object = {}): void {
    call(method, params).catch((err) => {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] soft ${method} failed: ${(err as Error).message}`,
        );
      }
    });
  }

  function socketAvailable(): boolean {
    if (!cfg.socketEnabled) return false;
    return Boolean(path);
  }

  return { call, callSoft, socketAvailable };
}
