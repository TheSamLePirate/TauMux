import { chmodSync, existsSync, unlinkSync } from "fs";

type RpcHandler = (
  method: string,
  params: Record<string, unknown>,
) => unknown | Promise<unknown>;

interface SocketData {
  buffer: string;
  /** Set once we've terminated this peer for buffer overflow so a slow
   *  drain of in-flight data events doesn't spam the log or restart
   *  the buffer-grow loop. */
  killed: boolean;
}

/** Hard cap on the per-connection accumulator. Reached only by a buggy
 *  client (or a malicious one) that writes bytes without ever sending a
 *  newline. The biggest legitimate `ht` payloads — agent prompts,
 *  layout snapshots — are well under this. Owner-only chmod limits
 *  exposure to local-user attacks, but a runaway script could still
 *  wedge the whole app via OOM, hence the cap. (Triple-A G.5 / L4) */
const MAX_BUFFER_BYTES = 1_048_576;

export class SocketServer {
  private server: ReturnType<typeof Bun.listen> | null = null;
  private bound = false;

  constructor(
    private socketPath: string,
    private handler: RpcHandler,
  ) {}

  async start(): Promise<void> {
    // Don't blindly unlink the socket file. If another τ-mux process is
    // already listening on this path, deleting the inode would orphan that
    // listener and silently break its `ht` clients (issue B4/B5 in
    // doc/full_analysis.md). Probe first; only unlink if the path is stale.
    if (existsSync(this.socketPath)) {
      const live = await this.isPeerLive();
      if (live) {
        console.error(
          `[socket] Another process is already listening on ${this.socketPath}.`,
        );
        console.error(
          "[socket] Refusing to overwrite — the existing process's `ht` clients would break.",
        );
        console.error(
          "[socket] Set HT_CONFIG_DIR or HT_SOCKET_PATH to a different path,",
        );
        console.error(
          "[socket]   e.g. HT_CONFIG_DIR=/tmp/tau-mux-dev bun run dev",
        );
        console.error("[socket] CLI commands via 'ht' will be unavailable.");
        return;
      }
      try {
        unlinkSync(this.socketPath);
      } catch {
        // race: peer cleaned up between probe and unlink — fine, the bind
        // attempt below will fail loudly if the path reappears.
      }
    }

    try {
      this.server = Bun.listen<SocketData>({
        unix: this.socketPath,
        socket: {
          open: (socket) => {
            socket.data = { buffer: "", killed: false };
          },
          data: async (socket, rawData) => {
            if (socket.data.killed) return;
            const text =
              typeof rawData === "string"
                ? rawData
                : new TextDecoder().decode(rawData);

            // Append to per-connection buffer for correct stream reassembly.
            // Sockets are stream-oriented: a large JSON payload may arrive
            // across multiple data events, so we must buffer until we see a
            // complete newline-delimited line.
            socket.data.buffer += text;

            // Hard cap (L4): a client that writes bytes without ever
            // sending a newline would otherwise grow the buffer until
            // the parent runs out of memory. Send a structured error and
            // close.
            if (socket.data.buffer.length > MAX_BUFFER_BYTES) {
              socket.data.killed = true;
              const err = JSON.stringify({
                id: 0,
                error: `request exceeded ${MAX_BUFFER_BYTES} bytes without a newline; closing connection`,
              });
              try {
                socket.write(err + "\n");
              } catch {
                /* connection may already be gone */
              }
              try {
                socket.end();
              } catch {
                /* idem */
              }
              console.warn(
                `[socket] dropped peer: per-connection buffer exceeded ${MAX_BUFFER_BYTES} bytes without newline`,
              );
              return;
            }

            const parts = socket.data.buffer.split("\n");
            // Keep the last (potentially incomplete) segment for the next event
            socket.data.buffer = parts[parts.length - 1];

            for (let i = 0; i < parts.length - 1; i++) {
              const line = parts[i].trim();
              if (!line) continue;

              let id: string | number = 0;
              try {
                const req = JSON.parse(line);
                id = req.id ?? 0;
                const method = req.method as string;
                const params = (req.params as Record<string, unknown>) ?? {};

                const result = await this.handler(method, params);
                const response = JSON.stringify({ id, result }) + "\n";
                socket.write(response);
              } catch (err) {
                const msg =
                  err instanceof Error ? err.message : "Unknown error";
                const response = JSON.stringify({ id, error: msg }) + "\n";
                socket.write(response);
              }
            }
          },
          close: () => {},
          error: (_socket, err) => {
            console.error("[socket] error:", err.message);
          },
        },
      });

      // Restrict socket permissions to owner-only (prevents other users on the
      // same machine from connecting and sending arbitrary RPC commands).
      try {
        chmodSync(this.socketPath, 0o600);
      } catch {
        console.warn("[socket] Could not set permissions on", this.socketPath);
      }

      this.bound = true;
      console.log(`[socket] listening on ${this.socketPath}`);
    } catch (err) {
      // If the socket cannot be bound (EADDRINUSE, EACCES, etc.), log the
      // error and allow the terminal to function normally without CLI support.
      console.error(
        "[socket] Failed to bind:",
        err instanceof Error ? err.message : err,
      );
      console.error("[socket] CLI commands via 'ht' will be unavailable.");
      this.server = null;
      this.bound = false;
    }
  }

  /** True iff the listener is bound and ready to accept connections. */
  isBound(): boolean {
    return this.bound;
  }

  /** Best-effort probe: does someone answer on this socket within 250 ms?
   *  Used to distinguish a live peer (refuse to take over) from a stale
   *  inode left behind by a crashed process (safe to unlink). */
  private async isPeerLive(): Promise<boolean> {
    return await new Promise<boolean>((resolveOnce) => {
      let done = false;
      const finish = (live: boolean): void => {
        if (done) return;
        done = true;
        resolveOnce(live);
      };
      const timer = setTimeout(() => finish(false), 250);
      try {
        Bun.connect<{ live: boolean }>({
          unix: this.socketPath,
          socket: {
            open: (socket) => {
              clearTimeout(timer);
              try {
                socket.end();
              } catch {
                // ignore — connection succeeded, that's all we need
              }
              finish(true);
            },
            data: () => {},
            close: () => {},
            error: () => {
              clearTimeout(timer);
              finish(false);
            },
          },
        }).catch(() => {
          clearTimeout(timer);
          finish(false);
        });
      } catch {
        clearTimeout(timer);
        finish(false);
      }
    });
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
    this.bound = false;
    try {
      unlinkSync(this.socketPath);
    } catch {
      // already gone
    }
  }
}
