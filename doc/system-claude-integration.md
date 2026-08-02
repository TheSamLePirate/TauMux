# Claude Code Integration

**Since:** 0.5.0 (M1) / 0.6.0 (M2) / 0.7.0 (M3) — plan: `doc/august-plan.md`,
tracking: `doc/tracking_august-plan.md`.

τ-mux integrates with Claude Code on **three planes** plus a **native
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
| Bun | `claude-session-registry`, `claude-status-presenter`, `claude-plan-mirror`, `claude-team-watcher`, `claude-integration` (assembly), `claude-agent-manager`, `claude-pane-host`, `rpc-handlers/claude.ts`, `webview-handlers/claude.ts` |
| CLI | `src/cli/claude-settings-edit.ts`, `ht claude …` verbs in `bin/ht` + `map-command.ts` |
| Webview | `claude-agent-pane`, `claude-surface-controller`, `claude-pane-bridge`, SurfaceManager methods, palette entries |
| Tests | `tests/claude-*.test.ts` (9 files) |
