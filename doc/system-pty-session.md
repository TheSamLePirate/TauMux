# HyperTerm Canvas: PTY & Process Management Guide

At its core, a terminal emulator is a program that manages other programs. HyperTerm Canvas uses a highly optimized architecture to handle shell processes without relying on heavy external C++ bindings like `node-pty`. 

This document explains how HyperTerm manages processes, memory, and output buffering under the hood.

---

## 1. The PTY Architecture

Most Node.js-based terminal emulators (like VS Code's terminal or Hyper) use `node-pty`. HyperTerm Canvas, built on top of [Bun](https://bun.sh), takes a different approach by utilizing Bun's native `Bun.spawn` API with the `{ terminal: true }` option.

This provides several benefits:
- **Zero Dependencies:** No native module compilation required (no `node-gyp`).
- **Startup Speed:** Shells spawn in less than 50ms.
- **Native OS Integration:** Bun communicates directly with the Unix `openpty` APIs.

When you open a new tab or split a pane, HyperTerm creates a `PtyManager`. This manager is responsible for tracking the Process ID (PID), capturing standard output (stdout), and passing keyboard input (stdin) down to the shell.

---

## 2. Environment Variables & Context

When HyperTerm spawns a new shell (e.g., `zsh` or `bash`), it injects a specific set of environment variables. If you are writing CLI tools or scripts, you can rely on these variables to know you are running inside HyperTerm Canvas.

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

---

## 3. Output Buffering & History

HyperTerm Canvas needs to be able to display the terminal output in the GUI (`xterm.js`), but it also needs to let scripts read the screen contents programmatically (via `ht read-screen`).

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

When you close a pane (via the GUI 'X' button or `ht close-surface`), HyperTerm must clean up the underlying shell.

1. The `SessionManager` calls `pty.destroy()`.
2. Bun sends a `SIGKILL` (signal 9) to the underlying shell process.
3. The File Descriptors (0, 1, 2, 3, 4, 5) are forcibly closed.

### Limitations regarding deep process trees
Because HyperTerm uses `SIGKILL`, it guarantees the shell will die instantly. However, if your shell had spawned child processes (e.g., you ran `npm run dev` which spawned `node server.js`), sending SIGKILL to the shell might leave `node server.js` running as an orphaned process in the background.

If you are writing scripts intended to be killed by closing the pane, ensure your scripts properly handle `SIGHUP` or listen for the closure of standard input (`stdin`) to clean themselves up.

---

## 5. UTF-8 Streaming

Terminal output is a continuous stream of bytes. Sometimes, a multi-byte UTF-8 character (like an emoji: 🚀) gets split right down the middle across two network chunks.

HyperTerm's `PtyManager` uses `TextDecoder("utf-8", { stream: true })`. This guarantees that if half an emoji arrives in Chunk A, the decoder will buffer it and wait for Chunk B before emitting the character to the UI, preventing strange `` symbols from appearing in your terminal.