# Claude Code ↔ τ-mux

Glue that surfaces Claude Code session state into τ-mux's sidebar — and teaches Claude Code to drive τ-mux's interactive surfaces — the same way `pi-extensions/ht-bridge` does for the pi coding agent.

The integration ships two pieces:

- **Runtime hook bridge** (`ht-bridge/`) — passive. Drives the active label pill, cost/context ticker, and idle/permission pill colour from Claude Code shell hooks. No LLM involvement.
- **`tau-mux` skill** (`skills/tau-mux/`) — active. Tells Claude Code to prefer `ht ask`, `ht plan`, `ht notify`, `ht new-split`, `ht browser`, `ht screenshot`, etc. over plain terminal output. Loaded by Claude Code from `~/.claude/skills/tau-mux/SKILL.md`.

Both are installed by `./install.sh` (one symlinks into `~/.claude/scripts/`, the other into `~/.claude/skills/`).

## What's here

| Path                                      | Purpose                                                           |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `ht-bridge/src/index.ts`                  | Shell-hook runner. Four events (`prompt`, `stop`, `notify-idle`, `notify-permission`) → `ht set-status` / `ht notify`. |
| `ht-bridge/config.json`                   | Optional per-user overrides (colors, keys, pricing, ticker off). |
| `ht-bridge/README.md`                     | Per-component doc, manual-test snippets, env vars.               |
| `skills/tau-mux/SKILL.md`                 | Instructional skill — teaches Claude Code to use ht ask / plan / notify / split / browser / screenshot when running inside τ-mux. |
| `skills/tau-mux/README.md`                | Skill doc — install, scope, and split-of-responsibilities with the runtime hook bridge. |
| `settings.snippet.jsonc`                  | Copy-paste hooks for `~/.claude/settings.json`.                  |
| `install.sh`                              | Symlinks `ht-bridge/` into `~/.claude/scripts/` and `skills/tau-mux/` into `~/.claude/skills/` so edits here land live with no rebuild. Use `SKIP_HOOKS=1` or `SKIP_SKILL=1` to install one without the other. |

## Install

```bash
# from the repo root
./claude-integration/install.sh
```

The script symlinks `~/.claude/scripts/ht-bridge` → this folder. Edits to `ht-bridge/src/index.ts` are picked up on the next hook invocation (Bun reads the file each time — no bundling step).

Then merge the hooks in `settings.snippet.jsonc` into your `~/.claude/settings.json`. Precisely:

- **Add** one hook under `UserPromptSubmit` (alongside your existing superset-notify entry).
- **Replace** the contents of `Stop` — drop the `afplay finish.mp3` and `cmux-notify.sh 'Session complete'` lines; keep the superset-notify block.
- **Replace** the contents of `Notification` — drop all `cmux-notify.sh` and `afplay need-human.mp3` lines; keep only the `idle_prompt` + `permission_prompt` bridge entries.

`settings.snippet.jsonc` shows the final shape.

## How it mirrors pi-extensions

The pi side packs both the passive surface (active label, cost ticker, notifications) and the active surface (LLM-callable tools, plan workflow, ask-user, system-prompt primer) into a single JS extension. Claude Code can't load JS extensions, so we split the same responsibilities across two install targets:

| `pi-extensions/ht-bridge` capability                 | Claude Code analog                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `before_agent_start` → "Thinking…" pill              | `UserPromptSubmit` hook → active label pill (`ht-bridge/`)                          |
| Haiku call → 3-5 word label                          | First clause of prompt (free, 40-char cap) [1]                                      |
| `agent_end` → `ht notify` summary                    | `Stop` hook → `ht notify` with prompt + duration + cost (`ht-bridge/`)              |
| `turn_end` → `ctx · %` ticker                        | `Stop` hook → `cc · turn N · cost` ticker (`ht-bridge/`)                            |
| Cost from pi-ai's `model.cost`                       | Cost from parsing the transcript JSONL (`ht-bridge/`)                               |
| `session_shutdown` → clear pills                     | `Stop` clears label; 24 h janitor prunes stale state (`ht-bridge/`)                 |
| `ht_ask_user` LLM tool                               | `tau-mux` skill — instructs the model to call `ht ask {yesno|choice|text|confirm-command}` |
| `ht_plan_*` LLM tools (review-first .pi/plans/*.md)  | `tau-mux` skill — instructs the model to write `.claude/plans/<name>.md` first, gate via `ht ask choice`, then `ht plan set` |
| `ht_notify` LLM tool                                 | `tau-mux` skill — instructs the model to fire `ht notify` on milestones (sparingly) |
| `ht_browser_*` LLM tools                             | `tau-mux` skill — instructs the model to use `ht browser open-split` + `ht browser browser:N …` |
| `ht_screenshot` LLM tool                             | `tau-mux` skill — instructs the model to call `ht screenshot --out`                 |
| `ht_run_in_split` LLM tool                           | `tau-mux` skill — instructs the model to use `ht new-split` + `ht send` for long-running commands |
| Bash-safety gate (registered via `before_tool_call`) | `tau-mux` skill — instructs the model to gate destructive bash via `ht ask confirm-command` |
| System-prompt primer at every turn                   | `tau-mux` skill — Claude Code loads the skill body when its `description` matches the user's task |

[1] An LLM upgrade is a straightforward add — `claude -p "…"` with `--output-format text` would slot into the `handlePrompt` path. Default stays free to keep latency off the hook critical path.

## Uninstall

```bash
rm ~/.claude/scripts/ht-bridge
rm ~/.claude/skills/tau-mux
```

Then revert the `~/.claude/settings.json` hook blocks; the bridge owns no other files beyond transient state at `$TMPDIR/ht-claude-bridge/`.

## Related

- `bin/ht` — the CLI the bridge shells out to.
- `src/bun/rpc-handlers/sidebar.ts` — the `sidebar.set_status` RPC method the bridge drives. Workspace attribution via `HT_SURFACE` lives here.
- `src/bun/rpc-handlers/notification.ts` — the `notification.create` / `notification.dismiss` path the bridge's `ht notify` calls hit.
- `doc/system-webview-ui.md` §4 — sidebar UX spec the pills render under.
