# Tracking — august-plan.md (AAA Claude Code integration)

**Plan:** `doc/august-plan.md` · **Started:** 2026-08-02 · **Base version:** 0.4.12 (`29bc68c3`)

Legend: ✅ done · 🔄 in progress · ⏸ pending · ⚠️ deviation (explained inline)

## Milestone status

| Milestone | Target | Status | Version | Commit |
|---|---|---|---|---|
| M1 — "τ-mux sees Claude" (WS1 + WS1b + WS2) | 0.5.0 | ✅ | 0.5.0 | `4287936f` |
| M2 — "τ-mux acts for Claude" (WS3 + WS4 + WS7) | 0.6.0 | ✅ | 0.6.0 | `e2cea5e3` |
| M3 — "Claude lives in τ-mux" (WS5 + WS8) | 0.7.0 | ✅ | 0.7.0 | `50cbee6a` |
| M4 — "AAA" (WS6 + WS9) | 0.8.0 | 🔶 partial (0.7.2) | — | `fb73fce6` + docs `957e6437` |

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

## M3 detail (in progress)

| Item | Status | Notes |
|---|---|---|
| Skill v2 (2.0.0) — mirror-aware, slimmed | ✅ | committed `0ada7222` |
| `@anthropic-ai/claude-agent-sdk` pinned 0.3.220 | ✅ | bundles CC 2.1.220 — matches user's installed CLI |
| `src/bun/claude-agent-manager.ts` + 7 fake-query tests | ✅ | committed `0ada7222` |
| Shared types: `SurfaceKind` + RPC messages for the pane | ✅ | `592d4b67` |
| Bun: handlers slice + ctx + `claude-pane-host.ts` (manager, factory, session lister) | ✅ | `592d4b67` + `23159e71` |
| canUseTool → ask-user queue wiring (same modal as WS3) | ✅ | in claude-pane-host; deny-on-timeout |
| Webview: pane view + controller + bridge + SurfaceManager methods + palette entries + CSS | ✅ | 4 new modules (`claude-agent-pane`, `claude-surface-controller`, `claude-pane-bridge`, + host); 12 DOM tests |
| Bun: `tryRestoreLayout` branch `surfType === "claude"` | ✅ | fresh session on restore; resume via Sessions picker |
| Session browser (SDK `listSessions` → picker; resume in split) | ✅ | resume opens a new pane bound to the old session (SDK can't swap sessions in a live stream) |
| Gates + `bun start` | ✅ | 3299 tests green · typecheck · web-client bundles · app boots + terminal works |
| MCP spike (WS8) | ✅ decided | **Evaluated → skipped for v1.** The `ht` CLI surface already works and is token-free per session; MCP tool schemas would cost context in every Claude session for a duplicate surface. Revisit post-M4 only if skill activation proves unreliable in practice. |

**Continuation map (exact wiring steps, CLAUDE.md non-PTY checklist):**
1. `src/shared/types.ts`: add `"claude"` to `SurfaceKind`; webview→bun
   messages `claudeAgentCreate {cwd?, model?, resume?, split?, direction?}`,
   `claudeAgentPrompt {surfaceId, text}`, `claudeAgentInterrupt {surfaceId}`,
   `claudeAgentSetModel {surfaceId, model}`, `claudeAgentSetMode {surfaceId,
   mode}`, `claudeAgentListSessions {}`; bun→webview `claudeAgentSurfaceCreated
   {surfaceId, split?}`, `claudeAgentEvent {surfaceId, event}`,
   `claudeAgentExit {surfaceId, error}`, `claudeAgentSessions {sessions}`.
2. Webview: `claude-agent-pane.ts` (header: model/mode/cost pills + interrupt;
   transcript: user/assistant/tool cards; composer) + `claude-agent-surface-
   controller.ts` (htEvents emit like TelegramSurfaceController) + Surface-
   Manager `addClaudeSurface/addClaudeSurfaceAsSplit/removeClaudeSurface` +
   `applyLayout` skip-fit + CSS (reuse `agent-panel` classes where possible).
3. Bun `index.ts`: construct `ClaudeAgentManager` with `askUser` bridged to
   the ask-user queue (kind "choice", allow/deny — same as WS3), handlers for
   the new messages gated by `satisfies BunMessageHandlers`, event fan-out
   `claudeAgentEvent`, `tryRestoreLayout` branch `surfType === "claude"` →
   re-mount pane (fresh session; resume affordance in-pane).
4. `ht` CLI: `claude pane [--cwd]` → RPC `claude.open_pane` (optional v1).
5. Tests: pane view DOM smoke (happy-dom like telegram-pane tests), message
   handler roundtrip, restore branch.

## Pane v3 — design-system alignment (user-requested, 0.9.0)

User: "make the UI/UX much better, better color theme, better visual effects,
best integration possible." Root cause found by reading the design system
first: **the pane used a Catppuccin palette inherited from the v1 hook
bridge**, and `surfaceIdentity()` mapped `claude` → `human` (cyan), so an
agent session rendered in the human identity colour — a §7 violation.

| Item | Status | Notes |
|---|---|---|
| §7 identity — `surfaceIdentity("claude") === "agent"` | ✅ | amber propagates free to focus ring, sidebar card, status bar, notification dot |
| Shared primitives — `IdentityDot` + `TabBadge` status | ✅ | pulse (`tauPulse`) + focus glow inherited; dot stays pure identity, phase moves to a badge |
| Full TAU palette (no raw hex) | ✅ | every colour a `--tau-*` token; theming audit clean |
| §3 radius scale + 4 px grid | ✅ | `--tau-r-pane/btn/chip`, nothing > 12 px |
| §10 canonical motion only | ✅ | `tauPulse` / `tauBlink` / existing `agent-msg-in`; no new keyframes |
| §4.1 typography roles | ✅ | sans chrome, mono for telemetry/paths/commands (tabular numerals) |
| Grouped control strip (§5.1) | ✅ | identity+config left, meters+actions right |
| Queued-message feedback | ✅ | dashed bubble + footer chip; clears when the turn drains |
| Copy affordance on assistant messages | ✅ | hover, carries markdown source |
| cwd everywhere (header + surface chip + sidebar card) | ✅ | seeded at create, refreshed from SDK `init`; synthetic metadata for a pid-less pane |
| `ht claude pane` / `claude.pane` RPC / SDK namespace | ✅ | closes the gap vs `agent.create`; also how this pass was screenshot-verified |
| Tests | ✅ | +8 design-conformance (palette/radius/motion/identity/primitives) +3 behaviour; 3331 green |
| Gates | ✅ | typecheck · lint · emoji · animations · guideline do/don'ts · theming · module-size |
| Visual verification | ✅ | live screenshots of the pane in-app (empty state + full window) |

**Deviation:** ratchet promotes on `surface-manager.ts` (+7 wiring) and
`bun/index.ts` (+1); the synthetic-metadata builder was extracted to
`claude-surface-controller.ts` rather than left inline in the god module.

## Pane v2 (user-requested, 0.8.0)

The user judged the M3 pane "not good enough" — full-feature pass:

| Item | Status | Notes |
|---|---|---|
| Markdown transcript (shared `mdLite`), O(N) streaming live-element | ✅ | pi-pane pattern; HTML-injection test locked |
| Thinking blocks (streamed, collapsed, pulsing) | ✅ | |
| Tool cards v2: status dot, expandable input + `tool_use_id`-matched output, copy buttons, failure styling | ✅ | output capped 4k chars |
| In-place New / Resume / Fork (`manager.replace` rebind + `getSessionMessages` history replay under a divider) | ✅ | old stream's observers detached first — no ghost "session ended" |
| Inline approval status (synthetic `__tau_permission` events from the host) | ✅ | pending row → denied/timeout record |
| Model switcher (mid-session; session's real model auto-added) + mode switcher w/ bypass highlight | ✅ | |
| Meters (tokens/cost/elapsed) + pulsing state dot + smart autoscroll + jump pill + empty state | ✅ | |
| cwd inheritance (new panes start in the focused pane's cwd via metadata poller) | ✅ | |
| Composer: autoResize, queue-while-streaming, local echo deduped against SDK replay | ✅ | |
| Design governance | ✅ | emoji audit (glyphs → icon/CSS), canonical keyframes (tauBlink/tauNotifyPulse), radius ≤12px — all three audits caught my first draft and were fixed |
| Tests | ✅ | pane suite rewritten: 23 DOM/pure tests; manager `replace` test; 3316 total green |
| Docs | ✅ | features/claude-code-pane rewritten (EN+FR), 0.8.0 changelog section (EN+FR), site builds 149 pages |

## User bug reports (0.8.1)

| Report | Root cause | Fix |
|---|---|---|
| "Cannot close the Claude pane (X does nothing)" | bun's polymorphic `closeSurface` had no `claude-agent:` branch — the id fell through to the PTY close, which no-ops on unknown ids, so no `surfaceClosed` echo ever removed the pane | branch added (close SDK agent + echo); routing locked by `tests/claude-pane-close.test.ts` |
| "Plan panel shows only that there is a plan, no information" | Claude Code's real TaskCreated payload carries **`task_subject`** (+ `task_description`) — not the doc-described `task_name` we read; steps got empty names, titles degraded to bare numeric ids. Verified by capturing a live hook payload (CC 2.1.220) | bridge reads `task_subject` (with `task_name` fallback) + forwards `task_description`; registry stores descriptions; mirror titles = subject → description first-clause → `task <id>`, capped 80 chars; `PlanStep.description` threaded through store + panel as a hover tooltip |

## M4 detail (partial — 0.7.1)

| Item | Status | Notes |
|---|---|---|
| WS6 — `claude-team-watcher.ts` (teams/tasks dirs → sidebar `team` pill) | ✅ | schema-defensive, silent when unused, 5 fixture tests |
| WS9 — `doc/system-claude-integration.md` (architecture + trust model) | ✅ | |
| WS9 — palette entries (New Claude Code Pane / splits) | ✅ | shipped with M3 |
| WS9 — sessions section in the sidebar | ⏸ REMAINING | new module (NOT sidebar.ts growth): list live registry sessions w/ phase dot + ctx meter + cost, click→focus; needs a `claudeSessions` push bun→webview or reuse of `claude.sessions` polling |
| WS7→M4 — Settings → Claude Code GUI tab | ⏸ REMAINING | `settings-claude.ts` section calling a new `claude.install*` RPC that shells the same `claude-settings-edit.ts` functions |
| WS9 — keyboard ⌘⌥C, approval sound, a11y pass on new DOM | ⏸ REMAINING | `KEYBOARD_BINDINGS` entry → `claudeAgentCreate`; `claudeApprovalSound` setting per `notificationSound*` pattern |
| WS9 — pane-header Claude phase chip (deferred from M1) | ⏸ REMAINING | `renderSurfaceChips` + registry state push |
| M2 deferral — bridge bundling into .app + copy-install | ⏸ REMAINING | electrobun.config copy rule + installer copy path |
| WS9 — website-doc sweep (EN + FR, version-stamped) | ✅ | user-requested 2026-08-02: 3 changelog sections (incl. the two pre-plan pending waves), claude-code integration rewrite, 3 new page pairs (features/claude-code-pane, cli/claude, api/claude), settings/auth-hardening/extensions edits — all EN+FR; site builds (149 pages); backlog cleared |
| M4 completion gate (→ 0.8.0) | ⏸ | close the REMAINING rows above, then `bun run bump:minor` |

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
7. **⚠️ M3 v1 pane scope (per plan §WS5 non-goals + additions):** images,
   MCP management UI, subagent transcripts, checkpoint/rewind, and slash
   parity are out, as planned. Additionally deferred beyond the plan's
   list: mid-session model *switcher UI* (RPC + manager support exist;
   no dropdown yet — palette/M4), fork-from-picker (resume only; `fork`
   is wired through the whole stack but no UI toggle), and in-pane
   visual verification (app boots + 12 DOM tests cover the pane; a
   human click-through of the palette flow is recommended before
   release).
8. **⚠️ M3 ratchet promotes:** bun/index.ts +14 (restore branch),
   views/index.ts +50 (palette + message registries), surface-manager.ts
   +82 (the per-kind surface pattern lives there by design). All logic
   is in the 4 new modules; the promoted lines are registry entries.
9. **Transition note:** the bridge is symlink-installed, so v2 went live for
   the user's hooks immediately. Against the still-running 0.4.7 app,
   `claude.event` is an unknown method → `ht` fails silently (fire-and-forget
   holds, verified). Pills resume once the user restarts τ-mux on ≥0.5.0.
   The v1-era `$TMPDIR/ht-claude-bridge/` state dir is orphaned (24 h TTL
   never prunes now) — one-off manual cleanup, noted in the README.

## Doc obligations ledger

- `doc/changes_to_document.md` — ✅ M1 entry added (changelog + cli + api +
  install docs, en + fr) — fold on next user-driven docs sweep.
- website-doc — due at M2 boundary per plan §6.

## Log (see git for full detail)

- **2026-08-02** — Plan authored (`doc/august-plan.md`). Tracking file created.
- **2026-08-02** — M1 implemented end-to-end: shared types + registry +
  presenter + RPC handlers + CLI verbs + statusline renderer + bridge v2 +
  SDK namespace + 73 tests. Three repo gates tripped and resolved (emoji in
  statusline → removed; module-size ratchet → new module + explicit promote;
  SDK coverage → claude namespace). Full suite 3243 pass / 0 fail. Live E2E
  against a dev instance verified (event → sessions → notification with
  duration + cost; statusline render < 130 ms wall incl. bun startup).
