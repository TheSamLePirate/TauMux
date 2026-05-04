---
title: Pi (ht-bridge)
description: pi-extensions/ht-bridge — observe + intercept + register tools, bridging pi-coding-agent into τ-mux's plan panel, ask-user modal, and sidebar.
sidebar:
  order: 2
---

`pi-extensions/ht-bridge/` (renamed from `ht-notify-summary/` in 0.2.80) is a Pi (an AI coding-agent) extension that does three things at once:

1. **Observes** every pi turn — pushes the active task label, cost ticker, tool-execution badge, plan-shaped JSON, and per-turn activity log into τ-mux's sidebar.
2. **Intercepts** dangerous bash commands — pops a τ-mux modal (which mirrors to Telegram) before `rm -rf`, `sudo`, force-pushes, etc. actually run.
3. **Registers tools** — gives the LLM `ht_ask_user`, `ht_plan_set/_update/_complete`, `ht_browser_open/_navigate/_close`, `ht_notify`, `ht_screenshot`, and `ht_run_in_split` (spawns a sibling pane for long-running commands) so it can drive τ-mux directly. A system-prompt primer teaches the model when to use each, including the **current workspace + surface id + cwd** resolved at startup via `system.identify`.

Plus two slash commands (`/ht-plan`, `/ht-ask`) for human-driven control, plan replay on session resume, and a "Compacting…" pill while pi rolls a session into a summary.

Same idea as the [Claude Code integration](/integrations/claude-code/), but pi's richer event surface lets ht-bridge intercept tool calls and add LLM-callable tools — Claude Code's shell-hook protocol can't.

## Capability matrix

| Capability | Default |
|---|---|
| Active-label pill (`Pi : <task>` while running, `ht notify` on `agent_end`) | on |
| Cost / context-window ticker (`Pi · 34% · $0.012`) | on |
| Tool-execution badge (`pi_tool : bash <cmd>`) | on |
| Plan-text mirror (sniffs fenced JSON arrays of `{id,title,state}`) | on |
| Per-workspace activity log (`tool_call`, errors, turn summaries) | on |
| K2000 / KITT scanner installed as pi's working indicator (`░▒█──────` sweeping back and forth while pi streams) | on |
| τ-mux indicator pill: green `● τ-mux ws:2 surface:7` when connected, red `● τ-mux (offline)` outside τ-mux. Outside τ-mux this is the **only** thing the extension renders — observers/tools/intercepts all short-circuit. | on |
| Bash-safety gate (matches `rm -rf`/sudo/mkfs/force-push/…, blocks on user "no") | `confirmRisky` |
| LLM-callable `ht_ask_user`, `ht_plan_*`, `ht_browser_*`, `ht_notify`, `ht_screenshot` | on |
| LLM-callable `ht_run_in_split` — spawns a sibling pane and runs a long-running command (dev server, watcher, log tail) the user can watch live. Same bash-safety gate as the `bash` tool. | on |
| System-prompt primer (chains a τ-mux orientation block onto every turn) | on |
| `/ht-plan` and `/ht-ask` slash commands | on |
| "Compacting…" pill on `session_before_compact` / `_compact` | on |
| Plan replay on `session_start { reason: "resume" \| "fork" }` | on |

Each row is gated by an independent flag in `config.json` — disabling any of them is one boolean.

## Transport

Hot paths (sidebar pills, log lines, plan updates, notifications) go through a direct Unix-socket JSON-RPC client (~1 ms/call) instead of forking the `ht` CLI (50–100 ms). Cold paths and missing-socket fallbacks transparently shell out to `ht`. Transport failures (connect refused, EPIPE) trigger the fallback; protocol-level outcomes (server returned `error`, request timed out, AbortSignal aborted) propagate as-is so we don't retry "method not found" against `ht`.

## Module layout

```
pi-extensions/ht-bridge/
├── config.json                (default flags for every capability)
├── index.ts                   (factory; conditionally wires sub-modules)
├── lib/                       (config, ht-client, summarizer, surface-context)
├── observe/                   (active-label, cost-ticker, tool-badge, plan-mirror, activity-log)
├── intercept/                 (bash-safety + bash-safety-core)
├── tools/                     (ask-user, plan, browser, notify, screenshot)
├── system-prompt/             (primer)
├── commands/                  (plan-cmd, ask-cmd)
└── lifecycle/                 (compaction, resume)
```

## Install

```bash
# Global (all sessions)
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi-extensions/ht-bridge" ~/.pi/agent/extensions/ht-bridge

# Or project-local
mkdir -p .pi/extensions
ln -s "$PWD/pi-extensions/ht-bridge" .pi/extensions/ht-bridge
```

Reload inside pi: `/reload`. Quick test without installing: `pi -e ./pi-extensions/ht-bridge/index.ts`. If you previously installed `ht-notify-summary`, remove that symlink first.

## Configuration

Edit `pi-extensions/ht-bridge/config.json` or override individual fields with env vars. The original `PI_HT_NOTIFY_*` prefix is preserved for backward compatibility; everything new is under `PI_HT_BRIDGE_*`. Full table: see the [extension's README](https://github.com/TheSamLePirate/TauMux/tree/main/pi-extensions/ht-bridge).

Common overrides:

```bash
PI_HT_BRIDGE_BASH_SAFETY=confirmAll      # gate every bash call (paranoid)
PI_HT_BRIDGE_BASH_SAFETY=off             # disable gate entirely
PI_HT_BRIDGE_TOOLS=0                     # disable all ht_* tools
PI_HT_BRIDGE_SYSTEM_PROMPT_PRIMER=0      # don't mutate pi's system prompt
PI_HT_NOTIFY_MODEL=gpt-5-mini            # swap the fast summary model
PI_HT_NOTIFY_DEBUG=1                     # log failures from any module to stderr
```

## How the LLM-callable tools work

Each tool is registered via `pi.registerTool({ name, description, promptSnippet, promptGuidelines, parameters, execute })`. The `promptGuidelines` field is the leverage point — pi only learns to use these tools because the system prompt tells it when to. Each guideline names the tool explicitly (`Use ht_ask_user when …` rather than `Use this tool when …`) since pi appends them flat to the global Guidelines section.

The system-prompt primer adds, on every `before_agent_start`, a τ-mux orientation block: surface id, registered tools, behaviour nudges (`Don't ht_notify on every step — once or twice per task`), and a bash-safety reminder. Disabled tools don't appear in the primer, so a user who turned off `ht_browser_*` doesn't see contradicting guidance.

## Read more

- [Claude Code integration](/integrations/claude-code/) — sibling pattern, narrower hooks (no tool interception, no custom-tool registration).
- [Notification channels](/integrations/notification-channels/)
- [Plan panel](/features/plan-panel/) — what `ht_plan_set` writes to.
- [Ask-user feature](/features/ask-user/) — what `ht_ask_user` triggers.
