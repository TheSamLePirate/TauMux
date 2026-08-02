---
title: claude.*
description: event, statusline, sessions — Claude Code session ingestion and observability.
---

Ingestion + read side for the [Claude Code
integration](/integrations/claude-code/) (0.5.0). Producers are the hook
bridge and `ht claude statusline`; the read side drives `ht claude
sessions`, diagnostics, and future UI. Also reachable through the
extension SDK's `claude` namespace.

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
