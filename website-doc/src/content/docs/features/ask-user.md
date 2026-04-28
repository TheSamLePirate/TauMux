---
title: Ask-user (agent → human)
description: A typed protocol so an agent can ask the user a yes/no, multiple-choice, free-text, or "confirm this command" question — answered from the τ-mux modal, a sibling shell, or Telegram.
sidebar:
  order: 11
---

When an agent (a CLI script, a coding agent, a long-running automation) needs human input, it shouldn't print a question into the terminal stream and hope you notice. τ-mux ships a structured protocol — `ht ask` from the agent's side, a webview modal on yours — that surfaces every question with attribution and routes the answer back deterministically.

## What it does

- **Four question kinds.** `yesno`, `choice`, `text`, and `confirm-command` (a two-step ack → run gate for destructive commands).
- **Webview modal.** When a request lands for the focused surface, a centered sheet pops with the title, body, attribution (workspace · pane · agent), and kind-appropriate controls.
- **Per-surface FIFO.** Multiple concurrent requests across surfaces are isolated; the same surface queues them in arrival order.
- **Sidebar pending pill.** When a question is open on a workspace you're not focused on, a cyan `N ?` pill appears on that workspace card. Click the workspace, the modal pops.
- **Telegram routing.** Optional. Every queued question fans out to allow-listed Telegram chats with kind-appropriate buttons (`Yes`/`No`, one-button-per-choice, force-reply for text, two-step confirm). On resolution the original message is edited in place with a strike-through title and a footer like `✓ answered: yes` so the chat reads as a clean audit log.
- **Snapshot on bootstrap.** If the webview reloads or attaches mid-question, it pulls the current pending list from bun and re-pops the modal. No stranded requests.

## Quick example

From any sibling shell:

```bash
ht ask yesno --title "Run install?" --body "Lockfile changed"
# Modal pops in the active τ-mux pane.
# Click Yes → CLI prints "yes" and exits 0.
# Click No  → CLI prints "no"  and exits 0.
# Esc/Cancel → exits 3.
# Timeout    → exits 2.
```

```bash
ht ask choice --title "Branch" --choices main,dev,feature/x
# One button per choice; first choice auto-focused.
# Returns the selected id on stdout.
```

```bash
ht ask text --title "Commit message" --default "wip"
# Text input pre-filled with "wip".
# Enter submits; empty submit shakes (refuses).
```

```bash
ht ask confirm-command --title "Run command" --body "rm -rf ./build" --unsafe
# Step 1: red "This will execute on your machine" banner +
#         [I understand] / [Cancel] buttons.
# Step 2 (after ack): [Run] (red) / [Back] / [Cancel].
# Two deliberate clicks, never one. Enter intentionally does not submit.
```

The agent's `ht ask` invocation blocks until you answer, cancel, or the optional `--timeout` elapses.

## Behavior summary

| Kind | Modal body | Buttons | Enter | CLI exit |
|---|---|---|---|---|
| `yesno` | title + body | `Yes` (primary) · `No` · `Cancel` | submits "yes" | 0 with `yes` / `no`; 3 on cancel |
| `choice` | title + body | one per choice + `Cancel` | submits first choice | 0 with `<choice id>`; 3 on cancel |
| `text` | title + body + input (uses `--default`) | `Submit` · `Cancel` | submits typed value (empty shakes) | 0 with the typed string; 3 on cancel |
| `confirm-command` | title + body + code box | step 1: `I understand` / `Cancel`; step 2: `Run` / `Back` / `Cancel` | does **not** submit (deliberate clicks) | 0 with `run`; 3 on cancel |

A `--timeout <ms>` flag on `ht ask` auto-resolves the request as `timeout` (exit code 2) if no answer arrives in time.

## How answers route

Three answering paths share one source of truth (the bun-side queue):

1. **The webview modal** in τ-mux — clicks dispatch `askUserAnswer` / `askUserCancel` over the Electrobun bridge.
2. **Sibling CLI** — `ht ask answer <id> <value>` and `ht ask cancel <id>` from another shell. Useful when scripting tests or driving from a remote shell.
3. **Telegram** — taps on the inline buttons (or a `force_reply` answer for `text` kind). First tap wins; later taps from other allow-listed users see "(no such id — already resolved)".

Whichever path resolves a request, the bun queue emits a single `resolved` event that the modal picks up (dismiss), Telegram picks up (edit-in-place footer), and the agent's `ht ask` invocation picks up (stdout + exit).

## Telegram audit trail

When `Settings → Telegram → Route ht ask to Telegram` is on, the chat history becomes a self-documenting log of every question and its answer:

```
[bot]  Run install?
       Lockfile changed
       [Yes] [No] [Cancel]

[you]  → tap Yes

[bot]  ~~Run install?~~
       Lockfile changed
       ✓ answered: yes
```

Scroll back through the chat — every prompt has its resolution stamped on it.

## Background-surface case

When an agent fires `ht ask` against a surface you're **not** currently focused on:

- The modal **does not** steal focus from your active surface.
- The originating workspace's sidebar card shows a cyan `1 ?` pill.
- Click the workspace → modal pops with the head request for the active surface.
- Switching back to a surface with no pending hides the modal but does **not** cancel — the request stays open until you answer, cancel, or timeout.

## Source files

- `src/bun/ask-user-queue.ts` — the queue (FIFO + timeouts + subscribers).
- `src/bun/rpc-handlers/ask-user.ts` — `agent.ask_user` / `agent.ask_pending` / `agent.ask_answer` / `agent.ask_cancel`.
- `src/bun/ask-user-telegram.ts` — Telegram fan-out + edit-in-place helpers.
- `src/views/terminal/ask-user-state.ts` — webview-side per-surface FIFO mirror.
- `src/views/terminal/ask-user-modal.ts` — the modal (four kind variants, two-step confirm gate).
- `bin/ht ask` — CLI entry point.

## Read more

- [`ht ask` CLI reference](/cli/ask-user/)
- [`agent.*` JSON-RPC methods](/api/agent/)
- [Telegram bridge](/features/telegram-bridge/) — the routing layer for question fan-out
