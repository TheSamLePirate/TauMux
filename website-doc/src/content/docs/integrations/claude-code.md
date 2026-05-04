---
title: Claude Code
description: Two-piece integration — runtime shell hooks that drive sidebar pills, plus a `tau-mux` skill that teaches Claude Code to use τ-mux's interactive surfaces.
sidebar:
  order: 1
---

The Claude Code integration ships **two pieces** because Claude Code can't load JS extensions the way pi can. The pi extension's responsibilities are split across:

- **`claude-integration/ht-bridge/`** — runtime shell hooks. Passive. Drives the active label pill, cost / context ticker, and idle / permission pill colour from Claude Code shell hooks. No LLM involvement.
- **`claude-integration/skills/tau-mux/`** — Claude Code skill. Active. Teaches Claude Code to prefer τ-mux's interactive `ht` surfaces (`ht ask`, `ht plan`, `ht notify`, `ht new-split`, `ht browser`, `ht screenshot`, `ht set-status`) over plain terminal output.

The pi side packs both into a single JS extension (`pi-extensions/ht-bridge/`); for Claude Code the two halves install into different locations under `~/.claude/`.

## Install

```bash
cd claude-integration
./install.sh         # symlinks ht-bridge → ~/.claude/scripts/ht-bridge
                     # AND skills/tau-mux → ~/.claude/skills/tau-mux
```

Flags:

- `SKIP_HOOKS=1 ./install.sh` — install only the skill.
- `SKIP_SKILL=1 ./install.sh` — install only the runtime hook bridge.
- `FORCE=1` — replace existing targets without prompting.
- `COPY=1` — copy instead of symlink (read-only checkouts).

Then add the hook blocks from `claude-integration/settings.snippet.jsonc` into your `~/.claude/settings.json` (the snippet shows the exact `UserPromptSubmit` / `Stop` / `Notification` event hooks). The skill loads automatically — no settings.json edit needed.

## Runtime hook bridge — what gets shown

| Claude event | What ht-bridge does |
|---|---|
| `UserPromptSubmit` | Sets the `Claude : <task>` active label pill. Starts the per-session timer. |
| `Stop` | Clears the label, parses the transcript JSONL for tokens / cost, fires `ht notify` with prompt + duration + cost, refreshes the persistent `cc · turn N · …` ticker. |
| `Notification` matcher `idle_prompt` | Sets the label pill to `Waiting for input` (orange). |
| `Notification` matcher `permission_prompt` | Sets the label pill to `Approval needed` (red) and fires a notification. |

If τ-mux isn't running or `ht` isn't on PATH, the hooks gracefully no-op — Claude Code continues unaffected.

## tau-mux skill — what it teaches

When a Claude Code session matches the skill's description (multi-step plans, user questions, long-running processes, browser verification, screenshots, completion signaling, risky bash), Claude Code loads `~/.claude/skills/tau-mux/SKILL.md`. The skill instructs the model to:

- **Plan workflow.** Write the detailed plan to `.claude/plans/<name>.md` first, gate publication with `ht ask choice` (accept / decline / discuss), then `ht plan set` only on accept. Update steps with `ht plan update <id> --state …` as work progresses.
- **Structured questions.** Use `ht ask {yesno|choice|text|confirm-command}` for decisions the user owns — branch points, framework picks, commit messages, login flows. Modal pops in τ-mux (with optional Telegram forward).
- **Milestone notifications.** `ht notify --title … --body …`, sparingly — once or twice per task. Don't double up with the `Stop`-hook notification.
- **Long-running processes.** Use `ht new-split` + `ht send --surface … "cmd\n"` for dev servers, watchers, and log tails — not the inline `bash` tool. The user can watch live; the agent stays unblocked.
- **Browser verification.** `ht browser open-split <url>`, then drive with `ht browser browser:N {navigate|click|fill|wait|get|is|eval|console|errors|snapshot}`.
- **Screenshots.** `ht screenshot --out /tmp/…png` then `Read` the file back so the agent sees what the user sees.
- **Sidebar progress.** `ht set-status <key> "<value>" --icon … --color …` and `ht set-progress 0.42 --label "…"`. Pick a key that isn't `Claude` or `cc` (those belong to the runtime hook).
- **Bash safety.** Gate destructive commands (`rm -rf`, `git push --force`, `sudo`, `mkfs`, `dd`, bulk `chown`/`chmod`) through `ht ask confirm-command --command "…" --reason "…"` before running.

