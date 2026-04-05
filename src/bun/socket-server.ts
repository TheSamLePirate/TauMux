import { unlinkSync } from "fs";

type RpcHandler = (
  method: string,
  params: Record<string, unknown>,
) => unknown | Promise<unknown>;

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

    this.server = Bun.listen({
      unix: this.socketPath,
      socket: {
        open: () => {},
        data: async (socket, rawData) => {
          const text =
            typeof rawData === "string"
              ? rawData
              : new TextDecoder().decode(rawData);

          // Handle multiple newline-delimited requests in one chunk
          const lines = text.split("\n").filter((l) => l.trim());

          for (const line of lines) {
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
              const msg = err instanceof Error ? err.message : "Unknown error";
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

    console.log(`[socket] listening on ${this.socketPath}`);
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
