# Plan 10 — User-request panel: agent asks user via τ-mux UI

## Source quote

> # User Request handled in t-mux
> when a agent ask user question, it does it in tmux

## Goal

When an agent needs human input (a permission, a free-text answer, a
multiple-choice decision), display the question in a τ-mux UI panel
rather than blocking inside the terminal stream where the user might
miss it.

## Today

- Agents print a question in the terminal and pause for stdin / a key.
- Some integrations send a macOS notification, but the user has to
  switch focus to the terminal pane to answer.

## Proposal

A typed RPC `agent.ask_user` and a corresponding modal/panel:

### RPC contract

```ts
interface AskUserRequest {
  agent_id?: string;            // attribution
  surface_id: string;           // who is asking
  request_id: string;           // for response routing
  kind: "yesno" | "choice" | "text" | "confirm-command";
  title: string;                // 1 line
  body?: string;                // multi-line markdown
  choices?: { id: string; label: string }[];   // for kind=choice
  default?: string;             // pre-filled / preselected
  timeout_ms?: number;          // auto-resolve if user idle
  unsafe?: boolean;             // visual warning treatment
}
interface AskUserResponse {
  request_id: string;
  action: "ok" | "cancel" | "timeout";
  value?: string;               // text or chosen id
}
```

CLI:

```sh
ht ask --kind yesno --title "Run npm install?" --body "Lockfile changed"
ht ask --kind choice --title "Branch" --choices main,dev,feature/x
ht ask --kind text --title "Commit message"
ht ask --kind confirm-command --title "Run command" --body "rm -rf ./build"
```

`ht ask` blocks on stdout, prints the chosen value (or exits with
non-zero on cancel/timeout).

### UI

A floating panel anchored over the originating surface (similar to
Plan #03's notification overlay but **modal** — focus goes to the
panel, terminal input is paused):

- Compact card, centered over the pane.
- Buttons / radio / textarea per `kind`.
- Esc → cancel; Enter → submit / OK.
- For `kind: confirm-command`: show the command in a code box and a
  bold "This will execute on your machine" warning. Two-step:
  user has to click "I understand", *then* "Run".
- A "send to telegram" toggle (per-request, default off): forwards
  the question to the configured telegram chat with inline buttons,
  so the user can answer from their phone (see Plan #08 for the
  callback wiring).

### Routing

- Responses dispatched on the socket / Electrobun bus as
  `askUserResponse` events keyed by `request_id`.
- The agent waits in `ht ask` (single-shot RPC).

### Idle / multi-pane behaviour

- Multiple concurrent requests: one panel per surface, stack if
  same surface has more than one (queue).
- If user clicks away from the surface, panel persists; sidebar shows
  a badge counter so the user can find it.

## Files

- `src/shared/types.ts` — `AskUserRequest`, `AskUserResponse`.
- `src/bun/rpc-handlers/agent.ts` — `agent.ask_user` (returns a
  promise; routes the response back on completion).
- `src/views/terminal/ask-user-panel.ts` (new) — UI.
- `src/views/terminal/socket-actions.ts` — dispatch the `askUserShown`
  / `askUserResolved` actions.
- `bin/ht` — `ask` subcommand.
- `doc/system-ask-user.md` (new).

## Tests

- `tests/ask-user-rpc.test.ts` — request/response round trip
  preserves `request_id`.
- `tests/ask-user-timeout.test.ts` — timeout resolves with
  `action: "timeout"`.
- `tests/ask-user-confirm-command.test.ts` — two-step UI; first click
  doesn't submit.

## Risks / open questions

- This duplicates terminal stdin-driven prompts. Decision: agents that
  want native UX use `ht ask`; legacy stdin prompts keep working.
- Telegram forwarding needs Plan #08's button infra; cross-link.
- Multiple agents asking the same surface concurrently: handle as a
  FIFO queue per `surface_id`.

## Effort

M — RPC plumbing + 4 UI variants (yesno / choice / text /
confirm-command) + tests. ~2 days.
