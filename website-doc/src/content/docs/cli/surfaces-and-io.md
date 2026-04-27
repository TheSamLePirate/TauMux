---
title: Surfaces & I/O
description: split, focus, close, send, send-key, read-screen, screenshot.
sidebar:
  order: 4
---

Surface lifecycle and I/O — splitting panes, focusing them, sending keystrokes, reading the visible buffer.

## list-surfaces

```bash
ht list-surfaces
# surface:1  ws:0  ~/code/foo  bun run dev
# surface:2  ws:0  ~/code/bar  zsh
# surface:3  ws:1  ~/code/docs astro dev
```

## new-split

```bash
ht new-split right                 # left | right | up | down
ht new-split right --cwd ~/code/foo
ht new-split down --shell /bin/zsh
```

Creates a new terminal surface as a split of the focused (or `--surface`-targeted) pane. Optional flags:

- `--cwd <path>` — initial working directory.
- `--shell <path>` — override the shell binary for this surface only.
- `--ratio 0.6` — split ratio.

## close-surface

```bash
ht close-surface
ht close-surface --surface surface:3
```

Closes the targeted surface (defaults to focused). Shell receives SIGHUP.

## focus-surface

```bash
ht focus-surface --surface surface:3
```

## send

```bash
ht send "echo hello\n"
ht send --surface surface:3 "ls\n"
```

Sends raw text to the surface's PTY. Use `\n` to inject Enter, `\t` for Tab, etc. (Standard escape rules apply.)

## send-key

```bash
ht send-key enter
ht send-key tab
ht send-key arrow-up
ht send-key ctrl+c
```

Symbolic keys for things that are awkward to escape. Supports modifiers (`shift+`, `ctrl+`, `alt+`, `cmd+`) and named keys (`enter`, `tab`, `escape`, `arrow-up/down/left/right`, `home`, `end`, `page-up/down`, `f1` … `f12`).

## read-screen

```bash
ht read-screen --lines 20
ht read-screen --scrollback true     # include scrollback buffer
ht read-screen --json
```

Reads the current visible terminal buffer. Useful for agents tailing log output or for screenshots-as-text. With `--scrollback true`, includes everything in scrollback (up to `scrollbackLines` setting).

## screenshot

```bash
ht screenshot --out ~/Desktop/τ.png
ht screenshot --surface surface:3 --out /tmp/pane.png
```

PNG screenshot of the surface's render area. Useful for design QA, automated visual regression, or pasting into bug reports. Captures the rendered xterm.js canvas plus any overlay panels.

## tmux compat

```bash
ht capture-pane --lines 50    # alias for read-screen
```

## Read more

- [JSON-RPC surface methods](/api/surface/)
- [Live process metadata](/features/live-process-metadata/)
