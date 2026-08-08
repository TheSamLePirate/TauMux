# Plan — make τ-mux the best terminal to run Claude Code in

**Audited:** v0.11.0 · branch `main` · 2026-08-08
**Target:** `claude` run as a CLI inside an ordinary **terminal pane** (the PTY path).
Not the native Claude pane (`claude-agent-pane.ts`, Agent SDK) — that one is already
ahead of the market and is out of scope here.

**Reference used for "what Claude Code expects":** the shipped binary,
`~/.local/share/claude/versions/2.1.224` (Mach-O, embedded JS readable via `strings`).
Every claim below marked ✅ was read out of that binary or out of
`node_modules/@xterm/xterm/lib/xterm.js`, not from memory.

---

## Verdict

τ-mux has the deepest Claude Code *integration* of any terminal — hooks, status pills,
plan mirror, ask-user modals, auto-approve, Telegram fan-out, a dedicated skill. And it
runs that integration on top of a **terminal layer that drops or corrupts several of the
signals Claude Code actually uses.**

The single worst one: **pasting is not bracketed**. Claude Code turns on
`DECSET 2004` and τ-mux never emits `ESC[200~ … ESC[201~`, so a multi-line paste is
submitted line-by-line as separate prompts. That is the most common real-world Claude
Code interaction in any terminal, and it is broken in this one.

The pattern repeats: Claude Code drives eleven DEC private modes and two notification
escapes; τ-mux honours some, ignores others, and actively swallows one it already
intercepts for another purpose.

Fix the floor first (Phase 0, days). Then close the signal gaps (Phase 1). Only then
chase the structural wins (Phase 2) and the thing no other terminal can do (Phase 3).

---

## What Claude Code 2.1.224 actually asks of a terminal

Read out of the binary — `JC = { … }`, the private-mode table it drives:

```
CURSOR_VISIBLE:25   ALT_SCREEN:47      ALT_SCREEN_CLEAR:1049
MOUSE_NORMAL:1000   MOUSE_BUTTON:1002  MOUSE_ANY:1003   MOUSE_SGR:1006
FOCUS_EVENTS:1004   BRACKETED_PASTE:2004
THEME_NOTIFY:2031   SYNCHRONIZED_UPDATE:2026
```

Plus:

| Signal | What Claude Code does with it | τ-mux today |
|---|---|---|
| `COLORTERM=truecolor` | 24-bit colour depth | ✅ set (`pty-manager.ts:141`) |
| `DECSET 2004` bracketed paste | collapses a paste into `[Pasted text #1 +N lines]` | ❌ **never emitted** |
| `DECSET 2026` synchronized output | tear-free full-frame repaint | ✅ xterm 6.0 supports |
| `DECSET 1004` focus events | suppress notifications while focused | ✅ xterm 6.0 supports (needs verify) |
| `DECSET 2031` theme notify | match its UI colours to the terminal | ❌ xterm 6.0 has no `2031` |
| `OSC 9 ; <text>` | the `iterm2` notification channel | ❌ **intercepted then dropped** |
| `BEL` | the `terminal_bell` notification channel | ❌ no `onBell` handler anywhere |
| Shift+Enter | multiline prompt | ❌ indistinguishable from Enter |
| `TERM_PROGRAM` | terminal-specific advice + `/terminal-setup` | ❌ unset; **leaks the launcher's value** |
| IDE lock file + WS MCP | `openDiff`, `selection_changed`, `at_mentioned` | ❌ not implemented (opportunity) |

Claude Code's own help text names the terminals that get Shift+Enter for free:
*"iTerm2, WezTerm, Ghostty, Kitty, Warp, and Windows Terminal support Shift+Enter
natively."* τ-mux is not on that list and cannot be until it speaks the Kitty keyboard
protocol or hand-maps the key.

### xterm.js 6.0.0 capability floor (verified against the shipped bundle)

