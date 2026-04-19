# τ-mux: PTY & Process Management Guide

At its core, a terminal emulator is a program that manages other programs. τ-mux uses a highly optimized architecture to handle shell processes without relying on heavy external C++ bindings like `node-pty`. 

This document explains how τ-mux manages processes, memory, and output buffering under the hood.

---

## 1. The PTY Architecture

Most Node.js-based terminal emulators (like VS Code's terminal or Hyper) use `node-pty`. τ-mux, built on top of [Bun](https://bun.sh), takes a different approach by utilizing Bun's native `Bun.spawn` API with the `{ terminal: true }` option.

This provides several benefits:
- **Zero Dependencies:** No native module compilation required (no `node-gyp`).
- **Startup Speed:** Shells spawn in less than 50ms.
- **Native OS Integration:** Bun communicates directly with the Unix `openpty` APIs.

When you open a new terminal tab or split a terminal pane, τ-mux creates a `PtyManager`. This manager is responsible for tracking the Process ID (PID), capturing standard output (stdout), and passing keyboard input (stdin) down to the shell.

> **Note:** Browser panes (`⌘⇧L`) do not use PTYs. They are managed by `BrowserSurfaceManager` and render via `<electrobun-webview>` OOPIF elements. See [`system-browser-pane.md`](system-browser-pane.md) for the browser pane architecture.

---

## 2. Environment Variables & Context

When τ-mux spawns a new shell (e.g., `zsh` or `bash`), it injects a specific set of environment variables. If you are writing CLI tools or scripts, you can rely on these variables to know you are running inside τ-mux.

| Variable | Description |
|---|---|
| `TERM=xterm-256color` | Tells CLI applications (like vim or htop) to use rich colors. |
| `COLORTERM=truecolor` | Indicates the terminal supports 24-bit RGB colors. |
| `HT_WORKSPACE_ID` | The ID of the current workspace (e.g., `ws:1`). |
| `HT_SURFACE_ID` | The ID of the specific pane/surface you are in (e.g., `surface:4`). |
| `HT_SOCKET_PATH` | The path to the Unix socket for the RPC API (default: `/tmp/hyperterm.sock`). |
| `HYPERTERM_META_FD` | The File Descriptor number mapped to the Sideband Meta channel (usually `3`). |
| `HYPERTERM_DATA_FD` | The File Descriptor number mapped to the Sideband Binary channel (usually `4`). |
| `HYPERTERM_EVENT_FD`| The File Descriptor number mapped to the Sideband Event channel (usually `5`). |
| `HYPERTERM_CHANNELS` | JSON-encoded channel map describing all available sideband channels (names, fds, directions, encodings). |
| `HYPERTERM_PROTOCOL_VERSION` | Sideband protocol version (currently `"1"`). |
| `HYPERTERM_DEBUG` | Set to `"1"` to enable debug logging in client libraries. |

---

## 3. Output Buffering & History

τ-mux needs to be able to display the terminal output in the GUI (`xterm.js`), but it also needs to let scripts read the screen contents programmatically (via `ht read-screen`).

To achieve this, the `SessionManager` maintains a rolling **Output Buffer** for every active surface.

### How it works:
- As the shell outputs text (stdout), it is intercepted by the `PtyManager`.
- The text is immediately dispatched via Electrobun RPC to the Webview to be rendered by `xterm.js`.
- Simultaneously, the text is appended to an internal array in the Bun process.

### The 64KB Limit
To prevent memory leaks when running noisy commands (like compiling a large C++ project), the output buffer is strictly capped at **64 Kilobytes (`MAX_HISTORY_BYTES`) per surface**.

If a surface outputs more than 64KB of text, the oldest chunks are dropped. 

**What this means for you:**
When you run `ht read-screen --scrollback`, you are reading from this 64KB buffer. If the terminal has been running for days and printing thousands of lines, you will only be able to capture the most recent portion of the history via the CLI.

*(Note: The visual GUI powered by `xterm.js` maintains its own scrollback buffer, which is configured to hold up to 10,000 lines).*

---

## 4. Process Termination & Signals

When you close a pane (via the GUI 'X' button or `ht close-surface`), τ-mux must clean up the underlying shell.

1. The `SessionManager` calls `pty.destroy()`.
2. Bun sends a `SIGKILL` (signal 9) to the underlying shell process.
3. The File Descriptors (0, 1, 2, 3, 4, 5) are forcibly closed.

### Limitations regarding deep process trees
Because τ-mux uses `SIGKILL`, it guarantees the shell will die instantly. However, if your shell had spawned child processes (e.g., you ran `npm run dev` which spawned `node server.js`), sending SIGKILL to the shell might leave `node server.js` running as an orphaned process in the background.

If you are writing scripts intended to be killed by closing the pane, ensure your scripts properly handle `SIGHUP` or listen for the closure of standard input (`stdin`) to clean themselves up.

---

## 5. Shell selection and settings integration

By default τ-mux spawns whatever `$SHELL` points to (falling back to `/bin/zsh`). Two layers override this:

1. **`settings.json`** — the `shellPath` key in `AppSettings`. When set, `SessionManager` is constructed with that value (`new SessionManager(shellPath)`). Changing the value in **Settings → General → Shell** calls `sessions.setShell(newValue)`; the new shell takes effect for *new* surfaces — existing PTYs are never re-parented.
2. **`-l` flag** — every spawn launches the shell with `-l` so dotfiles (`.zprofile`, `.zshrc`) load. This is important for PATH inheritance in GUI launches.

`SessionManager.createSurface` also sets these per-shell environment variables on top of `process.env`:

- `HT_SURFACE=<id>` — the ID of the new surface (used by `ht` for default `--surface` resolution).
- `TERM=xterm-256color`, `COLORTERM=truecolor` — tell TUI apps about color support.
- `HYPERTERM_*` channel map — described in the sideband doc.

Changing **Settings → Advanced → Scrollback lines** updates the webview xterm.js options in place (no respawn).

---

## 6. Live process metadata

Independently of the PTY layer, a `SurfaceMetadataPoller` (`src/bun/surface-metadata.ts`) observes every descendant of every shell and publishes snapshots at 1 Hz. This gives you:

- `pid` / `foregroundPid` / `tty`
- full descendant tree with argv, CPU%, RSS
- cwd of the foreground process
- listening TCP ports for the whole tree

See [system-process-metadata.md](system-process-metadata.md) for the full pipeline, parsers, and consumers (pane chips, sidebar, Process Manager, web mirror, `ht` CLI).

Importantly, the metadata pipeline never touches the PTY — it only reads pids and runs `ps` / `lsof` against them. PTY correctness is unaffected.

---

## 7. Web mirror auto-start

`Settings → Network → Auto-start Web Mirror` is read at bun startup. If true (and no `HYPERTERM_WEB_PORT` env override is set to force-start), the mirror starts automatically on `webMirrorPort` (default 3000). Changing the port setting at runtime hot-swaps a running mirror onto the new port without restarting the app.

---

## 8. UTF-8 Streaming

Terminal output is a continuous stream of bytes. Sometimes, a multi-byte UTF-8 character (like an emoji: 🚀) gets split right down the middle across two network chunks.

τ-mux's `PtyManager` uses `TextDecoder("utf-8", { stream: true })`. This guarantees that if half an emoji arrives in Chunk A, the decoder will buffer it and wait for Chunk B before emitting the character to the UI, preventing strange `` symbols from appearing in your terminal.