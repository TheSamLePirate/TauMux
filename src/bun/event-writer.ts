import type { PanelEvent } from "../shared/types";

const encoder = new TextEncoder();

export class EventWriter {
  private closed = false;

  constructor(private fd: number) {}

  send(event: PanelEvent): boolean {
    if (this.closed) return false;
    try {
      const line = JSON.stringify(event) + "\n";
      Bun.write(Bun.file(this.fd), encoder.encode(line));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.closed = true;
  }
}
