# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-08-03 — **full code-vs-docs audit**. The website is now
mechanically verified against the source rather than hand-maintained, and
`tests/docs-coverage.test.ts` fails CI if any of it drifts again._

What the audit found and fixed (EN + FR throughout):

- **API reference was 70 % complete** — 42 registered RPC methods were
  undocumented, including six whole domains. Added `api/editor.md`,
  `api/plan.md`, `api/autocontinue.md`, `api/audit.md`, `api/script.md`,
  `api/panel.md`; extended `agent` (pane lifecycle), `system` (health,
  shutdown), `telegram` (chats/history/restart), `claude` (pane, approve),
  `browser` (the eight cookie methods). **Now 138/138.**
- **CLI reference was missing 22 commands** — `rename-surface`, `list-panes`,
  `list-panels`, `list-browsers`, `editor`, `agent`, `run-script`, `shutdown`,
  the eight `browser-cookie-*` verbs and the legacy hyphenated browser aliases.
  **Now 83/83.**
- **Settings reference was actively wrong** — 11 documented fields did not
  exist (`copyOnSelect`, `themeOverrides`, `backgroundOpacity`, `ansiPalette`,
  `bloomEnabled`, `searchEngine`, `homePage`, `forceDarkMode`,
  `interceptTerminalLinks`, `botToken`, `accessPolicy`, `allowedChats`,
  `forwardNotifications`, `forwardChatId`), 14 defaults were wrong
  (`themePreset`, `terminalRenderer`, `paneGap`, `sidebarWidth`, `lineHeight`,
  `notificationSoundVolume`, `bloomIntensity`, `fontFamily`, …), and 38 fields
  were missing. Regenerated from `AppSettings` + `DEFAULT_SETTINGS`.
  **Now 62/62 with every default machine-checked.**
- **Concepts page listed 4 surface kinds; there are 7** (`claude`, `editor`,
  `extension` were missing) and it named `settings.json` as the layout store —
  it is `layout.json`. Rewritten with a per-kind table and accurate restore
  semantics.
- **Landing + introduction claimed the metadata poller shells out to
  `ps` + `lsof`** — replaced by libSystem FFI in v0.4.8 (~2 ms/tick), with
  `ps`/`lsof` kept only as a self-validating fallback. Corrected, and the
  landing page gained cards for the features it never mentioned (Claude Code
  integration, agent panes, extension apps, Telegram, editor).

_(Always add new items below this line. When folding into the website, clear
the backlog by overwriting the pending entries with a fresh
"Backlog cleared <date> — …" summary like the one above.)_

## v0.10.5 — plan panel: clear control + step detail

- **Plan cards can be dismissed from the UI.** Each card now carries a clear
  control — hover-revealed `×` while work is in flight, promoted to a labelled
  `Clear` button (with the card outlined in `--tau-ok`) once every step is
  done. It routes through the same `plan.clear` handler as `ht plan clear`, so
  the CLI, the native panel and the web mirror can never disagree. The panel
  does **not** optimistically remove the card: the store's broadcast is what
  repaints, so a clear that didn't land can't leave a phantom-free panel.
  Web mirror gained the `planClear` client envelope; a host that doesn't wire
  `onClearPlan` simply gets no button rather than a dead one.
- **Step descriptions render inline.** Steps that carry a description (every
  mirrored Claude Code task does — `task_description`) are now toggles: click
  to expand the full text under the row, click again to collapse. Expanded
  rows stop ellipsizing their title. Previously the description existed only
  as a hover `title` tooltip, which is why a plan "showed only that there is a
  plan". Expansion is local view state, keyed per `(workspace, agent, step)`,
  and never goes on the wire — the native panel and the mirror may disagree.
- **Cards gained a progress bar and an `updated Nm ago` stamp**, so a stale
  plan is visible as stale.
- **Accessibility:** the card used to be one big `<button>`, which made the new
  controls illegal nested buttons. It is now an inert container holding three
  real controls (workspace switch, clear, per-step toggle) with `aria-expanded`
  on the toggles.
- **Bug fix — `PlanStore.update` dropped `description`.** `ht plan update
  <id> --state done` silently deleted the step's description, blanking the new
  detail row exactly when a step completed.
