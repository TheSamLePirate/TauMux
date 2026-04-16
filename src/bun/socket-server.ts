import { chmodSync, unlinkSync } from "fs";

type RpcHandler = (
  method: string,
  params: Record<string, unknown>,
) => unknown | Promise<unknown>;

interface SocketData {
  buffer: string;
}

export class SocketServer {
  private server: ReturnType<typeof Bun.listen> | null = null;

  constructor(
    private socketPath: string,
    private handler: RpcHandler,
  ) {}

  start(): void {
    // Remove stale socket file
    try {
      unlinkSync(this.socketPath);
    } catch {
      // doesn't exist, fine
    }

    try {
      this.server = Bun.listen<SocketData>({
        unix: this.socketPath,
        socket: {
          open: (socket) => {
            socket.data = { buffer: "" };
          },
          data: async (socket, rawData) => {
            const text =
              typeof rawData === "string"
                ? rawData
                : new TextDecoder().decode(rawData);

            // Append to per-connection buffer for correct stream reassembly.
            // Sockets are stream-oriented: a large JSON payload may arrive
            // across multiple data events, so we must buffer until we see a
            // complete newline-delimited line.
            socket.data.buffer += text;

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
    }
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
    try {
      unlinkSync(this.socketPath);
    } catch {
      // already gone
    }
  }
}
