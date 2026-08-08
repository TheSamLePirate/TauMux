import type { SidebandContentMessage, PanelEvent } from "../shared/types";
import { PtyManager } from "./pty-manager";
import { SidebandParser } from "./sideband-parser";
import { EventWriter } from "./event-writer";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { statSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { framePaste } from "../shared/bracketed-paste";
import {
  DecPrivateModeTracker,
  MODE_BRACKETED_PASTE,
} from "./dec-mode-tracker";
import { CommandBlockTracker } from "./command-blocks";

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
   *  instead of dumping raw bytes that could start mid-escape.
   *
   *  Null unless the web mirror is running — see
   *  `setHeadlessMirrorEnabled`. Nothing outside the replay path may
   *  depend on it. */
  headless: HeadlessTerminal | null;
  serializer: SerializeAddon | null;
  /** DEC private modes the input path cares about, scanned off the PTY
   *  stream. Always present; independent of the headless mirror. */
  modes: DecPrivateModeTracker;
  /** OSC 133 command blocks. Empty unless the shell has the optional
   *  integration installed — the metadata poller remains the
   *  zero-config baseline. */
  blocks: CommandBlockTracker;
}

/** Construct a headless mirror + serializer, or `{null, null}` if xterm
 *  refused. A failed mirror costs a state-correct web replay, nothing
 *  else — never let it fail surface creation. */
