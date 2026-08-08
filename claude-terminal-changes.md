# What changed for Claude Code in τ-mux

**v0.11.0 → v0.14.0** · branch `feat/claude-code-terminal` · 2026-08-08
Plan: [`doc/plan_best_terminal_for_claude_code.md`](doc/plan_best_terminal_for_claude_code.md) ·
Log: [`doc/tracking_best_terminal_for_claude_code.md`](doc/tracking_best_terminal_for_claude_code.md)

---

## The short version

τ-mux had the deepest Claude Code *integration* of any terminal, sitting on
a *terminal layer* that dropped or corrupted several of the signals Claude
Code actually uses. Claude Code drives eleven DEC private modes; τ-mux
honoured some, ignored others, and swallowed one it already intercepted for
a different purpose.

That layer is now fixed, and τ-mux went one step further: it is a **Claude
Code IDE host**. Claude's diffs open in an editor pane and the approval
reaches your phone.

Everything below was verified against Claude Code 2.1.225 — the shipped
binary and live sessions — not against documentation.

---

## Things that were broken and now work

### Pasting

**Before.** Pasting a 20-line block into Claude Code submitted 20 separate
prompts.

⌘V is intercepted in the webview and handled natively (the WebView can't
read the system clipboard), which bypassed xterm's own `paste()` — the only
code path that frames a paste. So `DECSET 2004` was never honoured, despite
Claude Code turning it on.

**Now.** Pastes are framed with `ESC[200~`…`ESC[201~` when the running app
asks for it, and `\r\n` / `\n` are normalised to `\r`. Claude Code collapses
the paste into a single `[Pasted text #1 +19 lines]`.

Two extras beyond a straight fix:

- **Embedded paste markers are stripped.** Without that, a crafted clipboard
  payload closes its own bracket and everything after it is interpreted as
  *typing* — arbitrary command execution from a paste. xterm.js does not do
  this; τ-mux does.
- **A size policy.** Over ~50 KB or 500 lines asks first; over 1 MB refuses.
  Refusal rather than truncation, because outside bracketed-paste mode a
  truncated paste is a truncated *command*, and half of an `rm -rf` is still
  a command.

### Shift+Enter and ⌥Enter

