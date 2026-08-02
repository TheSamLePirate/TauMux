---
title: ht claude
description: statusline, sessions, install, uninstall, doctor, event.
---

Verbs backing the [Claude Code integration](/integrations/claude-code/).
Added in 0.5.0 (statusline / sessions / event) and 0.6.0 (install /
uninstall / doctor).

## claude statusline

```bash
ht claude statusline
```

Not called by hand — install it as Claude Code's statusline:

```json title="~/.claude/settings.json"
{ "statusLine": { "type": "command", "command": "ht claude statusline" } }
```

Reads the JSON Claude Code pipes on stdin, prints a τ-mux-styled status
line (model · effort · directory · git branch · permission mode · PR ·
context bar · cost · ±lines · rate-limit warnings ≥80%), and tees the
parsed data to the app (`claude.statusline`) so the sidebar ticker and
session registry stay accurate. The print always happens and always
comes first — a missing or hung app never degrades the line; exit code
is always 0.

## claude sessions

```bash
ht claude sessions          # live sessions
ht claude sessions --all    # include recently-ended ones
```

Lists the Claude Code sessions the app has observed: short id, phase
(`working` / `waiting-input` / `waiting-approval` / `compacting` /
`error`), pane, title, and `(model · ctx% · cost · turn N)`.

## claude install / uninstall

```bash
ht claude install [--features lifecycle,tasks,statusline,approvals]
                  [--dry-run] [--settings-path P] [--bridge-path P]
ht claude uninstall
```

Managed surgery on `~/.claude/settings.json`:

- **timestamped backup** beside the file before every write;
- **additive merge** — entries you wrote yourself are never touched;
- **idempotent** — a second install reports `= unchanged` lines;
- **refuses** to rewrite a file it cannot parse;
- a user-defined `statusLine` is kept (reported, not clobbered).

Default features: `lifecycle,tasks,statusline`. **`approvals` is
opt-in** — it wires the `PermissionRequest` hook that routes permission
prompts to a τ-mux modal + Telegram (see the
[integration page](/integrations/claude-code/#decision-plane--remote-approvals-opt-in)
for the fail-safe contract). `uninstall` removes exactly the managed
entries (identified by their command path) and keeps a backup.

## claude doctor

```bash
ht claude doctor
```

One-screen health report: `claude` binary + version, settings file
parse state, bridge presence, hooks wired vs missing, approvals state,
statusline (`ht claude statusline` / user-defined / none), skill
presence, and app reachability — including the specific "reachable but
pre-0.5.0 — restart τ-mux" case.

## claude event

```bash
ht claude event --json '<bridge-event JSON>'
```

Internal — the hook bridge's transport into `claude.event`. Injects
`HT_SURFACE` as the surface attribution when the payload lacks one.