function buildHeadlessMirror(
  id: string,
  cols: number,
  rows: number,
): { headless: HeadlessTerminal | null; serializer: SerializeAddon | null } {
  try {
    const headless = new HeadlessTerminal({
      cols,
      rows,
      scrollback: HEADLESS_SCROLLBACK,
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    headless.loadAddon(serializer);
    return { headless, serializer };
  } catch (err) {
    console.warn(
      `[session] headless terminal init failed for ${id}:`,
      err instanceof Error ? err.message : err,
    );
    return { headless: null, serializer: null };
  }
}

export class SessionManager {
  private surfaces = new Map<string, Surface>();
  private counter = 0;
  private shell: string;
  /** Whether to keep a headless xterm per surface. Driven by the web
   *  mirror's lifecycle — see `setHeadlessMirrorEnabled`. */
  private headlessEnabled = false;
  /** Extra args passed to the shell alongside the hardcoded `-l`. Tests use
   *  this to append `-f` (zsh) or `--norc` (bash) so slow rc files don't
   *  fight a settle timeout. */
  private extraShellArgs: string[] = [];

  // Callbacks — wired by index.ts to send to webview via RPC
  onStdout: ((surfaceId: string, data: string) => void) | null = null;
  onSidebandMeta:
    ((surfaceId: string, msg: SidebandContentMessage) => void) | null = null;
  onSidebandData:
    ((surfaceId: string, id: string, data: Uint8Array) => void) | null = null;
  onSidebandDataFailed:
    ((surfaceId: string, id: string, reason: string) => void) | null = null;
  onSurfaceClosed: ((surfaceId: string) => void) | null = null;
  /** Fires when the PTY exits, before the surface is removed. */
  onSurfaceExit: ((surfaceId: string, exitCode: number) => void) | null = null;

  constructor(shell?: string, extraShellArgs: string[] = []) {
    this.shell = resolveShell(shell);
    this.extraShellArgs = [...extraShellArgs];
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
    // Built only while the web mirror is running: a full terminal
    // emulator per surface — parse, cells, reflow, scrollback — is a lot
    // to run in the main process for a feature that is off by default.
    const built = this.headlessEnabled
      ? buildHeadlessMirror(id, cols, rows)
      : { headless: null, serializer: null };
    const headless: HeadlessTerminal | null = built.headless;
    const serializer: SerializeAddon | null = built.serializer;

    // DEC private modes the *input* path needs. Deliberately not read
    // off the mirror above — see dec-mode-tracker.ts.
    const modes = new DecPrivateModeTracker([MODE_BRACKETED_PASTE]);
    const blocks = new CommandBlockTracker();

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
      modes.write(data);
      try {
        blocks.write(data);
      } catch (err) {
        // A parser bug must never take the PTY down with it — the whole
        // point of this being an optional layer.
        console.error("[session] block tracker threw:", err);
      }
      // Re-read: `setHeadlessMirrorEnabled` swaps the surface's mirror
      // at runtime, and this closure captured the value at spawn time.
      const mirror = this.surfaces.get(id)?.headless ?? headless;
      if (mirror) {
        try {
          mirror.write(data);
        } catch {
          /* headless terminal bugs must never crash the PTY pipeline */
        }
      }
      // W3-PTY-GUARD — defense-in-depth: a throwing stdout sink (the native
      // coalescer's inline ≥8 KB soft-cap branch can hit the Electrobun
      // bridge synchronously) must never unwind into the PTY read loop and
      // kill the terminal. Mirrors the headless guard above + the CLAUDE.md
      // "never crash the PTY pipeline" rule.
      try {
        this.onStdout?.(id, data);
      } catch (err) {
        console.error("[session] onStdout sink threw:", err);
      }
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
        args: ["-l", ...this.extraShellArgs],
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
      modes,
      blocks,
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

  /**
   * Whether the application currently running in `surfaceId` has asked
   * for bracketed paste (`DECSET 2004`).
   *
   * Answered from `DecPrivateModeTracker`, which scans the PTY stream
   * for exactly this — not from the headless mirror, which is an
   * optional subsystem that must never become load-bearing for input
   * handling (see dec-mode-tracker.ts). An unknown surface answers
   * `false`, which degrades to unframed writes rather than framing a
   * paste no application asked for.
   */
  isBracketedPasteMode(surfaceId: string): boolean {
    return (
      this.surfaces.get(surfaceId)?.modes.isSet(MODE_BRACKETED_PASTE) ?? false
    );
  }

  /**
   * Write clipboard text as a *paste* rather than as typing.
   *
   * The distinction is the whole point: a paste is framed with
   * `ESC[200~`/`ESC[201~` when the app asked for it, so a multi-line
   * block lands in the app's editor as one unit instead of being
   * submitted line by line. Size policy lives with the caller — this
   * method frames and writes whatever it is handed.
   */
  /**
   * Turn the per-surface headless mirrors on or off.
   *
   * The mirror exists for one reason: a web-mirror client that joins
   * mid-stream needs a *terminal-state-correct* replay, not raw bytes
   * that might start halfway through an escape sequence. When the web
   * mirror is not running, nobody can ask for that replay, and running a
   * full terminal emulator per surface — parse, cell allocation, reflow,
   * 2000 lines of scrollback — in the same process as the metadata
   * poller and the socket server is pure overhead. Agent CLIs are
   * chatty producers; this is the wrong place to pay double.
   *
   * Turning it on backfills from the raw history buffer we always keep,
   * so a client connecting to a long-running pane still gets a coherent
   * screen rather than an empty one. The buffer is capped at 64 KB, so
   * the replay is the recent past rather than all of history — the same
   * bound the old always-on mirror had, since its scrollback was capped
   * too.
   *
   * Gated on the *server running* rather than on client count: the
   * server is opt-in, and a client that drops and resumes must still
   * find its session intact.
   */
  setHeadlessMirrorEnabled(enabled: boolean): void {
    if (this.headlessEnabled === enabled) return;
    this.headlessEnabled = enabled;

    for (const surface of this.surfaces.values()) {
      if (enabled) {
        if (surface.headless) continue;
        const built = buildHeadlessMirror(
          surface.id,
          surface.pty.cols,
          surface.pty.rows,
        );
        surface.headless = built.headless;
        surface.serializer = built.serializer;
        if (built.headless) {
          try {
            built.headless.write(surface.outputHistory.join(""));
          } catch {
            /* a failed backfill costs replay fidelity, nothing more */
          }
        }
      } else {
        try {
          surface.headless?.dispose();
        } catch {
          /* already gone */
        }
        surface.headless = null;
        surface.serializer = null;
      }
    }
  }

  writePaste(surfaceId: string, text: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;
    surface.pty.write(framePaste(text, this.isBracketedPasteMode(surfaceId)));
  }

  renameSurface(surfaceId: string, title: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface || !title) return;
    surface.title = title;
  }

  /**
   * Push new terminal dimensions down to the PTY, the headless mirror and
   * any sideband listener — but only when they actually changed.
   *
   * The dedupe is not a micro-optimisation. `applyLayout()` calls
   * `onResize` for every pane on every full layout pass (workspace
   * switch, sidebar toggle, settings apply, font change, divider
   * mouse-up), and `fitSurfaceTerminal` deliberately no-ops when the
   * grid is unchanged — so the overwhelming majority of these carry
   * dimensions identical to the ones already in force. Forwarding them
   * anyway means `TIOCSWINSZ`, which means **SIGWINCH to the foreground
   * process group**, which for a full-screen TUI (Claude Code, vim,
   * htop) means a complete repaint. Switching workspaces used to make
   * every agent pane in the destination redraw itself for no reason.
   *
   * Guarding here rather than in `PtyManager` keeps the sideband
   * `resize` event and the headless mirror on the same "real change"
   * definition as the PTY, so a script listening on fd 5 sees exactly
   * the transitions the child saw.
   */
  resize(surfaceId: string, cols: number, rows: number): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;
    if (surface.pty.cols === cols && surface.pty.rows === rows) return;
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
