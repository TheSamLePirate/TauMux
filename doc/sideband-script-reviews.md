# Sideband Script Reviews

Expert-review pass against `doc/system-sideband-protocol.md` + `doc/how-to-use-sideband.md`, followed by a bulk remediation to lift every script to grade A. Each entry records what it teaches, the remaining strengths, the specific fixes applied, and the current grade.

Run the companion doc to learn what each script demonstrates: [`doc/how-to-use-sideband.md`](./how-to-use-sideband.md).

**All 24 files were upgraded in a single bulk pass (commit `28edd9d`). See "Systemic fixes applied" at the bottom for the one-line summary of the common changes that landed across the suite.**

---

## Libraries

### [`scripts/hyperterm.py`](../scripts/hyperterm.py) — **A**

**Purpose.** Python client — panel creation, updates, event routing, channel discovery.

**Fixes applied.**
- Added `timeout=` kwarg to every `show_*`.
- Added `data_channel=` kwarg; `update()` now honours per-panel channel memory.
- Small SVG/HTML (<2 KB) auto-inline via `data:` in meta — skips the fd4 hop.
- `clear()` drops per-panel channel / format / listener entries so long-running scripts don't leak.

### [`scripts/hyperterm.ts`](../scripts/hyperterm.ts) — **A**

**Purpose.** TypeScript / Bun client — same surface as Python, async-native with `waitForClose`.

**Fixes applied.**
- Per-panel `dataChannel` + `format` memory on `showImage` / `showCanvas`; `update()` routes binary replacements to the original channel automatically.
- Small SVG/HTML auto-inline (parity with Python).
- `waitForClose()` now **rejects** on event-stream EOF via `dispatcher.rejectAllPending()` — scripts no longer hang indefinitely when the app exits mid-await.
- `clear()` frees per-panel memory.

---

## Python demos

### [`scripts/demo_image.py`](../scripts/demo_image.py) — **A**

**Teaches.** Display an image, handle drag / resize / close.

**Fixes applied.** `on_error` handler; 50 MB pre-read size cap via `os.path.getsize`; `timeout=20000` on `show_image`.

### [`scripts/demo_interactive.py`](../scripts/demo_interactive.py) — **A**

**Teaches.** Interactive HTML panel with click counter + SIGINT cleanup.

**Fixes applied.** Replaced manual event loop with typed `on_click` + `on_close` + `run_event_loop()`; `cleaned_up` reentrance guard in SIGINT handler; `on_error` logging.

### [`scripts/demo_chart.py`](../scripts/demo_chart.py) — **A**

**Teaches.** Streaming SVG chart via `ht.update(id, data=svg)`.

**Fixes applied.** `updating` flag skips overlapping frames; `savefig` result validated before send; `PANEL_ID` moved out of module scope; `on_error` logging.

### [`scripts/demo_dashboard.py`](../scripts/demo_dashboard.py) — **A**

**Teaches.** Multiple independent panels as a dashboard.

**Fixes applied.** `on_terminal_resize` repositions panels (vertical stack under 80 cols); macOS memory fallback now parses `vm_stat` output instead of returning hardcoded 42; `poll_events` called each tick so the resize handler fires; `on_error` logging.

### [`scripts/demo_canvas_mandelbrot.py`](../scripts/demo_canvas_mandelbrot.py) — **A**

**Teaches.** Interactive canvas2d with click-zoom and wheel-zoom; background event thread.

**Fixes applied.** `threading.Lock` around `cx`/`cy`/`zoom`; replaced blocking `ht.events()` with 50 ms `poll_events` loop + `shutdown_requested` flag; typed event handlers; PNG encode wrapped in try/except; `timeout=20000` on initial meta + every update; main thread joins worker on exit; `on_error` logging.

### [`scripts/demo_canvas_heatmap.py`](../scripts/demo_canvas_heatmap.py) — **A**

**Teaches.** Streaming canvas with interactive pause/resume and wheel-adjusted FPS.

**Fixes applied.** Same shape as Mandelbrot — `state_lock` around `running`/`paused`/`fps`; poll-based event thread with `shutdown_requested`; typed handlers; PNG encode guard; `timeout=20000`; `on_error` logging.

---

## TypeScript demos — interactive

### [`scripts/demo_draw.ts`](../scripts/demo_draw.ts) — **A**

**Teaches.** Paint-like drawing app: toolbar, palette, canvas, undo/redo.

**Fixes applied.** Fixed broken `fullPane ? "float" : "float"` ternary to `"overlay" : "float"`; `onError` branch in `handleEvent`.

