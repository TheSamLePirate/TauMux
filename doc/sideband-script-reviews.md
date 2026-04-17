# Sideband Script Reviews

Expert-review pass against `doc/system-sideband-protocol.md` + `doc/how-to-use-sideband.md`. Each entry: **what it teaches**, **strengths**, **issues** (with line numbers), **improvements**, and a **grade**.

Run the companion doc to learn what each script demonstrates: [`doc/how-to-use-sideband.md`](./how-to-use-sideband.md).

---

## Libraries

### [`scripts/hyperterm.py`](../scripts/hyperterm.py)

**Purpose.** Python client — panel creation, updates, event routing, channel discovery.

**✓ Strengths.**
- Graceful degradation: all methods no-op when `HYPERTERM_META_FD` is absent (`:72`, `:123–124`, `:167–168`).
- Correct channel discovery via `HYPERTERM_CHANNELS` with legacy fallback (`:41–70`).
- Correct `byteLength` computation on every `show_*` (`:194`, `:229`, `:264`).
- Full event dispatch: pointer, wheel, drag, resize, close, `__terminal__` resize, `__system__` errors (`:478–497`).
- Exposes `flush()` for stuck-channel recovery (`:143–147`).
- Close-callback cleanup avoids leaks (`:521–526`).

**⚠️ Issues.**
- No `timeout` option on `show_image` / `show_svg` / `show_html` / `show_canvas` (`:151–312`). Large payloads silently hit the 5s default.
- `show_svg` / `show_html` always go over fd4 even for tiny strings (`:233`, `:268`). Inline `data:` URIs would drop latency.
- `update()` ignores any per-panel `dataChannel` and always writes to "data" (`:334`).
- `_dispatch` includes `button: 0` for events that don't carry it (e.g. mousemove) (`:510`).

**💡 Improvements.**
- Add `timeout=` kwarg to `show_*`.
- Add `dataChannel=` kwarg to `update()` / `sendData()`.
- Use inline `data:` URIs for strings under ~1 KB.
- Build event payloads per-type so optional fields are omitted cleanly.

**Grade.** **B+**

---

### [`scripts/hyperterm.ts`](../scripts/hyperterm.ts)

**Purpose.** TypeScript / Bun client — same surface as Python, async-native with `waitForClose`.

**✓ Strengths.**
- Robust channel discovery + legacy fallback (`:257–266`, `:279–287`).
- All `show*` use `.byteLength` correctly on `Uint8Array` (`:382`, `:396`, `:414`).
- Lazy event-loop start via `ensureEventLoop` avoids premature EOF (`:473–477`).
- `PanelOptions` exposes `timeout` (`:52`) — addresses the Python gap.
- Clean Promise APIs: `waitForClose` (`:642–645`), `onClose` (`:636–639`).
- `__terminal__` pseudo-panel correctly routed (`:209–219`).
- Multi-channel support via `getChannelFd` (`:317–321`) and channel-named `sendData` (`:306–315`).

**⚠️ Issues.**
- `showSvg` / `showHtml` always hit fd4 — no inline `data:` optimisation (`:334–346`, `:349–362`).
- `showImage` infers format from extension only — no magic-byte fallback (`:368–379`).
- `update(id, {data})` loses the panel's original `format` and `dataChannel` (`:423–438`).
- Event loop exits silently on EOF; any pending `waitForClose()` never resolves or rejects (`:479–506`).

**💡 Improvements.**
- Cache per-panel `format` + `dataChannel` in a `Map`; honour them on update.
- Inline-`data:` optimisation for small SVG / HTML.
- Reject pending `waitForClose` Promises on event-stream EOF with a clear error.

**Grade.** **A−**

---

## Python demos

### [`scripts/demo_image.py`](../scripts/demo_image.py)

**Teaches.** Display an image, handle drag / resize / close.

**✓ Strengths.** `ht.available` guard (`:10`); KeyboardInterrupt → `ht.clear` (`:35`); missing-path handled (`:14–16`); uses `ht.events()` generator (`:24`).

**⚠️ Issues.** Sync `read()` with no size cap on large images (`:18`); no `on_error` handler; loop leaks panel if broken unexpectedly.

