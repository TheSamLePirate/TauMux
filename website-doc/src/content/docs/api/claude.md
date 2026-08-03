---
title: claude.*
description: event, statusline, sessions — Claude Code session ingestion and observability.
---

Ingestion + read side for the [Claude Code
integration](/integrations/claude-code/) (0.5.0). Producers are the hook
bridge and `ht claude statusline`; the read side drives `ht claude
sessions`, diagnostics, and future UI. Also reachable through the
extension SDK's `claude` namespace.

## claude.pane

```json
{ "method": "claude.pane",
  "params": { "cwd": "/repo", "split": true, "direction": "right" } }
→ "OK"
```

Opens a [native Claude Code pane](/features/claude-code-pane/) — the same entry
point as the command palette. `resume` reopens a previous session id. Without
`cwd` the pane inherits the focused pane's working directory. Mirrors
`agent.create` for the pi pane.

## claude.auto_approve

```json
{ "method": "claude.auto_approve", "params": {} }
→ { "ok": true, "enabled": false, "delayMs": 700 }

{ "method": "claude.auto_approve", "params": { "enabled": true, "delay_ms": 500 } }
→ { "ok": true, "enabled": true, "delayMs": 500 }
```

Reads (no params) or flips automatic acceptance of Claude Code permission
prompts in **terminal** panes. Writes go through the settings manager, so the
change is persisted and applied immediately — no restart, no editing
`settings.json`. Backed by
[`claudeAutoApprove`](/configuration/settings/#claude-code).

See [`ht claude auto-approve`](/cli/claude/) and
[accepting terminal prompts](/integrations/claude-code/#accepting-terminal-prompts).

## claude.approve

```json
{ "method": "claude.approve", "params": { "surface_id": "surface:3" } }
→ { "ok": true, "surfaceId": "surface:3" }
→ { "ok": false, "reason": "no Claude Code terminal prompt is waiting" }
```

Accepts the permission prompt Claude Code is showing in a **terminal** pane by
sending Enter. Without `surface_id` it answers the longest-waiting session.
Refuses when nothing is waiting, when the approval was routed to the τ-mux
modal instead (there is no terminal prompt to answer), or when the session is a
Claude Code pane. See
[accepting terminal prompts](/integrations/claude-code/#accepting-terminal-prompts).

## claude.event

```json
{ "method": "claude.event", "params": { "event": {
  "type": "prompt", "sessionId": "abc123",
  "surfaceId": "surface:4", "cwd": "/repo",
  "prompt": "Fix the login bug", "ts": 1754000000000
} } }
→ "OK"
```

One normalized hook event. `type` is one of `session-start`,
`session-end`, `prompt`, `stop`, `stop-failure`, `subagent-start`,
`subagent-stop`, `pre-compact`, `post-compact`, `cwd-changed`,
`notify-idle`, `notify-permission`, `permission-request`,
`permission-resolved`, `task-created`, `task-completed`. Every field
except `type`/`sessionId` is optional — the registry tolerates absence
by design (payloads vary across Claude Code versions). Malformed
payloads return an `"ERR: …"` string rather than throwing (producers are
fire-and-forget hooks that never read the response).

## claude.statusline

```json
{ "method": "claude.statusline", "params": { "data": {
  "sessionId": "abc123", "sessionName": "Fix auth flow",
  "modelDisplayName": "Opus", "costUsd": 0.31,
  "contextUsedPct": 42, "rateLimits": { "fiveHourPct": 84 }
} } }
→ "OK"
```

The data plane: the parsed subset of Claude Code's statusline JSON
(cost, context %, rate limits, session title, model, permission mode,
effort, PR state). Phase is never changed by this method — that's the
event plane's job.

## claude.sessions

```json
{ "method": "claude.sessions", "params": { "all": false } }
→ { "sessions": [ { "sessionId": "abc123", "phase": "working",
    "surfaceId": "surface:4", "sessionName": "Fix auth flow",
    "modelDisplayName": "Opus", "costUsd": 0.31, "contextUsedPct": 42,
    "turnCount": 3, "tasks": [ … ], "subagents": [ … ], … } ] }
```

Live sessions, most-recently-active first. `all: true` includes
recently-ended sessions (kept ~5 minutes for UI teardown). Sessions with
no events for 24 h are pruned; the registry caps at 200 sessions.
