---
title: Process Manager
description: Full-screen overlay (⌘⌥P) listing every process across every workspace with CPU, memory, and kill buttons.
sidebar:
  order: 3
---

`⌘⌥P` opens the **Process Manager** — a full-screen overlay that aggregates every process in every descendant tree of every shell, across every workspace.

## Layout

```
┌─ Process Manager ────────────────────────── 47 processes · 12.3% CPU · 1.2 G RSS ─┐
│                                                                                    │
│ ▼ Workspace: build                                                                 │
│   ▼ surface:1  ~/code/foo  port chips: :3000 :8080                                 │
│     PID    Command                          CPU%   RSS   [kill]                    │
│     12345 *bun run dev                      4.2%   180M  [kill]                    │ ← * = foreground
│     12346  esbuild                          0.8%    42M  [kill]                    │
│   ▶ surface:2  ~/code/bar                                                          │
│                                                                                    │
│ ▶ Workspace: docs                                                                  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## What each column shows

| Column | What |
|---|---|
| **PID** | Process id. Foreground row is highlighted with the accent color. |
| **Command** | Full argv — `bun run dev`, `python3 -m http.server 8765`, etc. |
| **CPU %** | Instantaneous from `ps %cpu`; cell color heats up to red via `color-mix`. |
| **Memory** | RSS, formatted as K / M / G. |
| **Action** | **kill** button — SIGTERM by default. **Shift+click for SIGKILL.** |

Above the workspace list: a summary (`N processes · X.X% CPU · Y.Y M RSS`).

## How it stays live

The panel refreshes in place on every metadata change — no polling from the webview. Every emit from the [SurfaceMetadataPoller](/features/live-process-metadata/) (1 Hz when focused, ~3 Hz when hidden) flows through the same diff pipeline that drives the pane chips. If nothing changed, no re-render.

## Where ports come from

Each surface row collapses to show its cwd and a row of port chips. The chips are extracted from the `lsof -iTCP -sTCP:LISTEN` snapshot the poller runs once per tick — same source as the pane header chips. Click a chip to open `http://localhost:<port>` in a browser pane.

## Source files

- `src/views/terminal/process-manager.ts` — the overlay panel.
- `src/bun/surface-metadata.ts` — the poller (used by the panel and CLI).
- `src/bun/rpc-handlers/surface.ts` — `surface.kill_pid`, `surface.kill_port`.

## Read more

- [Live process metadata](/features/live-process-metadata/) — the underlying pipeline.
- [`ht ps` / `ht ports` / `ht kill`](/cli/process-and-ports/)
- [Architecture](/concepts/architecture/)
