# Claude Code ↔ τ-mux

Glue that makes τ-mux the best place to run Claude Code — and teaches
Claude Code to drive τ-mux's interactive surfaces — the same way
`pi-extensions/ht-bridge` does for the pi coding agent.

Three pieces (august-plan M1 architecture):

- **Event plane — hook bridge** (`ht-bridge/`), passive. Fourteen Claude
  Code shell hooks → `ht claude event` → the app-side
  `ClaudeSessionRegistry`. Drives the session phase (working / waiting /
  approval / compacting / error), turn boundaries, subagent counts, and
  the native task mirror. No LLM involvement.
- **Data plane — statusline** (`ht claude statusline`), passive. Claude
  Code pipes its statusline JSON (cost, context %, rate limits, session
  title, model, PR state — computed by Claude Code itself); the command
  renders a τ-mux status line back AND tees the data into the registry.
  Replaces v1's transcript parsing + pricing table + `pi` title sidecar.
- **`tau-mux` skill** (`skills/tau-mux/`), active. Tells Claude Code to
  prefer `ht ask`, `ht plan`, `ht notify`, `ht new-split`, `ht browser`,
  `ht screenshot` over plain terminal output. Loaded from
  `~/.claude/skills/tau-mux/SKILL.md`.

## What's here

| Path | Purpose |
| ---- | ------- |
| `ht-bridge/src/index.ts` | Thin hook runner: argv[2] event + stdin payload → `ht claude event`. |
| `ht-bridge/src/build-event.ts` | Pure payload→event mapping (unit-tested in `tests/claude-bridge.test.ts`). |
| `ht-bridge/config.json` | Optional overrides (enable flag, ht path). |
| `ht-bridge/README.md` | Per-component doc, event table, manual-test snippets. |
| `skills/tau-mux/SKILL.md` | Instructional skill — ask / plan / notify / split / browser / screenshot. |
| `settings.snippet.jsonc` | Drop-in `statusLine` + full `hooks` block for `~/.claude/settings.json`. |
| `install.sh` | Symlinks `ht-bridge/` into `~/.claude/scripts/` and the skill into `~/.claude/skills/`. |

App-side counterparts live in the main tree: `src/bun/claude-session-registry.ts`
(state), `src/bun/claude-status-presenter.ts` (pills + notifications),
`src/bun/rpc-handlers/claude.ts` (`claude.event` / `claude.statusline` /
`claude.sessions`), `src/shared/claude-types.ts` +
`src/shared/claude-statusline.ts` (wire types, statusline parse/render).

## Install

```bash
# from the repo root
./claude-integration/install.sh
```

Then merge `settings.snippet.jsonc` into `~/.claude/settings.json`:

1. the `statusLine` block (or keep your own statusline and lose the
   cost/context/rate-limit feed), and
2. the `hooks` entries — all fourteen are optional; the four v1 names
   (`prompt`, `stop`, `notify-idle`, `notify-permission`) are unchanged,
   so an existing install only needs the new blocks added.

A one-click installer in the app (Settings → Claude Code) is planned for
M2 (`doc/august-plan.md` WS7).

## Verify

```bash
ht claude sessions --all       # sessions the app has observed
echo '{"session_id":"t","prompt":"hello"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts prompt   # manual event
HT_CLAUDE_DEBUG=1 …            # surface bridge errors on stderr
```

## How it mirrors pi-extensions

| `pi-extensions/ht-bridge` capability | Claude Code analog |
| ------------------------------------ | ------------------ |
| `before_agent_start` → "Thinking…" pill | `UserPromptSubmit` hook → working pill |
| Haiku call → 3-5 word label | Claude Code's own session title, via the statusline feed (no sidecar, no second model) |
| `agent_end` → `ht notify` summary | `Stop` hook → app-side summary notification |
| `turn_end` → `ctx · %` ticker | statusline feed → `Opus · 42% ctx · $0.31` ticker |
| Cost from pi-ai's `model.cost` | `cost.total_cost_usd` from the statusline feed |
| `session_shutdown` → clear pills | `SessionEnd` hook → registry prune + pill clear |
| `ht_ask_user` LLM tool | `tau-mux` skill — `ht ask {yesno\|choice\|text\|confirm-command}` |
| `ht_plan_*` LLM tools | `tau-mux` skill + native TaskCreated/TaskCompleted mirror (M2 wires it to the plan panel) |
| `ht_notify` LLM tool | `tau-mux` skill — `ht notify` on milestones |
| `ht_browser_*` / `ht_screenshot` tools | `tau-mux` skill — `ht browser` / `ht screenshot` |
| Bash-safety gate | `tau-mux` skill — `ht ask confirm-command` (M2: PermissionRequest hook routing) |

## Uninstall

```bash
rm ~/.claude/scripts/ht-bridge
rm ~/.claude/skills/tau-mux
```

Then remove the hook blocks + `statusLine` from `~/.claude/settings.json`.
v2 keeps no state anywhere (v1's `$TMPDIR/ht-claude-bridge/` is gone; if
present from an old install it can be deleted).

## Related

- `doc/august-plan.md` — the full integration plan (M1–M4).
- `bin/ht` — the CLI the bridge shells out to (`claude event|statusline|sessions`).
- `src/bun/rpc-handlers/sidebar.ts` — workspace attribution via `HT_SURFACE`.
- `doc/system-webview-ui.md` §4 — sidebar UX spec the pills render under.
