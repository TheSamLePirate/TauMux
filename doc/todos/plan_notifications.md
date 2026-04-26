# Plan 03 — Notifications: in-terminal overlay, auto-accept Claude prompts, hook noise removal

## Source quotes (`doc/issues_now.md`)

> # Notification:
> - Also show the notification content as an overlay on top of the
>   terminal that send that notification
> - Auto accept when claude code request permission (Enter on the
>   terminal)
> - Remove "Claude Code waiting for your input" (from claude hooks)

Three independent items grouped because they all touch the
notification path.

---

## A. Notification overlay over the originating terminal

### Current state

Notifications today land in the sidebar (`src/views/terminal/sidebar.ts`,
the "Notifications" group) and optionally fire macOS-native banners
(`AppSettings.nativeNotifications`). They include `surface_id` in the
RPC payload, but the surface is not visually called out.

### Proposed behaviour

When a notification arrives with a `surface_id`, render a transient
overlay anchored over that surface's container:

- Floats at the top-right inside the surface's bounds (not the whole
  window — so split panes get independent overlays).
- Card with title (16 px) + body (14 px) + a single dismiss "×".
- Auto-dismiss after `notificationOverlayMs` (default 6 s); pauses on
  hover; click to keep open.
- Click body → mark notification as read, focus surface.
- Stack max 3 overlays per surface; older entries collapse into a
  "+N more" pill that opens the sidebar on click.

### Implementation sketch

- New file `src/views/terminal/notification-overlay.ts` — owns a
  `Map<surfaceId, OverlayController>`. Public API:
  `showOverlay(surfaceId, payload)`, `dismissOverlay(id)`,
  `relayoutAll()`.
- DOM: appended to the surface container div (already exists per
  surface) so existing layout / drag / resize logic moves the overlay
  with the surface — no extra repositioning code.
- Z-index above terminal canvas, below sideband panels (sideband panels
  remain authoritative for in-pane content per Plan #04).
- Wiring: `socket-actions.ts` already dispatches `notificationCreated`
  to `surfaceManager`. Add a hook there: if `payload.surface_id` is
  present, also call `notificationOverlay.showOverlay(...)`.
- Settings: new `notificationOverlayEnabled` (default true) +
  `notificationOverlayMs` (default 6000). Plumb through
  `AppSettings`.

### Files

- new `src/views/terminal/notification-overlay.ts`
- `src/views/terminal/socket-actions.ts` — call into overlay
- `src/views/terminal/index.ts` — instantiate overlay manager
- `src/views/terminal/index.css` — `.notif-overlay` styles
- `src/shared/settings.ts` — two new fields
- `src/views/terminal/settings-panel.ts` — toggle + duration input

### Tests

- `tests/notification-overlay.test.ts` — render → assert overlay div
  attached to right surface; advance fake clock to assert auto-dismiss;
  hover pauses dismiss.

---

## B. Auto-accept Claude permission prompts

### Current state

Claude Code prints a permission prompt asking the user to press
`Enter` (e.g. *"Allow Claude to write to file X? (y/N)"*). With Plan
#03 in mind, the user wants τ-mux to auto-press Enter on these prompts.

### Risk and scope

This is an **opt-in behaviour with safety implications**: an
auto-accept blindly approves any prompt, which can accept destructive
permissions. So:

1. Default: **off**.
2. Setting: `claudeAutoAcceptPrompts: "off" | "safe" | "all"` in
   `AppSettings`. `safe` only auto-presses Enter for
   read-only/diff-show prompts (whitelist of `prompt_kind`s);
   `all` accepts every Claude prompt.
3. Settings UI shows a clear "this will press Enter for you on every
   Claude prompt — destructive operations like file writes / shell
   commands will be auto-approved" warning under "all".

### Source-of-truth

Claude Code emits `Notification` events to its hooks. The
`claude-integration/ht-bridge/` extension already handles these. We
extend the existing notification hook to:

1. Detect a permission prompt — Claude tags these with a specific
   `prompt_kind` field. (TODO: confirm exact wire format from
   https://docs.anthropic.com/claude-code/hooks.)
2. If user setting is `all`, or `safe` and `prompt_kind` is in the
   safe list, run `ht send-key enter --surface $HT_SURFACE_ID`.

### Implementation sketch

- `claude-integration/ht-bridge/index.mjs` (or wherever the
  Notification hook lives) — read `HT_CLAUDE_AUTOACCEPT` env var (set
  by `applySettings` via shell startup snippet) and act accordingly.
- App-side: `SettingsManager` writes the env var into a managed
  `~/.config/tau-mux/claude-env.sh` that the integration sources.
- Audit log: every auto-accept logs a `sidebar.log` entry with `level: "warn"`, `source: "claude-autoaccept"` so the user can see what
  was approved.

### Files

- `claude-integration/ht-bridge/` — new hook handler
- `claude-integration/install.sh` — env-source line
- `src/shared/settings.ts` — `claudeAutoAcceptPrompts`
- `src/views/terminal/settings-panel.ts` — radio + warning
- new `doc/system-claude-integration.md` (or extend existing) —
  document the safety contract

### Tests

- `tests/claude-autoaccept.test.ts` — synthetic Notification payload →
  asserts the right `ht send-key` call (mocked exec).

### Open questions

- Exact `prompt_kind` taxonomy from Claude Code. Need to capture a few
  real examples and codify the safe-list.
- Should we also emit a sidebar toast each time we auto-accepted? Yes,
  for `all` mode (so the user sees what's happening).

---

## C. Remove "Claude Code waiting for your input" hook

### Current state

The Claude Notification hook surfaces a generic "Claude Code waiting
for your input" toast on every paused turn. The user finds this
noisy.

### Fix

In the Notification hook, filter out the `notification_kind === "idle"`
(or whichever wire value matches) — early-return without calling
`ht notify`. Add a setting `claudeNotifyOnIdle: boolean` (default
**false**). Users who want it back can flip it.

### Files

- `claude-integration/ht-bridge/` notification handler.
- `src/shared/settings.ts`, `settings-panel.ts` — new toggle.
- README in `claude-integration/`.

---

## Effort

M — overlay is the most work (~1 day with tests + CSS); auto-accept is
mostly settings plumbing once the prompt taxonomy is captured (~half
day); idle-suppression is a one-liner (~1 hour). Total ~2 days.

## Risks

- Auto-accept "all" mode is a foot-gun. Make the warning explicit. Log
  every auto-accepted prompt visibly. Consider rate limiting.
- Overlay z-index interactions with sideband panels and process-manager
  overlay (⌘⌥P). Pick `--z-overlay-notification` between them.