| Feature | Present |
|---|---|
| `2004` bracketed paste | ✅ — but **only inside xterm's own `paste()` path** |
| `2026` synchronized output | ✅ |
| `1004` focus events | ✅ |
| `2031` theme notify | ❌ zero occurrences |
| Kitty keyboard / `modifyOtherKeys` | ❌ zero occurrences |
| OSC handlers registered | `0,1,2,4,8,10,11,12,104,110,111,112` — no `7`, no `52`, no `133` |

---

## Findings

Ordered by damage to a Claude Code session, not by category.

### F1 — Paste is not bracketed, and bypasses the only code path that would bracket it (CRITICAL)

Chain:

| Step | Location |
|---|---|
| ⌘V keydown | `src/views/terminal/index.ts:2578-2588` — calls `pasteClipboard()` then `e.preventDefault()` |
| `pasteClipboard()` | `src/views/terminal/index.ts:2022-2034` — `rpc.send("clipboardPaste", …)` |
| bun handler | `src/bun/webview-handlers/clipboard.ts:35-38` → `ctx.handlePaste()` |
| `handlePaste()` | `src/bun/index.ts:2058-2098` — reads clipboard, `sessions.writeStdin(surfaceId, text)` |
| `writeStdin` | `src/bun/session-manager.ts:299-301` → `pty.write(data)` → raw bytes into the PTY |

Nothing in that chain wraps the text, normalises line endings, or consults
`decPrivateModes.bracketedPasteMode`. `grep -rn "200~\|bracketed" src/ tests/` returns
**zero hits.**

The `preventDefault()` at `index.ts:2584` is what makes it unrecoverable: it suppresses
the browser `paste` event, so xterm's own handler — the one that does
`bracketTextForPaste()` and `\r\n → \r` normalisation, present in the bundle — never
runs.

**Effect on Claude Code:** paste a 20-line stack trace and Claude Code receives 20
prompt submissions. No `[Pasted text #1 +19 lines]` collapse. Windows-style `\r\n` text
doubles the submissions. This is the defining papercut.

**Parity inversion worth noting:** the **web mirror is correct** — `src/web-client/main.ts:594`
uses xterm's native `onData`/paste path, so remote panes bracket properly while the
native app does not.

**Same defect, second entry point:** `surface.send_text` (`src/bun/rpc-handlers/surface.ts:258-266`)
also writes raw. So `ht send "line1\nline2"` — the primitive the agent-orchestration
skill uses to drive a Claude pane — has the identical failure mode.

---

### F2 — Redundant SIGWINCH on every layout pass (HIGH)

`src/views/terminal/surface-manager.ts:2705-2708`, inside `applyLayout()`:

```ts
fitSurfaceTerminal(view);          // no-ops when cols/rows are unchanged
…
if (view.term) this.onResize(surfaceId, view.term.cols, view.term.rows);   // fires unconditionally
```

`fitSurfaceTerminal` correctly short-circuits, but `onResize` does not, and there is no
dedupe further down either — `SessionManager.resize` (`session-manager.ts:309-320`) and
`PtyManager.resize` (`pty-manager.ts:255-264`) both forward blindly to
`terminal.resize()`, which issues `TIOCSWINSZ` and delivers **SIGWINCH to the foreground
process group every time**, identical dimensions or not. It also emits a sideband resize
event per call.

Full layout passes fire on: workspace switch, pane add/remove, sidebar toggle, font-size
change, settings apply, divider mouse-up, and the debounced window resize
(`index.ts:894-906`, 200 ms).

**Effect on Claude Code:** Ink treats SIGWINCH as "repaint everything". Switching
workspaces makes every Claude pane in the target workspace redraw its full UI — the
visible symptom being flicker and occasionally duplicated transcript rows.

The window-resize debounce is good work; the missing piece is one equality check.

---

### F3 — Shift+Enter and Option+Enter both fail (HIGH)

- `new Terminal({…})` at `src/views/terminal/surface-manager.ts:2354-2365` does **not**
  set `macOptionIsMeta`; xterm's default is `false`, so ⌥Enter is eaten as a dead-key /
  accented character rather than becoming `ESC CR`.
- xterm 6.0.0 has no Kitty keyboard protocol and no `modifyOtherKeys`, so Shift+Enter is
  byte-identical to Enter.
