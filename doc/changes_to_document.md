# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-08-08 — **whole-repo docs sync** (`docs/sync-app-state`).
The 0.10.1 → 0.10.8 backlog below was folded into the site (EN + FR), and the
repo-level docs were audited against the source for the first time since
v0.2.81._

What that sweep covered:

- **Website (EN + FR)** — changelog gained 0.10.1 through 0.10.8 (it stopped
  at 0.10.0). `integrations/claude-code.md` gained the
  `AskUserQuestion`/`ExitPlanMode` exclusion, the retraction behaviour, and
  the per-prompt (not per-transition) firing rule. `features/plan-panel.md`
  gained the clear control, inline step detail, progress bar and freshness
  stamp.
- **README.md** — was stale since v0.2.81 (~8 minor versions). Corrected:
  metadata poller is libSystem FFI (~5 ms/tick), not `ps` + `lsof` (~200 ms);
  12 theme presets defaulting to τ, not 10 defaulting to Obsidian; 3419 tests
  across 278 files, not "1500+ across 100"; `@xterm/xterm` 6.0, not 5.3;
  Bun 1.3.14. Added the seven surface kinds, agent integrations, 83 CLI
  commands, 139 RPC methods across 17 domains, the fd4 sandbox, the real
  keybinding set (`⌘\`, `⌘G`, `⌘⇧?` were missing), and the four CI jobs.
- **CLAUDE.md / AGENTS.md** — same factual corrections. AGENTS.md was a stale
  *copy* of CLAUDE.md that still claimed fd4 content was unsandboxed; the two
  are now byte-identical with a note saying to keep them that way.
- **doc/system-process-metadata.md** — the "full spec" had zero mentions of
  the FFI path. Added the two-implementation table, the self-validation
  contract, real per-tick costs, and a troubleshooting entry for "is the
  native path actually being used?".
- **doc/system-claude-integration.md** — stopped at 0.7.1. Added the terminal
  approval plane (0.10.x) in full: the six safety rules, why it counts
  announcements rather than transitions, the question-exclusion mechanism and
  its deliberate limitation, and registry persistence.
- **doc/system-plan-panel.md** — added the 0.10.5 card controls and the
  `PlanStore.update` description-dropping fix.

Not touched, deliberately: `doc/tracking_*.md`, `doc/todos/*`, `.pi/plans/*`,
`code_reviews/*` and the dated `full_app_review_*` / analysis docs. Those are
historical records of what was true on a given date — rewriting them to match
today would destroy the record rather than update it.

_(Always add new items below this line. When folding into the website, clear
the backlog by overwriting the pending entries with a fresh
"Backlog cleared <date> — …" summary like the one above.)_
---

## Design system consolidation + notification panel rebuild (unreleased)

Visual-system work. No RPC surface changed, so `api/` and `cli/` pages are
unaffected; this is a look-and-feel note plus one user-visible palette change.

**One token layer instead of six.** `src/views/terminal/index.css` had
accumulated six top-level `:root` blocks from successive redesign passes, each
re-declaring the same names. Whichever pass happened to sit last in the file
won, which is how the app ended up:

- rendering its chrome in **DM Sans** — a font that is not bundled, so it
  silently fell back to San Francisco while four weights of Inter shipped in
  `assets/fonts/inter/` and went unused;
- on a **grey `#181818`-ish body** rather than the `#07090b` the guidelines
  specify;
- with an **18 px window radius** and a `--radius-lg: 18px`, against a scale
  whose documented maximum is 12 px;
- with a full-window **fractal-noise film** (three separate re-declarations of
  the same `body::after`), which §0 rules out and which cost a compositor
  layer on every repaint.

All six are now merged into a single documented `:root`. Geometry that the app
actually shipped (32 px titlebar, 320 px sidebar) was deliberately preserved,
so this is a visual-language correction, not a silent relayout.

**Notification panel (left sidebar).** `.notification-copy` had no CSS rule
anywhere in the 13 000-line stylesheet, and the only global button rule was
`font: inherit` — so the copy control rendered as a stock macOS grey push
button inside the flat dark row, next to a dismiss button that was invisible
until hover. Both are now matched 20 px ghost buttons, always visible, with
keyboard focus states and a working copy-confirmation tick (the `.copied`
class was already being set and had never been styled). Rows gained a 2 px
state bar: amber = unread, cyan = click to focus the emitting pane.

**Button chrome reset.** The UA `appearance` is now neutralised globally for
`<button>`, so this whole class of bug — a control that sets size and colour
but never background/border, and therefore inherits macOS chrome — cannot
recur. It also fixed the Settings and panel close buttons.

**Z-index scale.** Overlays used 200 / 210 / 1800 / 1900 / 1900 / 2000 / 2010 /
10000 / 2147483600. That contained a genuine tie (settings vs. context menu,
resolved by DOM order) and left Process Manager and Pane Info below every other
modal. There is now one documented scale of named layers, and `surface-details`
finally adopts `ModalHost`, so it gets Escape-to-close, a focus trap, focus
restore and `role="dialog"` like every other modal.

**USER-VISIBLE — workspace colour palette retuned.** `WORKSPACE_COLOR_OPTIONS`
was the stock macOS system palette (`#4c8bf5`, `#34c759`, `#ffd60a`, …), which
is tuned for light-grey chrome and reads as foreign against `#07090b`. The
eight hue positions are kept — so a user's "green project / red project"
mapping survives — but re-voiced in the canon's luminous register, four of them
being the `--tau-*` tokens exactly. Label changes: "Blue" → "Cyan",
"Yellow" → "Amber", "Purple" → "Violet". Existing workspaces keep the hex they
were created with; only the picker changes. **Screenshots in the docs that show
workspace colours or the sidebar will need retaking.**

**Identity rule enforced.** Command-palette categories that spawn an agent
("Agent", "Claude Code") are now tagged amber per §7, and several cyan→amber
gradients (progress meter, agent streaming bar, welcome glyph) were flattened
to a single semantic colour — a bar ramping through both identity colours read
as the session changing owner as it filled.

**Test-harness fix worth noting.** `tests-e2e-native/client.ts` never sent the
RPC token, so the entire native e2e suite failed at the first state-mutating
call once `rpcSocketRequireToken` began defaulting to `true`. It now reads
`socket.token` beside the socket. This is why `bun run test:native` and the
design-review gallery work again.

---

## Pending — "best terminal for Claude Code" Phase 0 (2026-08-08)

Already folded into `website-doc` as part of the change (EN + FR):

- `cli/surfaces-and-io.md` — new `ht paste` command.
- `configuration/settings.md` — `terminalOsc9NotifyEnabled`,
  `terminalBellNotifyEnabled`.

Still to write when the docs sweep happens:

- **A "running agent CLIs" page.** τ-mux now speaks the things Claude
  Code and friends expect: bracketed paste, `TERM_PROGRAM=tau-mux`,
  Shift+Enter / ⌥Enter → `ESC CR`, `OSC 9` + BEL notifications routed to
  the notification centre and Telegram. That story is currently spread
  across three reference tables and told nowhere.
- `integrations/claude-code.md` — note that `preferredNotifChannel`
  `iterm2` *and* `terminal_bell` both work now, and that bell
  notifications are throttled to one per pane per 5 s.
- **Changelog** — entry for the version this ships as.

## Pending — Phase 1 (2026-08-08)

Folded in already (EN + FR): `configuration/settings.md` gained
`terminalOsc52WriteEnabled`.

Still to write:

- **Unicode 11 widths** are now on unconditionally (native + web
  mirror). Worth a line in the terminal concepts page — it changes how
  emoji and powerline glyphs measure, which is visible.
- **DECSET 2031** — switching theme preset now re-themes running agent
  CLIs in place. That is a genuinely novel capability (per *pane*, which
  no other terminal can express) and is currently documented nowhere.
- The OSC reference page should stop claiming OSC 7/52/133 are "handled
  by xterm". 52 is now really handled (write-only); 7 and 133 still are
  not.

## Pending — Phase 2 (2026-08-08)

Folded in already (EN + FR): `api/blocks.md` (new page),
`cli/surfaces-and-io.md` gained `shell-integration` and `blocks`.

Still to write:

- `doc/system-osc-sequences.md` is now materially wrong. It claims OSC
  7/52/133 are "handled by xterm"; 52 is handled by us (write-only), 133
  is handled by us (command blocks), 7 still is not, and OSC 9
  notifications are new. That page needs a rewrite, not a patch.
- `doc/system-pty-session.md` should mention `DecPrivateModeTracker` and
  why paste framing deliberately does not read the headless mirror.
- `doc/system-process-metadata.md` opens by boasting "no shell
  integration". Still true as the baseline, but it should now say
  *why* the optional layer exists and what it adds.
- The web-mirror docs should note the headless mirror is built with the
  server and torn down with it.

## Pending — Phase 3/4 partial (2026-08-08)

- **Clickable `path:line` references.** Terminal output now links file
  references into the editor pane. Belongs in the terminal concepts page
  and is worth calling out — τ-mux is one of very few terminals where
  that click has somewhere to go.
- **Drag & drop onto a terminal pane** inserts shell-quoted paths.
  Should be mentioned wherever the pane interactions are described.
- **Not documented on purpose:** the Claude Code IDE bridge is not
  implemented (see `doc/tracking_best_terminal_for_claude_code.md`).
  Nothing to write until it exists.

## Pending — IDE bridge (2026-08-08)

Folded in already (EN + FR): `configuration/settings.md` gained
`ideBridgeEnabled`; `integrations/claude-code.md` gained an "IDE bridge"
section (tools, security, reject-by-default).

Still to write:

- **The headline framing is missing from the site.** τ-mux is now a
  Claude Code IDE host — a terminal that shows Claude's diffs in an
  editor pane and takes the approval through Telegram. Every other host
  for that protocol is an editor. That belongs on the landing page and
  in the Claude Code overview, not only in a settings row.
- `doc/system-claude-integration.md` describes three planes (hooks,
  statusline, pane). There is now a fourth: the IDE bridge. The
  architecture section should say so.
- A note that `claude -p` never connects to an IDE — print mode skips
  discovery. Anyone debugging the bridge will otherwise chase it.
