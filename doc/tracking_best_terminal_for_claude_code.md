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

## Phase 2 — structural ⬜

## Phase 3 — IDE host ⬜
