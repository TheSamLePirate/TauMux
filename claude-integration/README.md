# Claude Code ↔ HyperTerm Canvas

Glue that surfaces Claude Code session state into HyperTerm's sidebar, the same way `pi-extensions/ht-notify-summary` does for the pi coding agent.

## What's here

| Path                                      | Purpose                                                           |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `ht-bridge/src/index.ts`                  | Shell-hook runner. Four events (`prompt`, `stop`, `notify-idle`, `notify-permission`) → `ht set-status` / `ht notify`. |
| `ht-bridge/config.json`                   | Optional per-user overrides (colors, keys, pricing, ticker off). |
| `ht-bridge/README.md`                     | Per-component doc, manual-test snippets, env vars.               |
| `settings.snippet.jsonc`                  | Copy-paste hooks for `~/.claude/settings.json`.                  |
| `install.sh`                              | Symlinks this folder into `~/.claude/scripts/ht-bridge` so edits here land live with no rebuild. |

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

| `pi-extensions/ht-notify-summary`      | `claude-integration/ht-bridge`                  |
| -------------------------------------- | ----------------------------------------------- |
| Runs inside pi-agent as a JS extension | Runs as 4 shell hooks from `settings.json`      |
| `before_agent_start` → "Thinking…"     | `UserPromptSubmit` → active label pill          |
| Haiku call → 3-5 word label            | First clause of prompt (free, 40-char cap) [1]  |
| `agent_end` → `ht notify` summary      | `Stop` → `ht notify` with prompt + duration + cost |
| `turn_end` → `ctx · %` ticker          | `prompt` + `stop` → `cc · turn N · cost` ticker  |
| Cost from pi-ai's `model.cost`         | Cost from parsing the transcript JSONL          |
| Per-session token watermarking         | Per-session state file under `$TMPDIR`          |
| `session_shutdown` → clear pills       | `Stop` clears label; 24 h janitor prunes stale state |

[1] An LLM upgrade is a straightforward add — `claude -p "…"` with `--output-format text` would slot into the `handlePrompt` path. Default stays free to keep latency off the hook critical path.

## Uninstall

```bash
rm ~/.claude/scripts/ht-bridge
```

Then revert the `~/.claude/settings.json` hook blocks; the bridge owns no other files beyond transient state at `$TMPDIR/ht-claude-bridge/`.

## Related

- `bin/ht` — the CLI the bridge shells out to.
- `src/bun/rpc-handlers/sidebar.ts` — the `sidebar.set_status` RPC method the bridge drives. Workspace attribution via `HT_SURFACE` lives here.
- `src/bun/rpc-handlers/notification.ts` — the `notification.create` / `notification.dismiss` path the bridge's `ht notify` calls hit.
- `doc/system-webview-ui.md` §4 — sidebar UX spec the pills render under.