**💡 Improvements.** Pre-check file size; wire `ht.on_error`; consider `mmap` for large files.

**Grade.** **B**

---

### [`scripts/demo_interactive.py`](../scripts/demo_interactive.py)

**Teaches.** Interactive HTML panel with click counter + SIGINT cleanup.

**✓ Strengths.** `ht.available` guard (`:13`); SIGINT handler clears panel (`:48–51`); ID-filtered event loop (`:57`); stateful click count.

**⚠️ Issues.** SIGINT handler not reentrant-safe (`:45`, `:50`); no `on_error`; `run_event_loop()` would be cleaner than manual loop (`:56`); no exit condition when the panel closes.

**💡 Improvements.** Use `ht.on_close(id, cb)` instead of manual filter; add `ht.on_error`; flag to avoid double-cleanup.

**Grade.** **B+**

---

### [`scripts/demo_chart.py`](../scripts/demo_chart.py)

**Teaches.** Streaming SVG chart via `ht.update(id, data=svg)`.

**✓ Strengths.** Uses `update` instead of re-create (`:80`); `plt.close()` cleanup (`:52`); SIGINT-clears (`:56–60`); lazy-creates on first frame (`:76–77`).

**⚠️ Issues.** Fixed 2s sleep ignores render latency → frame backlog (`:82`); no `on_error`; `PANEL_ID` is module-level mutable state; no validation of `savefig` result (`:53`).

**💡 Improvements.** Frame-in-flight flag; `ht.on_error`; move `PANEL_ID` into `__main__`; validate encode.

**Grade.** **B**

---

### [`scripts/demo_dashboard.py`](../scripts/demo_dashboard.py)

**Teaches.** Multiple independent panels as a dashboard.

**✓ Strengths.** Tracks panel IDs in a list for bulk cleanup (`:22–26`, `:105–112`); `ht.available` guard (`:15`); clear visual layout.

**⚠️ Issues.** Hardcoded coords never react to `__terminal__` resize; fixed 1s sleep (`:118`); no `on_error`; `get_mem()` returns hardcoded `42` on macOS (`:63`).

**💡 Improvements.** Wire `ht.on_terminal_resize` to reposition; adaptive sleep / back-off; real macOS fallback via `vm_stat`.

**Grade.** **B**

---

### [`scripts/demo_canvas_mandelbrot.py`](../scripts/demo_canvas_mandelbrot.py)

**Teaches.** Interactive canvas2d with click-zoom and wheel-zoom; background event thread.

**✓ Strengths.** Low-level `send_meta` + `send_data` (`:130–149`); `interactive: true` for pointer events; correct SIGINT cleanup (`:205`); background event thread (`:196–197`).

**⚠️ Issues.** **Data race:** `cx`, `cy`, `zoom` mutated from event thread without locks (`:172–174`) and read by main render loop (`:193+`). Blocking `ht.events()` leaves the thread dangling if fd5 closes. No `on_error`. Minimal PNG encoder could fail on large canvases.

**💡 Improvements.** `threading.Lock` around shared state; `poll_events` in a timed loop; `ht.on_error` + `ht.on_terminal_resize`; try/except around PNG encode.

**Grade.** **B−**

---

### [`scripts/demo_canvas_heatmap.py`](../scripts/demo_canvas_heatmap.py)

**Teaches.** Streaming canvas with interactive pause/resume and wheel-adjusted FPS.

**✓ Strengths.** Click-to-pause (`:178`); wheel-adjusts FPS (`:182–186`); low-level binary streaming (`:203–216`, `:234–239`); SIGINT cleanup (`:248`).

**⚠️ Issues.** Same thread-safety issue as Mandelbrot (`running`, `paused`, `fps` unlocked at `:172`, `:178`, `:184`); blocking `ht.events()`; no `on_error`; no terminal-resize handling; macOS CPU path uses `random` (`:89`).

**💡 Improvements.** Locks around shared state; switch to `poll_events`; `ht.on_error` + `ht.on_terminal_resize`; deterministic CPU fallback.

**Grade.** **B−**

---

## TypeScript demos — interactive

### [`scripts/demo_draw.ts`](../scripts/demo_draw.ts)

