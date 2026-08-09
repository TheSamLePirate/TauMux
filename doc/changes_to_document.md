# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

## Pending — clickable paths in terminal output (2026-08-08)

Nothing here is a new RPC method, `ht` command, or `AppSettings` field, so
`tests/docs-coverage.test.ts` does not gate it. It still changes documented
behaviour in three places.

- **`features/` — new page or section: "Clickable paths".** Clicking a
  `path`, `path:line` or `path:line:col` in terminal output opens it.
  Document the actual rules:
  - resolution is absolute (`/…`), `~`-expanded, or relative **to the
    pane's cwd** (from the metadata poller) — not to τ-mux's launch dir;
  - only paths that exist are underlined, so a link never opens a dead
    pane;
  - a **text** file opens in the file pane at the referenced line;
  - an **image** (png/jpg/gif/webp/bmp/ico/avif/heic/tiff, by extension
    *or* magic bytes) opens in an image viewer with fit / 1:1 / zoom and
    double-click to toggle;
  - an **SVG** opens as a rendered picture with a `Source` toggle;
  - a **directory** reveals itself in the sidebar file explorer instead
    of opening a pane;
  - clicking again reuses the current file pane (focus + jump for the
    same file, retarget for a different one); **⌥-click** forces a new
    split; a pane with unsaved edits is never retargeted;
  - hovering shows the resolved absolute path, size, mtime and — for
    images — a preview thumbnail;
  - a reference **broken across rows** still works, whether the terminal
    soft-wrapped it or the program re-flowed it onto an indented line
    (Claude Code's transcript does the latter constantly). Hovering
    either half links the whole path;
  - an **HTML file** (`.html` / `.htm` / `.xhtml`) has two valid
    readings, so neither is forced: a plain click opens the source in
    the file pane, **⌘-click** opens the rendered page in a browser
    pane, and the file pane grows a **Preview** button that does the
    same. `file://` URLs now survive the browser pane's address bar.
- **Dialogs, across several pages** — five actions that appeared to do
  nothing now work, because they no longer rely on native browser
  modals (which the webview swallows): closing/reloading a file pane
  with unsaved changes ("File not saved" → *Discard and close* /
  *Keep editing*), removing an extension, regenerating the web-mirror
  auth token, the file explorer's new-file **+** button, and renaming a
  pi agent session. Invalid file names are now explained inside the
  dialog instead of silently rejected.
- **`cli/` — `ht editor open` / `ht editor split` gained `--line` and
  `--column`.** 1-based; non-positive / non-integer values are ignored
  and the file opens at the top.
- **`concepts/workspaces-and-panes.md`** — the `editor` surface is now a
  *file* pane: it renders images and SVG as well as text. The surface
  kind name is unchanged (still seven kinds), so no docs-coverage churn.

EN **and** FR, per CLAUDE.md. Stamp the app version in
`website-doc/src/content/docs/api/system.md` and `cli/system.md` in the
same change.

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

## Pending — auto-approve retracts its own alert (2026-08-08)

- **`ht claude auto-approve` now clears the notification it answered.**
  The presenter's "Claude Code · approval needed" alert used to survive
  the approval: the overlay card, the sidebar entry, and any forwarded
  Telegram message all stayed up, asking the user to act on a prompt that
  had already been answered. Every send (auto AND manual `ht claude
  approve` / the palette entry) now dismisses it. This belongs in
  `integrations/claude-code.md` next to the existing auto-approve safety
  rules — it changes what the user should expect to see.
- **The alert survives a REFUSED approval**, which is the part worth
  stating explicitly: burst-guard pause, modal-routed approval, native
  Claude pane, or the user answering during the delay window all leave
  the notification standing. Retraction follows the send, not the prompt.
- **The `sidebar.log` audit line is unchanged.** Worth saying in the docs
  that the log is the record and the notification was only the interrupt
  — an unattended approval is still auditable after the fact.
- **Telegram messages are edited, not deleted.** A forwarded copy is
  rewritten in place with a `Resolved: auto-approved by τ-mux` footer and
  its OK / No / Continue / Cancel keyboard removed, and the
  `notification_links` rows are dropped so a late tap can't dispatch
  keystrokes at the surface. Belongs in the Telegram integration page
  wherever the notification buttons are described.
- **`notification.dismiss` gained two optional params** — `key` (dismiss
  by the producer's correlation tag from `notification.create {key}`
  instead of by id; newest match wins) and `resolution` (a note that the
  notification was answered rather than swiped, which is what triggers
  the Telegram edit). `notification.create` gained the matching optional
  `key`. These are new params on existing methods, so the docs-coverage
  gate does not catch them — the API reference pages for
  `notification.*` need updating by hand (EN + FR).

---

## Pending — every `ht` config knob reachable from Settings (2026-08-08)

Settings gained an **Integrations** section, and four `AppSettings` fields
gained their first renderer. No new RPC methods and no new settings fields, so
the docs-coverage gate catches none of this — it all needs writing by hand
(EN + FR).

- **Settings → Integrations (new section).** Covers the three things that were
  `ht`-only because they edit files outside `settings.json`:
  - **Claude Code bridge** — per-feature state (lifecycle / tasks / approvals /
    status line) read live from `~/.claude/settings.json`, tick boxes, and
    Install selected / Remove all / Re-check. Same planner as `ht claude
    install|uninstall`, so the two agree by construction: additive merge,
    timestamped backup, refuses on a settings file it cannot parse, never
    clobbers a user-defined statusline. The panel distinguishes **partial**
    from installed (some of a feature's hook events wired, e.g. after an
    upgrade adds one) — `ht claude doctor` only ever reported a total.
  - **Shell integration** — rc-file state + Install / Remove, mirroring
    `ht shell-integration`. Keeps the "already-open shells have not re-read
    their rc" caveat in the success message.
  - **Extensions** — per-extension enable toggle, mirroring `ht extension
    enable|disable`. Disabling stops running backends, it does not merely skip
    them next launch.
  - Auto-approve (toggle + delay) is mirrored here next to the bridge that
    feeds it; it also remains in General. `integrations/claude-code.md` should
    say the CLI verb and the panel are the same operation.
- **Sidebar auto-approve pill (USER-VISIBLE).** The sidebar footer gained a
  third, actionable pill under Telegram / Web Mirror: dot + `Auto-approve` +
  `On`/`Off`, amber when armed, click (or keyboard — it is a real
  `aria-pressed` button) to flip. State tracks Settings, the command palette
  and `ht claude auto-approve` live. **Sidebar screenshots need retaking.**
- **Four settings that previously required hand-editing `settings.json`** now
  have controls. The settings reference already lists all four; the prose
  saying they are file-only (if any) is now wrong:
  - `webMirrorBind` → Network → Bind Address (LAN / This Mac only).
  - `browserPartitionMode` → Browser → Cookie Isolation (Per pane / Shared).
  - `auditsGitUserNameExpected` → Advanced → Expected git user.name (empty
    disables the startup audit).
  - `bgBase` → Theme → Customize Colors → Background (swatch + `r, g, b`,
    accepts hex; sets `themePreset: "custom"`).
- **New Electrobun webview messages** (not socket RPC, so not in the `api/`
  CLI-facing reference): `requestIntegrationsStatus`, `claudeIntegrationInstall`,
  `claudeIntegrationUninstall`, `shellIntegrationSet`, `extensionSetEnabled`,
  and the `integrationsStatus` push. `extensionList` entries gained `enabled`.

## Pending — Claude Code integration: data plane + pane titles (2026-08-09)

No new socket RPC method or `AppSettings` field, but `ht claude statusline`
gains a **flag**, which the CLI reference should carry.

- **`ht claude statusline --exec <command>` (new).** Claude Code runs
  exactly one statusline command, and that slot is also τ-mux's only data
  plane. `--exec` tees the payload to τ-mux, then runs the user's own
  command on the same JSON and prints its output verbatim. `--append`
  additionally appends τ-mux's segment.
- **`ht claude install` now wraps** an existing user statusline instead of
  skipping it. Document the behaviour change: previously it printed
  "kept yours" and left the data feed dead.
- **`ht claude doctor`** now reports a dead data plane as `FAIL` with a
  paragraph naming exactly what is lost.
- **Pane titles.** Claude Code's OSC title is the *first prompt's* summary
  plus an animated spinner glyph, so it never tracks later work. τ-mux now
  (a) strips the glyph so the pane bar stops churning, and (b) renames the
  pane from the statusline's live `session_name`. Document the precedence:
  a user rename always wins; a program title applies only while unclaimed;
  restore re-applies text without claiming.
- **`layout.json` gained `surfaceTitlesLocked`** — which titles the user
  chose. Worth a line wherever layout persistence is described.

## Done — `ht atlas` + permission-decision (2026-08-09)

Documented in the same change (`tests/docs-coverage.test.ts` gates both):
new `cli/atlas.md` + `api/atlas.md` pages EN + FR, and
`claude.permission_decision` added to the claude API pages.

## Pending — CHRONO, the ⌘G view (2026-08-09)

⌘G under the Atlas variant no longer opens the expanded topology tree. It
opens **CHRONO**, a time field: the horizontal axis is the last 90
seconds with *now* at the right edge, every pane is a lane, and each
lane's **live terminal** sits at *now*.

Documentation impact (no new RPC method, `ht` command or `AppSettings`
field, so `tests/docs-coverage.test.ts` does not gate it):

- **`concepts/layout-variants`** (EN + FR) — rewrite the ⌘G section. It
  currently describes the full-window topology overlay, which is gone.
  What to say instead:
  - ⌘G opens CHRONO; Escape or ⌘G closes it; it exists only in the Atlas
    variant.
  - A lane's head is the pane's *real* terminal, moved into the lane —
    not a screenshot and not a copy. Typing into it types into the pane.
    The terminal is never resized; the lane is a viewport onto it, and
    the last line is anchored to the lane's bottom edge.
  - **The gutter is CHRONO's, the head is the pane's.** Clicking a lane's
    channel strip (or ↑/↓) selects it and leaves Escape closing the view;
    clicking its head hands the keyboard to that terminal, Escape
    included — the header says which one is live.
  - Enter goes to the selected pane and closes the view.
  - A lane's height follows what its terminal has to show, so a build
    printing forty lines gets a taller band than an idle shell.
  - Browser and extension panes cannot be moved (a native webview and an
    iframe), so their lanes show a standby card with a "go to pane"
    action. Browser overlays are hidden while CHRONO is open.
  - The four filters (all / agents / live / alert) work as in the column.
- **`guides/keyboard-shortcuts`** (EN + FR) — the ⌘G row's description
  changes from "expand topology" to "CHRONO — the last 90 seconds".
