# Tracking — Plan 03: notification overlay + Claude hook noise

**Plan**: [`plan_notifications.md`](plan_notifications.md) (Sections A + C)
**Status**: sections A + C done; section B deferred
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Section A (notification overlay anchored over the originating
terminal) and Section C (suppress Claude Code's "waiting for input"
notification spam from the ht-bridge integration). Section B
(auto-accept Claude permission prompts) is risky without live
Claude Code testing and stays deferred.

User asked to "make it good" — investing in proper polish: slide-in
animation, hover-pause, click-to-focus, stack overflow with "+N
more", auto-dismiss with explicit timeout knob.

## Step-by-step progress

- [x] `src/views/terminal/notification-overlay.ts` — pure
      `composeStack` helper + `OverlayCardController` (animation,
      auto-dismiss, hover-pause-resume, decorative meter) +
      per-surface `OverlayStack` + top-level `NotificationOverlay`
      manager
- [x] CSS for `.tau-notif-overlay-*`: 220ms slide+fade entrance
      via `tau-notif-overlay-in`, decorative drain meter via
      `tau-notif-overlay-meter-drain`, `prefers-reduced-motion`
      respected, `pointer-events: none` on the empty stack so
      terminal clicks pass through
- [x] AppSettings: `notificationOverlayEnabled` (default true) +
      `notificationOverlayMs` (default 6000, clamped 0–60000ms);
      validation + defaults; toggling enabled to false dismisses
      every live overlay immediately
- [x] SurfaceManager.`getSurfaceContainer(id)` accessor — null
      when surface no longer mounted
- [x] socket-actions `notification` handler:
      `latest` → `notificationOverlay.show(container, …)`,
      `dismissed` → `dismiss(surfaceId, id)`,
      `notifications:[]` → `dismissAll()`
- [x] Click-to-focus: card body click fires `ht-focus-surface`
      event + dismisses through `dismissNotification` RPC; the
      window listener focuses the surface and pings bun
- [x] Click-to-dismiss: close-button click (or auto-dismiss) goes
      through `dismissNotification` so sidebar + glow stay in sync
- [x] Settings panel: "Notification Overlay" toggle + auto-dismiss
      slider (0 = off / manual; up to 30s) under General
- [x] Tests: 23 cases — `composeStack` (empty / under / at / over
      cap / default cap), DOM behaviour (show / disabled /
      dedupe / overflow pill / dismiss removes-and-restacks /
      close-fires-dismiss / body-fires-activate / overflow-pill
      click / disabled-tears-down / dismissAll / forgetSurface),
      timing (auto-dismiss fires / autoDismissMs=0 keeps card)
- [x] Section C — `claude-integration/ht-bridge` gained a
      `notifyOnIdle` config flag (default **false**). The idle
      "Claude Code · waiting" notification is suppressed by
      default; the sidebar status pill still updates so users
      keep the visual cue. Env override
      `HT_CLAUDE_NOTIFY_ON_IDLE=1` re-enables.
- [x] `bun run typecheck` clean
- [x] `bun test` — 1016/1016 (was 998; +18 overlay tests)
- [x] `bun run bump:patch` — 0.2.8 → 0.2.9
- [x] Commit — `f6ae82c`

## Deferred

- **Section B — auto-accept Claude permission prompts**. The
  prompt-kind taxonomy needs real-Claude verification + a security
  review of the safe-list. Logged for a follow-up.
- **Telegram forwarding from overlay clicks** — overlay already
  dispatches the same `notification.dismiss` the sidebar uses, so
  any future Telegram reply hooks land for free.

## Deviations from the plan

1. **Settings live under General**, not under a new Notifications
   section. The two existing notification fields
   (`notificationSoundEnabled` / `notificationSoundVolume`) already
   live in General; co-locating the overlay settings keeps every
   notification-related toggle in one place.
2. **Click-to-focus is auto-dismiss-and-focus**, not just focus +
   mark-as-read. Plan said "click body → mark as read, focus
   surface"; in practice the card is in the way of the terminal
   it sits over, so dismissing is what the user actually wants.
   The notification stays in the sidebar list (not deleted, just
   marked dismissed) so any unread state continues to glow until
   the user acknowledges it via the sidebar.
