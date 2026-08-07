# τ-mux — Improvement Analysis (2026-08-08)

**Version audited:** 0.10.8 · **Branch:** main · **Baseline:** 3421 tests pass / 0 fail,
`tsc --noEmit` clean, all five audit scripts clean (module-size, theming, emoji,
animations, test-hooks).

**Method:** five parallel deep-dive agents (architecture, performance, security,
competitive/standards research, UX & reported-bug root-causing), each instructed to
exclude anything already tracked in `triple_a_analysis.md`, `feature_grades.md`,
`deferred_items.md`, `refactor-roadmap.md`, `issues_now.md`,
`full_app_review_2026-08.md`, `desktop-perf-plan.md`. Every finding below was then
re-verified by hand against the source. Findings that did not survive verification
were dropped; two agent claims were corrected and are footnoted as such.

---

## Verdict

The internal quality machine is genuinely excellent and needs no help: 49 graded
features, a coverage gate, a module-size ratchet, a theming audit at zero literals, a
focus-leak audit, typed RPC dispatch gated by `satisfies`. That flywheel works.

The gaps are **not** where the existing programme is looking. They fall in five areas
the AAA plan does not cover:

1. **One boot-order bug can brick the whole app** — and it is the user-reported
   Telegram crash.
2. **The LAN mirror ships with authentication disabled by default.**
3. **The PTY path lags the integration.** τ-mux has by far the deepest Claude Code
   integration of any terminal (~3,240 lines: dedicated pane, session registry, plan
   mirror, auto-approve, status presenter, `ht-bridge` hooks). But the *terminal* layer
   underneath it is missing the Kitty keyboard protocol and OSC 133 — so `claude` run as
   a CLI in a PTY pane is a worse experience than the same CLI in Ghostty, even though
   τ-mux's own Claude pane is better than anything else on the market.
4. **The webview cannot report its own failures.** Zero `try` blocks in 2,915 lines of
   SurfaceManager, no global error handler, nothing tee'd to the log. The bun side has a
   fault budget and health rows; the layer holding 100 % of the UI has neither — which is
   why "the sidebar froze" is unreproducible.
5. **Four months of work is uninstallable.** Code is v0.10.8; the newest GitHub
   release is v0.2.30 (2026-04-27).

A meta-observation worth more than any single item: the quality machine measures what it
can already see. The module-size ratchet exempts `.css`, so the biggest file in the repo
(13,457 lines) grew unchecked while every tracked `.ts` file stayed frozen. The audits are
clean because they audit the things that were already clean.

Everything below is ranked by leverage, not by category.

---

## 1. Ship-stoppers — fix this week

### 1.1 A corrupt `telegram.db` bricks the entire app (CRITICAL)

**This is the reported bug** *"when telegram crash, notification dont work and ht dont
work anymore"* (`issues_now.md:49`). Root cause found and reproduced.

`src/bun/index.ts:370` constructs `new TelegramDatabase(join(configDir, "telegram.db"))`
**unguarded, at module top level**. That constructor (`telegram-db.ts:52-82`) runs
`new Database()`, three PRAGMAs and full DDL — every one of which throws on a corrupt or
truncated WAL file, a mismatched `-wal`/`-shm` pair, or `SQLITE_FULL`.

The damning detail: the *very next statement*, `:374`, **is** wrapped in try/catch. The
author knew these operations throw and missed the constructor.

Ordering makes it fatal:

| Line | Statement |
|---|---|
| **370** | `new TelegramDatabase(...)` ← throws |
| 2408 | `mkdirSync(configDir)` |
| 2697 | `await socketServer.start()` |

Module evaluation aborts at 370, so **2,327 lines never run**: no socket (`ht` dies), no
notifications, no window. The `uncaughtException` handler at `:207` swallows it and the
process **exits 0**. The fault-budget breaker at `:229-255` needs 10 faults in 60 s and
cannot help — a single boot-time fault is strictly more fatal than ten runtime ones.

The Telegram DB is uniquely exposed because it is a WAL SQLite file written continuously
by the long-poll loop: any force-quit, OOM kill, or full disk mid-checkpoint corrupts it.

**Fix (S):** wrap in try/catch; on failure rename to `telegram.db.corrupt-<ts>`, retry
once, fall back to a null DB and `health.set("telegram","error",…)`. Structurally, wrap
the whole bootstrap in a `main()` with an explicit catch so a top-level throw can never
be mistaken for a clean start. Add a regression test that boots with a garbage
`telegram.db` and asserts the socket binds.

**Related (S):** `mkdirSync(configDir)` at `:2408` runs *after* `:370`, and
`SettingsManager` only creates the dir inside `writeToDisk()`. A genuinely fresh install
hits the same dead-boot path. Hoist the `mkdirSync` to immediately after `configDir` is
computed.

### 1.2 Web mirror is unauthenticated by default (HIGH)

`src/shared/settings.ts:774-775` ships `webMirrorBind: "0.0.0.0"` with
`webMirrorAuthToken: ""`, and `src/bun/web/server.ts:235` reads:

```ts
if (!this.authToken) return true;   // empty token authorises everyone
```

The only thing between a default install and unauthenticated arbitrary command execution
on the LAN is `autoStartWebMirror: false` — a **one-click toggle that never prompts for a
token**. The mirror's `stdin` path (`server.ts:1196`) is a real PTY write. On café,
hotel, or coworking Wi-Fi this is remote shell as you. The only mitigation is a
`console.warn` at `:525-527` that no user reads.

Everything *else* about that server is well built — constant-time compare (`:1407`),
Origin/CSRF check on WS upgrade (`:274`), per-IP throttle sourced from `requestIP` (not
spoofable `X-Forwarded-For`), security headers, and an explicit allow-listed wire
protocol rather than an RPC proxy. **The token is the entire boundary and its default is
"no token."**

**Fix (S):** refuse to start on `0.0.0.0` with an empty or <16-char token — auto-generate
`randomBytes(24).toString("base64url")` and surface it, or fall back to `127.0.0.1`. Flip
the default bind to `127.0.0.1`.

### 1.3 Auto-approve: a stale timer can approve a prompt it never evaluated (HIGH)

