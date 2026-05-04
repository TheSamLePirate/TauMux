# ht-bridge

Pi extension that bridges pi-coding-agent into τ-mux. Surfaces pi
turns in the sidebar (active label, cost ticker, tool-execution
badge, plan mirror, per-turn activity log), shows a green/red τ-mux
indicator + KITT-style scanner in pi's TUI, gates dangerous bash
commands behind a τ-mux modal, exposes τ-mux capabilities (ask-user,
plan, browser, notify, screenshot, run-in-split) as LLM-callable
tools, and adds slash commands plus session-resume restoration.

Outside τ-mux the extension is a no-op aside from a red `● τ-mux
(offline)` pill in pi's footer — every observer / tool / intercept
short-circuits so nothing fork-storms or logs noise at a missing
socket.

Current bundled release: **τ-mux / ht-bridge 0.2.81**.

> Renamed from `ht-notify-summary/` before the 0.2.81 integration
> release. The old env-var prefix (`PI_HT_NOTIFY_*`) is preserved for
> backward compatibility.

## Capability matrix

| # | Capability | Default | Module |
|---|---|---|---|
| 1 | **Active-label pill** — `ht set-status Pi "<task>"` while the agent runs; `ht notify` on `agent_end`. Fast model (Haiku) generates 3-5 word summaries with `reasoningEffort: "off"`. | on | `observe/active-label.ts` |
| 2 | **Cost / context ticker** — `Pi · 34% · $0.012` pill via `ht set-status ctx`, refreshed every `turn_end`. | on | `observe/cost-ticker.ts` |
| 3 | **Tool-execution badge** — `pi_tool : bash {cmd}` while a tool runs; clears on `tool_execution_end`. Tracks parallel tools via Map. | on | `observe/tool-badge.ts` |
| 4 | **Plan-text mirror** — sniffs assistant messages for fenced JSON arrays of `{id,title,state}`, writes a generated detailed markdown file in `.pi/plans/`, asks the user to accept/decline/discuss, then mirrors accepted plans to `plan.set`. State aliases (`in_progress`, `complete`, `blocked`, …) are normalised. | on | `observe/plan-mirror.ts` |
| 5 | **Activity log** — `tool_call`, `tool_result` (errors only), and `turn_end` summaries piped to `sidebar.log` per workspace. | on | `observe/activity-log.ts` |
| 5b | **TUI heartbeat (K2000 scanner)** — installs an 8-cell sweeping head/trail animation as pi's working indicator (`░▒█──────` → `─░▒█─────` → …). Animates only while pi is streaming; pi handles the timing internally via `setWorkingIndicator({ frames, intervalMs })`. | on | `observe/tui-heartbeat.ts` |
| 5c | **τ-mux indicator pill** — footer status `● τ-mux ws:2 surface:7` (green) when ht-bridge is connected, `● τ-mux (offline)` (red) when running outside τ-mux. The workspace appears as soon as `system.identify` resolves. Outside τ-mux this pill is the only thing the extension renders — every observer/tool/intercept is short-circuited so the footer stays clean. | on | `observe/tui-status.ts` |
| 6 | **Bash-safety gate** — every `tool_call("bash")` matched against a risk list (`rm -rf`, `sudo`, `mkfs`, `dd of=`, `:(){:\|:&};:`, force-push, `git reset --hard`, `chmod 777`, raw-disk redirects). On match, pops `agent.ask_user kind="confirm-command"`. Cancel/timeout → `{block:true, reason}` returned to pi. Fail-open if τ-mux is unreachable. Modes: `off`, `confirmRisky` (default), `confirmAll`. | `confirmRisky` | `intercept/bash-safety.ts` |
| 7 | **`ht_ask_user` tool** — registered via `pi.registerTool`; pops a τ-mux modal (yesno / choice / text), blocks until answered, mirrors to Telegram if configured. | on | `tools/ask-user.ts` |
| 8 | **`ht_plan_set` / `_update` / `_complete` tools** — explicit plan ops the LLM can call. `ht_plan_set` takes concise sidebar `steps` plus `planName` and `detailedPlanMarkdown`, writes `.pi/plans/<planName>.md`, shows the path to the user first, and only publishes accepted plans. | on | `tools/plan.ts` |
| 9 | **`ht_browser_open` / `_navigate` / `_close` tools** — drive a τ-mux built-in browser pane during the agent loop. | on | `tools/browser.ts` |
| 10 | **`ht_notify` tool** — Mac toast + Telegram forward at task milestones. | on | `tools/notify.ts` |
| 11 | **`ht_screenshot` tool** — capture a τ-mux pane to PNG, return the path so pi can `read` it. macOS only. | on | `tools/screenshot.ts` |
| 11b | **`ht_run_in_split` tool** — spawn a sibling τ-mux split next to pi's pane and run a command in it (dev servers, log tails, watchers, builds). pi receives only the new surface id; output stays in the new pane for the user. Goes through the same bash-safety gate as the built-in `bash` tool. | on | `tools/run-in-split.ts` (+ `-core.ts`) |
| 12 | **System-prompt primer** — `before_agent_start` chains a τ-mux orientation block: **surface id + workspace id + cwd**, registered ht_* tools, behaviour nudges, bash-safety reminder. Workspace and cwd come from `system.identify` (resolved lazily at startup). Skipped outside τ-mux. | on | `system-prompt/primer.ts` (+ `lib/surface-context.ts`) |
| 13 | **`/ht-plan show \| set <json> \| clear`** — slash command for manual plan ops from inside pi. | on | `commands/plan-cmd.ts` |
| 14 | **`/ht-ask <text> \| yesno <title> \| choice <title> a,b,c`** — slash command to pop a τ-mux modal whenever you want one. | on | `commands/ask-cmd.ts` |
| 15 | **Compaction status pill** — `Compacting…` between `session_before_compact` and `session_compact`. | on | `lifecycle/compaction.ts` |
| 16 | **Resume restoration** — on `session_start{reason:"resume"\|"fork"}`, walks the session for the last published `ht_plan_set` toolResult and replays the accepted steps to `plan.set`. | on | `lifecycle/resume.ts` |

