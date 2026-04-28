---
title: agent.*
description: ask_user, ask_pending, ask_answer, ask_cancel — the JSON-RPC surface for the agent → human ask-user protocol.
sidebar:
  order: 10
---

Agents call `agent.ask_user` when they need a structured human answer (yes/no, multiple choice, free text, or "confirm this command"). The bun-side queue holds the request until the [webview modal](/features/ask-user/), a sibling CLI, or [Telegram](/features/telegram-bridge/) resolves it. The `agent.ask_user` call itself is **long-pending** — it returns the response in one round-trip, no polling required.

| Method | Params | Result |
|---|---|---|
| `agent.ask_user` | `{ surface_id: string, kind: "yesno"\|"choice"\|"text"\|"confirm-command", title: string, body?: string, agent_id?: string, choices?: Array<{ id: string, label?: string }>, default?: string, timeout_ms?: number, unsafe?: boolean }` | `{ request_id: string, action: "ok"\|"cancel"\|"timeout", value?: string, reason?: string }` |
| `agent.ask_pending` | `{ surface_id?: string }` | `{ pending: AskUserRequest[] }` |
| `agent.ask_answer` | `{ request_id: string, value: string }` | `{ resolved: boolean }` |
| `agent.ask_cancel` | `{ request_id: string, reason?: string }` | `{ resolved: boolean }` |

## agent.ask_user

The asking call. Validates `params` strictly, drops a request into the queue, and **does not respond until the request is resolved** (answered, cancelled, or timed out).

| Param | Required | Notes |
|---|---|---|
| `surface_id` | yes | Originating surface — drives modal anchoring + Telegram attribution. |
| `kind` | yes | One of `yesno` / `choice` / `text` / `confirm-command`. |
| `title` | yes | One-line prompt. |
| `body` | no | Multi-line body (plain text; markdown is reserved for a future panel polish). |
| `agent_id` | no | Attribution tag (e.g. `claude:1`) — shown in the modal header. |
| `choices` | for `kind=choice` | Non-empty array. Each entry needs an `id`; `label` defaults to `id`. |
| `default` | no | Pre-filled / preselected value (interpreted per kind). |
| `timeout_ms` | no | Auto-resolves with `action: "timeout"` after this many ms. |
| `unsafe` | no | Render-hint for `confirm-command` — drives the destructive treatment in the modal and Telegram. The wire flag is preserved end-to-end. |

Response `value` semantics by kind:

| Kind | `value` on `action: "ok"` |
|---|---|
| `yesno` | `"yes"` or `"no"` |
| `choice` | the chosen choice id |
| `text` | the typed string |
| `confirm-command` | `"run"` (only after the two-step ack → run gate) |

`action: "cancel"` and `action: "timeout"` carry no `value`. `action: "cancel"` may carry `reason`.

## agent.ask_pending

Snapshot of pending requests. Useful for a webview / panel that just attached and needs to seed its local state, or for a sibling CLI that wants to show what's open.

```json
{ "id": "1", "method": "agent.ask_pending", "params": { "surface_id": "surface:3" } }
// { "pending": [
//   { "request_id": "req:1", "surface_id": "surface:3", "kind": "yesno", "title": "Run install?", "created_at": 1714280000000 }
// ]}
```

`surface_id` filters; omit for the whole queue.

## agent.ask_answer

Resolve a request as the user's answer. The original `agent.ask_user` long-pending call returns with `action: "ok"` and the supplied `value`.

```json
{ "id": "2", "method": "agent.ask_answer", "params": { "request_id": "req:1", "value": "yes" } }
// { "resolved": true }
```

`{ "resolved": false }` means the id didn't match — already resolved (timeout, cancel, or another path beat you to it) or never existed. Idempotent on unknown ids.

## agent.ask_cancel

Resolve a request as cancelled. The original `agent.ask_user` returns `action: "cancel"` with the optional `reason` on `stderr` of the calling `ht ask` invocation.

```json
{ "id": "3", "method": "agent.ask_cancel", "params": { "request_id": "req:1", "reason": "user is afk" } }
// { "resolved": true }
```

## Push events

The webview and web mirror also receive these as push messages over the bun → client channels:

| Push | When | Payload |
|---|---|---|
| `askUserEvent: kind="shown"` | A new request lands in the queue. | `{ request: AskUserRequest }` |
| `askUserEvent: kind="resolved"` | A request resolves (answer/cancel/timeout). | `{ request_id, response: AskUserResponse }` |
| `askUserEvent: kind="snapshot"` | Reply to a `askUserRequestSnapshot` ping from the webview. | `{ pending: AskUserRequest[] }` |

The webview modal uses these to render in real time without polling.

## CLI equivalents

| Method | CLI |
|---|---|
| `agent.ask_user` (kind=yesno) | `ht ask yesno --title "..." --body "..."` |
| `agent.ask_user` (kind=choice) | `ht ask choice --title "..." --choices a,b,c` |
| `agent.ask_user` (kind=text) | `ht ask text --title "..." --default "..."` |
| `agent.ask_user` (kind=confirm-command) | `ht ask confirm-command --title "..." --body "..." --unsafe` |
| `agent.ask_pending` | `ht ask pending` |
| `agent.ask_answer` | `ht ask answer <id> <value>` |
| `agent.ask_cancel` | `ht ask cancel <id>` |

## Read more

- [Ask-user feature overview](/features/ask-user/)
- [`ht ask` CLI reference](/cli/ask-user/)
- [Telegram bridge](/features/telegram-bridge/) — Telegram-side routing for the answering path
