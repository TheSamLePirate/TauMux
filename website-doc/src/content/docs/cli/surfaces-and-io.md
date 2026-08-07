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

## rename-surface

```bash
ht rename-surface "build watcher"
ht rename-surface --surface surface:3 "api server"
```

Sets the pane's display title. Without `--surface` it renames the pane you are
in (`HT_SURFACE`), falling back to the focused pane. A renamed pane ignores
OSC 0/2 title escapes from then on, so the name you set sticks.

## list-panes

```bash
ht list-panes
```

The pane tree of the active workspace (split directions and ratios), as
opposed to `list-surfaces` which is a flat list.

## list-panels

```bash
ht list-panels
ht list-panels --surface surface:2
```

[Canvas panels](/features/canvas-panels/) currently open in a surface.

## list-browsers

```bash
ht list-browsers
```

Every [browser pane](/features/browser-panes/) with its id and current URL.

## editor

```bash
ht edit src/index.ts                    # open in an editor split
ht editor open src/index.ts [--split]
ht editor split src/index.ts [--direction right|down] [--create]
ht editor list
ht editor save|reload|close [editor:N]
```

CodeMirror [editor panes](/features/file-explorer-and-editor/). `--create`
makes a missing file, `--cwd` resolves a relative path.

## agent

```bash
ht agent create                  # pi agent pane in a new workspace
ht agent create-split [right|down]
ht agent list
ht agent count
ht agent close --agent <id>
```

The [pi coding-agent pane](/integrations/pi/). For Claude Code panes see
[`ht claude pane`](/cli/claude/).

## run-script

```bash
ht run-script --command "bun run dev" --cwd ~/code/app
```

Runs a command the way the sidebar's script buttons do — in a real pane you can
watch. `--workspace` targets a workspace, `--script-key` sets the key used to
track running state on the workspace card.

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

## wait-ready

```bash
ht wait-ready                                      # wait on the focused surface
ht wait-ready --surface surface:7                  # explicit target
ht wait-ready --surface surface:7 --timeout-ms 5000
```

Block until the targeted surface's metadata is observable (the 1 Hz poller has produced its first snapshot), then print the snapshot. Returns `null` on timeout. Default timeout is 2000 ms; capped at 30 000 ms.

Use it to synchronize automation that races the post-spawn metadata poll — e.g. spawning a pane and immediately calling `ht open`. Naive scripts don't need this anymore: `ht open` and `ht kill` now wait up to 2 s internally before erroring out. Reach for `wait-ready` only when you want to pin the exact moment yourself.

## send

```bash
ht send "echo hello\n"
ht send --surface surface:3 "ls\n"
```

Sends raw text to the surface's PTY. The string is unescaped before being written, so the following sequences are interpreted:

| Escape | Sent as | Use for |
|---|---|---|
| `\n` | `\r` (CR) | Submit a command — terminals expect carriage return, not line feed. |
| `\r` | `\r` (CR) | Same as `\n`; explicit form for scripts that already produce CR. |
| `\t` | `\t` (HT) | Tab — autocomplete, field navigation. |
| `\x1b` | `\x1b` (ESC) | Escape — leave insert mode in vim, dismiss menus. |
| `\\` | `\` | Literal backslash. |

Anything else passes through verbatim. Quote the argument with double quotes (or your shell's preferred form) so the backslashes survive shell parsing intact.

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
ht screenshot                                   # the focused pane
ht screenshot --surface surface:3               # a specific pane
ht screenshot workspace                         # all panes of the active workspace
ht screenshot workspace ws:2                    # all panes of a specific workspace
ht screenshot window                            # the whole app window
ht screenshot workspace --output ~/Desktop/ws.png
```

Captures a PNG, then crops to one of three targets:

- **(default)** the focused pane — or `--surface <id>` / `$HT_SURFACE`.
- **`workspace`** — the bounding box of every visible pane in a workspace (excludes titlebar + sidebar). Targets the active workspace, or a specific one via a trailing id / `--workspace <id>`. Only the active workspace's panes are visible to the capture; a background workspace falls back to the whole-window grab.
- **`window`** (or `--full-window`) — the whole app window, uncropped (titlebar + sidebar). Useful for bug reports.

Output path is optional (`--output` / `-o`); omitted, a timestamped PNG lands in the system tmpdir. The resulting path is printed. macOS only (uses `screencapture`). Captures the rendered xterm.js canvas plus any overlay panels.

## tmux compat

```bash
ht capture-pane --lines 50    # alias for read-screen
```

## Read more

- [JSON-RPC surface methods](/api/surface/)
- [Live process metadata](/features/live-process-metadata/)