`src/bun/claude-auto-approve.ts:128-143`. `fire()` captures `sessionId` but **not the
`seq` it was scheduled for**. It re-checks `canAutoApprove(fresh)` but never
`fresh.approvalSeq === seq`. Back-to-back prompts in one turn each schedule a timer — the
`approvalSeq` bump at `claude-session-registry.ts:189` is designed to allow exactly that.
Prompt A's timer fires against prompt B's live state and approves B; B's own timer then
sends a **second** Enter into whatever is now on screen. If prompt C has been raised, that
stray CR approves it with **no gate applied at all** — no burst accounting, no
`awaitingUserChoice` check.

Compounding: the file's own comments concede Claude Code exposes no prompt-resolved hook,
so a user who answers manually at t=200 ms still leaves the registry reading
`waiting-approval` at t=700 ms. The "re-check against LIVE state" guard cannot see the
resolution it was written to catch.

**Fix (S):** `if (fresh.approvalSeq !== seq) return;` inside `fire()`, and move `burst()`
accounting to send time. One line each, plus a test for two prompts inside one delay
window.

### 1.4 Auto-approve inspects volume, never content (HIGH)

`s.approvalMessage` is carried through the registry (`:195`) and used **only to build the
audit-log string** (`claude-auto-approve.ts:197`). There is no deny-list, no allow-list,
no dry-run, and no distinction between "read a file" and "run `rm -rf`". The 8/min rate
limit bounds *volume*, not *blast radius* — one prompt is enough.

τ-mux already owns the screen (`surface.read` / the serialize addon) but deliberately does
not consult it, so nothing verifies the pane is even showing a permission prompt before
the CR lands.

**Fix (M):** deny-list regex over `approvalMessage` (`\brm\s+-rf`, `sudo`, `--force`,
`>\s*/dev/`, `curl|wget .*\|\s*(ba)?sh`, credential paths) that hard-refuses and notifies.
**(M–L):** verify the pane's last screen line matches the expected prompt before sending.

---

## 2. Your own bug list — all root-caused

Every open item in `issues_now.md` now has a file:line diagnosis.

### 2.1 "Sideband view goes transparent when not focused"

Two independent causes.

**A — a stuck `terminal-typing` class (primary).** `index.css:2870`:

```css
body.terminal-typing .panel { opacity: 0.3 !important; ... }
```

Added on any keypress into xterm (`index.ts:1968`). Removed **only** by `mousemove`
(`:2733`) and `mousedown` (`:2742`), plus a few overlay paths. There *are* `blur` and
`visibilitychange` handlers at `:2841` and `:2847` — but they call
`hideSurfaceContextMenu()` and `reportVisibility()`, **not** `clearTypingFocusMode()`.
So: type a command, Cmd-Tab away without moving the mouse, and every panel sits at 30 %
opacity indefinitely. Exactly the reported symptom.

**Fix (S):** add `clearTypingFocusMode()` to the existing `blur` handler at `:2847` and
the `visibilitychange` handler at `:2841`; add a ~1.2 s idle timeout on keydown. If
"always visible" is the real requirement, delete the `opacity` line and keep only the
`filter` de-emphasis. Note `.panel::before { opacity: 0.64 }` (`:2788`) makes panels
see-through *at rest* too — raise it if the goal is genuine opacity.

**B — the bloom canvas paints over panels.** Inside `.surface-terminal`:
`.surface-terminal-layer` (z 2) → `.surface-panels` (z 10, `:2595`) →
`canvas.terminal-effects-layer` (**z 32**, `:2563`, `mix-blend-mode: screen`). The
occluder rasteriser treats only *text cells* as occluders
(`terminal-effects.ts:625-741`) — panels are invisible to it — so bloom halos
screen-blend across panel bodies. Only reproduces with bloom on.
**Fix (S):** `.terminal-effects-layer { z-index: 5 }`, or append the canvas to
`termLayerEl` rather than `termEl`.

### 2.2 "Terminal scrolls to the top — very boring"

**Root cause: `src/shared/xterm-fit.ts:113-116`.**

```ts
const target = Math.max(0, Math.min(after.baseY, after.baseY - distFromBottom));
```

`distFromBottom` is snapshotted from the **pre-resize** buffer (`:105`). When the pane
grows (rows ↑ ⇒ `baseY` ↓ 1:1) or reflow unwraps lines (total lines ↓ ⇒ `baseY` ↓),
`after.baseY - distFromBottom` goes **negative**, `Math.max(0, …)` clamps to **line 0**,
and `scrollToLine(0)` slams the viewport to the very top of scrollback. It fires only when
`!wasAtBottom` — i.e. only when you are scrolled up, which is precisely when it is
maddening.

**Why pi more than Claude:** the `W1-SCROLL` comment (`xterm-fit.ts:79-88`) already
documents that sideband panels force refits, and pi paints panels constantly, so pi hits
`resizePreservingScroll` far more often.

**Fix (S):**

```ts
if (after.baseY <= 0) return;
const dist = Math.min(distFromBottom, after.baseY);
const target = after.baseY - dist;
```

**Same bug, worse, in the mirror:** `src/web-client/main.ts:447` calls
`ref.term.resize(s.cols, s.rows)` **raw** — no scroll preservation at all. The shared
helper already lives in `src/shared/xterm-fit.ts`; only the native side
(`surface-manager.ts:2901`) adopted it. Route the mirror through it.

**Secondary:** `surface-manager.ts:1361` assigns `t.options.scrollback` on every
`termVisualChanged` pass, which triggers a buffer resize. Guard with a value comparison.

### 2.3 "Sidebar workspace card flicker"

The card-slot cache is fine; the flicker has two other mechanisms.

1. **`item.className = …` nukes transient classes every tick** (`sidebar.ts:1085`).
   `dragging`, `drop-before`, `drop-after`, `drag-origin` (set at `:2421,2462-2463`) are
   destroyed on every render, and `stableWorkspacesSignature` includes `cpuPercent` /
   `memRssKb` so `renderWorkspaces()` runs ~1 Hz forever. **During a drag-reorder the drop
   indicator and the dragged card blink at 1 Hz.** `applyHighlight()` (`:952`) restores
   only `keyboard-focus`. **Fix (S):** use `classList.toggle("active", …)`.