**Teaches.** Paint-like drawing app: toolbar, palette, canvas, undo/redo.

**✓ Strengths.** 60fps rate limiter + deferred-render queue (`:241`, `:549–559`); hit testing (`:257–332`); HTML-escape on user text (`:374`); SIGINT cleanup (`:936`); event loop exits cleanly on EOF (`:884–913`); handles terminal resize (`:702–724`).

**⚠️ Issues.** `position: fullPane ? "float" : "float"` is a no-op ternary (`:570`); no `onError` handler.

**💡 Improvements.** Fix the ternary to `"overlay"` when fullPane; wire `ht.onError`; consider migrating from raw fds to the lib for readability.

**Grade.** **B+**

---

### [`scripts/demo_colorpick.ts`](../scripts/demo_colorpick.ts)

**Teaches.** HSL color picker: gradient square, hue bar, saved swatches.

**✓ Strengths.** Precise hit testing (`:268–331`); correct HSL↔RGB math (`:131–222`); 16ms render throttle (`:238–240`, `:493–507`); SIGINT clear (`:730`); clean drag state machine (`:235`, `:571–654`); `close` event handled (`:565–569`).

**⚠️ Issues.** No `onError`; no `onTerminalResize`; no persistence for saved swatches.

**💡 Improvements.** Wire `onError` + `onTerminalResize`; persist swatches to a file or env.

**Grade.** **A−**

---

### [`scripts/demo_qrcode.ts`](../scripts/demo_qrcode.ts)

**Teaches.** Full QR encoder (v1–10, EC-M) with interactive live encoding.

**✓ Strengths.** Complete QR pipeline: GF(256), Reed–Solomon, data placement, masking, penalty scoring. Three input modes (argv / stdin / interactive raw TTY) (`:1279–1336`); SVG escape (`:1008`); SIGINT restores terminal (`:1339–1348`).

**⚠️ Issues.** `close` event detected but doesn't call `ht.clear` immediately — relies on SIGINT (`:1152–1155`). Interactive mode re-renders on every keystroke with no throttle (`:1236`, `:1265`). No `onError`.

**💡 Improvements.** Call `ht.clear(id)` on close event; 50ms throttle on interactive re-render; wire `onError`.

**Grade.** **B+**

---

### [`scripts/demo_clock.ts`](../scripts/demo_clock.ts)

**Teaches.** Minimal fixed-position clock.

**✓ Strengths.** Tiny (~212 lines); `setInterval` cleanup (`:147–153`, `:205–207`); responds to terminal resize (`:180–187`); SIGINT/TERM handlers (`:210–211`).

**⚠️ Issues.** **Critical protocol bug (`:151`):** `update()` payload sets `data: renderClock()` but no `byteLength`. The parser waits for a binary on fd4 that never comes → panel never updates visually. Also no `onError` and no `close` handler.

**💡 Improvements.** Either set `byteLength: bytes.byteLength` and send the buffer on fd4, or convert to inline `data:` URI in the meta. Wire `close` → `cleanup()` and `onError`.

**Grade.** **D** — ship-stopping protocol bug on the update path.

---

### [`scripts/demo_3d.ts`](../scripts/demo_3d.ts)

**Teaches.** Real-time 3D renderer — 5 meshes, Phong lighting, painter's sort, keyboard + mouse + wheel input.

**✓ Strengths.** Full 3D pipeline in <1 KLoC; dirty-flag + `FRAME_INTERVAL` rate limit (`:940–952`); rich keyboard controls; mouse-drag + wheel-zoom (`:1018–1050`); clean fd5 reader (`:1058–1087`).

**⚠️ Issues.** No `onError`; `readStdin()` not awaited at `:1250` (works in practice via event loop serialisation, but implicit); ASCII-only keyboard decode (`:1136`).

**💡 Improvements.** Wire `onError`; document (or fix) the fire-and-forget `readStdin`; UTF-8-safe key decode (cosmetic).

**Grade.** **A**

---

## TypeScript demos — canvas-heavy

### [`scripts/demo_gallery.ts`](../scripts/demo_gallery.ts)

**Teaches.** Image carousel with grid/list modes, drag-resize, click/scroll nav.

