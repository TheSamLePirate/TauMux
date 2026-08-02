---
title: Claude Code
description: Deep Claude Code integration — full-lifecycle hooks, a statusline data feed, remote permission approvals, an automatic task-list mirror, and a native Claude Code pane.
sidebar:
  order: 1
---

Since 0.5.0, τ-mux integrates with Claude Code on **three planes**, plus a
[native Claude Code pane](/features/claude-code-pane/) (0.7.0). Each piece
degrades independently — any subset works, and none of it can break the
terminal (the PTY never depends on the integration).

## The three planes

### Event plane — hooks

Fourteen Claude Code shell hooks (session start/end, prompt/stop, API
failures, subagent start/stop, compaction, cwd changes, task
created/completed, idle/permission notifications) run a small bridge that
forwards one normalized JSON event to the app (`ht claude event`). A
per-session registry tracks each Claude Code session's **phase** —
working / waiting for input / approval needed / compacting / error — and
attributes it to the pane it runs in (`HT_SURFACE`).

You see it as:

- the **`Claude` label pill** — session title while working, yellow
  *Waiting for input*, red *Approval needed*, muted *Compacting…*, red
  error text on API failures (rate limit, overload);
- a **completion notification** on every turn end (prompt + duration +
  cost), an error notification on API failures;
- the **plan panel** mirroring Claude Code's native task list — see below.

### Data plane — statusline

```json title="~/.claude/settings.json"
{ "statusLine": { "type": "command", "command": "ht claude statusline" } }
```

Claude Code pipes a JSON snapshot to its statusline command on every
assistant message. `ht claude statusline` renders a τ-mux-styled status
line back into Claude Code — model, effort, directory, git branch,
permission mode, PR badge, a color-coded context bar, session cost,
±lines, and rate-limit warnings at ≥80% — **and** tees the data into the
sidebar: the **`cc` ticker** becomes `Opus · 42% ctx · $0.31`.

Cost, context %, rate limits, and the session title are **numbers Claude
Code computes itself** — they always match `/cost` and `/context`.
(Earlier versions parsed transcripts against a hand-maintained pricing
table; that machinery is gone.)

### Decision plane — remote approvals (opt-in)

With the `approvals` feature installed, Claude Code permission prompts
are routed to a τ-mux **[ask-user modal](/features/ask-user/)** — and to
**Telegram** when the [bridge](/features/telegram-bridge/) is configured
— with three answers: **Allow**, **Deny**, **Answer in terminal**. The
modal shows the exact tool + input (ground truth, never a summary).

**Fail-safe by construction:** if τ-mux isn't running, the modal times
out, you pick "Answer in terminal", or anything at all goes wrong, the
bridge prints nothing and Claude Code shows its own prompt exactly as
before. The gate can only ever *add* an answer path. Kill switch without
uninstalling: `HT_CLAUDE_APPROVALS=0`.

## Task-list mirror

Claude Code's native task list (TaskCreate / TaskCompleted) is mirrored
into the [plan panel](/features/plan-panel/) automatically, per session —
no model cooperation needed. Completed tasks show as done, the first open
task as active; the mirror is cleared when the session ends, and it
coexists with pi plans (each agent gets its own slot).

Because the mirrored plan and the turn-end notification feed the existing
[auto-continue](/features/auto-continue/) engine, plan-anchored
continuation works for Claude Code sessions under the same safety gates.

## Install

```bash
# one-time: put the bridge + skill in place (from the τ-mux repo)
./claude-integration/install.sh

# wire everything into ~/.claude/settings.json (managed, reversible)
ht claude install                          # lifecycle + tasks + statusline
ht claude install --features approvals     # opt-in: remote approvals
ht claude install --dry-run                # preview the diff
ht claude uninstall                        # remove every managed entry
```

The installer makes a **timestamped backup**, merges **additively** (your
existing hooks are untouched), is **idempotent**, refuses to rewrite a
settings file it cannot parse, and never clobbers a user-defined
statusline (it reports it as kept). See [`ht claude`](/cli/claude/).

## Diagnostics

```bash
ht claude doctor      # binary + version, hooks wired/missing, approvals,
                      # statusline, skill, app reachability
ht claude sessions    # sessions the app has observed (phase, title, cost)
HT_CLAUDE_DEBUG=1     # surface bridge errors on stderr
```

## The `tau-mux` skill

The skill (v2) teaches Claude Code the **interactive** surfaces — `ht
ask` for decisions, splits for long-running processes, `ht browser` / `ht
screenshot` for verification, `confirm-command` gating for destructive
bash. Everything the hooks automate (pills, ticker, notifications, the
plan mirror, approvals) is explicitly *not* the model's job — the skill
says so, which keeps it short and reliable.

## Agent teams

When Claude Code's experimental agent teams are enabled, τ-mux shows a
passive **`team` sidebar pill** ("3 members · 2/6 tasks") read from the
on-disk team state. Read-only and schema-defensive — the upstream feature
is experimental.

## Architecture

Bridge and skill live in `claude-integration/` in the repo; app-side
state lives in a session registry with presenter / mirror / watcher
modules. The full design — including the trust model — is documented in
`doc/system-claude-integration.md`.
