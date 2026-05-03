---
title: shareBin
description: A folder of bundled executables (show_md, show_img, show_chart, …) auto-prepended to $PATH in every shell. They render full-pane sideband panels.
sidebar:
  order: 8
---

`shareBin/` is a folder of small executables that ship with τ-mux. Its absolute path is **prepended to `$PATH` in every shell τ-mux spawns**, so the bundled scripts (`show_md`, `show_img`, `show_chart`, …) are reachable as bare commands from any pane — no install step, no shell-rc edits, no `bun run` wrapper.

Each script uses the [sideband protocol](/sideband/overview/) (fd 3/4/5) to render a full-pane HTML/SVG panel pinned to the host pane. When the user closes the panel — or sends SIGINT / SIGTERM — the script exits.

## Bundled commands

| Command | What it does |
|---|---|
| `show_md <file.md>` | Live markdown previewer. Re-renders on mtime change unless `--no-watch`. |
| `show_img <path>` | Centered image panel. Preserves aspect ratio; 50 MB cap. |
| `show_html <file>` | Wrap arbitrary HTML in standard panel chrome. |
| `show_table <csv\|tsv>` | Sortable HTML table. Click headers to sort asc / desc / restore. |
| `show_chart <csv>` | Line / bar / scatter plot. Re-rendered on every pane resize. |
| `show_json <file>` | Collapsible JSON tree. `--depth N` controls default-expanded depth. |
| `show_yaml <file>` | YAML → tree (subset parser; pipe through `yq -o json` for complex docs). |
| `show_diff <patch>` | Side-by-side unified diff with hunk + add / delete counts. |
| `show_gitdiff` | `git diff` of the current repo, side-by-side. |
| `show_gitlog [path]` | Branch-graph commit log. `--max N` and `--branches`. |
| `show_qr <text>` | QR code SVG. `--ec`, `--scale`, `--margin`, `--dark`/`--light`. |
| `show_sysmon` | Full-pane system monitor — CPU arc, per-core bars, RAM, top procs, sparkline. |
| `show_webcam` | MJPEG webcam stream via ffmpeg + AVFoundation (macOS) / V4L2 (Linux). |
| `demo_status_keys` | Exercise every renderer in the smart status-key DSL via `ht set-status`. |

Most accept `<path>` or stdin (`-` is implicit when nothing is on argv), so they compose with shell pipes:

```bash
ps aux | show_table --tsv
git diff | show_diff
curl -s api.example.com/data.json | show_json --depth 3
echo "https://example.com" | show_qr --ec H
```

## How it works

- `src/bun/pty-manager.ts` resolves the absolute path to `shareBin/` (whether running from a dev checkout or from inside the packaged `.app`) and prepends it to `PATH` on every `Bun.spawn`. The folder is also listed under `build.copy` in `electrobun.config.ts` so it ships in the bundle.
- Every script is a `#!/usr/bin/env bun` (or `python3`) executable with no extension — `show_md`, not `show_md.ts`. The shebang lets the kernel run them directly via `PATH` lookup.
- Scripts import from `shareBin/lib/` (rendering helpers — `full-screen`, `chart`, `csv`, `markdown`, `json-tree`, `qr`, `git-log`, `diff-render`, `table`, `yaml`) and from the bundled clients `hyperterm.ts` / `hyperterm.py`. Those clients no-op when not running inside τ-mux, so the same script also runs sanely from a plain terminal.
- Output is rendered through `lib/full-screen.ts`, which produces a Catppuccin-styled HTML page and pins it to the host pane. The page re-renders on pane resize, exits cleanly on close, and never affects the underlying PTY.

## Adding your own command

Drop an executable in `shareBin/`, mark it `+x`, and it becomes a first-class command in every τ-mux shell. The full agent-oriented authoring guide — boilerplate, rendering helpers, panel positioning, event handling — lives in [`doc/system-sharebin.md`](https://github.com/TheSamLePirate/TauMux/blob/main/doc/system-sharebin.md). Short version:

```typescript
#!/usr/bin/env bun
// shareBin/show_widget
import { fullScreenHtml, fullScreenPage, CATPPUCCIN } from "./lib/full-screen";

fullScreenHtml({
  render: () => fullScreenPage({
    tag: { label: "WIDGET", color: CATPPUCCIN.blue },
    title: "hello",
    body: `<p style="padding:24px">…</p>`,
  }),
});
```

```bash
chmod +x shareBin/show_widget
# rebuild / restart τ-mux — `show_widget` is now on $PATH in every pane
```

## Source files

- `shareBin/` — the scripts themselves and their `lib/` helpers.
- `shareBin/hyperterm.ts` / `shareBin/hyperterm.py` — sideband client libraries.
- `src/bun/pty-manager.ts` — `PATH` prepend at shell-spawn time.
- `electrobun.config.ts` — `build.copy.shareBin` ships the folder in the packaged app.
- `doc/system-sharebin.md` — authoring guide for new commands.

## Read more

- [Sideband overview](/sideband/overview/)
- [TypeScript client](/sideband/typescript-client/)
- [Python client](/sideband/python-client/)
- [Demo scripts](/sideband/demos/)