3. **Overflow pill is a flat-corner chip**, not pill-shaped.
   `border-radius: 999px` would have violated §11
   "no radius > 12 px". Using 4 px to match the close button.
4. **Hover-pause persists progress meter visually** by
   pausing the CSS animation rather than resetting it. When the
   user mouseleaves, the timer restarts from where it stopped and
   the meter resumes its animation. Plan said "hover pauses the
   timer" but didn't spec the visual; this matches macOS Notification
   Center semantics.
5. **No emoji in copy.** First test run failed `audit-emoji` for
   `✕` characters in user-facing notes + comments. Replaced
   with "close button" wording. The actual close icon is rendered
   via the existing SVG icon (`createIcon("close")`).
6. **Two new keyframes registered as STATE_EXCEPTIONS**, not
   CANONICAL — they map to a state signal (notification arrival /
   countdown to dismiss) rather than a guideline-cited canonical
   motion.

## Issues encountered

1. **Three design audits fired** on the first full-suite run:
   `audit-emoji` (✕ in copy + comments), `audit-animations` (two
   unlisted keyframes), `audit-guideline-do-donts` (`border-radius:
   999px` on the overflow pill). Each was cheap to fix. Lesson
   carried over from Plan #02 + #08: run the design audits as
   part of every pre-commit check on UI work.
2. **Initial multi-line edit dropped a leading space** in the JSDoc
   block, leaving `". * "` instead of ` * `. Caught visually before
   commit; one-character fix. Lesson: when overwriting JSDoc
   blocks, double-check the leading whitespace.

## Open questions

- Plan put settings under "General" / "Notifications"; the existing
  panel has no "Notifications" section. Going with adding the two
  toggles to the existing General section since
  `notificationSoundEnabled` / `notificationSoundVolume` already
  live there.

## Verification log

| Run                                              | Result                              |
| ------------------------------------------------ | ----------------------------------- |
| `bun run typecheck`                              | clean (after every edit)            |
| `bun test tests/notification-overlay.test.ts`    | 18/18 pass                          |
| `bun scripts/audit-emoji.ts`                     | clean (post-fix)                    |
| `bun scripts/audit-animations.ts`                | clean (post-registration)           |
| `bun scripts/audit-guideline-do-donts.ts`        | 11/11 pass (post-radius-fix)        |
| `bun test` (full)                                | 1016/1016 pass, 107615 expect() calls |
| `bun run bump:patch`                             | 0.2.8 → 0.2.9                       |

## Commits

- `f6ae82c` — notifications: terminal-anchored overlay cards + suppress Claude idle toast
  - 14 files changed, 1132 insertions(+), 8 deletions(-)

## Retrospective

What worked:
- Splitting `composeStack` out as a pure function gave me 5 trivial
  tests covering the load-bearing ordering / overflow logic without
  any DOM. The DOM tests are then thin shells over its results.
- Per-surface `OverlayStack` rooted inside the surface container
  means existing layout / drag / resize logic moves overlays for
  free — no extra repositioning code, no resize observers.
- Pause-and-resume of the auto-dismiss timer + the meter animation
  reads naturally on hover without any setTimeout-arithmetic
  surprises. Storing the deadline + recomputing remaining ms on
  pause is more robust than tracking elapsed.
- The dismiss path routing through the existing
  `dismissNotification` RPC means a tap on the overlay is
  indistinguishable from a tap on the sidebar — single source of
  truth for "this notification is read".

What I'd do differently:
- Three audits caught me in a row (emoji / animations / radius).
  Worth wiring `bun scripts/audit-*.ts` into a single
  `bun run audits` package script and running it before
  `bun test` on UI work. Cheap follow-up.
- I considered adding a small "auto-test" mode to the overlay where
  fast test code can advance the auto-dismiss without waiting on
  real timers. Skipped — the actual `Bun.sleep(80)` is fast enough,
  and synthesising the timeout would risk drift between fixture
  and production behaviour.

Carried over to follow-ups:
- Section B — auto-accept Claude permission prompts (needs Claude
  hook payload taxonomy + security-review of safe prompt-kind list)
- Per-pane chip showing "+N pending" while the sidebar is closed
- Telegram routing for overlay actions (the existing Plan #08
  callback path already covers OK / Continue / Stop on
  forwarded notifications; could surface overlays for
  Telegram-originated actions too)