- `attachCustomKeyEventHandler` is available on the xterm API and **used nowhere on the
  native side** (only `src/web-client/dictation-input.ts` uses it, for the mobile
  dictation shim). There is no hook installed where a hand-mapping could live.

Net: the only multiline affordance in a τ-mux pane is `\` + Enter.

*(Raised at a general level in `improvement_analysis_2026-08.md` §4.2; repeated here
because it is squarely on the Claude Code path and Phase 0 acts on it.)*

---

### F4 — Terminal identity is unset and the launcher's identity leaks through (HIGH)

`src/bun/pty-manager.ts:136-158` builds the child env as `{ ...process.env, … }` and sets
`TERM`, `COLORTERM`, `LANG`, `HYPERTERM_*`, `HT_SOCKET_PATH` — but **never
`TERM_PROGRAM`**, and never scrubs the inherited one.

Two consequences:

1. **Dev builds lie.** `bun start` from iTerm2 propagates `TERM_PROGRAM=iTerm.app`,
   `TERM_PROGRAM_VERSION`, `ITERM_SESSION_ID`, `ITERM_PROFILE`, `LC_TERMINAL`,
   `TERM_SESSION_ID` straight into every pane. Claude Code then believes it is inside
   iTerm2 — it will claim Shift+Enter works natively (it does not here), and
   `/terminal-setup` will happily write iTerm2 preferences and toggle
   `com.googlecode.iterm2 AllowClipboardAccess` for a terminal the user is not using.
2. **Packaged builds are anonymous.** Launched from Finder there is no `TERM_PROGRAM` at
   all, so Claude Code falls to its generic path.

Related, same function: `LC_ALL: process.env["LC_ALL"] || ""` writes an empty `LC_ALL`
into the environment rather than leaving it unset. Harmless in practice on macOS, but it
is the one env var the project's own locale-robustness rule cares about — worth deleting
the key instead of emptying it.

---

### F5 — Claude Code's notifications are received and thrown away (HIGH, cheap)

`src/views/terminal/surface-manager.ts:2432-2459` registers an OSC **9** handler that
parses only the ConEmu `9;4` progress form and `return false` for everything else. With
no other OSC 9 handler registered, plain `OSC 9 ; <message>` — **exactly what Claude
Code's `iterm2` notification channel emits** — is parsed, rejected, and discarded.

And `grep -rn "onBell" src/` returns nothing, so the `terminal_bell` channel is equally
dead.

So both of Claude Code's built-in notification channels are no-ops in τ-mux — in an app
that already owns a notification centre, a sidebar ticker, sounds, and a Telegram bridge.
This is the cheapest high-value fix in the report: two handlers, both routed into
machinery that already exists.

---

### F6 — Glyph widths are wrong for Claude Code's own UI (MEDIUM)

`@xterm/addon-unicode11` is not in `package.json` and not loaded. xterm's built-in
Unicode v6 width table misjudges the characters Claude Code's transcript is built out of
— `✳ ⏺ ✻ ⎿ ⧉`, emoji in tool output, powerline glyphs in the statusline — producing
column drift, and drift plus cursor-relative repainting produces visible corruption.

---

### F7 — Claude Code cannot see the theme it is running in (MEDIUM)

Claude Code drives `DECSET 2031` (theme-change notification). xterm 6.0.0 does not
implement it — zero occurrences of `2031` in the bundle. xterm *does* answer an OSC 11
background-colour query, which is the fallback path, so this is degradation rather than
breakage.

Worth calling out because τ-mux is unusually well placed here: it ships 12 theme presets
and knows each pane's exact palette. Implementing `2031` + the `CSI ? 997 ; {1,2} n`
notification on top of the existing theme pipeline would make Claude Code the only agent
CLI that re-themes itself when you switch τ-mux presets — including **per pane**, which
no other terminal can express.

---

### F8 — Every byte of Claude Code output is parsed twice in the main process (MEDIUM)

`src/bun/session-manager.ts:113-131` constructs a `@xterm/headless` Terminal +
`SerializeAddon` **per surface, unconditionally**, and `pty.onStdout`
(`session-manager.ts:134-147`) writes every chunk into it *and* appends to a 64 KB raw
history array.

The headless mirror exists only so web-mirror clients rejoining mid-stream get a
state-correct replay. When the web mirror is off — the default — it is pure overhead, on
the same process that runs the metadata poller, the socket server, and the Claude hooks.
Claude Code is a chatty producer; this is the wrong place to pay double.

Note the outbound side is already excellent: `NativeStdoutCoalescer` is genuinely
well-designed (microtask flush when quiet, timer when busy, soft cap bypass). No change
needed there.

---

### F9 — Ergonomic gaps a Claude Code user hits daily (MEDIUM/LOW)

- **No drag-and-drop of files onto a terminal pane.** `dragover`/`drop` handlers exist on
  `agent-panel.ts:559-568` and `sidebar.ts:2447-2477` but not on terminal panes. Dropping
  a screenshot to get its quoted path is standard in iTerm2/Ghostty/Terminal.app and is
  how people feed images to Claude Code.
- **No paste size guard.** `handlePaste` writes whatever the clipboard holds, unbounded,
  synchronously.
- **No OSC 52.** Remote copy from nvim/tmux over SSH fails silently.
- **`scrollbackLines` is ignored at pane construction.** `surface-manager.ts:2364`
  hardcodes `scrollback: 10000`; the setting is only honoured later, in `applySettings`
  (`surface-manager.ts:1361`). A pane created after startup starts at 10 000 regardless of
  the user's setting until the next settings change.

---

### F10 — The unclaimed differentiator: τ-mux as Claude Code's IDE (OPPORTUNITY)

Verified in the binary: Claude Code auto-discovers an IDE by scanning a lock directory
for `*.lock` files, then connects to `ws://host:<port>` as an MCP server and sends
`ide_connected`. The lock payload is
`{ workspaceFolders, port, pid, ideName, useWebSocket, runningInWindows, authToken }`;
discovery is also forceable with `CLAUDE_CODE_SSE_PORT`, and gated by `autoConnectIde` /
`CLAUDE_CODE_AUTO_CONNECT_IDE`. The methods it speaks include **`openDiff`**,
**`selection_changed`**, **`at_mentioned`**.

