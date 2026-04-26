# Plan 13 — Web mirror parity with bridge view + mobile/touch UI

## Source quote

> # http mirror ui
> Let's make it on par with only bridge view.
> Can go fullscreen and resize
> but add mobile/touch UI/UX

## Current state

`src/web-client/` is the web mirror that connects to `src/bun/web/`
over WebSocket. It mirrors workspace state, panel content, and
sideband panels for read-only consumption from a phone / second
screen. Today it has rougher UX than the native (Electrobun) view —
"only bridge view" in the user's note appears to refer to the
in-app bridge view (when the mirror is opened in the native window
or a sibling browser).

## Targets

### A. Visual parity with native (no missing affordances)

Inventory of native features and their mirror status (TBD — needs
walk-through):

| Feature                          | Native | Web mirror today | Action                |
| -------------------------------- | ------ | ---------------- | --------------------- |
| Workspace switcher + sidebar     | ✓      | ?                | match                 |
| Pane bar chips (cwd / fg / ports)| ✓      | partial          | port over             |
| Sideband HTML / SVG / canvas     | ✓      | ✓                | verify all renderers  |
| Sideband interactive events      | ✓      | partial          | port event passthrough|
| Floating panels w/ drag/resize   | ✓      | ✓                | feature parity        |
| Process Manager overlay (⌘⌥P)    | ✓      | absent           | add                   |
| Settings panel                   | ✓      | absent           | add (read-only first) |
| Notification overlay (Plan #03)  | new    | new              | parity from day 1     |
| Plan panel (Plan #09)            | new    | new              | parity from day 1     |
| Telegram pane                    | ✓      | ?                | port                  |

Step 1 of the plan: do this audit explicitly, paste into this doc,
green/red each row.

### B. Fullscreen + resize

The mirror should support:

- Browser full-screen (F11 / fullscreen API). Add a button + keyboard
  shortcut.
- Per-pane fullscreen (double-click the pane bar) — same UX as native.
- Window resize: layout reflows fluidly. Today there might be jank
  on resize (verify). Throttle layout calls; use the existing
  `applyLayout` pure function from `src/web-client/layout.ts`.

### C. Mobile / touch

This is the bulk of the work:

#### Layout breakpoints

- `< 720 px` → stack: single workspace card + active pane only.
- `720..1024 px` → tablet: collapsible sidebar + active pane.
- `≥ 1024 px` → current desktop layout.

CSS uses `clamp()` and `@media` queries. Add mobile-friendly
typography (16 px min on inputs to avoid iOS auto-zoom).

#### Touch gestures

Primary gestures:

| Gesture                  | Action                                        |
| ------------------------ | --------------------------------------------- |
| Tap pane                 | Focus pane                                    |
| Long-press pane bar      | Open context menu (close, duplicate, …)       |
| Swipe left/right on body | Switch workspace                              |
| Pinch on terminal        | Zoom terminal (font-size in steps)            |
| Two-finger drag in pane  | Scroll terminal scrollback                    |
| Edge-swipe right         | Open sidebar drawer                           |
| Edge-swipe left          | Close sidebar drawer                          |

Routing in `panel-interaction.ts`: extend the gesture router to
recognise touch-pointer types separately from mouse, with hysteresis
on swipe vs tap.

#### Software keyboard

The terminal needs to accept keyboard input on mobile. iOS / Android
need an off-screen `<input>` to summon the keyboard. xterm.js has
`open` mobile support already; verify and tune. Provide:

- A floating "keyboard" button that focuses the off-screen input
  (same trick as Termux web).
- A toolbar above the keyboard with: `Esc`, `Tab`, `Ctrl`, `↑↓←→`,
  `|`, `~`, `/`, `:`. Sticky `Ctrl` state.

#### Notifications on mobile

Use Web Notifications API (already?) and Vibration API for tactile
cues on critical events. Gate behind a permission prompt.

## Implementation phases

### Phase 1 — audit + parity tracker

Walk through every native feature, populate the table above, file
follow-up sub-plans.

### Phase 2 — Process Manager + Settings (read-only)

Two clearly-missing panels. Build them.

### Phase 3 — Mobile breakpoints + gestures

Significant CSS work. Use the design report
(`bun run report:design:web`) to verify the three layouts.

### Phase 4 — Software keyboard + toolbar

Tricky on iOS (Safari). Acceptance: typing into the terminal feels
"OK" (not great) on a phone.

### Phase 5 — Polishing

- Pull-to-refresh: re-subscribe websocket.
- "Add to Home Screen" PWA manifest: `manifest.json`,
  `service-worker.ts` (offline shell).

## Files

- `src/web-client/main.ts` — mount layout breakpoints.
- `src/web-client/sidebar.ts` — drawer behaviour for mobile.
- `src/web-client/layout.ts` — responsive `computeRects`.
- `src/web-client/panel-interaction.ts` — touch gesture router.
- `src/web-client/panel-renderers.ts` — verify each renderer works on
  touch (e.g. canvas2d shouldn't pan with the page).
- `src/web-client/client.css` — breakpoints + soft-keyboard toolbar.
- new `src/web-client/keyboard-toolbar.ts`.
- new `src/web-client/process-manager.ts` (mirror).
- new `src/web-client/settings-panel.ts` (mirror, read-only).
- new `src/web-client/manifest.json` + `sw.ts` for PWA.
- `src/bun/web/server.ts` — serve manifest + sw.

## Tests

- `tests/web-mirror-layout.test.ts` — `computeRects` at 360 / 768 /
  1280 viewports.
- `tests/web-mirror-gestures.test.ts` — swipe → next workspace.
- `tests-e2e/` — Playwright spec covering mobile viewport + a couple
  of canonical interactions (swap workspace, open sidebar, open
  terminal).

## Risks / open questions

- Touch + xterm.js on iOS Safari is historically painful. Acceptance
  bar: read-only works perfectly; typing is "best-effort".
- PWA service worker can cache stale assets. Use a build-hash-based
  cache key.
- Effort balloon if we try to ship every feature. Cut hard at Phase 3
  for v1; Phase 4–5 are stretch.

## Effort

L — Phase 1–3 ~1 week; Phase 4–5 stretch +1 week.
