# Tracking — best terminal for Claude Code

Plan: `doc/plan_best_terminal_for_claude_code.md`
Started 2026-08-08 from v0.11.0.

---

## Phase 0 — correctness floor ✅

All seven items landed, plus two Phase-1 items that came along with the
extraction they required.

| # | Item | Status |
|---|---|---|
| 0.1 | Bracketed paste | ✅ |
| 0.2 | Paste size guard | ✅ |
| 0.3 | SIGWINCH dedupe | ✅ |
| 0.4 | `macOptionIsMeta` | ✅ |
| 0.5 | Shift+Enter mapping | ✅ |
| 0.6 | Terminal identity env | ✅ |
| 0.7 | `scrollbackLines` at construction | ✅ |
| 1.1 | OSC 9 notifications | ✅ (pulled forward) |
| 1.2 | BEL notifications | ✅ (pulled forward) |

### Deviations from the plan

**The Shift+Enter byte was wrong in the plan.** The plan said `0x0A`
(Ctrl+J) "to be verified". Verified against the shipped Claude Code
binary (`~/.local/share/claude/versions/2.1.224`): `/terminal-setup`
installs `{"key":"shift+enter", "command":
"workbench.action.terminal.sendSequence", "args":{"text":"\r"}}`
for VS Code, and runs PlistBuddy to set iTerm2's `useOptionAsMetaKey`.
The sequence is **`ESC CR`**, not `0x0A`. Implemented as `ESC CR`, which
also makes Shift+Enter and ⌥Enter agree — the latter already produces
those bytes now that `macOptionIsMeta` is on.

**`surface.send_text` is *not* blanket-bracketed.** The plan said to
route it through the framing helper. Doing so would have broken the
`ht send "npm run dev\n"` contract: with DEC 2004 on, a bracketed
payload lands in the app's line editor instead of executing. Split the
verbs instead — `ht send` types, **`ht paste` pastes** — which is also a
clearer statement of intent for scripts driving an agent CLI. `ht paste`
maps to `surface.send_text` with `paste: true`; no new RPC method.
A `--paste` *flag* was rejected because `parseFlags` is greedy and would
swallow the text as the flag's value.

**Marker stripping added beyond the plan.** `framePaste` strips embedded
`ESC[200~`/`ESC[201~`. xterm.js does not do this. Without it, a crafted
clipboard payload closes its own bracket and the remainder is
interpreted as *typing* — arbitrary command execution from a paste.

**Version constant moved.** `TERM_PROGRAM_VERSION` needs the app version
on the bun side, and importing an RPC-handler module from `pty-manager`
is the wrong layering. Added `APP_VERSION` to `src/shared/brand.ts`,
taught `scripts/bump-version.ts` to stamp it (7th file), and pinned the
copies together with `tests/version-consistency.test.ts` so a partial
bump fails CI rather than shipping a lie.

**Module-size ratchet promoted (+15 / +12 / +27).** Six new modules were
extracted first — `bracketed-paste`, `terminal-key-encoding`,
`paste-host`, `terminal-input`, `terminal-options`, `terminal-osc` — and
`src/bun/index.ts` came out 14 lines *smaller* than its old ceiling. The
residual growth is code in the module that owns the concern: the RPC
forwarder in `index.ts`, workspace-progress bridging in
`surface-manager.ts`, two form fields in `settings-panel.ts`. Promoted
per the script's own instruction rather than extracting artificially.

### New modules

| Module | Why |
|---|---|
| `src/shared/bracketed-paste.ts` | Framing, newline normalisation, marker stripping, size policy. Pure. |
| `src/shared/terminal-key-encoding.ts` | Shift+Enter → `ESC CR`. Pure, shared native + web. |
| `src/bun/paste-host.ts` | Clipboard read + size policy, injectable environment. |
| `src/views/terminal/terminal-input.ts` | Installs the key-override hook (and the `preventDefault` that makes it work). |
| `src/views/terminal/terminal-options.ts` | xterm construction options with their rationale. |
| `src/views/terminal/terminal-osc.ts` | OSC 0/2/9 + BEL, including the OSC 9 dialect split and the bell throttle. |

### Tests added