**Before.** Neither produced a newline. `\` + Enter was the only multiline
affordance.

**Now.** Both send `ESC CR`.

Not a guess: Claude Code's own `/terminal-setup` installs
`{"key":"shift+enter", …, "args":{"text":"\r"}}` for VS Code and flips
iTerm2's `useOptionAsMetaKey` to make ⌥Return produce the same two bytes.
τ-mux now matches both. (The plan said `0x0A`; that was wrong.)

### Notifications

**Before.** Both of Claude Code's notification channels did nothing here.
`preferredNotifChannel: iterm2` emits `OSC 9 ; <message>` — τ-mux's OSC 9
handler decoded only ConEmu `9;4` progress and dropped everything else.
`terminal_bell` emits `BEL` — there was no `onBell` subscriber at all.

**Now.** Both route through `notification.create`, the same path as
`ht notify` — so they get the overlay, the sidebar, the sound, and Telegram
fan-out. BEL is throttled to one per pane per 5 s so a program ringing in a
loop can't flood the centre.

### Terminal identity

**Before.** `TERM_PROGRAM` was never set, and `...process.env` copied the
*launching* terminal's identity into every pane. A dev build started from
iTerm2 told Claude Code it **was** iTerm2 — so it offered iTerm2-specific
setup, including writing iTerm2 preference files, for an app you weren't
looking at.

**Now.** `TERM_PROGRAM=tau-mux` plus a version, and 20 inherited identity
variables (`ITERM_SESSION_ID`, `KITTY_WINDOW_ID`, `WEZTERM_PANE`, …) are
scrubbed before ours are set.

### Glyph widths

**Before.** xterm's built-in width table is Unicode v6 (2010), which
mis-measures emoji, powerline separators, and the box-drawing vocabulary
agent CLIs build their transcripts from.

This is not cosmetic: the program positions its cursor by counting columns,
so one wrong width puts every subsequent redraw a cell off and the UI
shreds.

**Now.** Unicode 11 widths, applied unconditionally — v6 is not a preference
anyone holds — on both the native pane and the web mirror.

### Switching workspaces no longer makes every agent repaint

**Before.** `applyLayout()` called `onResize` for every pane on every full
layout pass, and nothing downstream compared dimensions. Each redundant call
meant `TIOCSWINSZ` → SIGWINCH → a full Ink repaint.

**Now.** Deduped where the PTY, the headless mirror and the fd-5 sideband
event share one definition of "actually changed".

---

## Things that are new

### τ-mux is a Claude Code IDE host

The headline. Claude Code can attach to an editor and gain what a terminal
cannot give it: showing a proposed edit as a **diff** and waiting for a human
verdict. It discovers one by scanning `~/.claude/ide/` for a lock file.

τ-mux now advertises itself there. Every other host for that protocol is an
editor. τ-mux is a terminal that *contains* an editor pane, a notification
centre and a Telegram bridge — so `claude` in one pane puts its diff in the
pane next door and asks for an approval **that reaches your phone**.

| Tool | Behaviour |
|---|---|
| `openDiff` | Opens the proposal in an editor pane, raises an ask-user prompt. Accept applies; reject / cancel / timeout / internal error all reject. |
| `close_tab` | Claude gave up on a diff. The pane is left alone — it's yours, and yanking it mid-read is worse than a stale tab. |
| `getDiagnostics` | Always reports none. τ-mux runs no language server; inventing diagnostics would be worse than saying so. |

`executeCode` is deliberately **not** offered — it means "run in the active
Jupyter kernel", and advertising a tool that fails every call would leave the
model choosing it forever.

**Security.** Loopback only, ephemeral port, a token regenerated each launch
in a `0600` lock file that is removed on exit.

**Reject is the default.** A review resolves to "apply" only on an explicit
yes. An edit is never applied because the review machinery failed.

Controlled by `ideBridgeEnabled` (on by default).

### Command blocks — `ht blocks`

τ-mux's metadata poller reads real pids through libSystem, so cwd,
foreground command and ports work in any shell with zero config. That stays
the baseline. What it structurally *cannot* know is where one command ends
and the next begins, or what a command returned — only the shell knows.

`ht shell-integration install` adds OSC 133 marks, and `ht blocks` then
reports facts instead of inference:

```bash
ht blocks                    # last finished command, with its output
ht blocks list --limit 10    # recent history
ht blocks current            # what's running right now
```

```json
{ "command": "bun test", "exit_code": 1, "duration_ms": 4200, "output": "…" }
```

The rc snippet sources `$HT_SHELL_INTEGRATION_PATH`, so it is inert outside
τ-mux — it cannot break your shell in iTerm2, over SSH, or in CI — and it
survives the `.app` moving.

### Clickable `path:line`

Agent CLIs, compilers, test runners and stack traces print these constantly.
They were dead text you retyped. They now open the editor pane.

The matcher is tested hardest on what must **not** match: a link provider
that underlines prose steals the click. `see line 42` and `open README` stay
plain text.

### Drag and drop onto a terminal pane

Standard in iTerm2, Terminal.app, Ghostty and WezTerm; missing here. It's
also how people hand a screenshot to an agent.

Paths are blanket single-quoted (verified by round-tripping a hostile
filename through a real `/bin/sh`, not by inspecting the output string) and
inserted as a *paste*, since a macOS filename may legally contain a newline
and typing that would submit half a command line.

### Theme follows the terminal

Claude Code drives `DECSET 2031` to be told when the palette flips
dark/light. xterm 6.0 doesn't implement it, so the request was parsed and
forgotten.

τ-mux now answers — and is unusually well placed to: the palette is a
setting with twelve presets and the thing being reported on is a **pane**.
Switching preset re-themes running agent CLIs in place, per pane, which no
other terminal can express.

### `ht paste`

`ht send` types — scripts depend on `ht send "npm run dev\n"` executing.
`ht paste` pastes: framed with bracketed paste, so a multi-line prompt
reaches an agent CLI as **one message** instead of one submit per line.

### OSC 52 clipboard

A yank in nvim or tmux over SSH now reaches your local clipboard.

Write-only, permanently. OSC 52's *read* turns any process with terminal
access into a clipboard exfiltrator — running unprompted, leaving nothing on
screen. xterm ships it disabled, iTerm2 prompts, Ghostty refuses. τ-mux
refuses with no setting, because a toggle there would be a toggle whose only
effect is to weaken you.

---

## Things that got faster

**The headless mirror is gated on the web server.** It exists only so a web
client joining mid-stream gets a state-correct replay. With the mirror off —
the default — running a full terminal emulator per surface (parse, cells,
reflow, 2000 lines of scrollback) in the same process as the metadata poller
and socket server was pure overhead. Agent CLIs are chatty producers; that
was the wrong place to pay double.

Gating it had a trap: paste framing was reading DEC 2004 *off that mirror*,
so the optimisation would have silently undone the headline fix. The fact now
comes from a ~40-line scanner over the PTY stream — cheaper, and it removes
an off-by-default subsystem from the input path's dependencies.

---

## New surface area

**Settings** — `terminalOsc9NotifyEnabled`, `terminalBellNotifyEnabled`,
`terminalOsc52WriteEnabled`, `ideBridgeEnabled` (all default on).

**CLI** — `ht paste`, `ht blocks [last|list|current]`,
`ht shell-integration [status|install|uninstall]`.

**RPC** — `blocks.last`, `blocks.list`, `blocks.current`.

All documented in `website-doc`, EN and FR.

---

## Two bugs only real shells revealed

Worth recording because no unit test would have caught either:

- **Powerlevel10k rebuilds hook arrays asynchronously**, seconds after
  install, silently dropping our `preexec`. Prompts kept being marked while
  every command boundary and exit code vanished — indistinguishable from
  "the integration doesn't work". The script re-arms on every prompt now.
- **p10k emits its own OSC 133**, so each command is announced twice, and
  treating the second `C` as a new command split every block in half: one
  with the command text and no exit code, one with the output and exit code
  but no text.

---

## What to try

```bash
# Paste a 20-line block into a claude pane → one [Pasted text] chip
# Shift+Enter or ⌥Enter in that pane → a newline, not a submit