### [`scripts/demo_colorpick.ts`](../scripts/demo_colorpick.ts) — **A**

**Teaches.** HSL color picker: gradient square, hue bar, saved swatches.

**Fixes applied.** `onError` branch; `onTerminalResize` keeps panel right-aligned by recomputing x on width change.

### [`scripts/demo_qrcode.ts`](../scripts/demo_qrcode.ts) — **A**

**Teaches.** Full QR encoder (v1–10, EC-M) with interactive live encoding.

**Fixes applied.** `close` event now immediately calls `ht.clear(id)` instead of deferring to SIGINT; 50 ms render throttle in interactive mode via `renderScheduled` flag + `setTimeout`; `onError` branch.

### [`scripts/demo_clock.ts`](../scripts/demo_clock.ts) — **A** (was D — ship-stopper fixed)

**Teaches.** Minimal fixed-position clock.

**Fixes applied.** **Migrated from broken raw-fd writes (update() was setting `data:` without `byteLength`, so the fd4 read never fired and the clock face stayed frozen) to the `τ-mux` class, which now auto-inlines sub-2 KB HTML.** Wired `onTerminalResize`, `onClose`, `onError` through the lib.

### [`scripts/demo_3d.ts`](../scripts/demo_3d.ts) — **A**

**Teaches.** Real-time 3D renderer — 5 meshes, Phong lighting, painter's sort, keyboard + mouse + wheel input.

**Fixes applied.** `onError` branch; `void`-ed fire-and-forget `readStdin` / `readEvents` with an intent comment.

---

## TypeScript demos — canvas-heavy

### [`scripts/demo_gallery.ts`](../scripts/demo_gallery.ts) — **A**

**Teaches.** Image carousel with grid/list modes, drag-resize, click/scroll nav.

**Fixes applied.** Full migration from broken raw-fd helpers (previous partial migration had left undefined symbols) to the `τ-mux` class; `timeout: 15000` on image show; `shuttingDown` flag cancels stdin + event readers on cleanup; `onError` handler.

### [`scripts/demo_webcam.ts`](../scripts/demo_webcam.ts) — **A**

**Teaches.** Live camera stream via ffmpeg with frame drop + FPS throttle.

**Fixes applied.** `timeout: 30000` on JPEG frame meta + updates; `killFfmpeg()` wired to `process.on("exit", …)` so ffmpeg dies on any exit path (SIGINT, natural exit, uncaught throw).

### [`scripts/demo_canvas_particles.ts`](../scripts/demo_canvas_particles.ts) — **A**

**Teaches.** A CPU-rendered tornado scene with procedural sky, funnel body, rotating debris, rain, lightning, and click-triggered gusts.

**Fixes applied.** 2× internal canvas with half-size meta for HiDPI crispness; funnel and debris physics scale by `SCALE`; `CLICK_DEBOUNCE_MS = 80` gates gust-on-click; `timeout: 20000` on every `ht.update`; `onError` handler.

### [`scripts/demo_canvas_life.ts`](../scripts/demo_canvas_life.ts) — **A**

**Teaches.** Game of Life — grid render, click-to-toggle, per-gen PNG updates.

**Fixes applied.** `timeout: 20000` on `ht.update`; `rendering` flag skips overlapping encodes (guards against backlog when encoding > frame interval); toroidal-wrap comment added; `onError` handler.

### [`scripts/demo_mdpreview.ts`](../scripts/demo_mdpreview.ts) — **A**

**Teaches.** Live Markdown preview with file watcher + CSS theming.

**Fixes applied.** Migrated from raw-fd writes to `τ-mux` class; `timeout: 25000` on HTML updates; `onTerminalResize` rerenders cached HTML; watcher wrapped in try/finally with `watchBusy` guard; `onError` handler.

---

## TypeScript demos — data / info

### [`scripts/demo_gitdiff.ts`](../scripts/demo_gitdiff.ts) — **A**

**Teaches.** Split-pane git diff with file list, hunk nav, polling refresh.

**Fixes applied.** `UNTRACKED_PREVIEW_MAX_BYTES = 1 MiB` cap on untracked-file preview with "…(file too large to preview)" marker; `onError` logging.

### [`scripts/demo_gitgraph.ts`](../scripts/demo_gitgraph.ts) — **A**

**Teaches.** Commit rail graph with sort / inspect / 5s polling refresh.