τ-mux already has every part needed: a WebSocket server (`src/bun/web-server.ts`), a
CodeMirror editor pane with `editor.open` / `editor.split` / `editor.save` RPC
(`src/bun/rpc-handlers/editor.ts:14-60`), a pane layout to host the diff, and a lock-file
+ token pattern it already uses for the socket server.

**No terminal is a Claude Code IDE host today.** Wiring this makes `claude` in a τ-mux
pane show its diffs in a real editor pane, take the user's editor selection as context,
and accept `@`-mentions from the file explorer — and that claim is not available to
Ghostty, iTerm2, Warp, or Kitty, because none of them has an editor.

---

## The plan

Effort: **XS** ≈ under an hour · **S** ≈ half a day · **M** ≈ 2–4 days · **L** ≈ a week+.

### Phase 0 — the correctness floor

Everything here is a bug, not a feature. Ship as one release.

| # | Work | Files | Effort |
|---|---|---|---|
| 0.1 | **Bracketed paste.** Add `src/shared/bracketed-paste.ts` — a pure `bracketText(text, enabled)` doing `\r\n\|\n → \r` normalisation, `ESC[200~`/`ESC[201~` wrapping, and stripping any `ESC[201~` inside the payload. Track `bracketedPasteMode` per surface: the bun side already parses every byte through the headless mirror, so read it from there (`headless.modes.bracketedPasteMode`) rather than adding a second parser. Route `handlePaste` **and** `surface.send_text` through it. | `src/shared/bracketed-paste.ts` (new), `src/bun/index.ts:2094-2097`, `src/bun/rpc-handlers/surface.ts:258-266`, `src/bun/session-manager.ts` | S |
| 0.2 | **Paste size guard.** Cap at ~1 MB; above a threshold (say 100 KB or 500 lines) show the existing confirm dialog before writing. | `src/bun/index.ts:2058`, `prompt-dialog.ts` | XS |
| 0.3 | **SIGWINCH dedupe.** Store `lastCols/lastRows` in `SessionManager.resize` and return early when unchanged; same guard in `PtyManager.resize`. Keep the sideband resize event on real changes only. | `src/bun/session-manager.ts:309`, `src/bun/pty-manager.ts:255` | XS |
| 0.4 | **`macOptionIsMeta: true`.** Verify ⌥Enter → `ESC CR` in a live pane before calling it done. | `src/views/terminal/surface-manager.ts:2354` | XS |
| 0.5 | **Shift+Enter hand-mapping.** Install `attachCustomKeyEventHandler` on the native terminal: `keydown` + `Enter` + `shiftKey` → write `\n` (0x0A) via `onStdin`, return `false`. Empirically confirm the byte against `claude` in a pane — do not ship on assumption. This is the stopgap until Phase 2.1. | `src/views/terminal/surface-manager.ts:2387` | XS |
| 0.6 | **Terminal identity.** Set `TERM_PROGRAM=tau-mux` + `TERM_PROGRAM_VERSION=<package version>`; `delete` the inherited `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERM_SESSION_ID`, `ITERM_SESSION_ID`, `ITERM_PROFILE`, `LC_TERMINAL`, `LC_TERMINAL_VERSION` before applying ours. Drop the `LC_ALL: ""` key rather than writing an empty value. | `src/bun/pty-manager.ts:136-158` | XS |
| 0.7 | **Honour `scrollbackLines` at construction.** | `src/views/terminal/surface-manager.ts:2364` | XS |

