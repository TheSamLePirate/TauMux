# Claude Code Integration

**Since:** 0.5.0 (M1) / 0.6.0 (M2) / 0.7.0 (M3) / 0.7.1 (M4) — plan:
`doc/august-plan.md`, tracking: `doc/tracking_august-plan.md`.
Pane polish landed in 0.8.0–0.9.0; the **terminal approval plane** in
0.10.0–0.10.8.

τ-mux integrates with Claude Code on **four planes** plus a **native
pane**. Each plane degrades independently: any subset works, and none of
them can break the terminal (the PTY never depends on any of this).

## 1. The three planes

### Event plane — hooks → registry

`claude-integration/ht-bridge/` is wired into `~/.claude/settings.json`
(via `ht claude install` or the snippet). Each Claude Code hook firing
runs the bridge with an event name; the bridge normalizes the payload
(`build-event.ts`, pure) and fire-and-forgets `ht claude event` →
`claude.event` RPC → **`ClaudeSessionRegistry`**
(`src/bun/claude-session-registry.ts`), the single source of truth:
one `ClaudeSessionState` per Claude Code session — phase (working /
waiting-input / waiting-approval / compacting / error), turn counting,
pane attribution (`HT_SURFACE` inherited by the hook process), subagent
list, mirrored task list.

Consumers subscribe to `registry.onChange`:

- **`ClaudeStatusPresenter`** — renders the `Claude` label pill, the
  `cc` ticker, and notifications by calling the LOCAL rpc dispatcher
  (`sidebar.set_status` / `notification.create`), so workspace
  resolution, sounds, persistence, Telegram and web-mirror fan-out ride
  the existing paths.
- **`ClaudePlanMirror`** — projects each session's native task list
  (TaskCreated/TaskCompleted hooks) into the plan panel under
  `agentId: "claude:<short-id>"`. Deterministic — no model cooperation.

### Data plane — statusline → registry

`ht claude statusline` is installed as Claude Code's `statusLine`
command. On every assistant message Claude Code pipes a JSON snapshot;
the command (bin/ht + `src/shared/claude-statusline.ts`) renders a
τ-mux-styled status line back **and** tees the parsed subset to
`claude.statusline`. This is where cost, context %, rate limits,
session title, model, permission mode, and PR state come from —
**numbers Claude Code computes itself**; τ-mux never re-derives them
(the v1 pricing table and `pi` title sidecar are gone for good).

### Decision plane — PermissionRequest → ask modal

The one synchronous hook. With approvals installed
(`ht claude install --features approvals`), a permission prompt runs the
bridge's `permission-request` handler: it drives `ht ask choice`
(→ ask-user modal + Telegram forward) and prints the decision JSON
(`hookSpecificOutput.decision.behavior`) on a clean Allow/Deny.
**Fail-safe contract:** timeout, hang, no `HT_SURFACE`, disabled flag,
"Answer in terminal", or any error → empty stdout + exit 0 → Claude
Code shows its own prompt. The gate can only ever ADD an answer path.
Locked by subprocess tests (`tests/claude-permission.test.ts`).

### Terminal approval plane — notification → Enter in the pane (0.10.x)

The decision plane above requires `--features approvals` and replaces
Claude Code's prompt. This plane is the complement: Claude Code runs in a
plain terminal pane, shows **its own** prompt, and τ-mux presses Enter.

`src/bun/claude-auto-approve.ts` has two entry points:

- **`approveNow(surfaceId?)`** — explicit. Palette entry *"Approve Claude
  Code permission prompt"* / `ht claude approve`. Answers the
  longest-waiting session, or a named `--surface`.
- **auto-approve** — opt-in (`claudeAutoApprove` setting, or
  `ht claude auto-approve on|off|status`). Fires as prompts appear, after
  a configurable delay.

The prompt accepts a bare CR, and the `Notification` / `permission_prompt`
hook plus `HT_SURFACE` tell us *that* a prompt is up and *where* — so
there is **no screen scraping**.

**Safety rules**, all enforced in `canAutoApprove` (pure, so they are
testable in one place) rather than trusted to callers:

1. `approvalSource === "tty"` only. A modal-routed approval has no
   terminal prompt — Enter would land in whatever is on screen.
2. Terminal panes only: never the native `claude-agent:` pane (it answers
   through `canUseTool`), never a pane we cannot name.
3. Never while `awaitingUserChoice` is set — see below.
4. Burst guard: more than 8 approvals in 60 s pauses that session and
   notifies. A prompt storm is not something to rubber-stamp.
5. Every send is logged to the pane's sidebar log — an audit trail of what
   was approved unattended.
6. After the delay, the engine re-checks the prompt is still pending, so
   it cannot fire a stray Enter into a pane you already answered.

**Why the counter, not a transition (0.10.6).** Claude Code ships no
"prompt resolved" hook, so answering a prompt emits nothing. A turn that
asks twice leaves the session in `waiting-approval` throughout, and the
second `notify-permission` reduces to a byte-identical state — a guard
that fired only on the *transition into* `waiting-approval` could not tell
it from the same prompt still being up, and the second prompt hung
forever. `ClaudeSessionState.approvalSeq` is bumped once per prompt
announcement and auto-approve fires per prompt. Statusline tees don't bump
it, so they still don't re-fire.

**Why questions are excluded (0.10.7–0.10.8).** Claude Code raises the
*same* `Notification` / `permission_prompt` hook for an **AskUserQuestion**
or **ExitPlanMode** modal as for "may I run this command", with the same
generic message — on the hook stream alone they are indistinguishable, and
auto-approve was answering the user's own multiple-choice questions by
taking their default option. Two hooks, `PreToolUse` / `PostToolUse`
**scoped by matcher** to `AskUserQuestion|ExitPlanMode`, publish
`ask-start` / `ask-end`. (The matcher matters: an unscoped `PreToolUse`
would spawn a bridge process on *every* tool call.)
`ClaudeSessionState.awaitingUserChoice` holds the tool name while a modal
is up; both `canAutoApprove` and the manual `ht claude approve` refuse
while it is set — pressing Enter on a choice modal picks a default, which
is not what "approve" means.

