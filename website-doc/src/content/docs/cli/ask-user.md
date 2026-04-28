---
title: Ask-user
description: ht ask — block on a structured question; ask pending / answer / cancel for the answering side.
sidebar:
  order: 10
---

`ht ask` is the agent's side of the [ask-user protocol](/features/ask-user/). The agent invokes one of four kinds and **blocks** on stdout until you answer, cancel, or the optional `--timeout` elapses. Sibling subcommands (`pending`, `answer`, `cancel`) are for scripting or remote answering paths.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Answered. Stdout carries the answer (`yes` / `no` / choice id / typed text / `run`). |
| `2` | Timed out. |
| `3` | Cancelled (Esc, Cancel button, sibling `ht ask cancel`, `/cancel` in Telegram). |

## ask yesno

```bash
ht ask yesno --title "Run install?" --body "Lockfile changed"
# Modal pops; user clicks Yes → prints `yes` and exits 0.
```

| Flag | Purpose |
|---|---|
| `--title <s>` | One-line prompt (required). |
| `--body <s>` | Multi-line body, plain text. |
| `--agent-id <s>` | Attribution shown in the modal header (e.g. `claude:1`). |
| `--surface <id>` | Override the originating surface (defaults to `HT_SURFACE`). |
| `--timeout <ms>` | Auto-cancel after this many ms; exits 2. |

Stdout: `yes` or `no` on accept, empty on cancel/timeout.

## ask choice

```bash
ht ask choice --title "Branch" --choices main,dev,feature/x
# Returns the selected choice id on stdout.

ht ask choice --title "Branch" --choices "main:Main,dev:Develop"
# Use id:label syntax for friendly labels.
```

| Flag | Purpose |
|---|---|
| `--choices <list>` | Comma-separated. Each entry is `id` or `id:label`. (required, ≥1) |
| All `yesno` flags above | (same semantics) |

Stdout: the selected choice id on accept.

## ask text

```bash
ht ask text --title "Commit message" --default "wip"
# User types into the input; Enter submits.
```

| Flag | Purpose |
|---|---|
| `--default <s>` | Pre-fill the input. |
| All `yesno` flags above | (same semantics) |

Empty submit is refused (the input shakes). Stdout: the typed value on accept.

## ask confirm-command

```bash
ht ask confirm-command \
  --title "Run command" \
  --body "rm -rf ./build" \
  --unsafe
# Two-step gate: [I understand] → [Run].
```

| Flag | Purpose |
|---|---|
| `--unsafe` | Render the destructive treatment (red banner + `[Run]` in red). The wire flag is preserved end-to-end so the modal and Telegram both highlight the risk. |
| All `yesno` flags above | (same semantics) |

Two deliberate clicks are required to accept; Enter intentionally does not submit. Stdout: `run` on accept.

## ask pending

```bash
ht ask pending
# id      surface       kind             title
# req:1   surface:1     yesno            Run install?
# req:2   surface:3     confirm-command  rm -rf ./build

ht ask pending --surface surface:1 --json
```

Lists open requests. Use this from a sibling shell when you want to drive the answering side via `ht ask answer` or `ht ask cancel` rather than the modal / Telegram.

## ask answer

```bash
ht ask answer req:1 yes
# resolves request req:1 with the answer "yes" — the agent's blocking
# `ht ask yesno` invocation in the other shell unblocks and exits 0.

ht ask answer req:1 yes --json
# {"resolved": true}
```

| Argument | Purpose |
|---|---|
| `<request_id>` | The id from `ht ask pending`. |
| `<value>` | The answer per kind (`yes` / `no` / choice id / typed text / `run`). |

Returns `{ "resolved": true }` when the id matched. `{ "resolved": false }` when the id was unknown (already resolved or never existed) — exits 0 either way; the boolean is the meaningful signal.

## ask cancel

```bash
ht ask cancel req:1
ht ask cancel req:1 --reason "user is afk"
```

Same shape as `ask answer`; the agent's `ht ask` invocation exits 3 with optional reason on stderr.

## Environment

| Variable | Purpose |
|---|---|
| `HT_SURFACE` | Default `surface_id` for the asking process. Set automatically when `ht ask` is launched from a τ-mux pane; pass `--surface` explicitly when calling from outside. |

## Read more

- [Ask-user feature overview](/features/ask-user/)
- [`agent.*` JSON-RPC methods](/api/agent/)
- [Telegram bridge](/features/telegram-bridge/) — chat-side routing for the answering path
