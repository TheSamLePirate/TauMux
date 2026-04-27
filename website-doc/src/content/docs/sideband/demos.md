---
title: Demos
description: Demo scripts that ship with the repo — copy them as starting points.
sidebar:
  order: 7
---

The repo's `scripts/` folder ships demo scripts that exercise the sideband protocol. Run any of them inside a τ-mux pane:

```bash
bun scripts/demo_draw.ts                     # mouse-driven SVG drawing
python3 scripts/demo_dashboard.py            # CPU + memory + clock panels
python3 scripts/demo_chart.py                # matplotlib SVG chart
python3 scripts/demo_interactive.py          # clickable HTML buttons
python3 scripts/demo_image.py photo.png      # image panel
bun scripts/demo_3d.ts                       # WebGL 3D demo
bun scripts/demo_canvas_life.ts              # Conway's Game of Life
bash scripts/test_sideband.sh                # protocol integration check
```

## What each demo shows

| Demo | Highlights |
|---|---|
| `demo_draw.ts` | `interactive` HTML panels, mouse events, `update` with new SVG content. |
| `demo_dashboard.py` | Multiple `float` panels updating at 1 Hz with `update`. |
| `demo_chart.py` | Matplotlib → SVG → `show_svg`. Demonstrates inline `data` instead of `byteLength`. |
| `demo_interactive.py` | Buttons in HTML panels; click events drive Python state. |
| `demo_image.py` | Single image panel from disk; demonstrates `show_image` with a path. |
| `demo_3d.ts` | Off-screen WebGL render → image bytes → `showCanvas2d`. |
| `demo_canvas_life.ts` | High-frequency `update` calls; demonstrates backpressure under load. |
| `test_sideband.sh` | Smoke test: launches a script, checks every panel type renders. |

## Reading order if you're new

1. `demo_image.py` — the simplest possible panel.
2. `demo_dashboard.py` — multiple panels, periodic updates.
3. `demo_interactive.py` — events flowing from terminal to script.
4. `demo_draw.ts` — full bidirectional flow.
5. `demo_3d.ts` — heavy binary payloads.

## Outside τ-mux

Every demo also runs in a regular terminal. The client libraries are no-ops, so you'll get textual output but no panels — useful for testing logic separately from rendering.

## Read more

- [Sideband overview](/sideband/overview/)
- [Python client](/sideband/python-client/)
- [TypeScript client](/sideband/typescript-client/)
- [Canvas panels feature](/features/canvas-panels/)