**✓ Strengths.** `ht.available` guard (`:29`); SIGINT clears both panels (`:716`); updates dimensions on resize (`:555–561`); file-read fallback (`:356`); raw TTY mode toggle for keys (`:606–608`, `:671–675`).

**⚠️ Issues.** Uses raw fds instead of the lib (`:19–27`, `:45–67`) — fragile if channels are absent. No `timeout` override on image meta (`:332–352`) — default 5s bites on slow disks. stdin + event readers never explicitly cancelled (`:712`).

**💡 Improvements.** Migrate to the `HyperTerm` class; add `timeout: 15000` to image meta; cancel readers on exit.

**Grade.** **B**

---

### [`scripts/demo_webcam.ts`](../scripts/demo_webcam.ts)

**Teaches.** Live camera stream via ffmpeg with frame drop + FPS throttle.

**✓ Strengths.** Separate capture + send paths with `latestFrame` buffer (`:213–225`); drop counter (`:322–326`); min-frame-interval throttle (`:46`); ffmpeg cleanup on SIGINT (`:342`); stderr drained (`:194–207`); stats logging (`:271–278`).

**⚠️ Issues.** No `timeout` override on large JPEG frames (`:262`) — `data-timeout` risk. ffmpeg spawned before `ht.available` check (`:170` vs `:114–121`) — wastes resources when not in HyperTerm. Subprocess not killed on uncaught exceptions. MJPEG start-marker scan is O(n) per chunk (`:143–148`).

**💡 Improvements.** `timeout: 30000`; `available` check before spawn; try/finally wrapper around ffmpeg; circular buffer for MJPEG parsing.

**Grade.** **B+**

---

### [`scripts/demo_canvas_particles.ts`](../scripts/demo_canvas_particles.ts)

**Teaches.** CPU particles with click-to-spawn.

**✓ Strengths.** Uses the `HyperTerm` class (`:10`); `ht.available` guard (`:13`); handlers wired cleanly (`:144–157`); SIGINT clear (`:168–171`); `ht.update` for subsequent frames (`:162`); stats output (`:163–164`).

**⚠️ Issues.** No `timeout` override (`:162`) — large PNG frames at 24fps can spike past 5s. No HiDPI scaling (renders 400×300 regardless of retina). Click handler un-debounced (`:151`) — a rapid-fire user can blow past `MAX_PARTICLES=500`. No encode-time budget tracking.

**💡 Improvements.** `timeout: 20000`; read terminal DPI on resize; 1-frame debounce on clicks; log slow-encode warnings.

**Grade.** **B**

---

### [`scripts/demo_canvas_life.ts`](../scripts/demo_canvas_life.ts)

**Teaches.** Game of Life — grid render, click-to-toggle, per-gen PNG updates.

**✓ Strengths.** Uses the lib (`:10`); guard (`:13`); generation counter (`:127`); SIGINT clear (`:161–165`); grid lines to avoid aliasing (`:72–82`); `Uint8Array` cell storage (`:30`); bounds-checked click toggle (`:136–140`).

**⚠️ Issues.** No `timeout` override (`:153`) — same risk as particles. No HiDPI. No frame-in-flight guard; slow encodes queue up. Toroidal boundary (`:46`) is undocumented.

**💡 Improvements.** `timeout: 20000`; DPI-aware canvas; `rendering` flag to skip overlapping frames; one-line comment on the toroidal wrap.

**Grade.** **B**

---

### [`scripts/demo_mdpreview.ts`](../scripts/demo_mdpreview.ts)

**Teaches.** Live Markdown preview with file watcher + CSS theming.

**✓ Strengths.** `ht.available` check (`:24`); polling-debounced watcher (`:560–577`); parser handles headings / code / tables / lists / blockquotes (`:187–427`); user-friendly error display (`:540–550`); SIGINT cleanup (`:608–613`); `ht.update` on rerender (`:516–520`); inline-format helpers escape HTML (`:106–149`).

**⚠️ Issues.** Raw fd pattern instead of `HyperTerm` class (`:17–24`). No `timeout` override on large HTML payloads (`:504–520`). Watcher interval survives uncaught throws (`:609`). No `onTerminalResize` → fixed 600px panel overflows narrow terminals. External image links unchecked (`:121`).

