# τ-mux work plans — backlog index

Plans split by subsystem. Generated from `doc/issues_now.md`. Each plan
is self-contained: problem, current state, proposal, implementation
steps, files to touch, tests, risks, effort.

| #  | Plan                                                  | System                          | Effort |
| -- | ----------------------------------------------------- | ------------------------------- | ------ |
| 01 | [ht CLI: socket discovery + log path + `ht log`](plan_ht_cli_socket_and_logs.md) | `bin/ht`, `src/bun/rpc-handlers/system.ts`, `src/bun/logger.ts` | S      |
| 02 | [Smart status-key system (`_pct`, `_lineGraph`, `_array`, hidden `_`)](plan_status_keys_smart.md) ✅ shipped (commit C — full v2 catalogue, 38 renderers) | `src/shared/status-key.ts`, `src/views/terminal/status-renderers.ts`, sidebar status renderer, `bin/ht set-status`, `shareBin/demo_status_keys` | L      |
| 03 | [Notification overlay + auto-accept Claude prompts](plan_notifications.md) | `notification.ts`, `claude-integration/`, webview overlay | M      |
| 04 | [Sideband overlay always visible (focus transparency bug)](plan_sideband_overlay.md) | `src/views/terminal/panel.ts`, `panel-manager.ts`, `index.css` | S      |
| 05 | [shareBin: rewrite all utilities in TS/mjs (no Python)](plan_sharebin_native.md) | `scripts/`, `shareBin/` | M      |
| 06 | [Sidebar workspace card: flicker fix + modular settings](plan_workspace_card.md) | `src/views/terminal/sidebar.ts`, `sidebar-state.ts`, `settings-panel.ts` | M      |
| 07 | [Telegram resilience: crash must not break ht/notifications](plan_telegram_resilience.md) | `src/bun/telegram-service.ts`, `app-context.ts`, `socket-server.ts` | M      |
| 08 | [Telegram smart buttons on turn-end notifications](plan_telegram_smart_buttons.md) ✅ shipped (v1.1 — OK / No / Continue / Cancel; ctrl+\* added to KEY_MAP) | `src/bun/telegram-service.ts`, `src/bun/telegram-button-dispatch.ts`, `src/bun/rpc-handlers/shared.ts`, `claude-integration/`, `pi-extensions/` | M      |
| 09 | [Plan panel in τ-mux: agent plan + auto-continue](plan_agent_plan_panel.md) | new pane kind, `agent-panel.ts`, sideband | L      |
| 10 | [User-request panel in τ-mux (agent asks user via UI)](plan_user_request_panel.md) | `prompt-dialog.ts`, agent runtime, telegram | M      |
| 11 | [OSC 9;4 progress reporting passthrough](plan_osc_progress.md) | xterm.js parser hook, status surface | M      |
| 12 | [Terminal scroll-to-top regression](plan_terminal_scroll_fix.md) | `surface-manager.ts`, xterm wiring | S      |
| 13 | [Web mirror parity with bridge view + mobile/touch UI](plan_web_mirror_parity.md) | `src/bun/web/`, `src/web-client/` | L      |
| 14 | [Misc audits: git-author audit, sidebar resize line-height](plan_audit_misc.md) | startup audit, css rendering | S      |

## Reading order

If picking up cold, read `plan_ht_cli_socket_and_logs.md` (#01) first —
it documents the current `HT_SOCKET_PATH` discovery story which several
other plans depend on. Then `plan_status_keys_smart.md` (#02) is the
biggest design surface and changes the contract every other status
producer uses.

## Execution protocol — tracking files are mandatory

When an agent picks up a plan and starts executing it, it **must**
maintain a sibling tracking file next to the plan:

```
plan_<thing-to-do>.md          ← the plan itself (read-only during execution)
tracking_<thing-to-do>.md      ← living log, updated by the executing agent
```

Naming: identical suffix as the plan. Plan
`plan_status_keys_smart.md` → tracking `tracking_status_keys_smart.md`.

### What goes in `tracking_*.md`

The tracking file is the agent's running journal. At minimum:

1. **Status header** — `not started | in progress | blocked | done`,
   plus the date the status last changed (absolute, e.g. `2026-04-26`).
2. **Step-by-step progress** — checkbox list mirroring the plan's
   "Implementation" section. Tick boxes as the work lands; do **not**
   edit the plan itself.
3. **Deviations from the plan** — every time you do something
   different from what the plan prescribed (skipped a step, picked a
   different file, changed an API shape, added a missing step), log
   it as a dated entry with the *why*. The plan's value drops fast if
   the tracking file lies about what was actually done.
4. **Issues encountered** — bugs, surprises, things that didn't work
   the first time, third-party glitches. Include the diagnostic that
   resolved each one (so the next agent doesn't re-debug).
5. **Open questions for the user** — anything you couldn't decide
   alone. Park here instead of guessing.
6. **Verification log** — what tests / typecheck / `bun start` runs
   passed, and any baseline updates (`bun run baseline:design`).
7. **Pointers to commits / PRs** — short SHAs of every commit
   produced under this plan.

### Frequency

Update on every meaningful change — at minimum once per work session.
Treat the tracking file like a commit message you'd be willing to
hand to the next person who picks up the work cold.

### When the work lands

Final state: tracking file says `done` with a brief retrospective
(what worked, what we'd do differently). The plan stays untouched as
the original spec; the tracking file is the historical record. Both
files stay in `doc/todos/` — they are part of the project's memory.

## Status

Most plans are still **proposed, not started**. Two are fully closed
and tracked retrospectively in `tracking_*.md`:

- **#02 Smart status-key system** — closed at commit C (2026-04-27).
  Catalogue covers 38 renderers across 6 families (numeric · time ·
  state · chart · data · rich). Live demo at
  `shareBin/demo_status_keys`. Tracking files:
  [`tracking_status_keys_smart.md`](tracking_status_keys_smart.md)
  (commit A) ·
  [`tracking_status_keys_smart_b.md`](tracking_status_keys_smart_b.md)
  (commit B) ·
  [`tracking_status_keys_smart_c.md`](tracking_status_keys_smart_c.md)
  (commit C).
- **#08 Telegram smart buttons** — closed at v1.1 (2026-04-27). Four
  buttons (OK / No / Continue / Cancel) drive the focused surface
  through `surface.send_text` + `surface.send_key`. Cancel-fix added
  the `ctrl+*` family to `KEY_MAP`. Tracking:
  [`tracking_telegram_smart_buttons.md`](tracking_telegram_smart_buttons.md).

Other plans remain open; the first agent to start each one creates
the matching `tracking_*.md` and updates the row above with a status
flag. Implementation order is gated on user prioritisation.