Answering a question emits no "resolved" event either, so in 0.10.7 the
notification the question raised **outlived the question**: the session sat
at `waiting-approval | tty` while actively working, the sidebar pill
claimed a pending approval, and a bare `ht claude approve` would have typed
Enter into a pane showing no prompt. `approvalIsQuestion` now records
whether a pending announcement belongs to a choice modal (set when
`notify-permission` arrives while `awaitingUserChoice` is up, and when
`ask-start` wins the race the other way), and `ask-end` retracts an
announcement it owns — phase back to `working` / `idle`, source and message
cleared — leaving a genuine tool prompt untouched.

**Deliberate limitation.** A notification arriving while a modal is up is
attributed to the modal. Unambiguous in practice: a genuine prompt in that
window would need Claude to receive an answer, run an inference round-trip
and hit a permission gate inside the ~200 ms the `PostToolUse` process
takes to spawn. If it ever happens the failure is a *missed* auto-approval
(a human presses Enter), never a stray keystroke — the safe direction.

Hook ordering between the two processes is not guaranteed; the delay plus
live re-check covers `ask-start` landing after the notification. A missed
`ask-end` (crash, timeout) cannot wedge a session: `prompt`, `stop` and
`session-end` all clear the flag.

> The two hooks require `ht claude install` and a restart of running
> Claude Code sessions. `ht claude doctor` reports them as missing until
> then.

## 2. The native pane (M3)

`SurfaceKind: "claude"` — a chat pane hosting a session via the Agent
SDK (`@anthropic-ai/claude-agent-sdk`, pinned; prefers the user's own
`claude` binary via login-shell resolution, SDK bundled CLI as
fallback).

```
webview                      bun
claude-agent-pane.ts   ←→   claude-pane-host.ts
claude-surface-controller    └ ClaudeAgentManager (claude-agent-manager.ts)
claude-pane-bridge.ts            └ SDK query() streaming-input
SurfaceManager add/remove        └ canUseTool → ask-user queue (same modal
(palette: "New Claude Code         + Telegram as the decision plane)
 Pane" / splits)
```

Wire messages: `claudeAgentCreate/Prompt/Interrupt/SetModel/SetMode/
ListSessions/Close` (webview→bun, exhaustiveness-gated by
`satisfies BunMessageHandlers`) and `claudeAgentSurfaceCreated/Event/
Exit/Sessions` (bun→webview). The pane renders SDKMessage types it
knows (`digestClaudeEvent`, pure) and ignores the rest — the SDK grows
message types faster than we do. Layout restore re-mounts panes as
FRESH sessions (the Sessions picker offers resume); no PTY is ever
created for this surface kind.

## 3. Teams (M4, passive)

`ClaudeTeamWatcher` polls `~/.claude/teams/` + `~/.claude/tasks/`
(experimental upstream feature, schema-defensive parsing) and mirrors a
`team` sidebar pill ("3 members · 2/6 tasks"). Read-only; silent when
the feature is unused.

## 4. Trust model

- **Hooks are user-installed shell commands.** `ht claude install` edits
  `~/.claude/settings.json` with a timestamped backup, additive merge,
  idempotence, and refuse-on-parse-failure; `uninstall` removes exactly
  the managed entries (identified by command path). A user-defined
  statusline is never clobbered.
- **The decision plane is display-ground-truth**: the modal shows the
  exact tool + input, never a summary. Kill switch:
  `HT_CLAUDE_APPROVALS=0`.
- **The pane's `canUseTool`** denies on timeout; with no ask-user queue
  wired (tests), it allows — production always wires the queue.
- The registry/presenter/mirror never touch the PTY; a total failure of
  the integration leaves every terminal working.

## 5. Diagnostics

`ht claude doctor` — binary + version, hooks wired/missing, approvals,
statusline (ours/other/none), skill presence, app reachability
(including "reachable but pre-0.5.0"). `ht claude sessions [--all]` —
registry contents. `HT_CLAUDE_DEBUG=1` — bridge stderr.

## 6. File map

| Area | Files |
|---|---|
| Bridge (installed) | `claude-integration/ht-bridge/src/{index,build-event,permission}.ts` |
| Skill | `claude-integration/skills/tau-mux/SKILL.md` (v2) |
| Shared types | `src/shared/claude-types.ts`, `src/shared/claude-statusline.ts` |
| Bun | `claude-session-registry`, `claude-registry-persistence`, `claude-status-presenter`, `claude-plan-mirror`, `claude-team-watcher`, `claude-auto-approve`, `claude-integration` (assembly), `claude-agent-manager`, `claude-pane-host`, `rpc-handlers/claude.ts`, `webview-handlers/claude.ts` |
| CLI | `src/cli/claude-settings-edit.ts`, `ht claude {pane,approve,auto-approve,sessions,statusline,install,uninstall,doctor,event}` in `bin/ht` + `map-command.ts` |
| Webview | `claude-agent-pane`, `claude-surface-controller`, `claude-pane-bridge`, SurfaceManager methods, palette entries |
| Tests | `tests/claude-*.test.ts` |

## 7. Session registry persistence (0.10.4)

The registry is persisted (`claude-registry-persistence.ts`) so phases,
pane attribution and mirrored task lists survive an app restart rather
than resetting every session to unknown. Repeated "skipped" decisions
collapse in the log instead of flooding it.