2. **Layout jitter from the meta row.** `buildCardMetaRow` returns `null` when command,
   fallback title and ports are all empty (`:1533-1538`), and the slot is deleted
   (`:1155-1157`). `focusedSurfaceCommand` comes from the 1 Hz poller and flaps as agents
   spawn/exit children — so the row appears and disappears, the card changes height, and
   every card below shifts. **Fix (S/M):** render a fixed-height `visibility: hidden`
   placeholder, and/or debounce `focusedSurfaceCommand` with ~2 s hysteresis.

### 2.4 "Line-height issue on sidebar resize"

**Root cause:** `#terminal-container { transition: left var(--transition-medium) }` =
**240 ms** (`index.css:2158`, `:223-224`). `applyPositions` measures
`terminalContainer.offsetWidth` (`surface-manager.ts:2733`) and `fitSurfaceTerminal`
measures `parent.clientWidth` (`:2886`). On resize **commit**, `wireSidebarResize.onCommit`
calls `requestLayout("full")` (`:379`) which runs on the next rAF (~16 ms) — about
**224 ms before the transition finishes**. Cols/rows are computed from a mid-animation
width and the grid stays off by a row/column until something else forces a fit.

`toggleSidebar` gets this right via `scheduleLayoutAfterTransition()` (`:1428-1440`); the
resize path does not.

**Fix (S):** call `scheduleLayoutAfterTransition()` in `onCommit`, and add
`body.sidebar-resizing #terminal-container { transition: none }` during the drag.

### 2.5 "`ht log` — I don't know what it does" / "Where is the log file?"

Not bugs — a naming trap. `ht log "msg"` **writes** a line into the sidebar Logs panel
(`src/cli/map-command.ts:751-762`). `ht logs` **prints** today's log path and streams it
with `--tail` (`bin/ht:154-192`). Two near-identical names whose help entries sit ~100
lines apart (`bin/ht:1341` vs `:1443`). In-app, the path appears only in Settings →
Advanced (`settings-panel.ts:1686`).

**Fix (S):** rename `ht log` → `ht sidebar-log` (keep `log` aliased with a deprecation
notice); add "Open log file" / "Reveal log file" palette commands; put an "app log ↗" link
in the sidebar Logs header; make `ht logs` the first line of `ht --help`.

### 2.6 Already fixed — prune these from `issues_now.md`

- **Hardcoded `/tmp/hyperterm.sock`** — fixed. `ht identify` returns the real bound path,
  and `bin/ht:130-140` even prints a remediation hint for the stale-shell case.
- **OSC 9;4 progress** — shipped, graded A, with a per-pane chip.

`issues_now.md` is drifting stale, which actively misdirects effort. Prune it or fold it
into the tracking-doc convention used everywhere else.

---

## 3. Performance — where the "performance first" claim breaks

The **bun-side** story is real and well engineered: libSystem FFI poller (~10 µs/pid, not
`ps`/`lsof`), focus-aware 3-tier cadence, adaptive stdout coalescing, backpressure-aware
WS with bounded per-session rings. No perpetual RAF loops — all 29 `requestAnimationFrame`
sites are dirty-flag driven. **The webview is where it breaks.**

### 3.1 Every pane allocates a WebGL context — even with bloom off (default)

`TerminalEffects` is constructed **unconditionally** per terminal surface
(`surface-manager.ts:2384`) — `setEnabled()` is called *after*. Its constructor grabs a GL
context (`terminal-effects.ts:303-313`), allocates a full-resolution 2D occluder canvas
(`:287`, `:594-595`), and compiles a 124-line fragment shader (`:912-969`).
`setEnabled(false)` (`:435`) only sets `active=false` + `display:none` — **the context
stays live**. `destroy()` (`:458-478`) deletes buffers/program/texture but **never calls
`loseContext()`**.

The proof this is an oversight rather than a decision: `terminal-renderer.ts:83-86` *does*
call `WEBGL_lose_context.loseContext()` on a 1×1 probe canvas, with a comment explaining
that browsers cap live contexts.

Default is `terminalBloom: false` (`settings.ts:751`), so this is pure waste for the
default user: ~2 full-resolution framebuffers per pane (800×500 at DPR 2 ≈ 6.4 MB each)
plus a shader compile per pane-open.

**Scenario:** WebKit caps live contexts near 16 per web process and force-loses the oldest
on overflow. 5 workspaces × 4 panes = 20 terminals blows past it. There is **zero**
`webglcontextlost` handling on the bloom canvas. With `terminalRenderer: "webgl"` each
pane costs *two* contexts — the limit lands at 8 panes, and eviction can kill an xterm
renderer context, not just a bloom one. Panes in inactive workspaces are only
`display:none` (`:2073`), so they hold contexts forever.

**Fix (M):** create the GL context lazily on first `setEnabled(true)`; release it
(`loseContext()` + null the 2D canvas) on `setEnabled(false)` and in `destroy()`; add a
module-level live-context counter that refuses new bloom layers past ~10 and logs once.

### 3.2 The sidebar's render memo can structurally never hit

`sidebar.ts:463-480` computes `stableWorkspacesSignature(workspaces)` — a
`JSON.stringify` of the whole payload (`:81-87`) — to skip `renderWorkspaces()` when
nothing changed. But the payload builder **mutates itself**: `buildOneWorkspace` calls
`pushCpuSample` (`shared/sidebar-state.ts:255`, impl `:342-350`), appending a sample on
every call, unconditionally. For the first 32 calls the array *length* changes; after that
any non-constant CPU rotates it. The signature therefore differs on essentially every
call — you pay the full stringify **and** the render. The "Phase 2B perf pass" early-out
is dead code.

Worse, `pushCpuSample` fires from all 19+ `updateSidebar()` call sites (focus change,
title change, workspace switch), not on a fixed cadence — so the sparkline's time axis is
also wrong.

This is the exact failure mode the perf plan documents for `cpuOrRssMoved` on the bun
side, reproduced on the webview side and never checked.

**Fix (S):** move `pushCpuSample` onto the 1 Hz metadata path only; exclude `cpuHistory`
from the signature (compare a rounded `cpuPercent` instead).

### 3.3 Telegram SQLite work blocks boot, even when Telegram is disabled

Same line as §1.1, different cost. `index.ts:370` → `new Database()`, 3 PRAGMAs,
`chmodSync` ×3, `existsSync` ×2, full DDL, and a `DELETE … WHERE id NOT IN (SELECT MIN(id)
… GROUP BY …)` self-join dedupe **on every launch** (`telegram-db.ts:52-82`, `:158-169`).
Then `:373-403` runs four more synchronous `DELETE`s including `pruneOldMessages`
(`:555-557`) — whose only index is `(chat_id, ts)`, making it a full table scan. All of it
lands between process start and `new BrowserWindow` at `:723`, and Telegram is **off by
default**.

