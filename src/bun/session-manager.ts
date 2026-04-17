import type { SidebandContentMessage, PanelEvent } from "../shared/types";
import { PtyManager } from "./pty-manager";
import { SidebandParser } from "./sideband-parser";
import { EventWriter } from "./event-writer";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { statSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

const MAX_HISTORY_BYTES = 64 * 1024; // 64KB raw byte fallback per surface
const HEADLESS_SCROLLBACK = 2000; // bounded scrollback for the bun-side mirror

/** Pick a sensible shell binary, defaulting off the caller's input but
 *  degrading safely when the path doesn't exist. Logs once per unique
 *  bad path so the user sees why their setting was ignored. */
const _rejectedShells = new Set<string>();
function resolveShell(shell: string | undefined): string {
  const candidate = shell || process.env["SHELL"] || "/bin/zsh";
  try {
    if (isAbsolute(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  } catch {
    /* stat failed — fall through to warning + fallback */
  }
  // Not an absolute path or doesn't exist — first fall back to $SHELL, then
  // /bin/zsh. Log once per bad value so recurring startups don't spam.
  if (!_rejectedShells.has(candidate)) {
    _rejectedShells.add(candidate);
    console.warn(
      `[session] shellPath "${candidate}" is not an executable file; falling back to /bin/zsh`,
    );
  }
  const envShell = process.env["SHELL"];
  try {
    if (envShell && isAbsolute(envShell) && statSync(envShell).isFile()) {
      return envShell;
    }
  } catch {
    /* ignore */
  }
  return "/bin/zsh";
}

export interface Surface {
  id: string;
  pty: PtyManager;
  parser: SidebandParser | null;
  eventWriter: EventWriter | null;
  cwd: string;
  title: string;
  /** Raw byte history kept as a safety net if the headless terminal
   *  failed to construct (or for diagnostics). 64 KB cap, oldest dropped. */
  outputHistory: string[];
  outputHistorySize: number;
  /** Headless xterm that mirrors the PTY stream so we can replay a
   *  *terminal-state-correct* snapshot to web clients via SerializeAddon
   *  instead of dumping raw bytes that could start mid-escape. */
  headless: HeadlessTerminal | null;
  serializer: SerializeAddon | null;
}

export class SessionManager {
  private surfaces = new Map<string, Surface>();
  private counter = 0;
  private shell: string;

  // Callbacks — wired by index.ts to send to webview via RPC
  onStdout: ((surfaceId: string, data: string) => void) | null = null;
  onSidebandMeta:
    | ((surfaceId: string, msg: SidebandContentMessage) => void)
    | null = null;
  onSidebandData:
    | ((surfaceId: string, id: string, data: Uint8Array) => void)
    | null = null;
  onSidebandDataFailed:
    | ((surfaceId: string, id: string, reason: string) => void)
    | null = null;
  onSurfaceClosed: ((surfaceId: string) => void) | null = null;
  /** Fires when the PTY exits, before the surface is removed. */
  onSurfaceExit: ((surfaceId: string, exitCode: number) => void) | null = null;

  constructor(shell?: string) {
    this.shell = resolveShell(shell);
  }

  /** Update the shell used for new surfaces. Does not affect existing PTYs.
   *  When the supplied path is missing/unreadable, falls back to the same
   *  defaults the constructor uses so the user can't settings-panel
   *  themselves into a state where no new shells spawn. */
  setShell(shell: string): void {
    this.shell = resolveShell(shell);
  }

  createSurface(cols: number, rows: number, cwd?: string): string {
    const id = `surface:${++this.counter}`;
    const surfaceCwd = resolveSafeCwd(cwd);

    const pty = new PtyManager();

    // Output history buffer (filled after surface is created below)
    const outputHistory: string[] = [];
    let outputHistorySize = 0;

    // Headless mirror of the PTY stream. Used by getOutputHistory() so
    // web clients rejoining mid-stream get a terminal-state-correct
    // replay instead of raw bytes that could start mid-escape-sequence.
    let headless: HeadlessTerminal | null = null;
    let serializer: SerializeAddon | null = null;
    try {
      headless = new HeadlessTerminal({
        cols,
        rows,
        scrollback: HEADLESS_SCROLLBACK,
        allowProposedApi: true,
      });
      serializer = new SerializeAddon();
      headless.loadAddon(serializer);
    } catch (err) {
      console.warn(
        `[session] headless terminal init failed for ${id}:`,
        err instanceof Error ? err.message : err,
      );
      headless = null;
      serializer = null;
    }

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
      if (headless) {
        try {
          headless.write(data);
        } catch {
          /* headless terminal bugs must never crash the PTY pipeline */
        }
      }
      this.onStdout?.(id, data);
    };

    // Wire exit — surface closes when shell exits
    pty.onExit = (code: number) => {
      this.onSurfaceExit?.(id, code);
      this.closeSurface(id);
    };

    console.log(
      `[session] spawning ${id} with shell ${this.shell} at cwd ${surfaceCwd}`,
    );
    // Spawn the PTY. If the shell path is bad or posix_spawn fails, don't
    // let the exception blow up the whole session-create path — log, mark
    // the surface as failed, and let the close callback tear down any
    // half-registered state.
    try {
      pty.spawn({
        shell: this.shell,
        args: ["-l"],
        cols,
        rows,
        cwd: surfaceCwd,
        env: { HT_SURFACE: id },
      });
    } catch (err) {
      console.error(
        `[session] spawn failed for ${id} (shell=${this.shell}):`,
        err instanceof Error ? err.message : err,
      );
      // Fire the same exit callback the shell would on a clean quit —
      // downstream handlers remove the surface from the layout.
      queueMicrotask(() => {
        this.onSurfaceExit?.(id, 127); // 127 = "command not found" convention
        this.closeSurface(id);
      });
    }

    // Set up sideband channels
    const fds = pty.sidebandFds;
    let parser: SidebandParser | null = null;
    let eventWriter: EventWriter | null = null;

    // Create event writer first so parser errors can be sent to the child
    if (fds.eventFd !== null) {
      eventWriter = new EventWriter(fds.eventFd);
      eventWriter.onError = (source, error) => {
        console.error(`[sideband] ${id} ${source}: ${error.message}`);
      };
    }

    if (fds.metaFd !== null) {
      // Build data channel map from all "out" binary channels
      const dataChannels = new Map<string, number>();
      for (const ch of pty.channels) {
        if (ch.direction === "out" && ch.encoding === "binary") {
          dataChannels.set(ch.name, ch.fd);
        }
      }
      // Fallback: if no channels detected but legacy dataFd exists, use it
      if (dataChannels.size === 0 && fds.dataFd !== null) {
        dataChannels.set("data", fds.dataFd);
      }

      parser = new SidebandParser(fds.metaFd, dataChannels);

      parser.onMeta = (msg) => {
        this.onSidebandMeta?.(id, msg);
      };

      parser.onData = (contentId, data) => {
        this.onSidebandData?.(id, contentId, data);
      };

      parser.onError = (source, error) => {
        console.error(`[sideband] ${id} ${source}: ${error.message}`);
        // Send error feedback to the child process via fd5
        eventWriter?.send({
          id: "__system__",
          event: "error",
          code: source,
          message: error.message,
        });
      };

      parser.onDataFailed = (contentId, reason) => {
        console.error(
          `[sideband] ${id} data-failed for "${contentId}": ${reason}`,
        );
        this.onSidebandDataFailed?.(id, contentId, reason);
        // Also notify the child script via fd5
        eventWriter?.send({
          id: "__system__",
          event: "error",
          code: "data-timeout",
          message: reason,
          ref: contentId,
        });
      };

      parser.start();
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
      headless,
      serializer,
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
    try {
      surface.headless?.dispose();
    } catch {
      /* ignore */
    }
    this.surfaces.delete(surfaceId);

    console.log(`[session] closed ${surfaceId}`);
    this.onSurfaceClosed?.(surfaceId);
  }

  writeStdin(surfaceId: string, data: string): void {
    this.surfaces.get(surfaceId)?.pty.write(data);
  }

  renameSurface(surfaceId: string, title: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface || !title) return;
    surface.title = title;
  }

  resize(surfaceId: string, cols: number, rows: number): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;
    surface.pty.resize(cols, rows);
    try {
      surface.headless?.resize(cols, rows);
    } catch {
      /* ignore */
    }
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
    if (surface.serializer) {
      try {
        // Terminal-state-correct replay. Rewrites the alternate buffer,
        // SGR state, cursor position, scrollback — everything a fresh
        // client needs to land in the right screen, even mid-TUI.
        return surface.serializer.serialize();
      } catch (err) {
        console.warn(
          `[session] serialize() failed for ${surfaceId}:`,
          err instanceof Error ? err.message : err,
        );
        /* fall through to byte-buffer replay */
      }
    }
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
      try {
        surface.headless?.dispose();
      } catch {
        /* ignore */
      }
    }
    this.surfaces.clear();
  }
}

/** Accept a user-supplied cwd only if it's an absolute path that resolves
 *  to an existing directory. Otherwise fall back to $HOME (or `/` as a
 *  last resort). This prevents RPC callers from spawning shells at
 *  arbitrary or nonexistent paths via `workspace.create { cwd: "…" }`.
 *  realpath canonicalization also folds away `..` segments. */
export function resolveSafeCwd(cwd: string | undefined): string {
  const fallback = process.env["HOME"] || "/";
  if (!cwd || typeof cwd !== "string") return fallback;
  if (!isAbsolute(cwd)) {
    console.warn(`[session] ignoring non-absolute cwd "${cwd}"`);
    return fallback;
  }
  try {
    const resolved = realpathSync(cwd);
    const st = statSync(resolved);
    if (!st.isDirectory()) {
      console.warn(`[session] ignoring non-directory cwd "${cwd}"`);
      return fallback;
    }
    return resolved;
  } catch (err) {
    console.warn(
      `[session] ignoring unreadable cwd "${cwd}": ${err instanceof Error ? err.message : err}`,
    );
    return fallback;
  }
}