The skill is self-contained — no config file, no env vars. Edit `claude-integration/skills/tau-mux/SKILL.md` to retune behaviour; changes land live (Claude Code re-reads the skill each session).

## How it mirrors pi-extensions

| `pi-extensions/ht-bridge` capability                   | Claude Code analog                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `before_agent_start` → "Thinking…" pill                | `UserPromptSubmit` hook → active label pill (runtime hook bridge)                   |
| `agent_end` → `ht notify` summary                      | `Stop` hook → `ht notify` with prompt + duration + cost (runtime hook bridge)       |
| `turn_end` → `ctx · %` ticker                          | `Stop` hook → `cc · turn N · cost` ticker (runtime hook bridge)                     |
| `ht_ask_user` LLM tool                                 | `tau-mux` skill — instructs the model to call `ht ask {yesno\|choice\|text\|confirm-command}` |
| `ht_plan_*` LLM tools (review-first `.pi/plans/*.md`)  | `tau-mux` skill — `.claude/plans/<name>.md` → `ht ask choice` accept-gate → `ht plan set` |
| `ht_notify` LLM tool                                   | `tau-mux` skill — `ht notify` on milestones, sparingly                              |
| `ht_browser_*` LLM tools                               | `tau-mux` skill — `ht browser open-split` + `ht browser browser:N …`                |
| `ht_screenshot` LLM tool                               | `tau-mux` skill — `ht screenshot --out`                                             |
| `ht_run_in_split` LLM tool                             | `tau-mux` skill — `ht new-split` + `ht send`                                        |
| Bash-safety gate (`before_tool_call`)                  | `tau-mux` skill — `ht ask confirm-command` before destructive bash                  |
| System-prompt primer at every turn                     | `tau-mux` skill — Claude Code loads the skill body when its `description` matches   |

## Telegram forwarding

When **Settings → Telegram → Forward notifications** is enabled in τ-mux, every `ht notify` call (whether from the runtime hook on `Stop` or from the skill on a milestone) also forwards to your configured chat. Useful for "Claude finished while I was away" pings, and for `ht ask` modals that appear as inline-keyboard buttons in the chat.

## Customizing

- **Runtime hook bridge.** Edit `claude-integration/ht-bridge/src/index.ts`. Per-user overrides via `claude-integration/ht-bridge/config.json` (colors, keys, pricing tables, ticker on/off, idle-notification on/off). Env overrides under `HT_CLAUDE_*`. Bun re-reads the file on each hook invocation; no rebuild step.
- **tau-mux skill.** Edit `claude-integration/skills/tau-mux/SKILL.md`. The frontmatter `description` field controls when the skill loads — tweak it to broaden or narrow the trigger surface.

## Source

- `claude-integration/ht-bridge/src/index.ts` — the hook runner (TypeScript, run via Bun).
- `claude-integration/ht-bridge/config.json` — per-user runtime overrides.
- `claude-integration/skills/tau-mux/SKILL.md` — the skill body.
- `claude-integration/skills/tau-mux/README.md` — skill install + scope notes.
- `claude-integration/install.sh` — symlinks both pieces into `~/.claude/`.
- `claude-integration/settings.snippet.jsonc` — drop-in hook config.

## Read more

- [Pi extensions](/integrations/pi/)
- [Notification channels](/integrations/notification-channels/)
- [Telegram bridge](/features/telegram-bridge/)