**Acceptance:** a new test file `tests/bracketed-paste.test.ts` proving wrap /
normalisation / nested-terminator stripping / mode-off passthrough; a resize test proving
N identical `resize()` calls produce exactly one `terminal.resize`; and a manual pass in a
live pane — paste a 20-line block into `claude` and see one `[Pasted text …]` chip.

---

### Phase 1 — stop dropping Claude Code's signals

| # | Work | Effort |
|---|---|---|
| 1.1 | **OSC 9 notifications.** In the existing OSC 9 handler, when the payload is *not* `9;4`, treat it as a notification: route to the notification centre + sidebar ticker + sound + (if enabled) Telegram forward, tagged with the surface. Gate behind a setting alongside `terminalOsc94Enabled`. Instantly makes `preferredNotifChannel: iterm2` work — and work better than in iTerm2, because it reaches the phone. | XS |
| 1.2 | **BEL.** Subscribe `term.onBell` → same pipeline, throttled. Makes `terminal_bell` live. | XS |
| 1.3 | **Unicode 11.** Add `@xterm/addon-unicode11`, load it, set `term.unicode.activeVersion = "11"`. Add to the web client too, for parity. | XS |
| 1.4 | **Focus events.** Verify that a window blur actually produces an xterm focus-out (`ESC[O`) while a pane holds DOM focus; if not, forward the existing `window` blur/focus listeners (`index.ts:2847-2853`) into `term.blur()`/`term.focus()`. Without this Claude Code thinks it is always focused and suppresses notifications. | XS–S |
| 1.5 | **DECSET 2031 + theme reporting.** Register a private-mode handler for 2031 and emit `CSI ? 997 ; 1 n` (dark) / `; 2 n` (light) when the pane's theme changes; make sure OSC 11 queries answer with the pane's real background. Wire into the existing theme-preset pipeline so switching presets re-themes running Claude sessions. | S |
| 1.6 | **OSC 52.** Add `@xterm/addon-clipboard`, gated by a setting (default: read-blocked, write-allowed). | XS |

**Acceptance:** with `preferredNotifChannel` set to `iterm2`, then `terminal_bell`, a
finished Claude turn in an unfocused pane produces a τ-mux notification in both cases.
Switching theme preset visibly re-themes a live `claude` session.

---

### Phase 2 — structural