Every capability is gated by an independent flag in `config.json` /
env vars — disabling a row in the matrix above only requires flipping
its boolean.

## Transport

Hot-path RPCs (sidebar.set_status, sidebar.log, plan.update,
notification.create) go through a direct Unix-socket JSON-RPC client
in `lib/ht-client.ts` (~1 ms/call) instead of forking `ht`
(50-100 ms). Cold-path RPCs (ask-user, browser-open) and missing-
socket fallbacks transparently shell out to the `ht` CLI.

The client distinguishes transport failures (connect refused, socket
closed) from protocol-level errors (server returned `error`, request
timed out, AbortSignal aborted). Only the former trigger the CLI
fallback — protocol errors propagate as-is so we don't retry "method
not found" against `ht`.

## Module layout

```
ht-bridge/
├── config.json                 (default flags for every capability)
├── index.ts                    (factory; gates everything on inTauMux)
├── lib/
│   ├── config.ts               (typed Config + env overrides)
│   ├── ht-client.ts            (Unix-socket JSON-RPC + ht-CLI fallback)
│   ├── messages.ts             (extractText, sliceTurn, formatDuration, truncate)
│   ├── summarizer.ts           (fast-model label/summary helper)
│   └── surface-context.ts      (HT_SURFACE → surface/workspace/cwd via system.identify)
├── observe/
│   ├── active-label.ts         "Pi : <task>" pill + agent_end notify
│   ├── cost-ticker.ts          "ctx · 34% · $0.012" pill
│   ├── tool-badge.ts           "pi_tool : bash <cmd>" pill
│   ├── plan-mirror.ts          fenced-JSON sniffer → approval gate → plan.set
│   ├── activity-log.ts         tool_call / tool_result / turn_end → sidebar.log
│   ├── tui-heartbeat.ts        K2000 scanner installed as pi's working indicator
│   ├── tui-heartbeat-frames.ts pure frame generator (testable without pi)
│   └── tui-status.ts           green/red "● τ-mux ws:N surface:M" footer pill
├── intercept/
│   ├── bash-safety.ts          pi event glue
│   └── bash-safety-core.ts     pure logic (testable without pi)
├── tools/
│   ├── ask-user.ts             ht_ask_user
│   ├── plan.ts                 ht_plan_set / _update / _complete
│   ├── plan-approval.ts        writes .pi/plans/*.md + accept/decline/discuss gate
│   ├── browser.ts              ht_browser_open / _navigate / _close
│   ├── notify.ts               ht_notify
│   ├── screenshot.ts           ht_screenshot
│   ├── run-in-split.ts         ht_run_in_split (pi/typebox glue)
│   └── run-in-split-core.ts    pure execute() logic (testable without pi)
├── system-prompt/
│   └── primer.ts               before_agent_start primer
├── commands/
│   ├── plan-cmd.ts             /ht-plan show|set|clear
│   └── ask-cmd.ts              /ht-ask
└── lifecycle/
    ├── compaction.ts           "Compacting…" pill
    └── resume.ts               replay last published ht_plan_set on resume/fork
```

