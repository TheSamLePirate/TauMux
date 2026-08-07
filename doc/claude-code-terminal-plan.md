# Plan — make the τ-mux PTY pane a first-class Claude Code terminal

**Created:** 2026-08-08 · **Baseline:** v0.10.8 · **Owner:** platform + webview
**Companion:** `doc/improvement_analysis_2026-08.md` §4.2
**Tracking doc (create on execution):** `doc/tracking_claude_code_terminal.md`

---

## Goal

τ-mux has the deepest Claude Code *integration* of any terminal — a dedicated pane,
session registry, plan mirror, auto-approve, status presenter, `ht-bridge` hooks. But the
**PTY pane** underneath that integration is an ordinary xterm.js with no agent-specific
work done on it, and that is where the owner actually runs `claude`.

The target is concrete and externally defined. Anthropic publishes a terminal-support
matrix ([terminal-config](https://code.claude.com/docs/en/terminal-config)):

| Tier | Terminals | Shift+Enter |
|---|---|---|
| **Works without setup** | Ghostty, Kitty, iTerm2, WezTerm, Warp, Apple Terminal, Windows Terminal | ✅ |
| Needs `/terminal-setup` | VS Code, Cursor, Devin Desktop, Alacritty, Zed | after one run |
| **Not available** | gnome-terminal, JetBrains IDEs | ❌ Ctrl+J only |

**τ-mux is in none of the three lists, and behaves as tier 3.** `/terminal-setup` writes
config files for terminals it recognises; it does not recognise τ-mux and never will
unless upstream adds it. So every fix must be on our side.

**Definition of done:** τ-mux behaves like a tier-1 terminal — Shift+Enter, Option
shortcuts, `/copy`, and notifications all work with **zero user configuration**, verified
against a live `claude` session in a PTY pane.

---

## Evidence base

Verified against the working tree and the shipped `@xterm/xterm` 6.0.0 bundle on
2026-08-08. **Read this before adding scope** — half the plausible items on this topic are
already done, and rebuilding them is the main risk to this plan.

### Already correct — do NOT build these

| Capability | Status | Evidence |
|---|---|---|
| `TERM=xterm-256color` | ✅ set | `pty-manager.ts:140` |
| `COLORTERM=truecolor` | ✅ set | `pty-manager.ts:141` |
| Bracketed paste (DECSET 2004) | ✅ supported | xterm bundle, incl. DECRQM reply |
| **Synchronized output (DECSET 2026)** | ✅ supported | xterm bundle, incl. DECRQM reply |
| Alternate screen (1049) | ✅ supported | xterm bundle — `/tui fullscreen` works |
| SGR mouse (1006/1016) | ✅ supported | xterm bundle — fullscreen scroll/select works |
| OSC 8 hyperlinks | ✅ supported | web-links addon |
| OSC 0/2 title | ✅ handled | `surface-manager.ts` title propagation |
| OSC 9;4 progress | ✅ handled | `osc-progress.ts` |

Synchronized output matters especially: Claude Code auto-detects it and it is the
documented cure for TUI flicker, so `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` should **not** be
needed. If a user still reports flicker, that is a bug in our DECRQM reply path, not a
missing feature — investigate before adding anything.

### Confirmed gaps — the actual scope of this plan

| # | Gap | Evidence | User-visible symptom |
|---|---|---|---|
| G1 | No Kitty keyboard protocol (CSI u) | xterm 6.0.0 has no `modifyOtherKeys`/CSI-u; registered OSCs are only 0,1,2,4,8,10,11,12,104,110,111,112 | **Shift+Enter submits instead of newline** |
| G2 | `macOptionIsMeta` never set | `surface-manager.ts:2354` `new Terminal({…})` omits it; xterm defaults `false` | **Option+Enter and Option+P do nothing** |
| G3 | No OSC 52 | no handler registered | **`/copy` cannot reach the system clipboard** |
| G4 | BEL ignored | zero `onBell` references in `surface-manager.ts` / `index.ts` | `preferredNotifChannel: "terminal_bell"` produces **silence** |
| G5 | Non-progress OSC 9 discarded | `osc-progress.ts:53` — *"Anything else is a different OSC 9 dialect (notifications etc.)"* → dropped | iTerm2-dialect desktop notifications thrown away |
| G6 | No `TERM_PROGRAM` | `pty-manager.ts:136-158` env block sets none | τ-mux is unidentifiable to any tool that probes |
| G7 | No Unicode 11 widths | `@xterm/addon-unicode11` not a dependency | emoji / box-drawing column drift in the TUI |
| G8 | Scroll-to-top on refit | `shared/xterm-fit.ts:113-116` clamps to line 0 | **viewport jumps to top of scrollback mid-session** |
| G9 | No ligatures | `@xterm/addon-ligatures` not a dependency | cosmetic only |

---

## Effort and risk legend

Matches `doc/deferred_items.md`. **S** < 30 min · **M** 1–3 h · **L** half-day+ ·
**XL** multi-day. Risk **low** = strictly more capable than before, no existing behaviour
changes.

---

## Phase 0 — the one-liners (do first, ~1 hour total)

Three changes, no new dependencies, no protocol work. This phase alone moves τ-mux from
tier 3 to "usable", and G8 removes the single most irritating daily bug.

### 0.1 — `macOptionIsMeta: true` (G2)

**Scope.** Add the option to the `new Terminal({…})` literal at
`src/views/terminal/surface-manager.ts:2354`.

Anthropic documents this as a *required* terminal setting, not a nicety: *"On macOS, most
terminals do not send Option as a modifier by default, so these shortcuts do nothing until
you enable it."* It gates **Option+Enter** (newline) and **Option+P** (switch models) —
the VS Code equivalent is literally `terminal.integrated.macOptionIsMeta: true`.

**Acceptance.** In a PTY pane running `claude`: Option+Enter inserts a newline; Option+P
opens the model switcher. Before the change both do nothing.

**Risk: medium, not low** — this changes existing behaviour. Option+letter currently
produces accented characters (Option+e → `´`, Option+n → `˜`). Users who type accented
text *in a terminal pane* would regress. Ship it behind an `AppSettings` field
(`terminalOptionIsMeta`, default `true`) via the standard settings pattern in CLAUDE.md so
it is one toggle to undo. **S.**

### 0.2 — Shift+Enter via `attachCustomKeyEventHandler` (G1, interim)

**Scope.** `attachCustomKeyEventHandler` has **zero call sites** in this codebase today.
Add one next to the existing `term.onData` wiring at `surface-manager.ts:2386`: intercept
`keydown` + `key === "Enter"` + `shiftKey`, write the newline byte directly via
`this.onStdin(surfaceId, …)`, return `false` to suppress the default CR.

**Byte to send: `\n` (0x0a, i.e. Ctrl+J).** Anthropic documents Ctrl+J as the universal
newline-without-submit that *"work[s] in every terminal with no setup"*, so emitting the
same byte is the lowest-risk mapping — it is exactly what the user would type manually.

**Verify empirically before shipping.** This byte choice is reasoned from the documented
Ctrl+J equivalence, not yet observed in a live pane. Test in a real `claude` session
first; if it submits rather than inserting, the fallback is `\x1b\r` (ESC+CR, the meta-CR
form) — try that second.

**Acceptance.** Shift+Enter inserts a newline in `claude`, `pi`, and at a bare `zsh`
prompt (where it should be harmless). Enter alone still submits everywhere.

**Risk: low** — additive, scoped to one key combination. **S.**

### 0.3 — Fix the scroll-to-top clamp (G8)

**Scope.** `src/shared/xterm-fit.ts:113-116` computes `distFromBottom` from the
**pre-resize** buffer, then clamps `after.baseY - distFromBottom` with `Math.max(0, …)`.
When a pane grows or reflow unwraps lines, `after.baseY` shrinks, the expression goes
negative, and the clamp lands on **line 0** — the viewport slams to the top of scrollback.
It only fires when the user is scrolled up, i.e. exactly when it is maddening.

```ts
if (after.baseY <= 0) return;            // nothing to restore
const dist = Math.min(distFromBottom, after.baseY);
const target = after.baseY - dist;
```

Also route the mirror through the same helper: `src/web-client/main.ts:447` calls
`ref.term.resize()` **raw**, so the web mirror has no scroll preservation at all.

**Why it belongs in a Claude Code plan.** The `W1-SCROLL` comment at `xterm-fit.ts:79-88`
already documents that sideband panels force refits — and agent panes paint panels
constantly, so agent sessions hit this path far more than plain shells. Anthropic lists
*"scrollback jumps"* as a symptom serious enough to warrant switching renderers; here it
is our own bug, and it is fixable.

**Acceptance.** Scroll up mid-session in a pane running `claude`, then trigger a refit
(resize the pane, toggle the sidebar, let a sideband panel paint). The viewport holds
position. Add a unit test in `tests/` covering pane-grow and reflow-unwrap. **S.**

---

## Phase 1 — Kitty keyboard protocol, properly (G1)

**Scope.** Bump `@xterm/xterm` to the beta carrying the Kitty keyboard protocol
([PR #5600](https://github.com/xtermjs/xterm.js/pull/5600); npm dist-tags confirm
`beta: 6.1.0-beta.292`), replacing the 0.2 hand-mapping with real CSI-u encoding.

This is what actually moves τ-mux into tier 1: not one key, but every modifier combination
for every agent TUI, and it is the mechanism the tier-1 terminals use.

**Sequence.** Land Phase 0.2 first and keep it until this is proven — 0.2 is the
de-risked path to relief and costs nothing to keep as a fallback behind a settings flag.

**Risk: medium.** A beta of the core rendering dependency. Mitigations: it is a
`^`-free pin, `bun test` (3421 tests) plus `bun run test:full-suite` gate it, and the
revert is a one-line `package.json` change. Do **not** land this in the same commit as
anything else.

**Acceptance.** With 0.2's hand-mapping disabled, Shift+Enter still inserts a newline;
Ctrl+Enter, Alt+Enter and Shift+Tab reach the TUI distinctly. No regression in the 3421-test
suite or the design report. **S–M.**

---

## Phase 2 — Notifications and clipboard (G3, G4, G5)

This is the phase with the most τ-mux-specific upside, because the destination already
exists: τ-mux has a full notification pipeline (sidebar entries, toast overlay, sound,
**and Telegram forwarding**). Terminal-native notifications currently land nowhere.

### 2.1 — BEL → τ-mux notification (G4)

Anthropic's documented fallback for terminals that are *not* Ghostty/Kitty/iTerm2 — which
is τ-mux — is `preferredNotifChannel: "terminal_bell"`. τ-mux has **no `onBell` handler at
all**, so that documented path produces nothing.

**Scope.** Subscribe to xterm's `onBell` per surface; route into the existing notification
system with the surface as source. Gate behind a setting (`terminalBellNotifies`, default
on) — a bell from a plain shell should be cheap to silence. Debounce so a `yes`-flood or a
misbehaving TUI cannot spam the sidebar.

**Honest scoping.** The owner already receives Claude Code notifications through the
`ht-bridge` hooks (`claude-status-presenter.ts` decides them app-side), so this is *not*
filling a hole in that workflow. Its value is robustness and breadth: it works for any
tool that rings the bell, in sessions where the hooks are not installed, and over SSH.
Rate it accordingly — do not oversell it. **S.**

### 2.2 — Notification OSC dialects (G5)

`osc-progress.ts:53` explicitly identifies and then **discards** non-`9;4` OSC 9 payloads,
with the comment *"a different OSC 9 dialect (notifications etc.)"*. The hook point is
already there.

**Scope.** Extend the existing OSC 9 handler to route the iTerm2 notification dialect into
the notification pipeline, and register OSC 777 (`notify;title;body`, the urxvt/GNOME
form) and Kitty's OSC 99. Reuse the exact sanitisation the Telegram path uses — these are
untrusted strings from a subprocess and one of them can reach Telegram. Cap title/body
length as the OSC 0 title handler already does (60 chars).

**Acceptance.** `printf '\e]9;hello\a'` raises a τ-mux notification; `\e]777;notify;t;b\a`
likewise; OSC 9;4 progress still drives the progress bar and does **not** raise a
notification. **M.**

### 2.3 — OSC 52 clipboard (G3)

Anthropic documents that `/copy` needs terminal clipboard access — in iTerm2 that is
literally the *"Applications in terminal may access clipboard"* setting that
`/terminal-setup` toggles. Without an OSC 52 handler, **`/copy` silently fails in τ-mux**,
as does yank-from-nvim and tmux over SSH.

**Scope.** Add `@xterm/addon-clipboard` (0.2.0). **Write-only by default.** Never enable
the OSC 52 *read* path: it lets any subprocess exfiltrate clipboard contents, and this app
already exposes a LAN mirror. Add `terminalClipboardWrite` (default on) so it can be
turned off.

**Acceptance.** `/copy` in a `claude` PTY pane puts the reply on the system clipboard.
`printf '\e]52;c;?\a'` returns nothing. **S.**

---

## Phase 3 — Rendering fidelity (G6, G7, G9)

### 3.1 — `TERM_PROGRAM` + `TERM_PROGRAM_VERSION` (G6)

Every tier-1 terminal identifies itself; τ-mux sets nothing, so no tool can detect it or
special-case it, now or later. Add to the env block at `pty-manager.ts:136-158` alongside
the existing `HYPERTERM_*` vars.

**Do not spoof another terminal.** Setting `TERM_PROGRAM=iTerm.app` to farm Claude Code's
desktop-notification path would make every other tool misbehave and would break the moment
a real iTerm2 feature is probed. Advertise honestly; the notification win comes from
Phase 2, which we control. **S, risk low.**

### 3.2 — Unicode 11 widths (G7)

`@xterm/addon-unicode11` (0.9.0). Claude Code's TUI is box-drawing- and emoji-heavy; wrong
`wcwidth` means borders that do not line up and a cursor that drifts from where the TUI
thinks it is. This is a correctness issue, not cosmetics. **S.**

### 3.3 — Ligatures (G9)

`@xterm/addon-ligatures` (0.10.0). The default font stack is already
`JetBrainsMono Nerd Font Mono` (`surface-manager.ts:2356`), which ships ligatures the app
currently cannot render. Purely cosmetic — do it last, or drop it. **S.**

---

## Explicitly out of scope

- **OSC 133 semantic prompts / command blocks.** High value for τ-mux
  (`improvement_analysis_2026-08.md` §4.3) but Claude Code does not consume it — it is a
  *τ-mux* feature, not a Claude Code one. Separate plan; do not let it inflate this one.
- **Sixel / Kitty graphics.** Claude Code renders no inline images. Sideband already covers
  τ-mux's own image needs. Justify on `imgcat`/yazi/matplotlib, not on this plan.
- **Making `/terminal-setup` recognise τ-mux.** Upstream's call, not ours.
- **Spoofing `TERM_PROGRAM`.** See 3.1.

---

## Execution order

| Step | Items | Effort | Risk |
|---|---|---|---|
| 1 | 0.3 scroll clamp (+ mirror) | S | low |
| 2 | 0.1 `macOptionIsMeta` + setting | S | medium |
| 3 | 0.2 Shift+Enter handler | S | low |
| 4 | 2.3 OSC 52 write-only | S | low |
| 5 | 3.1 `TERM_PROGRAM` · 3.2 unicode11 | S | low |
| 6 | 2.1 BEL · 2.2 OSC notification dialects | S + M | low |
| 7 | **1. xterm beta bump — its own commit** | S–M | medium |
| 8 | 3.3 ligatures | S | low |

Steps 1–3 are one sitting and deliver most of the felt improvement. Step 7 is isolated
deliberately so a revert costs nothing.

---

## Verification protocol

Per CLAUDE.md, `bun test` and `bun run typecheck` must pass before any item is considered
done, and `bun start` must confirm the terminal still works. Beyond that, **every item
here must be verified against a live `claude` session in a PTY pane** — this plan is about
behaviour no unit test observes.

Manual checklist, run once after step 3 and again after step 7:

1. `claude` in a PTY pane → Shift+Enter inserts a newline; Enter submits.
2. Option+Enter inserts a newline; Option+P opens the model switcher.
3. Ctrl+J and `\`+Enter still work (must not regress — they are the universal fallbacks).
4. `/copy` → paste into another app and confirm.
5. `preferredNotifChannel: "terminal_bell"` → a finished turn raises a τ-mux notification.
6. Scroll up mid-session, resize the pane → viewport holds.
7. `/tui fullscreen` → alt-screen renders, mouse scroll and selection work, exit restores.
8. Paste 200 lines → collapses to `[Pasted text #1 …]`, no stray submits (bracketed paste).
9. No flicker during a long streaming turn (synchronized output already supported —
   if this fails, it is a DECRQM bug, not a missing feature).

## Per-CLAUDE.md conventions

- Track progress, deviations and issues in `doc/tracking_claude_code_terminal.md`,
  including the commit id for each landed step.
- Run `bun run bump:patch` (or `minor` when Phase 1 lands — it changes a core dependency)
  before each commit.
- Add entries to `doc/changes_to_document.md` for: the new settings fields
  (`terminalOptionIsMeta`, `terminalBellNotifies`, `terminalClipboardWrite`), the new OSC
  support, and a correction to `doc/system-osc-sequences.md`, whose rows for **OSC 7, 52
  and 133 are currently wrong** — they claim xterm handles sequences it registers no
  handler for.
