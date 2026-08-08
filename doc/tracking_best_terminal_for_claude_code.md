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

**Commit:** _(pending)_

### Not yet verified by hand

`bun start` + a live `claude` pane: paste a 20-line block and confirm one
`[Pasted text …]` chip; Shift+Enter inserts a newline; `⌥`+Enter same;
`preferredNotifChannel` `iterm2` and `terminal_bell` both raise a τ-mux
notification.

---

## Phase 1 — remaining

| # | Item | Status |
|---|---|---|
| 1.3 | Unicode 11 addon | ⬜ |
| 1.4 | Focus events (verify, then fix) | ⬜ |
| 1.5 | DECSET 2031 + theme reporting | ⬜ |
| 1.6 | OSC 52 clipboard | ⬜ |

## Phase 2 — structural ⬜

## Phase 3 — IDE host ⬜
