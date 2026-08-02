# ht-bridge (v2)

Forwards Claude Code shell-hook events into τ-mux. That is the whole job:
one hook fires → the bridge normalizes the payload into a small JSON event
→ `ht claude event` delivers it to the app → the app-side
`ClaudeSessionRegistry` (`src/bun/claude-session-registry.ts`) updates the
session state and the `ClaudeStatusPresenter` renders pills/notifications.

**What changed from v1** (august-plan M1): the bridge no longer keeps
per-session state files, parses transcripts, maintains a pricing table, or
runs the `pi` title sidecar. Cost, context %, rate limits, and the session
title now come from `ht claude statusline` — numbers Claude Code computes
itself. The bridge shrank from ~900 lines to ~150 and only *forwards*.

The visible result (rendered app-side, keys unchanged from v1):

- **`Claude`** — active label pill. Prompt's first clause immediately,
  Claude Code's own session title once the statusline reports it. Yellow
  **Waiting for input**, red **Approval needed**, muted **Compacting…**,
  red error text on API failures. Cleared when the turn ends.
- **`cc`** — persistent ticker: `Opus · 42% ctx · $0.31` (or `turn N`
  before the statusline has reported).
- A completion notification on `Stop` (prompt + duration + cost), an
  error notification on `StopFailure`, an approval notification on
  permission prompts. Idle pauses change the pill only — no toast.

## Wire-up

Shell hooks from `~/.claude/settings.json` — see
`../settings.snippet.jsonc` for the full drop-in block. Event name is
argv[2]; the hook payload arrives on stdin:

| argv[2] | Hook |
| ------- | ---- |
| `prompt` | `UserPromptSubmit` |
| `stop` | `Stop` |
| `stop-failure` | `StopFailure` |
| `session-start` / `session-end` | `SessionStart` / `SessionEnd` |
| `subagent-start` / `subagent-stop` | `SubagentStart` / `SubagentStop` |
| `pre-compact` / `post-compact` | `PreCompact` / `PostCompact` |
| `cwd-changed` | `CwdChanged` |
| `task-created` / `task-completed` | `TaskCreated` / `TaskCompleted` |
| `notify-idle` | `Notification` matcher=`idle_prompt` |
| `notify-permission` | `Notification` matcher=`permission_prompt` |

All events are optional — install the subset you want; the registry
tolerates any combination. Unknown argv[2] values are ignored (an
installer newer than the bridge must not crash the hook pipeline).

Every `ht` spawn is fire-and-forget (`stdio: ignore`, never awaited). If
τ-mux isn't running, the CLI fails silently and Claude Code never
notices. Exit code is always 0.

**Companion (data plane):** install the statusline too —

```json
"statusLine": { "type": "command", "command": "ht claude statusline" }
```

## Config

`config.json` next to `src/`, or environment variables:

| Env | Effect |
| --- | ------ |
| `HT_CLAUDE_ENABLED=0` | Disable the bridge entirely |
| `HT_CLAUDE_HT_BIN=/path/ht` | Override `ht` CLI location |
| `HT_CLAUDE_DEBUG=1` | Surface errors on stderr |

Pill keys, colors, and notification behavior are app-side now
(`src/bun/claude-status-presenter.ts`).

## Manual test

With τ-mux running (a build that has the `claude.*` RPC — ≥ 0.5.0):

```bash
# label pill (working, pink)
echo '{"session_id":"manual-test","prompt":"Investigate a flaky test in the billing suite"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts prompt

# permission state (red) + notification
echo '{"session_id":"manual-test","message":"Allow ls?"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts notify-permission

# turn end — clears the pill, fires the summary notification
echo '{"session_id":"manual-test"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts stop

# inspect what the app recorded
ht claude sessions --all
```

Run from inside a τ-mux pane so `HT_SURFACE` attributes the session to
your workspace; from outside, events land unattributed (active-workspace
fallback). `HT_CLAUDE_DEBUG=1` surfaces spawn errors.

## Tests

`tests/claude-bridge.test.ts` drives `src/build-event.ts` (the pure
payload→event mapping) with recorded hook payloads and replays the
result through the real registry — the wire contract between this
folder and the app is locked there. The bridge deliberately does not
import from `src/` (it's symlinked into `~/.claude/scripts/`), so the
event type is re-declared in `build-event.ts` and the test file is what
keeps the two in sync.
