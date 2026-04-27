---
title: Quick start
description: Your first τ-mux session — splits, the sidebar, the CLI, and a sideband panel.
sidebar:
  order: 3
---

Five minutes to a usable session.

## 1. Launch and explore

```bash
bun start                     # from the repo
# …or open the .app from /Applications
```

A single workspace opens with one pane. The sidebar on the left shows the workspace list and live status. The pane header shows the foreground command and any listening ports as chips.

| Shortcut | Action |
|----------|--------|
| `⌘D` | Split right |
| `⌘⇧D` | Split down |
| `⌘W` | Close focused pane |
| `⌘⌥←↑→↓` | Focus neighboring pane |
| `⌘⇧P` | Command palette |
| `⌘⌥P` | Process Manager |
| `⌘B` | Toggle sidebar |
| `⌘,` | Settings |

Full reference: [Keyboard shortcuts](/configuration/keyboard-shortcuts/).

## 2. Run something interesting

In any pane:

```bash
cd ~/code/some-project
bun run dev                   # or npm run dev / cargo run / python -m http.server …
```

Within a second:

- The pane header chip shows `bun run dev`.
- A port chip appears as soon as the server starts listening — click it to open in a browser.
- The sidebar's package.json card shows the script as **green pulse = running**.
- `⌘⌥P` opens the Process Manager — every pid in the descendant tree, with CPU/MEM and a kill button.

## 3. Drive it from a second shell

In another terminal (or another τ-mux pane):

```bash
ht tree                       # workspaces / panes / surfaces
ht ports                      # PORT PROTO ADDR PID COMMAND
ht open                       # opens the unique listening port
ht kill 3000                  # SIGTERM the pid bound to :3000
```

The CLI talks to τ-mux through `/tmp/hyperterm.sock`. See [CLI overview](/cli/overview/).

## 4. Try a sideband panel

Sideband channels let scripts inside the terminal stream structured content (images, charts, interactive HTML) into floating overlays. Demo scripts ship with the repo:

```bash
python3 scripts/demo_dashboard.py     # CPU + memory + clock panels
bun scripts/demo_draw.ts              # mouse-driven SVG drawing
python3 scripts/demo_chart.py         # matplotlib SVG chart
```

The protocol is documented in [Sideband overview](/sideband/overview/). Client libraries are no-ops outside τ-mux, so the same script runs unmodified in a regular terminal.

## 5. Open the web mirror

The mirror streams the full UI over WebSocket. Enable it in **Settings → Network → Auto-start Web Mirror**, then visit `http://<your-ip>:3000` from any device on the LAN. Set an auth token in the same panel if the network isn't fully trusted.

More: [Web mirror overview](/web-mirror/overview/).

## What's next

- [Architecture](/concepts/architecture/) — how the pieces fit together.
- [`ht` CLI reference](/cli/overview/) — every command grouped by domain.
- [Sideband protocol](/sideband/overview/) — render structured content from scripts.
- [Settings](/configuration/settings/) — every knob, with what each one actually does.
