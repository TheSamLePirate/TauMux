# Tracking — august-plan.md (AAA Claude Code integration)

**Plan:** `doc/august-plan.md` · **Started:** 2026-08-02 · **Base version:** 0.4.12 (`29bc68c3`)

Legend: ✅ done · 🔄 in progress · ⏸ pending · ⚠️ deviation (explained inline)

## Milestone status

| Milestone | Target | Status | Version | Commit |
|---|---|---|---|---|
| M1 — "τ-mux sees Claude" (WS1 + WS1b + WS2) | 0.5.0 | ✅ | 0.5.0 | `4287936f` |
| M2 — "τ-mux acts for Claude" (WS3 + WS4 + WS7) | 0.6.0 | ✅ | 0.6.0 | _see below_ |
| M3 — "Claude lives in τ-mux" (WS5 + WS8) | 0.7.0 | ⏸ | — | — |
| M4 — "AAA" (WS6 + WS9) | 0.8.0 | ⏸ | — | — |

## M1 detail

| Item | Status | Notes |
|---|---|---|
| `src/shared/claude-types.ts` — event/state/statusline types + helpers | ✅ | |
| `src/shared/claude-statusline.ts` — parse + ANSI render (pure) | ✅ | thresholds exported, shared with future sidebar meter |
| `src/bun/claude-session-registry.ts` — reducer + registry | ✅ | TTLs: 24 h stale / 5 min ended; cap 200 sessions |
| `src/bun/claude-status-presenter.ts` — pills + notifications | ✅ | drives `sidebar.set_status` / `notification.create` through the local dispatcher |
| `src/bun/claude-integration.ts` — assembly (index.ts stays wiring-only) | ✅ | |
| `src/bun/rpc-handlers/claude.ts` — `claude.event/statusline/sessions` | ✅ | registered via `claudeRegistry` option |
| `ht claude …` CLI (`map-command.ts` + `bin/ht`) | ✅ | `statusline` intercepted in main() (stdin + print-before-tee) |
| Bridge v2 rewrite (14 events; pure `build-event.ts`) | ✅ | deleted: transcript parser, pricing table, pi title sidecar, temp-file state (~900 → ~150 LOC) |
| `settings.snippet.jsonc` v2 (statusLine + 14 hooks) | ✅ | v1 event names unchanged — additive migration |
| READMEs (`claude-integration/`, `ht-bridge/`) | ✅ | |
| SDK namespace (`packages/tau-mux-sdk` `claude.*`) | ✅ | required by `sdk-api-coverage` gate |
| Tests | ✅ | 5 new files, 73 tests: registry reducer, statusline parse/render, presenter pills/notifications, bridge fixtures + wire-contract lock, RPC + CLI mapping |
| Gates | ✅ | `bun test` 3243/3243 · typecheck clean · lint 0 errors · emoji audit clean · module-size ratchet green |
| `bun start` + live E2E | ✅ | dev app boots; `claude event` → phase working; statusline tee → title/cost/ctx in `ht claude sessions`; `stop` → notification `"Claude · E2E smoke · 11s · $0.05"` through the real pipeline |

## M2 detail

| Item | Status | Notes |
|---|---|---|
| WS3 — `permission-request` sync bridge path (`permission.ts` + handler) | ✅ | exact decision JSON locked against docs schema; watchdog past ask timeout |
| WS3 — registry `permission-request` / `permission-resolved` phases + `approvalMessage` | ✅ | |
| WS3 — modal via existing `ht ask choice` (+ Telegram forward for free) | ✅ | Allow / Deny / "Answer in terminal" |
| WS3 — fail-safe paths (timeout / hang / no-surface / disabled / terminal) | ✅ | subprocess tests prove empty stdout + exit 0 on every one |
| WS4 — `claude-plan-mirror.ts` → PlanStore (`claude:<short-id>` slot) | ✅ | dedup fingerprint; workspace-move retraction; session-end clear |
| WS4 — auto-continue synergy | ✅ (composition) | presenter's turn-end notification + mirrored plan feed the existing engine — no new code path; the native Stop-hook `decision:block` variant deferred (see deviations) |
| WS7 — `ht claude install/uninstall` (settings.json surgery) | ✅ | backup, additive, idempotent, refuse-on-parse-failure, `--dry-run`, feature buckets lifecycle/tasks/statusline/approvals (approvals opt-in) |
| WS7 — `ht claude doctor` | ✅ | binary version, hooks wired/missing, approvals, statusline (ours/other/none), skill, app reachability incl. "pre-0.5.0" detection |
| Tests | ✅ | +37: permission pure/registry/subprocess-e2e (fake ht), plan mirror, installer fixtures |
| Gates | ✅ | 3280 pass / typecheck / lint / emoji / module-size all green |

