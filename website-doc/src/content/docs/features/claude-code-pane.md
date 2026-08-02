---
title: Claude Code pane
description: A native Claude Code session as a first-class pane — streamed chat, tool cards, permission modes, interrupt, cost pills, and a session-resume picker.
---

Since 0.7.0, Claude Code can run as a **native pane** — a first-class
surface alongside terminals, browsers, and the pi agent pane. The pane
hosts a real Claude Code session through the official Agent SDK, using
**your own `claude` install and login** (the SDK's bundled CLI is the
fallback when none is found).

This complements — not replaces — running `claude` in a terminal pane:
the [hook/statusline integration](/integrations/claude-code/) covers
terminal sessions; the pane is for when you want a chat-style surface
with structured affordances.

## Open one

Command palette (`⌘⇧P`):

- **New Claude Code Pane** — new workspace;
- **Split Claude Code Right / Down** — split beside the focused pane.

## What's in the pane

- **Streamed responses** — partial text accumulates live into the
  transcript; tool calls render as **cards** (`Bash` shows the exact
  command, file tools show the path).
- **Toolbar** — model pill, **permission-mode switcher** (default /
  acceptEdits / plan / bypassPermissions, applied mid-session), session
  cost pill, **Stop** (interrupt — also `Esc` from the composer), and
  **Sessions**.
- **Sessions picker** — lists your recent Claude Code sessions (title,
  branch, last activity); picking one **resumes it in a new split**.
- **Composer** — `Enter` sends, `Shift+Enter` inserts a newline.

## Permissions

Tool permissions inside the pane ride the **same
[ask-user modal](/features/ask-user/)** (and Telegram forward) as the
hook-level remote approvals: Allow / Deny, with the exact tool input
shown. No answer within the timeout → the tool is denied with a
"timed out" message to the model. There is no bypass path unless you
switch the pane to `bypassPermissions` yourself.

## Lifecycle

Closing the pane interrupts the turn and winds the session down — no
orphan processes. Restoring a saved layout re-mounts Claude panes as
**fresh sessions** (the old stream died with the app); use the Sessions
picker to resume where you were. Keyboard focus follows the app-wide
rule: the pane's composer is an input surface like the pi pane's, and
terminal keystrokes are never stolen by panes you didn't focus.
