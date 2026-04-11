import type { SidebandMetaMessage, PanelEvent } from "../shared/types";
import { PtyManager } from "./pty-manager";
import { SidebandParser } from "./sideband-parser";
import { EventWriter } from "./event-writer";

const MAX_HISTORY_BYTES = 64 * 1024; // 64KB of recent output per surface

export interface Surface {
  id: string;
  pty: PtyManager;
  parser: SidebandParser | null;
  eventWriter: EventWriter | null;
  cwd: string;
  title: string;
  outputHistory: string[];
  outputHistorySize: number;
}

export class SessionManager {
  private surfaces = new Map<string, Surface>();
  private counter = 0;
  private shell: string;

  // Callbacks — wired by index.ts to send to webview via RPC
  onStdout: ((surfaceId: string, data: string) => void) | null = null;
  onSidebandMeta:
    | ((surfaceId: string, msg: SidebandMetaMessage) => void)
    | null = null;
  onSidebandData:
    | ((surfaceId: string, id: string, data: Uint8Array) => void)
    | null = null;
  onSurfaceClosed: ((surfaceId: string) => void) | null = null;

  constructor(shell?: string) {
    this.shell = shell || process.env["SHELL"] || "/bin/zsh";
  }

  createSurface(cols: number, rows: number, cwd?: string): string {
    const id = `surface:${++this.counter}`;
    const surfaceCwd = cwd || process.env["HOME"] || "/";

    const pty = new PtyManager();

    // Output history buffer (filled after surface is created below)
    const outputHistory: string[] = [];
    let outputHistorySize = 0;

    // Wire stdout
    pty.onStdout = (data: string) => {
      outputHistory.push(data);
      outputHistorySize += data.length;
      while (
        outputHistorySize > MAX_HISTORY_BYTES &&
        outputHistory.length > 1
      ) {
        outputHistorySize -= outputHistory.shift()!.length;
      }
      this.onStdout?.(id, data);
    };

    // Wire exit — surface closes when shell exits
    pty.onExit = (_code: number) => {
      this.closeSurface(id);
    };

    console.log(`[session] spawning ${id} with shell ${this.shell} at cwd ${surfaceCwd}`);
    // Spawn the PTY
    pty.spawn({
      shell: this.shell,
      cols,
      rows,
      cwd: surfaceCwd,
      env: { HT_SURFACE: id },
    });

    // Set up sideband channels
    const fds = pty.sidebandFds;
    let parser: SidebandParser | null = null;
    let eventWriter: EventWriter | null = null;

    if (fds.metaFd !== null && fds.dataFd !== null) {
      parser = new SidebandParser(fds.metaFd, fds.dataFd);

      parser.onMeta = (msg) => {
        this.onSidebandMeta?.(id, msg);
      };

      parser.onData = (contentId, data) => {
        this.onSidebandData?.(id, contentId, data);
      };

      parser.start();
    }

    if (fds.eventFd !== null) {
      eventWriter = new EventWriter(fds.eventFd);
    }

    const surface: Surface = {
      id,
      pty,
      parser,
      eventWriter,
      cwd: surfaceCwd,
      title: this.shell.split("/").pop() || "shell",
      outputHistory,
      outputHistorySize,
    };

    this.surfaces.set(id, surface);
    console.log(`[session] created ${id} — pid: ${pty.pid}, ${cols}x${rows}`);

    return id;
  }

  closeSurface(surfaceId: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;

    surface.parser?.stop();
    surface.eventWriter?.close();
    surface.pty.destroy();
    this.surfaces.delete(surfaceId);

    console.log(`[session] closed ${surfaceId}`);
    this.onSurfaceClosed?.(surfaceId);
  }

  writeStdin(surfaceId: string, data: string): void {
    this.surfaces.get(surfaceId)?.pty.write(data);
  }

  resize(surfaceId: string, cols: number, rows: number): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;
    surface.pty.resize(cols, rows);
    surface.eventWriter?.send({
      id: "__terminal__",
      event: "resize",
      cols,
      rows,
    });
  }

  sendEvent(surfaceId: string, event: PanelEvent): void {
    this.surfaces.get(surfaceId)?.eventWriter?.send(event);
  }

  getOutputHistory(surfaceId: string): string {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return "";
    return surface.outputHistory.join("");
  }

  getSurface(surfaceId: string): Surface | undefined {
    return this.surfaces.get(surfaceId);
  }

  getAllSurfaces(): Surface[] {
    return [...this.surfaces.values()];
  }

  get surfaceCount(): number {
    return this.surfaces.size;
  }

  destroy(): void {
    for (const surface of this.surfaces.values()) {
      surface.parser?.stop();
      surface.eventWriter?.close();
      surface.pty.destroy();
    }
    this.surfaces.clear();
  }
}
