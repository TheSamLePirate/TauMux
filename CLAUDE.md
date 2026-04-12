# CLAUDE.md

## Task Completion Requirements

- All of `bun test` and `bun run typecheck` must pass before considering tasks completed.
- Run `bun start` to verify the app launches and the terminal works after UI changes.

## Project Snapshot

HyperTerm Canvas is a hybrid terminal emulator where a traditional PTY text layer (xterm.js) coexists with multiple floating canvas overlays. Scripts running inside the terminal can output structured content (images, charts, interactive widgets) via extra file descriptors (fd 3, 4, 5). Each piece of content becomes its own canvas layer — draggable, resizable — while keyboard and mouse input flows into xterm.js as usual.

This is an early-stage project. Performance and correctness are prioritized over feature breadth.

## Core Priorities

1. Performance first — <50ms startup, minimal memory overhead.
2. Correctness first — the terminal MUST behave like a real terminal (colors, TUI apps, line editing).
3. Keep behavior predictable — PTY is the source of truth, canvas panels are ephemeral overlays.

If a tradeoff is required, choose correctness and simplicity over feature completeness.

## Architecture

```
Bun Main Process (src/bun/)
  ├── Spawns shell via Bun.spawn with terminal option (real PTY)
  ├── Extensible sideband channels: default fd3/fd4/fd5, configurable via HYPERTERM_CHANNELS
  ├── Multi-channel SidebandParser reads metadata + binary from named data channels
  └── Communicates with webview via Electrobun RPC

Electrobun Webview (src/views/terminal/)
  ├── xterm.js renders PTY output
  ├── Canvas panels float above xterm.js (content renderer registry for extensible types)
  └── Keyboard always goes to xterm.js → stdin
```

## Key Constraints

- **No node-pty.** Use `Bun.spawn` with `terminal` option exclusively.
- **No React.** Vanilla TypeScript + DOM APIs in the webview. xterm.js is the only significant view dependency.
- **Keyboard never goes to panels.** All keystrokes go to xterm.js → stdin. Panels are visual output + mouse interaction only.
- **Each content block = its own DOM element.** Not a single shared canvas. Independent panels with CSS transforms.
- **No sandboxing of fd4 content** for now. HTML/SVG from fd4 is rendered directly. Scripts are trusted.
- **Electrobun RPC is the bridge.** All bun ↔ webview communication goes through Electrobun's typed RPC.

## Directory Roles

- `src/bun/` — Main process code. PTY management, sideband parsing, fd management. Runs in Bun.
- `src/views/terminal/` — Webview code. xterm.js, panel rendering, styles. Runs in system WebView.
- `src/shared/` — Types shared between bun and webview. RPC contracts, protocol definitions.
- `tests/` — Bun test files. Unit and integration tests for main process code.
- `scripts/` — Demo scripts and client libraries (Python, TS) for the sideband protocol.

## Coding Style

- TypeScript everywhere, ES modules.
- Minimal dependencies. No frameworks in the webview.
- Interface-heavy design, minimal class inheritance.
- Error handling: try-catch with graceful degradation. Log errors, don't throw from callbacks.
- Use `Bun.file(fd).stream()` for reading fds, `Bun.write(fd, data)` for writing.
