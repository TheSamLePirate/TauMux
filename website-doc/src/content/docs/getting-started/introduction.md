---
title: Introduction
description: What τ-mux is, what it isn't, and the design choices behind it.
sidebar:
  order: 1
---

τ-mux is a desktop terminal emulator that pairs a traditional PTY text layer with floating canvas overlays, a live observer of every descendant process, and a scriptable CLI — all built on [Electrobun](https://electrobun.dev) + [Bun](https://bun.sh).

It is **early-stage software** and prioritizes performance and correctness over feature breadth.

## What you get

- **A terminal that behaves like a real terminal.** xterm.js for rendering, `Bun.spawn` with `terminal: true` for PTYs. Colors, TUI apps, line editing, mouse reporting all just work.
- **Floating canvas overlays** alongside the text. Scripts can stream SVG, HTML, images, and `canvas2d` content through extra file descriptors and place them anywhere in the pane.
- **A live, cross-pane view of every process.** A 1 Hz `ps` + `lsof` poller surfaces cwd, listening TCP ports, CPU%, RSS, and full argv for every descendant of every shell. This single pipeline feeds the pane chips, the sidebar, the Process Manager, the web mirror, and the `ht` CLI.
- **A first-class CLI (`ht`).** Spawn panes, send keys, open ports in a browser, kill processes, drive a built-in browser — all from a shell.
- **A built-in browser.** Split a WebKit browser alongside terminals; fully scriptable for agent automation.
- **A web mirror.** The full UI streamed over WebSocket to anything on the LAN.

## What it isn't

- **Not a tmux replacement.** There is no shell-side multiplexing protocol. Workspaces and panes live in the GUI process; remote shells just stream their PTY through.
- **Not Electron.** Electrobun is a separate, much lighter desktop runtime built on system WebViews.
- **Not React.** The webview is vanilla TypeScript + DOM. xterm.js is the only significant dependency in the view layer.
- **Not sandboxed.** Sideband content (HTML, SVG) is rendered directly. Scripts running inside the terminal are trusted.

## Design choices that matter

1. **PTY is the source of truth.** Canvas panels and metadata chips are ephemeral overlays — they never affect terminal state. If the metadata pipeline crashes, the terminal keeps working.
2. **Keyboard always goes to the terminal.** Panels and chips are mouse-only. The exception is browser panes, which receive keyboard input when focused.
3. **Each content block is its own DOM element.** Not a single shared canvas — independent panels with CSS transforms, draggable and resizable.
4. **Metadata never touches the PTY.** The poller reads pids the app already owns and runs `ps` / `lsof` at 1 Hz. No shell integration, no scraped output.

## Where to go next

- [Installation](/getting-started/installation/) — build from source or install the bundled binary.
- [Quick start](/getting-started/quick-start/) — first session, first split, first sideband panel.
- [Architecture](/concepts/architecture/) — the diagram, end to end.