ht shell-integration install && exec $SHELL -l
bun test; ht blocks              # command, exit code, duration, output

claude config set --global preferredNotifChannel terminal_bell
# finish a turn with the pane unfocused → a τ-mux notification

# Drag a screenshot onto a pane → a quoted path at the cursor
# Click a src/foo.ts:42 in output → the editor pane opens
```

The IDE bridge is automatic: start `claude` in a pane and it connects. The
app log shows `[ide] connected (claude pid …)`.

---

## What is not done

**The xterm 6.1.0-beta bump (plan item 2.1).** Claude Code *does* speak the
Kitty keyboard protocol (`CSI > 1 u` / `CSI < u`) and modifyOtherKeys
(`CSI > 4 ; 2 m`), so the beta would give protocol-native disambiguation for
every modifier rather than the one hand-mapped key. It is not landed because
it is a beta of the **rendering engine**: it needs the visual regression
suites (`bun run test:full-suite`, `test:native:design-review`) rather than
the unit suite, and it deserves its own change with its own review instead of
riding on top of seven other terminal changes.

There is a migration note in the tracking doc, including one conflict:
with Kitty active, `installKeyOverrides` would *shadow* xterm's encoding by
intercepting first, so the override must become conditional.

**`selection_changed` / `at_mentioned`** exist on the IDE socket and are
tested, but nothing calls them yet — the editor pane has no selection event
to forward, and `@`-mention needs a file-explorer affordance.

---

## Verification

3664 tests pass (from 3472), `tsc --noEmit` clean, all five audit scripts
clean, `bun start` boots.

Verified by running the real thing, not only by asserting intent:

- A live PTY driving `/bin/sh` into `DECSET 2004`, asserting the framing
  flips on and off.
- A live shell spawned with a faked iTerm2 environment, reading back what
  the child actually sees.
- OSC 133 end-to-end against real zsh (p10k + syntax-highlighting +
  autosuggestions) and real bash: `false` → 1, `true` → 0.
- Shell quoting round-tripped through a real `/bin/sh`.
- The IDE bridge end-to-end: the shipped app under `bun start`, with a real
  interactive Claude Code connecting — `[ide] connected (claude pid 24699)`.

**Still unverified by hand:** the human loop inside a pane — pasting into a
live Claude session and seeing the chip, Shift+Enter inserting a newline, the
notification channels firing on a real turn end. The mechanisms are unit- and
PTY-tested; those specific interactions want your eyes.
