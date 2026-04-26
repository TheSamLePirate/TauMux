# Plan 11 — OSC 9;4 progress reporting passthrough

## Source quote

> # OSC 9;4 progress reporting
> if a program send OSC, t-mux must accept them (make the list os OSC)

## Background

OSC 9;4 is the de-facto progress sequence (introduced by ConEmu, now
supported by Windows Terminal, WezTerm, Ghostty, recent iTerm2). A
program emits:

```
ESC ] 9 ; 4 ; <state> ; <progress> ESC \
```

Where:

- `state`: `0` = remove (no progress), `1` = normal,
  `2` = error (red), `3` = indeterminate, `4` = paused (yellow).
- `progress`: 0..100 percentage (ignored for state 0/3).

Common emitters: cargo, ninja, modern build tools, `pv`, custom
scripts.

The user's broader ask is: catalog the OSC sequences we want to
support, and accept them properly so τ-mux's UI mirrors progress.

## OSC inventory we likely already pass through xterm.js

| OSC | Meaning                          | xterm.js handling   |
| --- | -------------------------------- | ------------------- |
| 0   | Window/icon title                | parsed              |
| 2   | Window title                     | parsed              |
| 4   | Set palette                      | parsed              |
| 7   | Working directory                | parsed (if config)  |
| 8   | Hyperlink                        | parsed (link addon) |
| 11  | Default background               | parsed              |
| 52  | Set / get clipboard              | gated               |
| 133 | Shell integration semantic marks | parsed              |
| 633 | VS Code shell integration marks  | sometimes parsed    |
| 1337| iTerm2 escape (incl. images)     | parsed via addon    |

We want to add **9;4** explicitly and surface a documented list.

## Implementation

xterm.js lets us register a custom OSC handler:

```ts
term.parser.registerOscHandler(9, (data) => {
  // data is the OSC payload (everything between "9;" and ST)
  const parts = data.split(";");
  if (parts[0] !== "4") return false;
  const state = parseInt(parts[1] ?? "0", 10);
  const value = parseInt(parts[2] ?? "0", 10);
  emitProgressEvent(surfaceId, state, value);
  return true;  // we handled it
});
```

The handler bridges into a shared `ProgressBus` that:

1. Updates a status pill on the pane chip bar (small inline progress
   gauge).
2. Updates the sidebar workspace card's progress slot (already
   exists per `sidebar.set_progress`).
3. Mirrors to the web mirror via `progressUpdate` socket-action.
4. (Optional) Sets the macOS dock-icon progress via Electrobun's
   `app.setBadge` if we wire it in.

### Where to install the OSC handler

- Per-xterm instance, in `surface-manager.ts` where each `Terminal` is
  constructed.
- The handler emits an event, not a direct DOM mutation, so it's
  testable without a DOM.

## Settings / UX

- `terminal.osc94.enabled`: default `true`. Disable for users who
  emit OSC 9;4 but don't want the UI to react.
- Pane chip is the primary visual; size of the bar fades when state=0
  or when the value was last updated >30 s ago (stale).

## Files

- `src/views/terminal/surface-manager.ts` — install handler per
  terminal.
- new `src/views/terminal/progress-bus.ts` — small event bus.
- `src/views/terminal/index.ts` — sidebar progress integration.
- `src/web-client/protocol-dispatcher.ts` — handle `progressUpdate`
  from server.
- `src/bun/web/server.ts` — broadcast.
- `doc/system-osc-sequences.md` (new) — list of supported OSCs.

## Tests

- `tests/osc-94.test.ts` — feed `\x1b]9;4;1;42\x1b\\` through the
  parser; assert event with `{state:1,value:42}`.
- `tests/osc-94-state0.test.ts` — `\x1b]9;4;0\x1b\\` clears progress.
- `tests/progress-bus.test.ts` — multiple surfaces emit independently.

## Risks / open questions

- Spurious progress updates from random pipes; mitigation: ignore
  values outside 0..100; debounce updates to ≤10 Hz per surface.
- Conflicting protocols (some shells emit OSC 9 for notifications;
  9;4 is a sub-format). Make sure our handler only takes over when
  payload starts with `4;`, leaves others to default xterm.

## Effort

M — handler install + bus + UI integration + tests. ~1 day.
