# August Plan — τ-mux × Claude Code: AAA Harness Integration

**Date:** 2026-08-02
**App version at planning:** 0.4.12 (`29bc68c3`)
**Claude Code version researched:** 2.1.x (hooks reference, statusline, Agent SDK, agent teams — verified against code.claude.com/docs on 2026-08-02)
**Tracking file (create on first implementation commit):** `doc/tracking_august-plan.md`

---

## 1. Vision

τ-mux should be **the best desktop environment to run Claude Code in** — the harness *around* the harness. Not a Claude Code replacement, not a wrapper that hides it: a terminal that *understands* it. When a Claude Code session runs in a pane, τ-mux should know its state (thinking / working / waiting / blocked), its cost, its context pressure, its plan, its subagents — and should let the user act on all of it (approve a permission from the sidebar or from their phone, resume a session from a browser UI, watch an agent team fan out across panes) without ever touching the raw TTY.

The pi agent pane proved the pattern: a coding agent as a first-class surface. Claude Code is the user's **main** harness, and it deserves the same first-class treatment — better, because Claude Code exposes a far richer integration surface than pi does.

**Definition of AAA for this plan:**

1. **Zero-config** — τ-mux detects Claude Code, installs/updates its own integration from the Settings panel, and `ht claude doctor` proves it's healthy. No manual settings.json surgery.
2. **Native fidelity** — never recompute what Claude Code already computes. Cost, context %, rate limits, session titles all come from Claude Code's own data feeds, not from reimplemented pricing tables.
3. **Actionable, not just visible** — every state τ-mux shows (waiting, permission-needed, task list) has a one-click action attached (focus pane, approve/deny, view plan), locally and via Telegram.
4. **Degrades gracefully** — every feature is a no-op when Claude Code is absent, old, or the hooks aren't installed. Nothing ever blocks Claude Code's hook pipeline or the PTY.

---

## 2. Where we are (honest audit of the current integration)

### 2.1 What exists

| Piece | State |
|---|---|
| `claude-integration/ht-bridge/` | Shell-hook runner on **3 events** (`UserPromptSubmit`, `Stop`, `Notification` idle/permission). Drives active-label pill, `cc` ticker, idle/permission pill colors, Stop notification. |
| `claude-integration/skills/tau-mux/` | Instructional skill: teaches Claude to use `ht ask / plan / notify / new-split / browser / screenshot / set-status`. Solid content, well-scoped. |
| `settings.snippet.jsonc` + `install.sh` | Manual install: symlink + copy-paste JSON merge by hand. |
| Sidebar / notification / plan-panel / ask-user plumbing | All the τ-mux-side machinery the integration needs already exists and is battle-tested (used by the pi bridge, Telegram, `ht`). |

### 2.2 What's wrong with it