**Fix (S):** open the DB lazily behind a getter used by the `telegram.*` RPCs; move boot
prunes to `setTimeout(…, 5000)`; add `idx_messages_ts`.

### 3.4 Smaller, cheap wins

- **`@xterm/addon-webgl` (124 KB) is statically imported but off by default**
  (`terminal-renderer.ts:24`; default `terminalRenderer: "dom"`). Parsed at every launch.
  **Fix (S):** `await import()` inside `attachRenderer`.
- **Mirror metadata fan-out is unfiltered and re-stringified per session**
  (`web/server.ts:826-838`). `surfaceMetadata` broadcasts to *all* sessions with no
  filter, unlike stdout which respects `subscribedSurfaceIds` (`:872`). A phone watching
  one workspace receives every pane's full `ProcessNode[]` tree — including argv — at
  1 Hz. **Fix (M):** stringify once and splice `seq`; filter by subscription. *(Slow-client
  backpressure itself is correct — `wsSend` skips the socket but still appends to the
  bounded ring, so one stalled client cannot stall the app.)*
- **`PanelManager` arms a 30 s `setInterval` per pane** (`panel-manager.ts:44-51`)
  iterating a usually-empty map. 20 panes = 20 timers. **Fix (S):** one shared timer, or
  arm only while `pendingData.size > 0`.
- **`rasterise()` forces two layout flushes per call, up to 30×/s**
  (`terminal-effects.ts:640-642`). `cursorCanvasPos()` was explicitly fixed to cache this
  geometry (`:496-502`); `rasterise` was left reading raw. Bloom-only, but then dominant.
  **Fix (S):** reuse the cached `offsetX`/`cellW` from `updateGeometry()`.
- **`htKeysSeen` is an uncapped `Set`** (`app-context.ts:73`), fed by
  `ht set-status --key` and broadcast in full on each new key (`index.ts:924-931`). Every
  other growth vector in the codebase is capped. **Fix (S):** cap at 256, FIFO.
- **`ClaudeTeamWatcher` is unstoppable and ungated.** `claude-integration.ts:78` does
  `new ClaudeTeamWatcher({ callRpc }).start()` and **discards the instance**, so `stop()`
  (`claude-team-watcher.ts:126`) is unreachable. The 5 s `setInterval` has no `unref()`, no
  visibility gate, and does blocking sync FS reads on the main thread.
  *Honest scope note: `~/.claude/teams` does not exist on this machine, so the early-exit
  fires and the current cost is one `existsSync` per 5 s — not the 20–100 file reads the
  raw reading suggests. Worth fixing for the unreachable `stop()` and the missing gate,
  but it is not burning you today.* **Fix (S).**
- **CodeMirror + Lezer is still eagerly bundled** — `editor-surface-controller.ts:7-15`
  statically imports `./editor-pane`, pulled in by `surface-manager.ts:65`. Measured
  **~1.4 MB of the 3.14 MB raw bundle**. (Already on the deferred list; re-confirmed.)

### 3.5 Claims that hold up

No perpetual RAF loops. Idle/visibility discipline genuinely wired for the metadata
poller, the native 1 Hz status bar, and the sidebar RAF coalescer. Stdout coalescing is
correct and well reasoned. Web-mirror client bundle is lean at 184 KB minified.
`index.css` at 324 KB raw has zero `backdrop-filter` and sane `will-change` usage — not a
problem.

---

## 4. What to add — the strategic answer

This is the part the AAA programme cannot give you, because it grades what exists rather
than what is missing.

### 4.1 The documentation is wrong about protocol support — start here

`doc/system-osc-sequences.md` claims OSC 7, 52 and 133 are "handled by xterm". They are
not. xterm 6.0.0 registers OSC handlers for exactly **0, 1, 2, 4, 8, 10, 11, 12, 104, 110,
111, 112** (verified by grepping the shipped bundle). So:

| OSC | Doc claims | Reality |
|---|---|---|
| 7 (cwd) | "handled by xterm" | **no handler** |
| 8 (hyperlinks) | web-links addon | ✅ correct |
| 52 (clipboard) | "xterm gates clipboard write" | **no handler** — remote copy from nvim/tmux silently fails |
| 133 (semantic prompts) | "markers visible via xterm itself" | **no handler** |

Fix the doc, then close the gaps.

### 4.2 Kitty keyboard protocol (CSI u) — highest value ÷ effort in this report