## Install

pi auto-discovers extensions from `~/.pi/agent/extensions/` (global)
or `.pi/extensions/` (project-local). Symlink this directory into
one of them:

```bash
# Global
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi-extensions/ht-bridge" ~/.pi/agent/extensions/ht-bridge

# Or project-local (from the repo root)
mkdir -p .pi/extensions
ln -s "$PWD/pi-extensions/ht-bridge" .pi/extensions/ht-bridge
```

Reload inside pi:

```
/reload
```

Quick test without installing:

```bash
pi -e ./pi-extensions/ht-bridge/index.ts
```

If you previously installed `ht-notify-summary`, remove that symlink
first — pi loads each registered extension once.

## Requirements

- τ-mux running (socket `/tmp/hyperterm.sock` or `$HT_SOCKET_PATH`).
- `ht` CLI on `PATH` (or set `htBinary` in `config.json`) — only used
  for cold-path operations and as the socket fallback.
- An API key for the configured provider/model (Anthropic Haiku by default).

## Configuration

Edit `config.json` next to the extension, or override with env vars.

### Active label + cost ticker (`PI_HT_NOTIFY_*` — frozen for back-compat)

| Field            | Env var                       | Default            |
|------------------|-------------------------------|--------------------|
| `enabled`        | `PI_HT_NOTIFY_ENABLED`        | `true`             |
| `provider`       | `PI_HT_NOTIFY_PROVIDER`       | `anthropic`        |
| `modelId`        | `PI_HT_NOTIFY_MODEL`          | `claude-haiku-4-5` |
| `minWords` / `maxWords` | `PI_HT_NOTIFY_MIN_WORDS` / `_MAX_WORDS` | `3` / `5` |
| `htBinary`       | `PI_HT_NOTIFY_HT_BIN`         | `ht`               |
| `notifySubtitle` | —                             | `pi agent`         |
| `statusKey`      | `PI_HT_NOTIFY_STATUS_KEY`     | `Pi`               |
| `statusIcon`     | `PI_HT_NOTIFY_STATUS_ICON`    | `bolt`             |
| `statusColor`    | `PI_HT_NOTIFY_STATUS_COLOR`   | `#a6e3a1`          |
| `tickerEnabled`  | `PI_HT_NOTIFY_TICKER_ENABLED` | `true`             |
| `tickerStatusKey` / `_ICON` / `_COLOR` | `PI_HT_NOTIFY_TICKER_KEY` / `_ICON` / `_COLOR` | `ctx` / `chart` / `#89b4fa` |
| `tickerShowCost` | `PI_HT_NOTIFY_TICKER_COST`    | `true`             |
| `tickerFormat`   | `PI_HT_NOTIFY_TICKER_FORMAT`  | `compact`          |

### Phase 2+ flags (`PI_HT_BRIDGE_*`)