`tests/bracketed-paste.test.ts` (28) · `tests/terminal-osc.test.ts` (13)
· `tests/terminal-key-encoding.test.ts` (7) ·
`tests/pty-terminal-identity.test.ts` (5) ·
`tests/session-resize-dedupe.test.ts` (6) ·
`tests/version-consistency.test.ts` (5).

Two are live-PTY end-to-end rather than unit tests, deliberately: the
original defects were both "the intent was right, the wiring never ran".
`bracketed-paste` drives a real shell into DEC 2004 and asserts the
framing flips; `pty-terminal-identity` spawns a shell with a faked
iTerm2 environment and reads back what the child actually sees.

### Baseline

3485 pass / 0 fail (was 3472 / 0), `tsc --noEmit` clean, all five audit
scripts clean.

**Commit:** `a1fc7b4a` (branch `feat/claude-code-terminal`)

### Not yet verified by hand

`bun start` + a live `claude` pane: paste a 20-line block and confirm one
`[Pasted text …]` chip; Shift+Enter inserts a newline; `⌥`+Enter same;
`preferredNotifChannel` `iterm2` and `terminal_bell` both raise a τ-mux
notification.

---

## Phase 1 — signals ✅

| # | Item | Status |
|---|---|---|
| 1.1 | OSC 9 notifications | ✅ (Phase 0 commit) |
| 1.2 | BEL notifications | ✅ (Phase 0 commit) |
| 1.3 | Unicode 11 widths | ✅ |
| 1.4 | Focus events | ✅ — no change needed, see below |
| 1.5 | DECSET 2031 + theme reporting | ✅ |
| 1.6 | OSC 52 clipboard | ✅ |

### 1.4 — the verify came back "nothing to fix"

This was scoped as *verify, then fix if needed*. It does not need fixing,
and the reasoning is worth recording so nobody re-opens it:

- xterm's `_onTextAreaBlur` already emits `ESC[O` when the application
  has enabled `DECSET 1004`, and `_onTextAreaFocus` emits `ESC[I`. Both
  are bound to the hidden helper textarea, not to the window.
- WebKit fires `blur` on the active element when the window loses key
  status, and `focus` when it regains it — the same event pair that
  makes the existing `window` blur/focus listeners at `index.ts` work.
- Switching workspace moves DOM focus via `focusSurface`, so a pane
  hidden behind another workspace has genuinely lost focus and reports
  it. There is no path where a background pane keeps focus.

Adding an explicit `term.blur()` on window blur would have been actively
wrong: it would leave nothing focused when the window came back, so the
first keystroke after alt-tab would go nowhere.

### 1.3 — no setting, deliberately

Unicode 11 widths are applied unconditionally rather than behind a
toggle. xterm's built-in table is Unicode v6 (2010); every terminal
these programs are actually tested against ships an up-to-date one. A
width disagreement is not cosmetic — the program positions its cursor by
counting columns, so one wrong width shreds every subsequent redraw. v6
is not a preference anyone holds.

Wired into the web mirror too, through the documented vendor-asset path
(`VENDOR_MAP` → `asset-loader` export → `page.ts` script → electrobun
copy rule): the mirror is how you check on an agent from a phone, and
garbled emoji there is exactly as unreadable.

### 1.6 — OSC 52 is write-only, permanently

Writes are the useful direction (a yank in nvim over SSH reaching the
local clipboard) and are behind `terminalOsc52WriteEnabled`, default on.
Reads are refused with no setting: OSC 52's read turns any process with
terminal access into a clipboard exfiltrator, running unprompted and
leaving nothing on screen. xterm ships it disabled, iTerm2 prompts,
Ghostty refuses. A toggle here would be a toggle whose only effect is to
weaken the user.

### 1.5 — initial state is not reported

The spec fires the notification *on change*. A program wanting the
current palette asks with an OSC 11 query, which xterm already answers
from the pane's configured background — so nothing needed inventing. The
CSI handlers return `false` always: returning `true` would consume
`CSI ? 1049 ; 2031 h` and silently break the alternate screen.

### New modules

| Module | Why |
|---|---|
| `src/views/terminal/terminal-clipboard.ts` | OSC 52 provider (write-only) + Unicode 11 install. |
| `src/views/terminal/terminal-theme-report.ts` | DECSET 2031 subscription tracking + luminance classification. |