**💡 Improvements.** Migrate to the lib; `timeout: 25000`; wrap watcher in try/finally; `onTerminalResize` rerender; size-cap remote images.

**Grade.** **B+**

---

## TypeScript demos — data / info

### [`scripts/demo_gitdiff.ts`](../scripts/demo_gitdiff.ts)

**Teaches.** Split-pane git diff with file list, hunk nav, polling refresh.

**✓ Strengths.** Thorough `escapeHtml` on user content (`:334–340`); subprocess error handling (`:598–604`); viewport sizing from `__terminal__` resize with fallbacks; clamped navigation; `MAX_RENDER_LINES` cap (`:61`, `:855`, `:983`); SIGINT cleanup (`:1831–1851`).

**⚠️ Issues.** `readFileSync` for untracked files has no size cap (`:790`); `buildSyntheticUntrackedDiff` can render megabytes (`:854–881`); no `onError` wired.

**💡 Improvements.** Cap untracked reads (e.g. 1 MB); chunk or stream large diffs; wire `onError`.

**Grade.** **A−**

---

### [`scripts/demo_gitgraph.ts`](../scripts/demo_gitgraph.ts)

**Teaches.** Commit rail graph with sort / inspect / 5s polling refresh.

**✓ Strengths.** `escapeHtml` on author / message / decorations (`:249–255`, `:612`, `:669–679`); git spawn try/catch (`:280–297`); `MAX_COMMITS=200` (`:56`); SIGINT clear (`:971–988`); `available` check (`:30`); linear rail-assignment memory.

**⚠️ Issues.** No `onError`; refresh loop has no in-flight guard (`:1203–1205`); rapid terminal resizes not debounced.

**💡 Improvements.** `refreshInFlight` flag; wire `onError`; debounce resize handler.

**Grade.** **A**

---

### [`scripts/demo_json.ts`](../scripts/demo_json.ts)

**Teaches.** Interactive JSON tree: expand/collapse, scroll, JSONPath, typed coloring.

**✓ Strengths.** Full `escapeHtml` coverage (`:318–324`, `:387`, `:470`, `:671`); parse-error UX (`:673–680`); pure in-memory (no subprocess); memoised flatten + expand state (`:249–294`); render throttle (`:310–312`); SIGINT cleanup (`:702–706`).

**⚠️ Issues.** No file-size cap when loading from disk (`:126–177`) — a 1 GB JSON OOMs; no recursion-depth guard during parse (`:674–686`) — stack overflow on pathological input; no `onError`.

**💡 Improvements.** Size-cap reads (e.g. 100 MB); depth limit during tree build; wire `onError`; lazy-expand huge subtrees.

**Grade.** **B+**

---

### [`scripts/demo_files.ts`](../scripts/demo_files.ts)

**Teaches.** Two-pane file browser with preview, search, keyboard nav.

**✓ Strengths.** Thorough escaping on all paths/content (`:551–557`, `:640`, `:655`); preview read capped at 4 KiB (`:676`, `:703`); fs error handling (`:440–507`, `:674–699`); symlink check + safe `readlinkSync` (`:468–478`, `:749–755`); close cleanup (`:1308–1319`).

**⚠️ Issues.** Symlink-loop protection is per-entry only — navigating into a `ln -s .. self` loop can recurse through history (`:619`). No `onError`. No `available` guard at startup.

**💡 Improvements.** Track visited inodes or cap nav depth; wire `onError`; early-exit on missing channels.

**Grade.** **A−**

---

### [`scripts/demo_procs.ts`](../scripts/demo_procs.ts)

**Teaches.** Process table with sortable columns, CPU/MEM bars, kill-on-click.

**✓ Strengths.** `escapeHtml` on process names (`:237–243`, `:338`, `:341`); piped stdout/stderr (`:149–152`); `process.kill` try/catch (`:512–519`); render throttle (`:140`); regex guard on ps parse (`:164–175`); SIGINT cleanup (`:662–672`).

**⚠️ Issues.** `ps -eo` spawn every 2s without timeout or output cap (`:149`, `:693`); no in-flight guard → overlap possible; no `onError`; no `available` guard.