| Field                     | Env var                          | Default        |
|---------------------------|----------------------------------|----------------|
| `toolBadgeEnabled`        | `PI_HT_BRIDGE_TOOL_BADGE`        | `true`         |
| `planMirrorEnabled`       | `PI_HT_BRIDGE_PLAN_MIRROR`       | `true`         |
| `activityLogEnabled`      | `PI_HT_BRIDGE_ACTIVITY_LOG`      | `true`         |
| `activityLogSource`       | `PI_HT_BRIDGE_ACTIVITY_LOG_SOURCE` | `pi`         |
| `tuiHeartbeatEnabled`     | `PI_HT_BRIDGE_TUI_HEARTBEAT`     | `true`         |
| `tuiHeartbeatIntervalMs`  | `PI_HT_BRIDGE_TUI_HEARTBEAT_INTERVAL_MS` | `80`   |
| `tuiHeartbeatLength`      | `PI_HT_BRIDGE_TUI_HEARTBEAT_LENGTH` | `8`         |
| `tuiStatusEnabled`        | `PI_HT_BRIDGE_TUI_STATUS`        | `true`         |
| `bashSafetyMode`          | `PI_HT_BRIDGE_BASH_SAFETY`       | `confirmRisky` |
| `bashSafetyTimeoutMs`     | `PI_HT_BRIDGE_BASH_SAFETY_TIMEOUT_MS` | `60000`   |
| `toolsEnabled`            | `PI_HT_BRIDGE_TOOLS`             | `true`         |
| `toolAskUserEnabled`      | `PI_HT_BRIDGE_TOOL_ASK_USER`     | `true`         |
| `toolPlanEnabled`         | `PI_HT_BRIDGE_TOOL_PLAN`         | `true`         |
| `toolBrowserEnabled`      | `PI_HT_BRIDGE_TOOL_BROWSER`      | `true`         |
| `toolNotifyEnabled`       | `PI_HT_BRIDGE_TOOL_NOTIFY`       | `true`         |
| `toolScreenshotEnabled`   | `PI_HT_BRIDGE_TOOL_SCREENSHOT`   | `true`         |
| `toolRunInSplitEnabled`   | `PI_HT_BRIDGE_TOOL_RUN_IN_SPLIT` | `true`         |
| `systemPromptPrimerEnabled` | `PI_HT_BRIDGE_SYSTEM_PROMPT_PRIMER` | `true`    |
| `commandsEnabled`         | `PI_HT_BRIDGE_COMMANDS`          | `true`         |
| `lifecycleCompactionEnabled` | `PI_HT_BRIDGE_LIFECYCLE_COMPACTION` | `true`  |
| `lifecycleResumeEnabled`  | `PI_HT_BRIDGE_LIFECYCLE_RESUME`  | `true`         |
| `socketEnabled`           | `PI_HT_BRIDGE_SOCKET`            | `true`         |
| `socketPath`              | `PI_HT_BRIDGE_SOCKET_PATH`       | `""` (auto)    |

Debug: `PI_HT_NOTIFY_DEBUG=1` logs failures from any module to stderr.

### Swap the model

Any model known to pi's model registry works:

```json
{ "provider": "anthropic", "modelId": "claude-haiku-4-5" }
{ "provider": "openai",    "modelId": "gpt-5-mini" }
{ "provider": "groq",      "modelId": "llama-3.3-70b-versatile" }
```

The extension always calls the model with `reasoningEffort: "off"` so
even reasoning-capable models skip thinking and return summaries fast.

## Testing

Bun-test units live under `tests/pi-extensions/ht-bridge/` so the
project's bare `bun test` picks them up:

```bash
bun test tests/pi-extensions/    # 89 tests across 8 files covering
                                 # ht-client, plan-mirror, bash-safety,
                                 # system-prompt primer, resume,
                                 # run-in-split, tui-heartbeat-frames,
                                 # tui-status formatter.
```

Modules with pi-coding-agent / typebox imports (`bash-safety.ts`,
`tools/*.ts`, `system-prompt/primer.ts` glue, `tui-heartbeat.ts`,
`tui-status.ts` registration, command/lifecycle wirings) keep their
testable logic in pi-free siblings (`bash-safety-core.ts`,
`run-in-split-core.ts`, `tui-heartbeat-frames.ts`, exported pure
helpers `buildPrimer` / `findLastPlanSet` / `formatStatusLine`) so
the test suite doesn't need to resolve pi's runtime out of the
repo's node_modules.

## Uninstall

Remove the symlink (or the directory) from `~/.pi/agent/extensions/`
or `.pi/extensions/` and run `/reload`.