Without it, **Enter and Shift+Enter are the same byte**. Agent TUIs lose multiline edit and
users fall back to Ctrl+J or `\`+Enter. Supported by Kitty, Ghostty, WezTerm, iTerm2,
Alacritty, Warp, and VS Code since 1.109 (Jan 2026).

τ-mux is pinned to `@xterm/xterm` 6.0.0. The implementation landed in
[xterm.js PR #5600](https://github.com/xtermjs/xterm.js/pull/5600) and ships in the beta —
npm dist-tags confirm `beta: 6.1.0-beta.292`.

**Scope this honestly.** It does **not** affect τ-mux's native Claude Code pane or agent
panel — those are DOM textareas that handle Shift+Enter directly
(`claude-agent-pane.ts:712`, `agent-panel.ts:1018`). It affects the **PTY path**: running
`claude`, `pi`, or any other agent CLI in an ordinary terminal pane.

**That path is the project owner's primary workflow** (confirmed during review), so this
is not a hypothetical papercut — it is daily friction for the person who uses the app
most. Priority accordingly.

#### Three fixes, ascending effort — the first two need no dependency change

**(1) `macOptionIsMeta: true` — one line.** `surface-manager.ts:2354` constructs
`new Terminal({…})` **without** `macOptionIsMeta`, and xterm's default is `false`. That
means Option+Enter — Claude Code's documented macOS multiline shortcut — does not emit the
meta sequence the TUI expects; the keypress is consumed as an accented character instead.
Adding the option is the cheapest possible win and should be verified in a pane
immediately.

**(2) `attachCustomKeyEventHandler` — ~5 lines.** The hook is part of the xterm API and is
**used nowhere in this codebase** (grep confirms zero call sites). Intercept
`keydown` + `Enter` + `shiftKey`, write `0x0a` (Ctrl+J, the byte Ink-based TUIs including
Claude Code treat as newline-without-submit) straight to `onStdin`, and return `false` to
suppress the default CR. Wire it beside the existing `term.onData` at `:2386`. *Verify the
exact byte in a live pane before shipping — `0x0a` is the expected mapping but has not
been empirically confirmed here.*

**(3) Bump to `@xterm/xterm` 6.1.0-beta — the real fix.** Full Kitty keyboard protocol, so
every modifier combination works for every agent TUI rather than one hand-mapped key.
Carries normal beta risk; (1) and (2) are the de-risked path to relief today.

**Effort: XS for (1)+(2); XS-S for (3).**

### 4.3 OSC 133 shell integration — the missing structural layer

`doc/system-process-metadata.md:3` states **"no shell integration"** as a design boast —
zero-config, works with any shell. Defensible originally, but it means τ-mux has **no
ground truth for where a command starts, ends, or what it returned**. Nothing in the ~90
tracking docs proposes changing that.

Ghostty 1.3.0 (2026-03-09) shipped a complete OSC 133 implementation enabling
jump-to-prompt, copy-command-output, click-to-move-cursor, and notify-on-command-finish.
VS Code's entire agent-terminal stack rides on its OSC 633 superset.

For τ-mux specifically the payoff is larger than for anyone else: the auto-continue engine
and Claude auto-approve are currently **heuristic guesses over a byte stream**. OSC 133
gives them exit codes and command boundaries as facts. It also feeds the chip system, the
sidebar, and notifications that already exist.

Keep the poller as the always-works baseline; add shell integration as an **optional
enhancement layer** installed the same way the `ht` CLI already is. **Effort: M.**

Follow-on once landed: expose blocks over the socket RPC —
`ht blocks last --json` → `{command, exitCode, durationMs, output}`. VS Code's agent
terminal is fragile precisely here
([microsoft/vscode#313074](https://github.com/microsoft/vscode/issues/313074)); τ-mux owns
the PTY *and* has an independent `ps`-based oracle, so it can do better.

### 4.4 Cheap standards parity

| Spec | Unlocks | Effort |
|---|---|---|
| OSC 52 (`@xterm/addon-clipboard` 0.2.0) | remote copy from nvim/tmux over SSH | XS |
| Unicode 11 (`@xterm/addon-unicode11` 0.9.0) | emoji/powerline column alignment | XS |
| Ligatures (`@xterm/addon-ligatures` 0.10.0) | Fira / JetBrains Mono | XS |
| Sixel + iTerm2 inline images (`@xterm/addon-image` 0.9.0) | `imgcat`, `chafa`, yazi previews, matplotlib | S |

τ-mux renders images **only** through its own fd-4 sideband, so every standard image tool
prints garbage. Kitty graphics is the de-facto standard (Kitty, Ghostty, iTerm2, Warp,
Terminal.app, WezTerm) but xterm.js has no implementation
([issue #5592](https://github.com/xtermjs/xterm.js/issues/5592)) — treat that as a
quarter-scale project, and ship Sixel + iTerm2 first.

### 4.5 Two differentiation plays

**Become the first MCP Apps *host* in a terminal (M).** On 2026-01-26 MCP shipped
[MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/): tools return
`ui://` HTML resources, hosts render them in **sandboxed iframes** with JSON-RPC over
`postMessage`. Every rendering host today is a chat window — Claude, ChatGPT, VS Code
Insiders, Goose. **None is a terminal.**

τ-mux already has this exact machinery: `src/shared/sideband-sandbox.ts` renders sideband
HTML in a strict-CSP `<iframe sandbox>` on both native and mirror, with a panel registry
and a bidirectional RPC bus. **The sideband protocol is now a proprietary dialect of a
ratified standard.** Concretely: when Claude Code in a τ-mux pane calls an MCP tool
returning a `ui://` resource, render it as a floating panel instead of dumping JSON.

This does not contradict the earlier WS8 decision (`tracking_august-plan.md:64`) — that
was about τ-mux as an MCP *server*, which costs tokens per session. Being a *host* costs
zero tokens and is unclaimed.