**💡 Improvements.** Subprocess timeout (e.g. 5s); in-flight flag; cap output bytes; wire `onError`.

**Grade.** **B**

---

### [`scripts/demo_sysmon.ts`](../scripts/demo_sysmon.ts)

**Teaches.** System dashboard — CPU arc, RAM / disk bars, per-core, top procs, net, expandable UI.

**✓ Strengths.** `escapeXml` in SVG contexts (`:297–303`, `:486–487`, `:542–543`); graceful fallbacks on subprocess failures (`:174–193`, `:196–225`, `:227–262`); bucketed minimap rendering (`:1289–1327`); per-core CPU delta tracking (`:145–172`); SIGINT cleanup (`:753–758`).

**⚠️ Issues.** No timeout on `df` / `ps` / `netstat` (`:176`, `:198`, `:229`) — a stuck NFS mount blocks forever. `netstat -ib` is macOS-only (`:229`). Interface regex assumes `en*` (`:234`). No `onError`, no `available` guard.

**💡 Improvements.** 2–3s subprocess timeout; Linux fallback via `/proc/net/dev`; broader interface match; wire `onError`.

**Grade.** **B+**

---

## Summary

| Script | Grade | Primary risk |
| ------ | ----- | ------------ |
| `hyperterm.py` | B+ | Missing `timeout` / `dataChannel` params |
| `hyperterm.ts` | A− | Pending `waitForClose` never rejects on EOF |
| `demo_image.py` | B | Unbounded file read |
| `demo_interactive.py` | B+ | No `on_error` |
| `demo_chart.py` | B | Frame backlog — fixed 2s tick |
| `demo_dashboard.py` | B | Hardcoded coords, no resize reaction |
| `demo_canvas_mandelbrot.py` | B− | Thread-unsafe shared state |
| `demo_canvas_heatmap.py` | B− | Same thread-safety issue |
| `demo_draw.ts` | B+ | No-op ternary on `position` |
| `demo_colorpick.ts` | A− | No `onError` / resize |
| `demo_qrcode.ts` | B+ | Missing `clear` on close, no keystroke throttle |
| `demo_clock.ts` | **D** | **update() payload lacks `byteLength` — never updates** |
| `demo_3d.ts` | A | Minor: no `onError` |
| `demo_gallery.ts` | B | Raw fds, no `timeout`, readers uncancelled |
| `demo_webcam.ts` | B+ | No `timeout` on large JPEGs |
| `demo_canvas_particles.ts` | B | No `timeout`, no HiDPI |
| `demo_canvas_life.ts` | B | No `timeout`, no HiDPI |
| `demo_mdpreview.ts` | B+ | No `timeout` / resize handler |
| `demo_gitdiff.ts` | A− | Uncapped file reads for untracked |
| `demo_gitgraph.ts` | A | Refresh has no in-flight guard |
| `demo_json.ts` | B+ | No file-size / depth limits |
| `demo_files.ts` | A− | Symlink-loop depth unchecked |
| `demo_procs.ts` | B | `ps` spawn has no timeout / in-flight guard |
| `demo_sysmon.ts` | B+ | macOS-only `netstat`, no subprocess timeouts |

### Systemic patterns (fixable in one sweep)

1. **Nobody wires `ht.on_error` / `ht.onError`.** Every protocol failure (`data-timeout`, `meta-validate`, `data-queue-full`) is currently silent.
2. **`timeout` is almost never set.** The 5s default is fine for small SVGs but insufficient for large JPEG / PNG streams. Every canvas demo should set `timeout: 20000+`.
3. **HiDPI / retina scaling is uniformly ignored** on canvas demos.
4. **`onTerminalResize` is rarely wired**, so dashboards and wide panels clip off-screen on narrow terminals.
5. **Subprocess spawners (git / ps / lsof / df / netstat) have no timeouts**, so a stuck NFS mount or network interface query freezes the UI.

### One ship-stopping bug

**`scripts/demo_clock.ts:151`** — the update path sets `data:` without `byteLength`, so fd4 is never read and the clock face never advances. Worth fixing before anyone stumbles on it.
