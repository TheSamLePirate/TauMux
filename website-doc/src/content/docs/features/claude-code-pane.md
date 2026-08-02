---
title: Claude Code pane
description: A native Claude Code session as a first-class pane — markdown chat, expandable tool cards with live results, thinking blocks, in-place session switching, model & permission switchers, and inline approval status.
---

Since 0.7.0 (fully-featured since 0.8.0), Claude Code can run as a
**native pane** — a first-class surface alongside terminals, browsers,
and the pi agent pane. The pane hosts a real Claude Code session through
the official Agent SDK, using **your own `claude` install and login**
(the SDK's bundled CLI is the fallback when none is found). New panes
inherit the **cwd of the pane you were focused on**, so sessions start
where you're working.

This complements — not replaces — running `claude` in a terminal pane:
the [hook/statusline integration](/integrations/claude-code/) covers
terminal sessions; the pane is for when you want a chat-style surface
with structured affordances.

## Open one

Command palette (`⌘⇧P`): **New Claude Code Pane**, or **Split Claude
Code Right / Down** beside the focused pane.

## The transcript

- **Markdown responses**, streamed live with a cursor — code blocks with
  language labels, inline code, headers, lists. Streaming is O(N) (the
  pi pane's live-element pattern), so long answers stay smooth.
- **Thinking blocks** — extended thinking streams into a collapsed
  "Thinking" block (pulsing while live); click to expand.
- **Tool cards** — every tool call is a card with a status dot
  (running → green ok / red failed), the tool name, and a one-line
  summary (`Bash` shows the exact command, file tools the path, `Task`
  the subagent brief). Click to expand: full **input** and the
  **matched output** (paired by `tool_use_id`), each with a copy button.
  Output is capped at 4 000 chars with the true length noted.
- **Inline approval status** — while a tool waits on the
  [ask-user modal](/features/ask-user/) (or Telegram), the transcript
  shows *"Waiting for approval: Bash"*; a denial or timeout leaves a red
  record in place.
- **Turn meta rows** — duration · cost · tokens after every turn; API
  failures render as errors.
- **Smart autoscroll** — the view sticks to the bottom until you scroll
  up; a **↓ latest** pill brings you back.

## Header

Left to right: a **state dot** (idle / pulsing while working / amber
while waiting for approval), a **model switcher** (default · Opus ·
Sonnet · Haiku — applied mid-session; the session's actual model is
added to the list automatically), the **permission-mode switcher**
(`bypassPermissions` is highlighted red), the session **cwd**, live
**token / cost / elapsed** pills, and **New · Sessions · Stop**.

## Sessions — in place

**Sessions** lists your recent Claude Code sessions (title, branch, last
activity). Picking one **resumes it in this pane**: the persisted
transcript is replayed under a *"resumed session"* divider and the
conversation continues with full context. **fork** resumes into a new
session id, leaving the original untouched. **New** starts a fresh
session in the pane. (Under the hood the pane rebinds its SDK stream —
the surface id, split position, and layout slot never change.)

## Composer

`Enter` sends, `Shift+Enter` inserts a newline, `Esc` interrupts. The
textarea grows with content. **Sending mid-turn queues** the message —
the SDK delivers it when the current turn ends.

## Permissions

Tool permissions ride the **same ask-user modal** (and Telegram forward)
as the hook-level remote approvals: Allow / Deny, with the exact tool
input shown. No answer within the timeout → the tool is denied with a
"timed out" message to the model. There is no bypass path unless you
switch the pane to `bypassPermissions` yourself.

## Lifecycle

Closing the pane interrupts the turn and winds the session down — no
orphan processes. Restoring a saved layout re-mounts Claude panes as
fresh sessions (resume from **Sessions** to continue). Keyboard focus
follows the app-wide rule: the composer is an input surface like the pi
pane's, and terminal keystrokes are never stolen by panes you didn't
focus.