| # | Work | Effort |
|---|---|---|
| 2.1 | **Bump to `@xterm/xterm` 6.1.0-beta** for the real Kitty keyboard protocol (xterm.js PR #5600). Retire the 0.5 hand-mapping once it lands. Put it behind a setting for one release so a beta regression is one toggle away from a fix. This is what gets τ-mux onto Claude Code's "natively supported" list. | S–M |
| 2.2 | **OSC 133 shell integration** as an *optional* layer, installed the way the `ht` CLI already is — the poller stays the zero-config baseline. Gives command boundaries and exit codes as facts instead of heuristics, which is what `AutoContinueEngine` and `claude-auto-approve` are currently guessing at over a byte stream. Follow-on: `ht blocks last --json`. | M |
| 2.3 | **Gate the headless mirror.** Construct lazily on first web-mirror client (replaying the 64 KB raw history to warm it) and dispose when the last disconnects. Halves per-byte main-process cost in the default configuration. | S |

---

### Phase 3 — the differentiator: τ-mux as Claude Code's IDE

The payoff item. Sequence it after Phases 0–1 — an IDE bridge on top of a terminal that
mangles pastes is the wrong order.

| # | Work | Effort |
|---|---|---|
| 3.1 | **Lock file + WS MCP server.** Reuse `web-server.ts` for the socket and the existing token pattern for `authToken`. Write `<claude-config>/ide/<port>.lock` with `{workspaceFolders, port, pid, ideName: "τ-mux", useWebSocket: true, authToken}`; remove it on shutdown. Announce `ide_connected`. | M |
| 3.2 | **`openDiff`** → render in a split editor pane via the existing `editor.open`/`editor.split` RPC. This is the headline: Claude Code's edits reviewed in a real editor, in the same window, without VS Code. | M |
| 3.3 | **`selection_changed` / `at_mentioned`** from the editor pane and from terminal selections, plus `@`-mention from the sidebar file explorer. | S |
| 3.4 | **Clickable file references.** Extend the web-links addon with a `path:line` matcher that opens the editor pane at that line — Claude Code prints these constantly. | S |

---

### Phase 4 — ergonomics

| # | Work | Effort |
|---|---|---|
| 4.1 | **Drag-and-drop onto terminal panes** → insert shell-quoted paths (multi-file = space-separated), matching iTerm2/Ghostty. The main way people hand screenshots to Claude Code. | S |
| 4.2 | **A `claude`-aware pane affordance** — once OSC 133 lands, a "copy last block" / "re-run" control in the pane bar. | S |

---

## Sequencing

```
Phase 0  ─────────────►  one release, all bugs.  Do not batch with features.
Phase 1  ─────────────►  next release.  Every item is XS/S and independently shippable.
Phase 2.1 ────────────►  beta bump, behind a setting, one release soak.
Phase 2.2/2.3 ────────►  after the beta soak.
Phase 3  ─────────────►  the differentiator.  Needs 0 + 1 landed to be credible.
Phase 4  ─────────────►  opportunistic.
```

## Explicitly not doing

- **A faster renderer.** WebView; Ghostty/Kitty win on raw text throughput permanently.
- **Kitty graphics / Sixel.** Claude Code emits no images. Unrelated to this goal.
- **Replacing the metadata poller with shell integration.** OSC 133 is an *additive*
  layer; the poller's zero-config property is a real asset.
- **Touching the native Claude pane.** It is ahead of the market already.

## Project chores attached to this work

- `bun run bump:patch|minor` before each commit (per `CLAUDE.md`).
- New settings (OSC 9 notifications, OSC 52, Kitty toggle, IDE bridge) must land in
  `AppSettings` + `DEFAULT_SETTINGS` + `validateSettings` + `SettingsPanel`, and be
  documented in `website-doc` **EN and FR** in the same change — `tests/docs-coverage.test.ts`
  fails otherwise.
- Same for any new `ht` command (`ht blocks`, `ht ide status`).
- Track progress in `doc/tracking_best_terminal_for_claude_code.md`, with commit ids.
- Log website-doc deltas in `doc/changes_to_document.md` as they accumulate.