### Tests added

`tests/terminal-clipboard.test.ts` (8) ·
`tests/terminal-theme-report.test.ts` (16).

### Baseline

3509 pass / 0 fail, `tsc --noEmit` clean, five audits clean, `bun start`
boots (socket bound, audits pass, shell spawned).

**Commit:** `184929c5`

---

## Phase 2 — structural

| # | Item | Status |
|---|---|---|
| 2.1 | xterm 6.1.0-beta (Kitty keyboard) | ⛔ **not landed** — see below |
| 2.2 | OSC 133 shell integration + `ht blocks` | ✅ |
| 2.3 | Gate the headless mirror | ✅ |

**Commit:** `3945ce72` (v0.12.0)

### 2.1 — not landed, and why

The beta is real and it does what the plan says: `npm view` confirms
`beta: 6.1.0-beta.292`, and the shipped bundle contains a `KittyKeyboard`
class driven by `coreService.kittyKeyboard.flags`. It would supersede the
Shift+Enter hand-mapping with proper CSI-u for every modifier.

Not landed for three reasons, in order of weight:

1. **The plan's own de-risking does not work.** It says "put it behind a
   setting for one release so a beta regression is one toggle away". You
   cannot put an npm dependency version behind a runtime toggle without
   bundling both copies — ~600 KB of duplicate terminal engine. The
   escape hatch that made the risk acceptable is not available.
2. **It collides with what Phase 1 just shipped.** The beta implements
   DECSET 2031 natively (`vtExtensions.colorSchemeQuery`,
   `decPrivateModes.colorSchemeUpdates`). `terminal-theme-report.ts`
   observes the same mode and returns `false` so xterm's handler also
   runs — after the bump, *both* would report and the program gets
   duplicate DSR replies. That needs deleting our implementation, not
   just bumping a version.
3. **The value already landed.** Shift+Enter — the case with a
   vendor-published answer and the one users actually hit — works. What
   remains is other modifier combinations.

**Correction to point 3, found later.** Claude Code *does* speak the
Kitty keyboard protocol: the binary defines `CSI > 1 u` (push, flags=1)
and `CSI < u` (pop), alongside `CSI > 4 ; 2 m` (modifyOtherKeys level 2).
xterm 6.0 implements neither, which is why the hand-mapping is currently
load-bearing — but it means the beta bump would deliver real,
protocol-native disambiguation rather than nothing. The item is worth
more than this entry originally implied.

**Extra migration step that discovery adds:** with Kitty active, xterm
will encode Shift+Enter itself, and `installKeyOverrides` would shadow it
by intercepting first and returning `false`. The override must become
conditional on the application *not* having pushed a Kitty flag set —
delete it outright only if you are certain every agent CLI opts in.

**Still not landed here**, for the unchanged reason: it is a beta of the
rendering engine, it needs the visual regression suites
(`bun run test:full-suite`, `test:native:design-review`) rather than the
unit suite, and shipping it as the last act of a long session — on top of
seven other terminal changes — is the highest-risk thing available. It
deserves its own change with its own review.

**When it is taken up:** delete `src/views/terminal/terminal-theme-report.ts`
and its wiring, delete `src/shared/terminal-key-encoding.ts` and
`terminal-input.ts`, set `vtExtensions.colorSchemeQuery`, and re-run the
native design-review suite (`bun run test:native:design-review`) — the
bump touches the renderer, and the unit suite does not cover rendering.

### 2.2 — two bugs only real shells revealed

Both were found by driving a live zsh, not by unit tests, and both are
now regression-tested:

- **Powerlevel10k rebuilds hook arrays asynchronously**, seconds after
  install, silently dropping our `preexec`. Prompts kept being marked
  while every `C`/`D` vanished — indistinguishable from "the integration
  doesn't work". The script re-arms on every prompt now.
- **p10k emits its own OSC 133**, so each command is announced twice and
  a naive parser splits every block in two (one with the command text
  and no exit code, one with the output and exit code but no text). A
  repeated `C` is now a no-op.

Verified end-to-end on real zsh (p10k + syntax-highlighting +
autosuggestions) and real bash.

### 2.3 — the trap in gating the mirror