1. **It uses 3 of ~30 hook events.** Claude Code today fires `SessionStart/SessionEnd`, `PreToolUse/PostToolUse/PostToolUseFailure`, `PermissionRequest/PermissionDenied`, `SubagentStart/SubagentStop`, `TaskCreated/TaskCompleted`, `TeammateIdle`, `PreCompact/PostCompact`, `StopFailure`, `CwdChanged`, `Notification` with rich `notification_type`s, and more. We see almost none of the session lifecycle.
2. **The cost pipeline is a reimplementation, and it's already stale.** `ht-bridge/src/index.ts` parses the transcript JSONL and multiplies by a **hardcoded pricing table that only knows Claude 4.x models** — the Claude 5 family (Opus 5, Fable 5) prices as a fuzzy "opus" guess. Meanwhile Claude Code's **statusline feed hands us `cost.total_cost_usd`, `context_window.used_percentage`, `rate_limits.*` — computed client-side by Claude Code itself.** ~200 lines of transcript parsing + pricing should be deleted, not maintained.
3. **The title sidecar is a Rube Goldberg machine.** We spawn `pi -p --model openai/gpt-5-nano` to generate a 3–5-word title *for a Claude session* — a dependency on a second agent CLI and a third-party model, with a 5 s timeout and ghost-pill guards to manage the race. Claude Code **already generates a session title** and hands it to us as `session_name` in the statusline feed (and `sessionTitle` is even settable via SessionStart hook output). The sidecar should be deleted.
4. **Permission prompts are dead-ends.** Today a permission request turns a pill red and fires a notification — then the user must go find the right pane and type in the TTY. Claude Code's `PermissionRequest` hook supports **synchronous decision control** (`decision.behavior: allow/deny`, `updatedInput`). τ-mux has `ht ask` with modal + Telegram forwarding. Nobody has connected these two. This is the single highest-value missing feature: **approve/deny from the sidebar or from your phone.**
5. **Plan mirroring is instruction-based, so it's unreliable.** The skill asks Claude to run `ht plan set`. When Claude forgets (or the skill doesn't activate), the plan panel is empty. Claude Code's `TaskCreated`/`TaskCompleted` hooks fire **deterministically** on its native task list — a passive mirror needs no model cooperation.
6. **No session awareness.** No browser of `~/.claude/projects/*/`*.jsonl sessions, no resume/fork UI, no "which pane is which session". The pi pane has all of this; Claude Code — the main harness — has none.
7. **No subagent / agent-team visibility.** Claude Code's agent teams put display-mode integration behind **tmux/iTerm2 only** — a pane multiplexer that *understands teams* is exactly what τ-mux is, and we render nothing.
8. **Install is manual and fragile.** Copy-paste JSON merging into `~/.claude/settings.json` by hand, with prose instructions ("drop the afplay line, keep the superset-notify block"). One typo breaks every hook.

### 2.3 What the app audit adds (context from `doc/full_app_review_2026-08.md`)