**Fixes applied.** `refreshInFlight` guard verified on polling loop; 100 ms `scheduleDebouncedResize` coalesces rapid `__terminal__` resize events; `onError` handler.

### [`scripts/demo_json.ts`](../scripts/demo_json.ts) — **A**

**Teaches.** Interactive JSON tree: expand/collapse, scroll, JSONPath, typed coloring.

**Fixes applied.** `MAX_JSON_FILE_BYTES = 100 MiB` stat-check at disk load; `MAX_TREE_DEPTH = 512` guard emits synthetic "max depth exceeded" placeholder to block stack-overflow on pathological input; `onError` handler.

### [`scripts/demo_files.ts`](../scripts/demo_files.ts) — **A**

**Teaches.** Two-pane file browser with preview, search, keyboard nav.

**Fixes applied.** `visitedInodes: Set<number>` blocks symlink-loop navigation (`ln -s . self` can't recurse); `onError` handler.

### [`scripts/demo_procs.ts`](../scripts/demo_procs.ts) — **A**

**Teaches.** Process table with sortable columns, CPU/MEM bars, kill-on-click.

**Fixes applied.** `ps` spawned with `timeout: 5000` + belt-and-suspenders `setTimeout` kill at 5.25 s; `fetchInFlight` flag gates the polling interval; `MAX_PROCESS_ROWS = 2000` row cap; `onError` handler.

### [`scripts/demo_sysmon.ts`](../scripts/demo_sysmon.ts) — **A**

**Teaches.** System dashboard — CPU arc, RAM / disk bars, per-core, top procs, net, expandable UI.

**Fixes applied.** `SUBPROCESS_TIMEOUT_MS = 3000` on `df`/`ps`/`netstat`; Linux `/proc/net/dev` fallback when `netstat` fails or is missing; broader interface regex (`en|wlan|eth|wl|docker|lo|enp|eno|ens|br-|veth`); `onError` handler.

---

## Systemic fixes applied across the suite

1. **`onError` handler wired everywhere** — every protocol failure (`data-timeout`, `meta-validate`, `data-queue-full`, …) now surfaces on stderr instead of being swallowed.
2. **`timeout:` override** on every script that streams meaningful binary — canvas frames, JPEG streams, large HTML — so a slow consumer doesn't silently drop panels.
3. **HiDPI / retina** handled on canvas-heavy demos (2× internal render with half-size meta).
4. **`onTerminalResize`** wired on any layout that cares about terminal width.
5. **Subprocess timeouts** on every `spawn` (`git`, `ps`, `lsof`, `df`, `netstat`) so a stuck NFS mount or missing binary can't freeze the UI.
6. **In-flight guards** on polling loops (gitgraph / gitdiff / procs / sysmon / mdpreview / canvas_life / chart) so overlap doesn't stack.
7. **File-size + recursion guards** (`demo_image`, `demo_json`, `demo_files`, `demo_gitdiff`) so pathological inputs can't OOM or stack-overflow.
8. **Ship-stopper resolved:** `demo_clock.ts` now uses the library's inline-`data:` path correctly and the clock face actually advances.

---

## Final grade table

| Script | Before | After |
| ------ | ------ | ----- |
| `hyperterm.py` | B+ | **A** |
| `hyperterm.ts` | A− | **A** |
| `demo_image.py` | B | **A** |
| `demo_interactive.py` | B+ | **A** |
| `demo_chart.py` | B | **A** |
| `demo_dashboard.py` | B | **A** |
| `demo_canvas_mandelbrot.py` | B− | **A** |
| `demo_canvas_heatmap.py` | B− | **A** |
| `demo_draw.ts` | B+ | **A** |
| `demo_colorpick.ts` | A− | **A** |
| `demo_qrcode.ts` | B+ | **A** |
| `demo_clock.ts` | **D** | **A** |
| `demo_3d.ts` | A | **A** |
| `demo_gallery.ts` | B | **A** |
| `demo_webcam.ts` | B+ | **A** |
| `demo_canvas_particles.ts` | B | **A** |
| `demo_canvas_life.ts` | B | **A** |
| `demo_mdpreview.ts` | B+ | **A** |
| `demo_gitdiff.ts` | A− | **A** |
| `demo_gitgraph.ts` | A | **A** |
| `demo_json.ts` | B+ | **A** |
| `demo_files.ts` | A− | **A** |
| `demo_procs.ts` | B | **A** |
| `demo_sysmon.ts` | B+ | **A** |

Typecheck clean. 672 unit tests green. All Python demos `py_compile` clean. Remediation landed in commit `28edd9d`.
