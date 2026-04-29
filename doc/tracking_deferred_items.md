# Tracking — Deferred Items execution

**Plan:** `doc/deferred_items.md`
**Started:** 2026-04-28
**Hand-off version:** 0.2.50

## User-imposed constraint

- **E.4 is SKIPPED.** User explicitly asked to keep web HTTP and WebSocket binding to `0.0.0.0`. Do not flip the `webMirrorBind` default. The findings in E.4 are not actioned.

## Execution log

| PR # | Cluster / item | Status | Commit | Notes |
|------|----------------|--------|--------|-------|
| 1 | Cluster A — N8, N9, N10, N11, N12, N13, N16, N17, M4 | landed | d0c7391 | bumped 0.2.50 → 0.2.51. All 1501 tests pass; typecheck clean. |
| 2 | A.1 — M5 `ht browser help` subcommand | landed | 427d35d | bumped 0.2.51 → 0.2.52. Extracted shared `BROWSER_HELP` constant; added `case "help"` + `--help`/`-h` flag short-circuit; 1503 tests pass. **Deviation:** had to hoist `BROWSER_HELP` to top of file (TDZ — main runs printHelp before later top-level statements). |
| 3 | A.2 — Separate dev configDir | landed | 0c30128 | bumped 0.2.52 → 0.2.53. Set `HT_CONFIG_DIR=$HOME/Library/Application Support/hyperterm-canvas-dev` on `start`, `dev`, `build:dev`. `build:canary` / `build:stable` untouched. Manual verification deferred (would require launching the app — tests cover the consumer side). |
| 4 | Cluster B — I11, I12, N15 | landed | 2bfe21c | bumped 0.2.53 → 0.2.54. New `lifecycleDisposers` registry; `PlanPanel.destroy()` + `NotificationOverlay.destroy()` + askUserModalHandle wired in. 1509 tests pass; new tests/plan-panel-dom.test.ts + 3 new destroy tests in tests/notification-overlay.test.ts. **Deviation:** registry is per-call-site append (per the plan's recommendation), not a per-component injected disposer service. |
| 5 | C.1, C.2 — I14 + N14 | landed | da2c479 | bumped 0.2.54 → 0.2.55. Settings theme picker applies preset partial locally before re-render; palette descriptions clarified for split/new-workspace commands. New tests/settings-panel-theme.test.ts asserts active-class swap on click. 1510 tests pass. |
| 7 | C.3, C.4 — N18 + I9 | landed | ae8f164 | bumped 0.2.56 → 0.2.57. plan-panel-mirror gained `receivedInitialSnapshot` guard + empty-state; settings-panel adds a "Restore previous bloom" button gated on `bloomIntensity===0 && bloomMigratedToTau`. New tests/plan-panel-mirror.test.ts and three new tests in tests/settings-panel-theme.test.ts. 1518 tests pass. |
| 11 | E.2 — M11 document pi-agent stream divergence | landed | 7f459f1 | Docs-only — no version bump. New § 9 in `doc/system-pty-session.md` and a one-liner in CLAUDE.md explain why pi-agent-manager uses stdin/stdout rather than the fd 3/4/5 sideband. |
| 10 | D.4 — N7 auth token URL scrub | landed | b24c024 | bumped 0.2.58 → 0.2.59. Token captured into module scope at construction; `history.replaceState` strips `?t=` from `window.location` only AFTER the first successful WebSocket open (so 401s leave the URL debuggable). Reconnects use the captured value. New tests/web-client-transport-token.test.ts (1 test, 7 assertions). 1524 tests pass. **Caveat:** the `replaceState` itself is verified via spy; the actual URL-bar update can't be observed in happy-dom and would need a real browser to confirm. |
| 8 | E.1 — M10 surface RPC startup-race + wait_ready | landed | 6e0b45d | bumped 0.2.57 → 0.2.58. New `waitForSurfaceMetadata` helper polls the cache (100 ms steps, 2 s default budget) before failing with a clearer error. `surface.kill_port` and `surface.open_port` use it; new `surface.wait_ready` method + `ht wait-ready` CLI; schema entry added. New tests/rpc-handler-surface-wait-ready.test.ts (5 tests). 1523 tests pass. **Deviation:** chose polling instead of an event-bus refactor of `SurfaceMetadataPoller.onMetadata` (which is a single-fn slot). Polling is wasteful in theory but simpler and self-contained; metadata poller still ticks at 1 Hz so the wait window almost always closes on the first poll. |
| 6 | D.1, D.2 — N3 + N4 | landed | efaa981 | bumped 0.2.55 → 0.2.56. panel-interaction.ts migrated to Pointer Events + setPointerCapture; pendingPanelData now FIFO (cap 16, warn-once on overflow). Existing drag/resize tests rewritten to dispatch PointerEvent on the handle; new pointercancel test added. 1511 tests pass. **Deviation:** D.2 unit test for the FIFO behavior was skipped — the queue logic lives inside the main() IIFE in src/web-client/main.ts and extracting it would balloon scope. Manual sanity preserved via the existing transport tests. |
| 9 | D.3 — N5 SW update flow with banner | landed | a82ee6b | bumped 0.2.59 → 0.2.60. SW no longer auto-skipWaiting on a follow-up install — only on first install when there are no live clients. New `update-banner.ts` module + wiring in `pwa.ts` watches `reg.waiting` / `reg.installing.statechange` / `reg.onupdatefound` and posts `{type:"SKIP_WAITING"}` on the user's Reload click. `controllerchange` listener reloads the page once the new SW takes over. Old caches are dropped in `activate` (i.e. post-user-approval). New tests/web-client-update-banner.test.ts (7 tests) covers banner DOM + click handlers. 1531 tests pass. **Deviation from plan:** the plan suggested a `tau-mux-update-available` CustomEvent piggy-backing on "existing toast machinery" — which doesn't exist. We built the banner as its own self-contained module instead, with inline CSS (so it survives if `client.css` fails to load — exactly the failure mode the SW update flow has to be robust against). **Manual verification recipe:** see "Manual D.3 test recipe" below. |

## Deviations from plan

(track here)

## Issues encountered

(track here)

## Manual D.3 test recipe

Service workers can't be exercised in happy-dom — the unit tests cover
the banner DOM and click handlers, but the lifecycle plumbing
(install/waiting/activate/controllerchange) needs a real browser. To
verify D.3 end-to-end:

1. **Build a baseline bundle.** `bun run build:web-client` writes the
   current bundle hash into `assets/web-client/sw.js` (it interpolates
   `__BUILD_VERSION__`). Note the hash that lands in `CACHE_NAME`.
2. **Start the web mirror.** With τ-mux running, ensure
   `Settings → Network → Auto-start Web Mirror` is on (or run
   `bun start`). Visit `http://localhost:<port>/` in Chrome; open
   DevTools → Application → Service Workers; confirm the SW is
   `activated and is running`.
3. **Force a "deploy".** Touch any source file under `src/web-client/`,
   then re-run `bun run build:web-client`. The bundle hash in `sw.js`
   changes.
4. **Reload the page once.** The browser detects the new SW, installs
   it, and parks it in `waiting` because a controller still exists.
   The mirror should render the banner: "A new version is available."
   with **Reload** and **Later** buttons. In Application → Service
   Workers you'll see the new worker labelled "waiting to activate".
5. **Click Reload.** The banner stays visible for ~one tick, then the
   page reloads automatically. After the reload, only the new SW is
   listed (the old one becomes redundant). The Application → Cache
   Storage panel should show only the new `tau-mux-mirror-<hash>`
   bucket — the previous one was deleted in the new SW's `activate`.
6. **Click Later instead.** Re-run from step 3, but click Later. The
   banner disappears; the running tab keeps using the old bundle.
   Reloading the tab manually then picks up the new bundle (the SW
   eventually claims via the `updatefound` retry path).
7. **Repeat in Safari.** Safari handles SW lifecycle slightly
   differently — particularly the `controllerchange` event timing.
   Confirm the same flow at least once on macOS Safari (Develop →
   Service Workers).
8. **Spot-check fallbacks.**
   - Open in a private window or on an http LAN IP: registration is
     skipped (`reason: "insecure-context"`); no banner ever appears.
   - Disable JS for sw.js in the network panel: the page degrades
     gracefully — the banner module is wired only when the SW
     registration succeeds.

If steps 4–6 work in both Chrome and Safari and step 5 leaves only the
new cache bucket, D.3 is healthy.

## Items deliberately skipped

- **E.4** — `webMirrorBind` default flip. Skipped per user instruction.
- **E.5** — IME composition (xterm.js internals). Requires Playwright + non-Latin input keyboard layouts; not practical in this pass. Tracking issue territory.
- **E.6** — `audit.fix` ergonomics. Plan says "hold for now" until Plan #11 consumer surface stabilizes.
- ~~**D.3** — service-worker update flow with toast.~~ **Landed in a follow-up pass.** See PR #9 below.