The 2026-08 audit is orthogonal but two items intersect: the RPC socket token (§2.5, now ON by default — the bridge's `ht` calls already handle it) and god-module growth (§3.6 — new integration code must land in **new modules**, not in `sidebar.ts`/`index.ts`). This plan treats both as constraints.

---

## 3. What Claude Code offers us (capability map, v2.1.x)

The integration surface, ranked by value to τ-mux:

| Surface | What it gives us | τ-mux consumer |
|---|---|---|
| **Statusline command** (`statusLine` in settings.json) | JSON on stdin on every assistant message / compact / mode change: `model`, `cost.total_cost_usd`, `cost.total_lines_added/removed`, `context_window.used_percentage`, `rate_limits.five_hour/seven_day`, `session_id`, `session_name`, `permission_mode`, `effort.level`, `pr.number/review_state`, `transcript_path`, `workspace.*` | The entire data layer for pills/tickers/meters — replaces transcript parsing, pricing tables, and the title sidecar |
| **`PermissionRequest` hook** | Synchronous allow/deny decision with `updatedInput`, timeout-safe | `ht ask` modal + Telegram → remote approval |
| **`TaskCreated` / `TaskCompleted` hooks** | Deterministic task-list lifecycle | Plan panel passive mirror |
| **`SessionStart` / `SessionEnd` hooks** | `source` (startup/resume/clear/compact/fork), `reason`; `additionalContext` injection | Session pills per pane, env priming, state cleanup |
| **`SubagentStart` / `SubagentStop`** | `agent_type`, `agent_id` | Live subagent chips on the pane header |
| **`StopFailure`** | `error_type` (rate_limit / overloaded / auth) | Error pill + actionable notification |
| **`PreCompact` / `PostCompact`** | compaction trigger + stats | Context-pressure pill state ("compacting…") |
| **`CwdChanged`** | old/new cwd | Instant cwd chip update (vs 1 Hz poller lag) |
| **`Notification` hook** | `notification_type`: permission_prompt, idle_prompt, auth_success, elicitation_*, agent_* | Typed routing instead of 2 matchers |
| **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | `query()` with streaming input, `canUseTool` callback, `interrupt()`, `setModel`/`setPermissionMode`, `listSessions`/`getSessionMessages`, resume/fork, hooks in-process | The native Claude pane (WS5) |
| **Agent teams** (experimental) | `~/.claude/teams/{name}/config.json` (members, state), `~/.claude/tasks/{name}/` (shared task list), `TeammateIdle` hook | Team dashboard in sidebar; teammate panes |
| **Sessions on disk** | `~/.claude/projects/<slug>/*.jsonl` + SDK `listSessions` | Session browser / resume UI |
| **Universal hook fields** | every event carries `session_id`, `transcript_path`, `cwd`, `permission_mode` | Session↔pane attribution (joined with `HT_SURFACE` env) |

Design consequence: **the statusline feed is the data plane; hooks are the event plane.** Everything τ-mux renders should be derivable from those two, and both arrive through one funnel (`ht`-mediated RPC into the bun process).

---

## 4. Design principles

1. **Passive before active.** Hooks + statusline (no model cooperation needed) are the foundation; skill/MCP instructions (model cooperation) are the enhancement layer. A feature that only works when the model remembers to call a CLI is a demo, not a feature.
2. **One state store in bun.** All Claude session state (per `session_id`: pane attribution, phase, cost, context %, tasks, subagents) lives in a new `src/bun/claude-session-registry.ts`, fed by RPC from the bridge/statusline, consumed by sidebar, pane chips, Telegram, and the web mirror through the existing pipelines. No webview-side session logic.
3. **Never block the hook pipeline.** Every hook handler stays fire-and-forget with the existing spawn-and-ignore pattern — except `PermissionRequest`, which is *deliberately* synchronous (that's its contract) and must implement its own timeout + safe-fallback (`ask` passthrough on any failure).
4. **New code in new modules.** Audit §3.6 constraint: no growth in `sidebar.ts` / `bun/index.ts` / `views/index.ts` beyond wiring lines. Target files are listed per workstream.
5. **Claude Code versions drift; degrade explicitly.** Gate features on hook payload presence, not CC version parsing. `ht claude doctor` reports what the installed CC supports.
6. **Respect the trust model.** Hooks run arbitrary shell — our installer edits `~/.claude/settings.json`, which is user-owned config. Always: timestamped backup, additive merge, show a diff, never touch unrelated keys. Document in `doc/system-security.md`.

---

## 5. Workstreams

### WS1 — Bridge v2: full-lifecycle hooks (foundation)

Rewrite `claude-integration/ht-bridge/` around the full event set. Keep the architecture (bun script, argv event, stdin JSON, fire-and-forget `ht` calls, `$TMPDIR` state) — it's proven. Change what flows through it.

**Events to add** (all optional to install; installer defaults sensible):

| Hook | Bridge behavior |
|---|---|
| `SessionStart` | Register session → `ht claude session-start` RPC: session_id, cwd, `HT_SURFACE` (inherited env = pane attribution), source (startup/resume/fork). Creates the per-pane session pill. |
| `SessionEnd` | Deregister; clear pills for that session; final notification only if turn was in flight. |
| `Stop` | Keep (notification + ticker refresh), minus all transcript parsing (WS2 provides the data). |
| `StopFailure` | Red pill + notification with `error_type` ("rate limited — resets 14:00" using statusline `rate_limits.resets_at`). |
| `SubagentStart` / `SubagentStop` | Increment/decrement live subagent count per session → pane chip `⑂ 2 agents`. |
| `PreCompact` / `PostCompact` | Pill state "compacting…" → back, context meter refresh. |
| `CwdChanged` | Push cwd → instant chip update (poller catches up later; this removes 1 Hz lag). |
| `Notification` | Route by `notification_type` (typed), not by 2 hand-matched strings. |
| `UserPromptSubmit` | Keep (turn start, label from prompt first-clause as *immediate* value; real title arrives via statusline `session_name`). |

**Deletions:** transcript parser, pricing table, `calcCost`, `findFuzzyPrice`, the entire pi title sidecar (`spawnTitleSidecar`, `runTitleSidecar`, `buildTitlePrompt`, `handleTitle`, `titlePi*` config). Net LOC should go **down**.

**New `ht` verbs** (thin RPC mappings in `src/cli/map-command.ts` + a new `src/bun/rpc-handlers/claude.ts`): `ht claude session-start|session-end|event` (generic typed event ingestion) — the bridge sends one small JSON per event; the registry (WS1b) interprets.

**WS1b — `src/bun/claude-session-registry.ts`** (new module): the single source of truth. Holds `Map<sessionId, ClaudeSessionState>` with pane attribution, phase (`idle|thinking|working|waiting-input|waiting-approval|compacting|error`), turn count, cost, context %, rate limits, subagent count, tasks. Emits diffs on the existing event bus → sidebar section, pane chips, web mirror. Fully unit-testable (pure reducer + thin IO shell, same pattern as `surface-metadata.ts`).

**Acceptance:** hooks installed → open a shell pane, run `claude`, prompt it: pane header shows a Claude chip cycling thinking→working→done; sidebar shows the session with live phase; kill the app mid-session → next `ht` call from a hook fails silently, Claude Code unaffected (verify with `HT_CLAUDE_DEBUG=1`).

**Effort:** M (2–3 days incl. tests). No UI beyond existing pill/chip primitives.

---

### WS2 — Statusline: the data plane

Ship `ht claude statusline` — a single command users set as their Claude Code statusline:

```json
{ "statusLine": { "type": "command", "command": "ht claude statusline" } }
```

It does two things with the stdin JSON:

1. **Prints a beautiful statusline back to Claude Code** (our house style: model · dir · git · context bar · cost · rate-limit warning ≥80%). Users get an immediately better statusline just by installing τ-mux — even outside τ-mux panes (when the socket is absent it *only* prints).
2. **Tees the raw JSON to the registry** (`claude.statusline` RPC, fire-and-forget, 50 ms socket timeout so the statusline never lags).

The registry then owns, per session, **Claude Code's own numbers**: `total_cost_usd`, `context_window.used_percentage`, `rate_limits`, `session_name`, `model.display_name`, `permission_mode`, `effort.level`, `total_lines_added/removed`, `pr.number/review_state`.

**UI consumers:**
- The `cc` ticker becomes `Opus · 42% ctx · $0.31` — accurate, no pricing table.
- New sidebar **context meter** per session (reuse `src/shared/tau-meter.ts`), amber ≥70%, red ≥90% ("compaction near").
- **Rate-limit meter** in the sidebar footer (5 h + 7 d), with reset time on hover. This is data no terminal shows well today — a genuinely differentiating feature.
- Session pill title = `session_name` (Claude's own AI title — deletes our sidecar).
- PR badge chip on the pane when `pr.number` present (click → `ht browser open-split <pr.url>`).

**Acceptance:** with statusline installed and one prompt sent: ticker shows real cost matching `/cost`, context meter matches `/context`, session pill shows the same title as Claude Code's session list. Statusline render < 30 ms (it's on every assistant message).

**Effort:** M (2 days). Depends on WS1b registry.

---

### WS3 — Remote approvals (the killer feature)

Wire `PermissionRequest` → τ-mux ask-user → decision JSON.

**Flow:**
1. Hook `permission-request` invokes the bridge **synchronously** (this one event is allowed to block — that's its design).
2. Bridge calls `ht ask claude-permission --tool Bash --input '<json>' --timeout 55000` → existing ask-user queue → **native modal** (pane-attributed, shows tool name + prettified input, Allow / Deny / "Ask in terminal") **and Telegram forward** (existing `ask-user-telegram.ts` path — approve from your phone).
3. Answer → bridge prints `{"decision": {"behavior": "allow"}}` (or deny with reason) → Claude Code proceeds.
4. **Timeout / τ-mux absent / any error → exit 0 with no output → Claude Code falls back to its own terminal prompt.** The gate can only ever *add* an answer path, never remove one.

**Scope guards:**
- Off by default; enabled per-install in the Settings panel ("Route permission prompts to τ-mux/Telegram").
- Matcher-scoped at install time (default: all tools; user can restrict to `Bash|Write|Edit`).
- The modal displays exactly what Claude Code would show (tool + input), no summarization — this is a security surface; show ground truth.
- `permission_mode` from the payload is displayed ("plan mode" etc.).
- Rapid-fire dedup: identical pending requests for the same session collapse into one modal.

Also handle `PermissionDenied` (auto-mode classifier denials) → passive log entry, and `Notification: elicitation_*` → surface MCP elicitations as notifications (modal answering via the `Elicitation` hook is a possible v2; keep out of scope now).

**Acceptance:** with approvals ON, `claude` asks to run a Bash command → modal appears in τ-mux and on Telegram; answering either approves in the terminal within 1 s; killing τ-mux mid-prompt → Claude Code's own prompt appears (fallback proven). E2E test with a scripted hook payload.

**Effort:** M (2–3 days). Highest value/effort ratio in the plan. Depends on WS1.

---

### WS4 — Task & plan mirroring (passive)

Replace "hope the model runs `ht plan set`" with deterministic mirroring:

1. `TaskCreated` / `TaskCompleted` hooks → registry task list per session → **plan panel** renders it (existing `plan-panel.ts` / `plan-store.ts`; add a `source: "claude"` provenance tag so pi/manual plans don't collide — one panel, labeled sources).
2. In-progress state isn't hook-covered; refresh task states opportunistically from the statusline tick (cheap) — exact in-progress fidelity is best-effort, creation/completion is exact.
3. The **skill slims down**: its plan section becomes "your native task list is already mirrored to the τ-mux sidebar; use TaskCreate normally. For review-first plans, keep writing `.claude/plans/<name>.md` + `ht ask choice`." Less instruction surface = more reliable activation.
4. **Auto-continue synergy:** τ-mux's auto-continue engine (`src/bun/auto-continue.ts`) is plan-anchored. With a mirrored task list it can now anchor on Claude Code's real tasks. Better: for Claude sessions, implement continuation *natively* via the `Stop` hook's `decision: "block", reason: "Continue with task N"` mechanism — no PTY typing, fully in-band. Gate it behind the same auto-continue setting + a per-session toggle; **never** allowed to fire when there are no pending tasks or when the turn ended in an error/question (`StopFailure`, `Notification idle_prompt` — reuse the existing decision function).

**Acceptance:** ask Claude Code to do a 4-step task with TaskCreate → sidebar plan panel shows 4 steps, states update on completion with no skill involvement; auto-continue (when enabled) advances through a deliberately-paused 2-task session and stands down on a question.

**Effort:** M (2 days). Depends on WS1b.

---

### WS5 — Native Claude Code pane (the flagship)

A `surfaceType: "claude"` pane — the pi-pane treatment for the main harness, built on the **Agent SDK** (`@anthropic-ai/claude-agent-sdk`, streaming-input mode). This is the biggest single feature; it makes τ-mux a genuine Claude Code frontend while every other workstream keeps improving plain-terminal `claude` sessions.

**Architecture (mirrors the pi pane precedent exactly):**
- `src/bun/claude-agent-manager.ts` — spawns/holds `query()` instances; resolves the user's `claude` binary like `resolvePiBinary()` does (login-shell PATH probe) and passes `pathToClaudeCodeExecutable` so we ride the user's install + auth, not a bundled binary; forwards SDK messages ↔ webview RPC.
- `src/views/terminal/claude-pane.ts` + `claude-surface-controller.ts` — chat UI. Reuse the agent-panel sub-modules where possible (`agent-panel-messages`, tool-card affordances) — evaluate extraction into `src/views/terminal/agent-panel-shared/` rather than copy-paste (this *reduces* god-module pressure).
- Follow the CLAUDE.md non-PTY-surface checklist verbatim (PaneLeaf.surfaceType, WorkspaceSnapshot/PersistedWorkspace records, add/split/remove on SurfaceManager, applyLayout sizing, tryRestoreLayout branch).

**v1 feature set (deliberately curtailed):**
- Prompt / streamed response with tool cards (Bash command + output, Edit diffs).
- `canUseTool` → the **same ask-user modal** as WS3 (one approval UX everywhere).
- Permission-mode switcher (default / acceptEdits / plan / bypass) via `setPermissionMode`; model switcher via `setModel`; effort display.
- `interrupt()` button.
- Session browser: SDK `listSessions()` / `getSessionInfo()` → resume (`resume`) and fork (`forkSession`) — richer than the pi pane's filesystem inference because the SDK is first-party.
- Cost/context header fed by SDK result messages (same registry, same meters).
- Plan-mode flow: plan approval surfaces as a modal with the plan rendered in the pane.

**Explicit v1 non-goals:** images, MCP management UI, hosting subagent transcripts, checkpoint/rewind UI, slash-command palette parity. Log them in the tracking file as v2 candidates.

**Risks:** SDK version tracks CC versions (SDK 0.3.191 ↔ CC 2.1.191) — pin the SDK, surface a mismatch warning in `ht claude doctor` when the user's CLI is far ahead/behind; streaming-input session lifetime bugs are the classic embedding failure — invest in an integration test harness with a mock/replayed message stream (the SDK message types are plain JSON; record + replay like the pi tests do).

**Acceptance:** open Claude pane → prompt → streamed response with tool cards; deny a Bash approval from the modal → model reroutes; resume yesterday's session from the browser; kill the pane → subprocess reaped (SIGTERM→SIGKILL escalation — do it right from day one, cf. audit §3.5); layout restore re-mounts the pane without leaking a PTY.

**Effort:** L (1.5–2 weeks incl. tests). Depends on WS3's modal path (shared), WS1b registry.

---

### WS6 — Agent teams & subagent observability

τ-mux is a pane multiplexer; agent teams currently only integrate with tmux/iTerm2 split panes. We can do better without waiting for official support:

1. **Passive team dashboard** (v1): when `~/.claude/teams/{session-derived}/config.json` exists for a tracked session, watch it + `~/.claude/tasks/{team}/` → sidebar **Team card**: members, state (working/idle), shared task list with claims. Read-only, robust to schema drift (validate, degrade to "team active, N members").
2. **Subagent chips** (from WS1's SubagentStart/Stop): `⑂ research ×2` on the pane header while subagents run.
3. **TeammateIdle** hook → optional notification ("teammate `researcher` idle").
4. **Exploration spike (time-boxed, 1 day):** teammate-per-pane display via `teammateMode: tmux` inside τ-mux PTYs, or spawning teammates into τ-mux splits. Outcome = a doc note, not a feature promise — the mode is experimental upstream and explicitly unstable.

**Acceptance:** enable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, spawn a 3-teammate session in a pane → sidebar shows the team card with live member states and task list within 2 s of file changes.

**Effort:** M (2–3 days), of which the dashboard is most. Depends on WS1b.

---

### WS7 — Onboarding, health, and the Settings tab

Make install AAA — this is where "much more Claude Code friendly" is won or lost for new users.

1. **Settings → Claude Code tab** (new `settings-panel` section, own module `src/views/terminal/settings-claude.ts`):
   - Detection row: `claude` binary path + version, hooks installed?, statusline installed?, skill installed?, approvals on/off.
   - **One-click Install / Update / Uninstall** for each piece. The installer (bun-side `src/bun/claude-install.ts`) edits `~/.claude/settings.json` **safely**: parse (JSONC-tolerant), timestamped backup beside it, additive merge of our hook entries (identified by a `"// managed-by": "tau-mux"`-style marker comment convention or command-path match), show the resulting diff in a modal before writing. Never touch unrelated keys. Refuse on parse failure with a clear message.
   - Per-feature toggles writing hook subsets: "session lifecycle", "statusline", "task mirror", "remote approvals" (each = a set of hook entries).
2. **`ht claude doctor`**: binary found, version, which hooks present in settings.json and whether they point at the live bridge, statusline wired, skill present, socket reachable from a hook's env, last event received per type + age. Modeled on the existing `runDoctor()`.
3. **First-run nudge:** when the metadata poller sees a `claude` foreground process in any pane and hooks are not installed → one-time notification "Claude Code detected — install the τ-mux integration? (Settings → Claude Code)". Never repeat after dismissal (persisted flag).
4. `install.sh` stays for repo-dev workflow; the app path becomes primary and works on the standalone .app (no repo checkout — ship the bridge inside the app bundle like the `ht` binary, copy on install so the .app can move).

**Acceptance:** fresh `~/.claude/settings.json` with user's existing unrelated hooks → Install → all four features active, user hooks untouched (byte-identical outside our keys), backup exists; Uninstall → settings byte-identical to pre-install; `ht claude doctor` all-green; doctor detects and names a manually broken hook path.

**Effort:** M–L (3–4 days). The settings.json merge safety deserves its own test file with nasty fixtures (comments, trailing commas, our-entries-already-present, duplicates).

---

### WS8 — Skill v2 + MCP evaluation

1. **Skill v2** (`claude-integration/skills/tau-mux/SKILL.md`): remove everything WS1–4 makes automatic (plan publishing, status pills the hooks own, completion notifications), keep and sharpen the genuinely *active* guidance: `ht ask` for decisions, splits for long-running processes, `ht browser`/`ht screenshot` for verification, confirm-command gating. Add: "your task list is mirrored automatically — use TaskCreate/TaskUpdate normally". Shorter skill = better activation reliability. Version the skill (frontmatter `version:`) so `ht claude doctor` can flag staleness against the app.
2. **MCP server — evaluate, don't assume.** Alternative to skill-taught CLI: `ht mcp-serve` (stdio) exposing typed tools (`tau_ask`, `tau_notify`, `tau_split`, `tau_browser_*`, `tau_screenshot`) that wrap the same RPC handlers. Pros: typed schemas, discoverable, no PATH/env fragility. Cons: every tool schema costs context tokens in *every* session, duplicate surface to maintain, and the `ht` CLI already works. **Decision gate:** build a spike behind a flag, measure activation quality vs the skill on 10 scripted tasks; adopt only if it clearly wins. Ship the skill improvement regardless.

**Effort:** S for skill v2 (1 day), S–M for the MCP spike (1–2 days, time-boxed).

---

### WS9 — AAA UI/UX polish pass

The connective tissue that makes it feel AAA rather than bolted-on. Do this after WS1–4 land, before calling the milestone done:

1. **Claude visual identity**: one consistent chip/pill family for Claude sessions (icon, the existing `#f5c2e7` accent, phase → color mapping identical in pane header, sidebar, notifications, Telegram, web mirror). Design tokens in `tau-tokens.ts`, no ad-hoc colors.
2. **Sessions section in the sidebar** (new module, not `sidebar.ts` growth): every live Claude session — title, phase dot, context meter, cost — click → focus pane; approval-waiting sessions sort to top with the red accent. This is the "agent view" for people who run 4 Claude sessions across workspaces.
3. **Phase-change micro-feedback**: waiting-approval pulses the workspace dot (existing notification-dot plumbing); optional distinct sound for approval-needed vs finish (settings: reuse `notificationSound*` pattern for a `claudeApprovalSound`).
4. **Command palette entries**: "Claude: New pane", "Claude: Resume session…", "Claude: Approve pending", "Claude: Open settings tab", "Claude: Toggle remote approvals".
5. **Keyboard**: ⌘⌥C focus/open Claude pane (via `KEYBOARD_BINDINGS`, honoring the keyboard-never-goes-to-panels rule — the Claude pane is an input surface like the pi pane, same focus contract).
6. **A11y**: modal + sidebar additions pass the existing a11y kit checks (`src/views/terminal/a11y/`); approval modal is fully keyboard-driveable (it's the one place keyboard *must* work — same exception the ask-user modal already has).
7. **Docs**: `doc/system-claude-integration.md` (architecture: event plane / data plane / decision plane, trust model, failure modes) + website-doc pages (EN **+ FR**, with app version stamped in `website-doc/src/content/docs/api/system.md` and `cli/system.md` per repo rules) + `doc/changes_to_document.md` entries as workstreams land.

**Effort:** M (3–4 days spread across the milestone).

---

## 6. Sequencing & milestones

Dependency spine: **WS1/WS1b → WS2 → (WS3, WS4) → WS5**, with WS6–9 attachable after WS1b.

| Milestone | Contents | Cumulative user value | Est. |
|---|---|---|---|
| **M1 — "τ-mux sees Claude"** | WS1 + WS1b + WS2 | Accurate live phase/cost/context/rate-limit for every terminal `claude` session; sidecar & pricing table deleted; sessions attributed to panes | ~1 week |
| **M2 — "τ-mux acts for Claude"** | WS3 + WS4 + WS7 | Remote approvals (modal + Telegram), passive task mirroring, one-click install + doctor | ~1.5 weeks |
| **M3 — "Claude lives in τ-mux"** | WS5 + WS8 | Native Claude pane with sessions/resume/fork/approvals; slimmed skill; MCP decision made | ~2 weeks |
| **M4 — "AAA"** | WS6 + WS9 | Team dashboard, sessions sidebar, identity/polish/a11y/docs (EN+FR) | ~1 week |

Each milestone: `bun test` + `bun run typecheck` green, `bun start` manual smoke, version bump (`bun run bump:minor` per milestone — these are feature releases; patches within), tracking updates in `doc/tracking_august-plan.md` with commit ids, `doc/changes_to_document.md` kept current, website-doc updated (EN+FR) at M2 and M4 boundaries.

Suggested versions: M1 → 0.5.0, M2 → 0.6.0, M3 → 0.7.0, M4 → 0.8.0.

---

## 7. Testing strategy

- **Bridge v2:** pure-function extraction (payload → intended `ht` calls) with recorded real hook payloads as fixtures per event type; the runner stays a thin shell. Target: every event handler unit-tested without spawning anything.
- **Registry:** reducer tests (event stream → state snapshots), including out-of-order events (statusline before session-start, stop for unknown session) and multi-session interleaving.
- **Approvals:** e2e-ish test driving the bridge binary with a scripted `PermissionRequest` payload against a mock socket server asserting the modal RPC and the decision JSON; explicit tests for the three fallback paths (timeout, no socket, malformed answer) proving exit-0-no-output.
- **Installer:** fixture-heavy tests for the settings.json merge (JSONC, existing hooks, ours-already-present, corrupt file) asserting byte-stability of unrelated content and restore-from-backup.
- **Claude pane:** replayed SDK message streams (JSON fixtures) through the manager → asserted webview RPC sequences; lifecycle tests for kill/reap.
- **Coverage gate:** every new file must be in the coverage baseline (audit §3.2 — re-promote after each milestone so new modules are gated).

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Claude Code hook/statusline schema drift across versions | Feature-gate on payload field presence; `doctor` reports capability; fixtures per known CC version; universal fields (`session_id`, `transcript_path`) are stable |
| `PermissionRequest` blocking degrades the Claude UX on τ-mux failure | Hard 55 s ceiling < CC's own timeout, exit-0-empty on *any* error → CC's native prompt; feature off by default |
| Settings.json corruption by installer | Backup + diff-preview + additive merge + refuse-on-parse-failure; heavy fixture tests |
| Agent SDK version coupling (pane) | Pin SDK; use user's CLI binary via `pathToClaudeCodeExecutable`; mismatch warning in doctor; pane is additive — terminal `claude` always works |
| Agent teams are experimental upstream | WS6 is read-only file watching with schema validation + graceful "team active" degradation; the pane-mode spike is time-boxed and non-committal |
| Scope creep into god modules | New modules named per workstream; wiring-only diffs in the big four; module-size lint (audit §3.6) lands with M1 |
| Token/attention cost of injected context (skill, SessionStart additionalContext) | Skill v2 gets *shorter*; no SessionStart context injection in v1 (attribution comes from env, not prompt text) |
| Double-notification noise (bridge + CC's own terminal bell + Telegram) | Registry is the single notification chokepoint; per-feature toggles; dedup identical notifications per session/turn |

---

## 9. Out of scope (recorded so they're deliberate)

- Checkpointing / rewind UI for the Claude pane (v2 candidate).
- MCP Elicitation *answering* (hook exists; we only display in this plan).
- Web-mirror parity for the Claude pane (mirror gets registry-driven pills/meters only; the pane itself is native-first).
- Bundling a Claude Code binary in the .app (we always ride the user's install + auth).
- Windows/Linux (Electrobun/macOS remains the target).
- `ultraplan` / cloud sessions integration.

---

## 10. Immediate next steps

1. Review this plan (`ht ask choice` when running under τ-mux, per house workflow) — accept / adjust workstream priorities.
2. On accept: create `doc/tracking_august-plan.md`, start M1/WS1 with the bridge-v2 event skeleton + registry module, fixtures first.
3. Record website-doc obligations in `doc/changes_to_document.md` from the first user-visible change onward.
