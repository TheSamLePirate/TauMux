# tau-mux skill (Claude Code)

A Claude Code skill that mirrors the behaviour
`pi-extensions/ht-bridge/` installs into the pi coding agent. Loaded
automatically by Claude Code when its `description` matches the user's
task.

## What it does

Teaches Claude Code, when running inside τ-mux, to prefer the
structured `ht` CLI surfaces over plain terminal output:

- Plan workflow with `.claude/plans/<name>.md` review-first → `ht plan set`.
- Structured questions via `ht ask {yesno|choice|text|confirm-command}`
  instead of asking via assistant text.
- Long-running processes via `ht new-split` + `ht send`, not the inline
  `bash` tool.
- Browser verification via `ht browser open-split` + `ht browser browser:N
  …`.
- Visual evidence via `ht screenshot --out`.
- Sidebar progress via `ht set-status` / `ht set-progress`.
- Completion / blocker notifications via `ht notify`.
- Destructive-command gating via `ht ask confirm-command`.

What it does **not** drive — those belong to the runtime hook bridge at
`~/.claude/scripts/ht-bridge/`:

- The `Claude` active-label pill (`UserPromptSubmit` hook).
- The `cc` cost / context ticker (`Stop` hook).
- The idle / permission pill colour (`Notification` hook).
- The completion notification on `Stop`.

The two pieces are deliberately split: the runtime hooks need to fire
on every event without LLM involvement, while the skill is the
behaviour-shaping layer the LLM consults.

## Install

```bash
# from the repo root
./claude-integration/install.sh
```

`install.sh` symlinks this directory into `~/.claude/skills/tau-mux/`,
so edits to `SKILL.md` here land live with no rebuild — Claude Code
re-reads the skill file each session.

If you only want the skill (not the hooks):

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/claude-integration/skills/tau-mux" ~/.claude/skills/tau-mux
```

Verify by asking Claude Code something that triggers it — e.g., "open
http://localhost:3000 in a browser pane and check if the dashboard
renders" — and watch for `ht browser open-split` calls instead of plain
`open` / `curl`.

## Uninstall

```bash
rm ~/.claude/skills/tau-mux
```

## Relationship to other τ-mux pieces

| Piece                                          | Role                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `pi-extensions/ht-bridge/`                     | The pi-side equivalent. Runs as a JS extension inside pi.    |
| `claude-integration/ht-bridge/`                | Claude Code runtime hook bridge. Active label + cost ticker. |
| `claude-integration/skills/tau-mux/` (this)    | Claude Code interactive-surface skill. LLM-shaping.          |
| `bin/ht`                                       | The CLI everything above shells out to.                      |
