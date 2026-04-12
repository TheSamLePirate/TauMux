import type { PanelEvent } from "../shared/types";

const encoder = new TextEncoder();

export class EventWriter {
  private closed = false;

  onError: ((source: string, error: Error) => void) | null = null;

  constructor(private fd: number) {}

  send(event: PanelEvent): boolean {
    if (this.closed) return false;
    try {
      const line = JSON.stringify(event) + "\n";
      const promise = Bun.write(Bun.file(this.fd), encoder.encode(line));
      // Bun.write returns a Promise — catch async write failures
      (promise as Promise<number>).catch((err: unknown) => {
        this.onError?.(
          "event-write",
          err instanceof Error ? err : new Error(String(err)),
        );
      });
      return true;
    } catch (err) {
      this.onError?.(
        "event-write",
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
  }

  close(): void {
    this.closed = true;
  }
}
