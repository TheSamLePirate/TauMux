---
title: PTY model
description: "Why τ-mux uses Bun.spawn with `terminal: true` and how it differs from node-pty."
sidebar:
  order: 3
---

Every terminal surface in τ-mux is backed by a single PTY-attached child process spawned via Bun's native API:

```ts
Bun.spawn([shellPath, "-l"], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  terminal: true,         // PTY mode — required
  env: { ...process.env, HT_SURFACE: surfaceId, HYPERTERM_PROTOCOL_VERSION: "1", ... },
});
```

`terminal: true` allocates a pseudo-terminal pair, attaches the child's stdio to the slave end, and returns master read/write streams to the parent. This is the only PTY API used in the codebase — there is no `node-pty`.

## Why no node-pty?

- node-pty requires native compilation per Node version and per platform — hostile to Bun.
- Bun's PTY support is built into the runtime, no native rebuild needed.
- The API is simpler: `terminal: true` is a single boolean rather than a constructor with locale, cwd, env, cols/rows knobs.

## Resize

The webview's `xterm.js` instance reports its cols/rows to the main process whenever the pane is resized. The main process forwards a `winsize` ioctl to the PTY master. xterm sees the resize, the child process gets a `SIGWINCH`, TUIs redraw correctly.

## What Bun.spawn does NOT do for us

- **Sideband file descriptors.** Bun.spawn doesn't expose extra fds beyond stdio. τ-mux opens fd 3, 4, and 5 separately and passes them to the child via `Bun.spawn`'s `stdio` array. See [Sideband overview](/concepts/sideband-overview/).
- **Tracking children-of-children.** A shell can spawn arbitrary descendants. Tracking them is the job of the [SurfaceMetadataPoller](/features/live-process-metadata/), which runs `ps` against the shell's pid + `ppid` chain at 1 Hz.
- **Foreground process detection.** When the shell launches `bun run dev`, the foreground process is no longer the shell. The poller reads `/dev/tty<N>`'s foreground process group to find the actual fg process.

## Lifecycle

| Event | What happens |
|---|---|
| Surface created | `Bun.spawn` runs, master fd hooked to xterm, env populated with `HT_SURFACE`. |
| Shell exits cleanly | Surface stays open showing the exit message. Re-run with `ht send "<command>"` or close. |
| Surface closed | `SessionManager.onSurfaceClosed` fires; PTY master closes; metadata poller drains the cache on the next tick. |
| Workspace closed | All surfaces in the workspace close in sequence. |
| App quit | Every shell receives SIGHUP; `Bun.spawn` cleans up master fds. |

## Output buffering

Stdout from the PTY is forwarded to the webview at 16 ms granularity (one frame at 60 Hz) — coalescing reduces RPC chatter without delaying typing visibly. The web mirror uses the same coalescing layer, plus a 2 MB ring buffer per session so reconnecting clients can replay missed output.

## Source files

- `src/bun/session-manager.ts` — multi-surface owner, callbacks for onSurfaceClosed.
- `src/bun/pty-manager.ts` — single PTY: spawn, stdin/stdout streams, sideband fd opening.
- `src/shared/types.ts` — `SurfaceMetadata`, RPC contract.

## Read more

- [Workspaces & panes](/concepts/workspaces-and-panes/)
- [Live process metadata](/features/live-process-metadata/)
- [Sideband overview](/concepts/sideband-overview/)