Paste framing was reading DEC 2004 off the headless mirror, so gating
the mirror would have silently stopped ⌘V bracketing — undoing the
headline fix of Phase 0. Split first: `DecPrivateModeTracker` scans the
PTY stream for the modes the *input* path needs, which is both cheaper
than a terminal emulator and correct layering.

---

## Phase 3 — IDE host (partial)

| # | Item | Status |
|---|---|---|
| 3.1 | Lock file + WS MCP server | ✅ |
| 3.2 | `openDiff` review | ✅ |
| 3.3 | `selection_changed` / `at_mentioned` | ◐ transport only |
| 3.4 | Clickable `path:line` references | ✅ |
| 4.1 | Drag & drop onto a terminal pane | ✅ |

**Commits:** `b3c3b0e5` (3.4 + 4.1, v0.13.0) · `f541155e` (IDE bridge, v0.14.0)

### The blocker was not what it looked like

The first attempt failed with **"Credit balance is too low"**, which read
as an account problem. It was not: `ANTHROPIC_API_KEY` is set on this
machine and *takes precedence over the claude.ai login*. Claude Code
even says so in a warning line that was easy to skim past. With
`env -u ANTHROPIC_API_KEY`, `claude` runs normally.

Worth recording because the misdiagnosis cost a whole phase: the error
named a symptom of the wrong subsystem.

### The protocol, recovered by observation

`scripts/ide-spike.ts` — an instrumented WS server that logs every
header and frame — answered all three open questions on the first
successful connect:

| Unknown | Answer |
|---|---|
| Auth header | `x-claude-code-ide-authorization: <authToken>` |
| Subprotocol | `Sec-WebSocket-Protocol: mcp` |
| `useWebSocket` key | `transport: "ws"` in the lock body |

Plus the full sequence: `initialize` (client offers
`protocolVersion: "2025-11-25"`, capabilities `roots.listChanged` +
`elicitation`) → `notifications/initialized` → `ide_connected`
(a notification carrying Claude's pid) → `tools/list`.

And the `openDiff` contract, read out of the binary and pinned by tests:
Claude sends `{old_file_path, new_file_path, new_file_contents, tab_name}`
and decodes the reply as `[0].text` = verdict, `[1].text` = content to
apply — `FILE_SAVED` (+content) / `DIFF_REJECTED` / `TAB_CLOSED`.

### Verified end to end

1. `IdeServer` unit suite — 28 tests, real WebSocket round-trips.
2. A real interactive `claude` against the `IdeServer` class:
   `[ide] connected (claude pid 9880)`.
3. **The shipped app**: `bun start`, then a real interactive `claude` →
   `[ide] connected (claude pid 24699)` in the app's own log.

### Two things learned the hard way

- **`claude -p` never connects to an IDE.** Print mode skips discovery
  entirely. Every attempt to verify with `-p` produced a silent
  non-result that looked like a protocol bug.
- **The lock is written before any pane exists**, so `workspaceFolders`
  started empty and stayed empty — and Claude reads the lock when *it*
  launches, always later. `refreshLock()` now runs on layout changes.

### 3.3 — transport only, deliberately

`notifySelectionChanged` and `notifyAtMentioned` exist and are wired to
the socket, but nothing calls them yet: the editor pane has no selection
event to forward, and `@`-mention needs a file-explorer affordance. The
protocol half is done and tested; the UI half is a separate change with
its own design questions.

### `executeCode` is not offered

It means "run this in the active Jupyter kernel". τ-mux has no such
notion, and advertising a tool that fails every call is worse than
omitting it — the model would keep choosing it.

### 3.4 / 4.1 — what did land

Both are independent of the IDE protocol and both are real Claude Code
ergonomics:

- **`path:line` links.** The matcher is tested hardest on what must *not*
  match, because a link provider that underlines prose steals the click.
  `see line 42` and `open README` stay plain; `(src/a.ts)` and
  `at foo (/abs/x.ts:88:7)` resolve.
- **Drag & drop** inserts blanket single-quoted paths, verified by
  round-tripping a hostile filename through a real `/bin/sh` rather than
  by inspecting the output string. Inserted as a paste, since a macOS
  filename may legally contain a newline.