## Deviations from plan

1. **⚠️ Module-size baseline promoted (+7 lines on `src/bun/index.ts`, 3209 → 3216).**
   The file was exactly at its ratchet ceiling; the four wiring lines the new
   subsystem needs (import, construct, handler option, presenter attach) had
   nowhere else to live. All real code went to new modules
   (`claude-integration.ts` et al.); the promote is the ratchet's documented
   escape hatch and is visible in this diff.
2. **⚠️ M1 acceptance "pane header chip" deferred to M4/WS9.** Sidebar pills +
   notifications + `ht claude sessions` cover M1 visibility without touching
   webview modules; the dedicated pane chip lands with the sessions panel
   (WS9) where the webview work is batched. Plan §5/WS1 acceptance otherwise met.
3. **Drive-by fix:** `bin/ht` used `readFileSync` without importing it —
   piped `ht telegram send` would have thrown ReferenceError. Import added.
4. **⚠️ M2: Settings → Claude Code GUI tab deferred to M4/WS9.** The
   installer shipped as `ht claude install/uninstall/doctor` (CLI) instead:
   same function, fully fixture-tested, and it works for headless/SSH
   installs too. The GUI tab batches with M4's webview wave (sessions
   panel) so the webview gets one coherent change set.
5. **⚠️ M2/WS4: native Stop-hook auto-continue (`decision: "block"`) deferred.**
   The synergy the plan wanted exists by composition today (mirrored plan +
   turn-end notification → existing engine, same runaway gates). The
   in-band Stop-hook variant needs its own runaway-budget design; parked
   for M4 evaluation rather than rushed.
6. **⚠️ M2/WS7: bridge is not yet bundled into the .app.** `ht claude
   install` requires the bridge dir (repo `install.sh` symlink) and says so
   with a clear error; bundling a copy into Resources + copy-install is an
   M4 packaging task.
7. **Transition note:** the bridge is symlink-installed, so v2 went live for
   the user's hooks immediately. Against the still-running 0.4.7 app,
   `claude.event` is an unknown method → `ht` fails silently (fire-and-forget
   holds, verified). Pills resume once the user restarts τ-mux on ≥0.5.0.
   The v1-era `$TMPDIR/ht-claude-bridge/` state dir is orphaned (24 h TTL
   never prunes now) — one-off manual cleanup, noted in the README.

## Doc obligations ledger

- `doc/changes_to_document.md` — ✅ M1 entry added (changelog + cli + api +
  install docs, en + fr) — fold on next user-driven docs sweep.
- website-doc — due at M2 boundary per plan §6.

## Log

- **2026-08-02** — Plan authored (`doc/august-plan.md`). Tracking file created.
- **2026-08-02** — M1 implemented end-to-end: shared types + registry +
  presenter + RPC handlers + CLI verbs + statusline renderer + bridge v2 +
  SDK namespace + 73 tests. Three repo gates tripped and resolved (emoji in
  statusline → removed; module-size ratchet → new module + explicit promote;
  SDK coverage → claude namespace). Full suite 3243 pass / 0 fail. Live E2E
  against a dev instance verified (event → sessions → notification with
  duration + cost; statusline render < 130 ms wall incl. bun startup).