**Ship an ACP client and retire two bespoke integrations (M).**
[ACP](https://agentclientprotocol.com/protocol/overview) is JSON-RPC 2.0 over
stdin/stdout, adopted by JetBrains, Google and GitHub across 25+ agents. It defines
`session/new`, `session/prompt`, `session/update` (message chunks, tool calls, **plans**),
`session/request_permission`, and `terminal/create` · `terminal/output` ·
`terminal/wait_for_exit` · `terminal/kill`.

τ-mux's pi integration is *already* stdin/stdout JSON-RPC with a plan mirror, an ask-user
modal, and permission auto-approve — it is a proprietary ACP. Adopting it yields Gemini
CLI, Codex, Crush and 20+ others as panes for free, and τ-mux would be the only client
that serves ACP's terminal methods with **real panes the user can watch** rather than a
hidden subprocess.

### 4.6 Do not build

- **A faster renderer.** You are a WebView; Ghostty/Alacritty/Kitty win on GPU text
  throughput permanently. Compete on structure, not frames.
- **Cloud agent infrastructure.** Warp has Oz and billing; capital-intensive. A local
  `ht run --detached` supervised from the phone gets 80 % of the value using the mirror +
  Telegram + auto-continue you already have.
- **Your own agent / model router.** Host agents; don't write one.
- **A WASM plugin runtime.** Zellij's sandboxed WASM system is years of work. MCP Apps
  hands you sandboxed third-party UI for free.
- **Block-everything UX.** Wave Terminal owns that framing; panels-over-a-real-PTY is the
  better differentiator.
- **Windows/Linux parity** until §4.2–§4.4 ship.

---

## 5. Distribution — four months of work is uninstallable

Code is **v0.10.8**. The newest GitHub release is **v0.2.30, 2026-04-27**. Only two
version tags exist in the entire repo.

`.github/workflows/release.yml` is written, correct, and fires on `v*` tags or manual
dispatch. `scripts/bump-version.ts` already supports `--commit --tag --changelog` with
two-tier rollback. **The pipeline works and has simply never been run.** Everything since
April — the entire Claude Code integration, agent panes, editor panes, extension apps,
the design system — exists only on your disk.

**Fix (S):** tag v0.10.8 and push. Then add a release step to the routine you already
follow for `bun run bump:*`.

---

## 6. Onboarding — the largest single UX gap

There is **none**. `firstRun`, `firstLaunch`, `onboardingCompleted` return **zero hits**
across `src/`. First launch calls `createWorkspaceSurface(80, 24)`
(`src/bun/index.ts:934-944`), spawns a shell, and that is the entire experience. The only
empty state in the app is one string — `"No workspaces yet — ⌘T to create one"`
(`sidebar.ts:876`) — which is unreachable on first run because a workspace is always
created.

Meanwhile the app ships **102 palette command ids**, **83 `ht` commands**, 10 settings
sections / 45+ fields, a sideband protocol, ⌘⌥P, ⌘⇧P and a keyboard cheatsheet — none of
it announced anywhere.

**Fix (S for 80 % of the value):** a dismissible 4-line overlay in the first pane, gated on
a `settings.onboardingCompleted` flag — ⌘⇧P palette, ⌘⌥P processes, ⌘/ cheatsheet,
`ht --help`. **(M):** auto-open the cheatsheet once, and add an `ht init` that prints the
socket export line you had to hand-write into `.zshrc` (`issues_now.md:44-46`).

---

## 7. Mobile / web mirror

The mobile story is **much further along than `issues_now.md` implies**:
`keyboard-toolbar.ts` (242 lines — Esc/Tab/Ctrl/arrows/PgUp/pipe/tilde with sticky-Ctrl
encoding), `touch-gestures.ts` (swipe = workspace switch, edge-swipe = drawer, pinch =
font size), `pwa.ts` + `sw.ts`, `viewport-fit=cover`, safe-area padding, pane fullscreen.
The key-accessory bar you'd otherwise propose is already built. Real gaps:

| Gap | Evidence | Impact ÷ effort |
|---|---|---|
| **No `visualViewport` handling.** `interactive-widget=resizes-content` is Chromium-only; on iOS Safari the keyboard *overlays* the page, so the accessory bar and last rows sit behind it. `grep visualViewport src/` = 0 hits. | `web/page.ts:35` | **High ÷ M** |
| **No disconnect UI.** After `MAX_RECONNECT_ATTEMPTS` the transport gives up with a `console.warn` (`transport.ts:171-179`); the only surface is an 8 px header dot (`main.ts:252-259`). A phone that slept shows a frozen terminal with no explanation. | | **High ÷ S** |
| **Pinch-zoom hijacked globally.** `user-scalable=no` + pinch remapped to font size — correct for the pane, but blocks zoom on sidebar/settings text. | `page.ts:35` | Med ÷ S |
| **No portrait multi-pane strategy.** Binary-split rects in portrait give ~24 cols per pane on a 390 px screen. | `layout.ts` | Med ÷ M |

---

## 8. Information architecture

**Settings (10 sections, 45+ fields) has no search** — 0 relevant hits in
`settings-panel.ts`. A fuzzy filter box over field labels is the single change that makes
45 fields navigable. **Effort: S, best ratio in this section.** Then merge
Appearance + Theme + Effects into one "Appearance" with sub-tabs, and demote
Auto-continue into Advanced.

**The sidebar is the real overload.** One scroll column carries workspace cards (stripe,
header, meta row, stat row + sparkline, cwd row, file explorer, panes, manifests, status
pills, progress) *plus* notifications, logs, plan panel and health pills. On a 320 px rail
with three workspaces the active card alone can exceed a viewport.

1. **Cap the inactive card** to header + stat row; render meta/cwd/panes/manifests only
   for the active workspace (`cardOptions.show.*` already exists — add an `activeOnly`
   mode). **S**, and it kills most of the §2.3 jitter too.
2. Move file explorer + manifests out of the card into a segmented "Files / Scripts /
   Status" area — they are per-workspace *tools*, not workspace *identity*. **M**.
3. Collapse Notifications + Logs into one bottom drawer with a tab switch and a count
   badge. Two always-expanded sections at the bottom of a scroll column is why nothing
   below the fold is ever seen. **M**.
4. Ship your own ask — "settings for what is shown and how, modular"
   (`issues_now.md:34`) — as a "Customize card…" item on the card context menu. **S**.

---

## 9. Architecture & code health

### 9.1 The webview has zero fault isolation and no error-reporting path

`src/views/terminal/surface-manager.ts` contains **0 `try {` blocks across 2,915 lines**
(verified). `index.ts:104-397` registers every Electrobun `messages:` handler as a bare
call into SurfaceManager. There is **no `window.addEventListener("error")` or
`"unhandledrejection"` anywhere** in `src/views/terminal/` or `src/web-client/` — the only
two hits (`browser-pane.ts:128,136`) sit inside a string injected into *guest* pages.
`src/shared/event-bus.ts:66-77` invokes every subscriber unguarded.

The asymmetry is the point: the bun side has `attributeFault` + `FAULT_BUDGET` +
`health.set` (`index.ts:198-231`), and the web client isolates store subscribers
(`store.ts:837-845`, comment: *"A crashing subscriber must not poison the store"*). The
native webview — which holds **100 % of the UI** — got neither. `logger.ts` tees only
bun's stdout, so a throw in the webview produces **no log line, no health row, no toast,
nothing**. Every "sidebar froze / chips stopped updating" report is unreproducible by
construction.

**Fix:** (a) `error` + `unhandledrejection` listeners in the `index.ts` bootstrap →
`rpc.send("webviewFault", …)`; bun logs and sets `health.set("webview", …)`. (b) try/catch
inside `EventBus.on`'s `wrapped`. (c) wrap the `messages:` table in a `guard()` HOF.
(a)+(b) **S**; (c) **M**.

### 9.2 `populateWorkspaceCard` is forked native/mirror — and has already drifted

`sidebar.ts:1018-2306` (~1,290 lines) vs `src/web-client/sidebar/workspace-card.ts` (575
lines), whose own header says *"Mirrors the native `populateWorkspaceCard`"*. Same
section-cache architecture; the `CardSlotKey` and `SectionKey` unions have the same nine
members.

**Confirmed drift, user-visible:** native gates seven sections on `show.*`
(`sidebar.ts:1140, 1171, 1218, 1258, 1280, 1330, 1368`), driven by 47
`workspaceCardShow*` references in `settings.ts`. The mirror's card has **zero
occurrences of `show`** — your card configuration silently does not apply on the web
mirror, and the file-explorer section is native-only.

This is the largest contiguous block in the largest `.ts` file. Extracting it drops
`sidebar.ts` 3,714 → ~2,400, deletes ~575 lines of web-client, and closes the drift in one
move. The pattern already exists twice — `shared/sidebar-manifest-card.ts` and
`shared/notification-overlay.ts` are shared renderers with injected `createIcon` and thin
native re-export shims (31 and 39 lines).

**Fix:** `src/shared/workspace-card-render.ts({ createIcon, options, callbacks })`. **L.**
*This is the highest-leverage decomposition seam nobody has proposed.*

### 9.3 `index.css` is exempt from the module-size ratchet — and 53 tests pin its text

`scripts/audit-module-size.ts:65` — `INCLUDE_EXT = new Set([".ts", ".tsx"])` (verified).
The baseline lists 8 files, all TypeScript. So `index.css` grew **12,352 → 13,457** while
every baselined `.ts` file stayed frozen. The ratchet that exists to stop god modules
growing does not cover the biggest file in the repo.

The lock-in is worse: **53 `tests/theme-tokens-*.test.ts` files (5,975 lines, all 53
reading `index.css`)** assert on selector-block *text*. Splitting `index.css` into partials
breaks all 53 at once. The test suite has ratcheted the file's shape in the opposite
direction from the tooling.

**Fix:** (a) add `.css` to `INCLUDE_EXT` and baseline both CSS files. (b) give the
theme-token tests one `loadNativeCss()` helper concatenating `src/views/terminal/css/*.css`
so the eventual split is a one-file change. (a)+(b) **S**; the split itself **L**.

### 9.4 The mirror protocol models 2 of 6 surface kinds; 5 creation paths never broadcast

`shared/web-protocol.ts:341,357` defines only `surfaceCreated` and
`telegramSurfaceCreated`; `web-client/main.ts:185` types panes as `"term" | "telegram"`.
In `src/bun/index.ts`, `createEditorWorkspaceSurface:1037`, `splitEditorSurface:1054`,
`createExtensionWorkspaceSurface:1095`, `createAgentWorkspaceSurface:1724` and
`splitAgentSurface:1773` contain **no `webServer?.broadcast`** — while the Telegram
equivalents (`:1148`, `:1159`) do. Editor, extension and agent panes simply do not exist on
the mirror.

This is tracked finding `A9` ("dual broadcast inlined at ~40 sites"), but now with
receipts: it has bitten **five times**. CLAUDE.md's *"Adding a non-PTY surface kind"*
checklist has no web-mirror step, so kind #7 will drift too.

**Fix (M):** a `Broadcaster.emit(envelope)` fan-out plus a generic
`nonPtySurfaceCreated` envelope carrying `surfaceType`, so the mirror renders a labelled
placeholder instead of a hole. Add the step to the CLAUDE.md checklist.

### 9.5 SurfaceManager derived-state fan-out is 53 hand-maintained call sites

`surface-manager.ts:176` still owns `private workspaces: Workspace[]`;
`WorkspaceCollection` is a **read-only query facade over that same array** (`:182`), not
the pure state class `A8` proposed. Every mutation must remember which of five fan-outs to
call: `updateSidebar()` ×21, `requestLayout()` ×14, `notifyWorkspaceChanged()` ×8,
`updateTitlebar()` ×6, `emitNotifyState()` ×4.

A full reducer port is **not** worth it — xterm instances and DOM identity aren't
reducible. What is worth it: route mutations *through* `WorkspaceCollection`, emit one
`changed` signal, and coalesce it into a single rAF that runs all five fan-outs. Removes
the "forgot to call updateSidebar" bug class permanently. **M.**

### 9.6 The metadata poller has no health row

`surface-metadata.ts:753-767` and `:935-955` degrade to `console.error` / `console.warn`
only. `health.set` is wired for pty, socket, web-mirror, telegram and audits — but
**never for metadata**, the subsystem whose failure is the most visible (every chip,
sidebar aggregate and Process Manager row goes blank) and the least explicable.
`ht health` reports green while the pipeline is dead. **Fix (S):** one `health.set` in the
tick catch and the missing-binary path.

### 9.7 A settings toggle that does nothing

`browserInterceptTerminalLinks` is declared (`settings.ts:218`), defaulted (`:814`),
validated (`:939`), schema-wrapped (`settings.schema.ts:293`), rendered as a live checkbox
(`settings-panel.ts:1286`), and documented in both
`website-doc/.../configuration/settings.md:91` and `doc/system-browser-pane.md:520` —
and **read by no code** (verified: zero consumers outside the settings plumbing). Either
implement the ⌘-click interception or delete the field, the panel row and the docs. Also
confirmed dead: `BranchChip`, `CommandBar`, `isHtmlSvgElement` in `tau-primitives.ts`.
**S.**

### 9.8 Test-suite verdict

**12.6 % of the suite (388 / 3,089 at audit time) is source-text grepping**, and 377 of
those are the theme-token CSS cluster — assertions that a rule references a token name.
They test authorship convention, not behaviour: there is no rendering regression they could
catch, and they actively obstruct §9.3. The rest of the suite is genuinely behavioural.

The real thin spot is not line coverage but **the webview's failure paths** — zero tests
assert what happens when an RPC payload is malformed or a DOM node is missing, which is
exactly the gap §9.1 describes.

---

## 10. Other security findings

- **MEDIUM — prompts and layout persisted world-readable.** `claude-sessions.json`,
  `layout.json`, `notifications.json`, `extensions-registry.json` are `-rw-r--r--` on the
  live install (verified), while `settings.json`, `cookie-store.json` and
  `browser-history.json` are correctly `0600`. `claude-registry-persistence.ts:129` passes
  no `mode`. `claude-sessions.json` contains full prompt text and cwds — among the most
  sensitive content in the app. **Fix (S):** pass `{ mode: 0o600 }` at all three call
  sites; extend `tests/file-modes.test.ts`.
- **MEDIUM — extension install runs unreviewed postinstall scripts with your
  environment.** `extension-manager.ts:600` spawns `bun install` with **no
  `--ignore-scripts`**, no timeout, and `env: { ...process.env }` — so a transitive
  dependency's postinstall hook executes with any `ANTHROPIC_API_KEY` present. The
  documented "extensions are trusted code" model covers the extension's own entry point,
  not its dependency tree. **Fix (S):** add `--ignore-scripts` and a spawn timeout.
- **MEDIUM — `electrobun` is two minor versions behind** (1.16.0 vs 1.18.1). This is the
  WebView/native bridge, the most security-relevant dependency. The rest of the tree is
  clean. Note `npm audit` cannot run — no lockfile is committed; consider committing
  `bun.lock` for supply-chain review. **Fix (S–M).**
- **MEDIUM — mirror snapshot ships full argv + cwd of every process**
  (`server.ts:763`). Command lines routinely carry tokens
  (`curl -H "Authorization: …"`, `psql "postgres://user:pass@…"`). Authenticated-only by
  design, but it sharply raises the cost of §1.2. **Fix (S):** redact argv matching common
  secret patterns.
- **LOW — `atomic-write.ts:44-58`:** on `ENOSPC` the throw escapes before the rename, so
  the `.tmp` is never unlinked. Accumulates turds on a full disk. **Fix (S):** unlink in a
  `finally`.
- **LOW — `createFetchTransport` (`telegram-service.ts:766+`)** passes a `signal` but sets
  no deadline; a black-holed connection to `api.telegram.org` hangs the long-poll past
  `POLL_TIMEOUT_SEC=25` with no watchdog. **Fix (S):**
  `AbortSignal.any([signal, AbortSignal.timeout(35_000)])`.

**Verified sound, no action:** constant-time token compare; Origin/CSRF check on WS
upgrade; brute-force throttle from `requestIP`; mirror wire protocol is an explicit
allow-list, not an RPC proxy; socket RPC dispatch is per-request guarded; socket at
`srw-------`; `socket.token` is 0600 and **not** injected into PTY env, so a sideband
producer gains no privilege it didn't already have as the same user; Anthropic key read
from env, never persisted; `SettingsSnapshotPayload` is a genuine allow-list — no bot
token or mirror token on the wire.

---

## 11. Suggested sequence

**Week 1 — stop the bleeding (all S).**
§1.1 telegram boot guard + hoist `mkdirSync` · §1.2 mirror token default · §1.3
auto-approve `seq` check · §2.1A panel opacity on blur · §2.2 scroll clamp (native +
mirror) · §10 file modes + `--ignore-scripts` · §9.1 webview error listeners ·
**§4.2(1)+(2) `macOptionIsMeta` + Shift+Enter key handler** · **§5 tag and push v0.10.8**.

§4.2(1)+(2) are ~6 lines total and remove daily friction from the owner's primary
workflow (`claude` in a PTY pane). Do them first — they are the cheapest real-world
improvement in this entire document.

§9.1 belongs in week 1 despite being an architecture item: until the webview can report a
fault, every other bug in this report is diagnosed by guesswork.

**Week 2 — the agent-terminal thesis.**
§4.1 fix the OSC doc · §4.2 bump xterm for CSI u · §4.4 the three XS addons · §1.4
auto-approve deny-list · §9.6 metadata health row · §9.7 delete-or-implement the dead
toggle.

**Week 3-4 — the structural bet.**
§4.3 OSC 133 shell integration + `ht blocks` · §3.1 WebGL context lifecycle · §6
onboarding overlay · §8 settings search · §9.3(a)(b) CSS ratchet + `loadNativeCss()`.

**Then, in order of leverage:** §9.2 the shared workspace-card renderer (**L**, but it is
the seam that stops the native/mirror drift class), then one differentiation play — MCP
Apps host or ACP client (§4.5). Both are M; MCP Apps is the more defensible position
because no terminal holds it.

---

## A note on line numbers

CSS line references in §2.1 and §2.4 were verified against the **working copy**, which has
uncommitted edits to `src/views/terminal/index.css` and `surface-details.ts`. Those shift
`index.css` by roughly +120 lines against committed `main` — e.g.
`body.terminal-typing .panel` is at **2897** in the working copy and **2777** on clean
`main`. Selector names are given alongside every CSS reference so they resolve either way.
All non-CSS references are against committed `main` and are exact.

---

## Appendix — corrections made during verification

Two agent claims did not survive checking and are corrected above rather than repeated:

1. An agent reported that `ht logs` does not exist and the log path is unreachable from
   the CLI. **`ht logs` does exist** (`bin/ht:154-192`) and prints the path via
   `system.identify`, with `--tail` streaming. The real defect is the `ht log` / `ht logs`
   naming collision (§2.5).
2. An agent reported `doc/system-osc-sequences.md` wrong about four OSCs including OSC 8.
   **OSC 8 is correctly documented** — the web-links addon handles it. Three rows are
   wrong, not four (§4.1).

A third framing was corrected: `ClaudeTeamWatcher`'s filesystem burn is **conditional on
`~/.claude/teams` existing**, which it does not on this machine (§3.4).

**Fourth, and the largest correction — made after review pushback.** The first draft of
this document claimed τ-mux is "one of the worse terminals to run Claude Code in." That is
wrong and has been rewritten in the Verdict and §4.2. It generalised a real but narrow
input-layer gap into a verdict on the whole app, and it ignored the counter-evidence
sitting in the repo:

- τ-mux ships ~3,240 lines of Claude-Code-specific integration — `claude-agent-pane.ts`
  (1,331), `claude-session-registry.ts` (382), `claude-agent-manager.ts` (348),
  `claude-status-presenter.ts` (277), `claude-pane-host.ts` (197),
  `claude-auto-approve.ts` (199), `claude-plan-mirror.ts` (131),
  `claude-team-watcher.ts` (187), plus the `ht-bridge` hooks. No other terminal has any
  equivalent.
- The Shift+Enter defect does not even reach that pane: `claude-agent-pane.ts:712` and
  `agent-panel.ts:1018` handle the key in the DOM.

On integration depth τ-mux is plausibly the **best** terminal for Claude Code today. The
accurate finding is narrower and still worth acting on: the PTY layer beneath that
integration lags the standards its peers already implement, and closing that gap is XS.

Lesson for future audits of this repo: a competitive-research agent optimises for a sharp
claim, and a sharp claim about a weakness will skip the strengths that sit one grep away.
Verify verdicts, not just facts.
