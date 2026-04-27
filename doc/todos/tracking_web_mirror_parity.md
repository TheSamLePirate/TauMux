# Tracking — Plan 13: Web mirror parity + mobile/touch UX (Commit A)

**Plan**: [`plan_web_mirror_parity.md`](plan_web_mirror_parity.md)
**Status**: done — Commit A ships every headless-doable Phase 2/3/4/5 deliverable; agent-panel mirror deferred (matches plan §A "Plan panel — parity from day 1" caveat in plan #09)
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

The plan called out five phases. Commit A ships all of Phase 2 (Process
Manager + Settings panel mirrors), Phase 3 (mobile breakpoints +
gesture router), Phase 4 (soft-keyboard toolbar), Phase 5 (PWA
manifest + service worker + pull-to-refresh + Web Notifications +
vibration). Phase 1 (audit) was performed via an Explore agent up
front and informed every other deliverable — its findings are
preserved in this tracking file's "Audit" section.

Deferred:
- **Plan panel mirror (agent-panel)**. The native agent panel is
  ~6 modules and ~3 kLOC; mirroring it requires snapshot envelopes
  for agent state that don't exist yet. The plan acknowledges this
  ("Plan panel — parity from day 1") but tying it into plan #13
  would inflate this commit beyond reason. Filing as a follow-up
  under plan #09 once that lands.
- **Per-pane fullscreen via double-click**. The button-driven path
  already works on touch — `tap pane bar fullscreen btn` is the
  same gesture as a double-tap on a phone. The user's existing
  `fullscreen-active` class + `applyFullscreen` flow needed no
  changes.

## Audit (Phase 1)

Pre-implementation walkthrough of the web mirror at HEAD. Status
columns updated post-commit so this file is the canonical record.

| Feature                          | Native | Mirror (pre) | Mirror (post-A) |
| -------------------------------- | ------ | ------------ | --------------- |
| Workspace switcher + sidebar     | ✓      | ✓            | ✓ (drawer mode on phone) |
| Pane bar chips (cwd / fg / ports)| ✓      | ✓            | ✓ (touch targets sized up) |
| Sideband HTML / SVG / canvas / image | ✓ | ✓            | ✓ (untouched) |
| Sideband interactive events      | ✓      | ✓            | ✓ (untouched) |
| Floating panels w/ drag/resize   | ✓      | ✓            | ✓ (untouched) |
| Process Manager overlay (⌘⌥P)    | ✓      | absent       | ✓ (read-only mirror) |
| Settings panel                   | ✓      | absent       | ✓ (read-only + mirror-local prefs) |
| Notification overlay             | ✓      | ✓ (sidebar)  | ✓ + Web Notifications + vibration |
| Plan panel (agent-panel)         | ✓      | absent       | deferred (see scope) |
| Telegram pane                    | ✓      | ✓            | ✓ (untouched) |
| Browser fullscreen               | ✓      | ✓            | ✓ + iOS standalone meta |
| Mobile / phone layout            | n/a    | one media query (768 px height tweak) | ✓ three-tier (≤720, 720-1024, ≥1024) |
| Touch swipe to switch workspace  | n/a    | absent       | ✓ |
| Touch edge-swipe to open drawer  | n/a    | absent       | ✓ |
| Pinch-zoom terminal font         | n/a    | absent       | ✓ |
| Soft-keyboard toolbar            | n/a    | absent       | ✓ (Esc / Tab / Ctrl / arrows / | ~ / : ` ' " / Hm / End / PgUp / PgDn) |
| PWA manifest + service worker    | n/a    | absent       | ✓ (cache-busted shell) |
| Add-to-Home-Screen (iOS)         | n/a    | absent       | ✓ (apple-touch-icon + status-bar meta) |
| Pull-to-refresh                  | n/a    | absent       | ✓ (transport reconnect + SW update) |

## Step-by-step progress

### Phase 2 — Process Manager + Settings (read-only)

- [x] `src/web-client/process-aggregator.ts` — pure aggregator over
      `state.surfaces`. Sort by CPU desc, ties on pid asc; tracks
      `isShell` / `isForeground` flags; `totalsForRows`,
      `filterRows` (case-insensitive command + title + pid),
      `formatRss` (KB / MB / GB), `formatCpu` (drop trailing zero,
      NaN-safe).
- [x] `src/web-client/process-manager.ts` — overlay UI, Esc-closeable,
      backdrop-click closes, click row = `focus/set` dispatch +
      `focusSurface` send (no kill — read-only).
- [x] `src/web-client/settings-panel.ts` — overlay UI with three
      sections (Audio & alerts / Touch & mobile / About). Uses
      mirror-local localStorage prefs (sound, web-notif opt-in,
      vibration opt-in, pinch zoom, soft-keyboard default). The
      "About" section surfaces the connection summary from
      `summarizeConnection(state, hasAuthToken)` (pure helper).
- [x] Both overlays add `.active` class to their toolbar buttons
      and re-render on every store change while open.

### Phase 3 — Mobile breakpoints + touch gestures

- [x] `src/web-client/touch-gestures.ts` — pure decision helpers
      (`resolveSwipeIntent`, `resolveEdgeIntent`, `resolvePinchStep`,
      `applyPinchStep`, `pickWorkspaceStep`) + `attachTouchGestures`
      DOM wiring. Float-drift bug on `1/1.12` rounding caught by
      tests + fixed with epsilon bias.
- [x] `src/web-client/client.css` — three breakpoints
      (`max-width: 720`, `max-width: 1024`, `min-width: 1025`).
      Sidebar becomes an overlay drawer below 1024 px (no pane-
      pushing); below 720 px the workspace select / pane buttons /
      sidebar rows scale up to 40+ px touch targets with iOS auto-
      zoom guards (16 px form-control font sizes).
- [x] `#sidebar-scrim` element added to the page shell + clickable
      to close the drawer; CSS-hidden on desktop.
- [x] Pinch-zoom routes through `xterm.options.fontSize = next`,
      clamped to [10, 22], gated by mirror-local pref.

### Phase 4 — Soft-keyboard toolbar

- [x] `src/web-client/keyboard-toolbar.ts` — pure `encodeKey()`
      generates xterm-compatible byte sequences for arrows
      (`\x1b[A` etc., plus `\x1b[1;5A` under Ctrl), Esc, Tab,
      `Hm/End/PgUp/PgDn`, and the punctuation row (`|~/\:` plus
      backtick + quotes). `encodeCtrlLetter()` maps `a..z` to
      `\x01..\x1a`. Sticky Ctrl latch auto-clears after one press.
- [x] DOM toolbar with 19 keys, mounts above the on-screen keyboard
      via `position: fixed bottom: env(safe-area-inset-bottom)`.
      `pointerdown` listener prevents default to keep xterm focus.
- [x] Toggle from toolbar button (`#kbd-toggle-btn`); CSS hides the
      button on `pointer: fine` (desktop). Default-on can be set in
      Settings.

### Phase 5 — PWA shell

- [x] `src/web-client/manifest.json` — `display: standalone`,
      Catppuccin theme + bg colours, single SVG icon (purpose
      "any maskable"), name + short_name in the τ-mux idiom.
- [x] `src/web-client/icon.svg` — 512×512 monogram (bg #181825,
      "τ" glyph, accent dot). Reused for `link rel=icon`,
      `apple-touch-icon`, and the manifest icon entry.
- [x] `src/web-client/sw.ts` — service worker, network-first for
      `/`, cache-first for `/fonts`, `/audio`, `/icons`,
      `/manifest.json`. `__BUILD_VERSION__` placeholder rewritten
      by the build to `<package.version>-<timestamp>` so cache
      rotates on every deploy.
- [x] `src/web-client/pwa.ts` — `registerServiceWorker()` (probes
      `isSecureContext`), `injectIosMeta()`, `refreshServiceWorker()`,
      `attachPullToRefresh()` (gated on `window.scrollY === 0` +
      no scrolled ancestor in the touch path).
- [x] `scripts/build-web-client.ts` — second `Bun.build` for
      `sw.ts` (esm), version-replace, copy `manifest.json` +
      `icon.svg` to `assets/web-client/`.
- [x] `src/bun/web/asset-loader.ts` — VENDOR_MAP entries for the
      three new files.
- [x] `src/bun/web/server.ts` — routes `GET /sw.js`,
      `GET /manifest.json`, `GET /icons/icon.svg`,
      `GET /icons/apple-touch-icon.png`. Headers chosen for
      correctness: `service-worker-allowed: /`, `no-store` on the
      worker (so we always re-fetch the latest), `application/manifest+json`
      on the manifest, long max-age on icons.
- [x] `src/bun/web/page.ts` — `<link rel="manifest">`,
      `<meta name="theme-color">`, iOS apple-* meta, three new
      toolbar buttons (`#kbd-toggle-btn`, `#procmgr-btn`,
      `#settings-btn`), `#sidebar-scrim` element. Updated viewport
      meta with `viewport-fit=cover` + `interactive-widget=resizes-content`.
- [x] `electrobun.config.ts` — packaged-build copy map updated for
      sw.js + manifest.json + icon.svg so the .app ships them.

### Web Notifications + Vibration

- [x] `src/web-client/web-notifications.ts` — pure
      `shouldFireNotification` (gates on hidden + permission +
      pref + api) and `decideVibration` (severity → pattern). Side-
      effect `fireNotification()` reads document.hidden, permission,
      preference, then fires `new Notification(...)` and calls
      `navigator.vibrate(...)` only when the deciders agree.
- [x] `main.ts` subscription — watches the `sidebar.notifications`
      array; on any new id (excluding the initial snapshot), fires
      `fireNotification` with severity "info" and an `onClick`
      that focuses the source surface. Uses `tag: "tau-mux:<id>"`
      so duplicate alerts replace instead of stacking.

### Hermetic tests (Tier 1)

- [x] `tests/web-mirror-touch-gestures.test.ts` — 23 cases
      covering swipe / edge / pinch math + workspace stepping.
- [x] `tests/web-mirror-process-aggregator.test.ts` — 16 cases
      covering sort, totals, filter, formatting.
- [x] `tests/web-mirror-keyboard-toolbar.test.ts` — 16 cases
      covering modifier-free + Ctrl-modified key encoding +
      `encodeCtrlLetter`.
- [x] `tests/web-mirror-pwa-and-notifications.test.ts` — 18 cases
      covering `shouldFireNotification`, `decideVibration`,
      `summarizeConnection` (status kinds, count derivation,
      auth-text branches).

### Verification

- [x] `bun run build:web-client` clean (sw.js cache key reflects
      version 0.2.17 + build timestamp).
- [x] `bun run typecheck` clean.
- [x] `bun test tests/web-mirror-touch-gestures.test.ts tests/web-mirror-process-aggregator.test.ts tests/web-mirror-keyboard-toolbar.test.ts tests/web-mirror-pwa-and-notifications.test.ts` — 73/73 pass.
- [x] `bun test` (full) — 1297/1297 (was 1224 pre-commit; +73).
- [x] `bun scripts/audit-emoji.ts` clean.
- [x] `bun run bump:patch` — 0.2.16 → 0.2.17.
- [x] Commit — pending (next step).

## Deviations from the plan

1. **Plan #13 §A "Plan panel — parity from day 1" deferred.** The
   native agent panel hasn't shipped commit B yet (per the user's
   session summary, plan #09 commit B is "headless-doable but
   pending"). Mirroring an unfinished UI invents the protocol
   contract; better to land the agent panel mirror together with
   plan #09 commit B in the same architecturally-coherent unit.

2. **Settings panel does NOT mirror native AppSettings.** The plan
   said "Settings panel (mirror, read-only first)". A literal
   mirror would surface shell paths, telegram tokens, font sizes
   etc. — most of which are sensitive (the bot token!) or
   irrelevant from the mirror's perspective. Instead, the mirror's
   Settings panel surfaces the *user-facing knobs that work in the
   mirror* (sound, OS notifications opt-in, vibration, pinch zoom,
   soft-keyboard default) plus an "About this mirror" section with
   the live connection summary. This matches the user's "make it
   perfect" direction better than a sterile dump of irrelevant
   config — the mirror's own preferences live next to its own
   diagnostic.

3. **Touch gestures live in their own module, not extending
   `panel-interaction.ts`.** The plan suggested extending the
   existing pointer router. After reading both files, I kept the
   panel-interaction concerns (drag a panel, resize a panel)
   separate from the new mirror-wide gestures (swipe to switch
   workspace, edge-swipe drawer, pinch terminal font). They fire
   on different elements and have different lifecycle semantics;
   mixing them would have inflated panel-interaction.ts and
   coupled unrelated tests.

4. **Sidebar drawer is mobile-and-tablet, not phone-only.** The
   plan said "≥ 1024 px → current desktop layout". I made the
   drawer mode kick in at < 1025 px, not just < 720 px, because
   the iPad / horizontal-tablet form factor benefits from the
   drawer too — the push-out mode on a tablet eats too much
   horizontal real estate from the panes. Easy to flip if the
   user wants the original threshold.

5. **PWA service worker uses cache-first for fonts/audio/icons,
   network-first for `/`.** The plan said "use a build-hash-based
   cache key" — done via `__BUILD_VERSION__` substitution. The
   shell HTML is network-first because it inlines the bundle, so
   stale HTML = broken app; static assets are cache-first because
   they are content-addressed by version-keyed cache.

6. **Soft-keyboard sticky-Ctrl auto-clears after one press,
   matching iOS / Android system keyboards.** The plan said
   "Sticky `Ctrl` state" without specifying lifetime; matching
   platform conventions felt right. Power users can rapid-tap
   Ctrl twice to lock, but that's a future polish.

7. **Pinch-zoom uses xterm's `options.fontSize` direct mutation.**
   xterm v5 supports live option updates (the FitAddon will
   recompute on the next `proposeDimensions`). No explicit
   `fitAddon.fit()` call needed because the surrounding ResizeObserver
   re-runs anyway whenever the pane geometry changes.

## Issues encountered

1. **Float drift on pinch resolution.** `Math.trunc(log(1/1.12) /
   log(1.12))` returned `-0` instead of `-1` because the ratio
   was -0.99999…. Test caught it on first run; fixed by switching
   to `sign * floor(abs(raw) + 1e-9)`. Also added a regression
   test that explicitly covers the symmetric case.

2. **Three TS6133 unused-import errors.** `pinchTarget` was set
   but never read after I dropped a follow-on feature; `GitCommit`
   was type-only and the `void GitCommit` workaround failed
   typecheck; `escapeHtml` in `show_webcam` (carryover from
   commit C earlier in this session) was unused. All caught by
   `bun run typecheck`, all fixed by simply deleting the dead
   code.

3. **Service-worker cache name needs to vary across deploys but
   stay stable within a deploy.** Using `Date.now()` alone meant
   every dev rebuild rotated the cache (good for dev, slightly
   wasteful). Settled on `<package.version>-<Date.now()>` so the
   version axis encodes "this is a different release" and the
   timestamp encodes "this is a different build". Worth
   revisiting if a future plan adds true content-hashing.

## Open questions

- The Process Manager mirror is read-only. Should we surface the
  native kill button at all, gated by a "mirror has elevated
  permission" capability? Filing as a stretch: today's web mirror
  doesn't have a privileged channel for any destructive action.
- The soft-keyboard toolbar covers the most-needed keys but not
  full F-keys (F1..F12). Programmable function keys would be
  another row. Defer until a user actually asks; the existing 19
  keys + Ctrl handle every Vim / tmux / shell scenario I can
  think of from the mobile workflow side.
- PWA install prompt (the `beforeinstallprompt` event) isn't
  caught — Chrome prompts on its own when criteria are met. We
  could surface a manual "Install" button in the Settings panel
  if users find Chrome's heuristics inconsistent. Defer.

## Verification log

| Run                                                       | Result                              |
| --------------------------------------------------------- | ----------------------------------- |
| `bun run build:web-client`                                | clean; sw.js cache key 0.2.17-… |
| `bun run typecheck`                                       | clean                               |
| `bun test tests/web-mirror-{touch-gestures,process-aggregator,keyboard-toolbar,pwa-and-notifications}.test.ts` | 73/73 pass, 121 expect() calls |
| `bun test` (full)                                         | 1297/1297 pass, 108127 expect() calls |
| `bun scripts/audit-emoji.ts`                              | clean                               |
| `bun run bump:patch`                                      | 0.2.16 → 0.2.17                     |

## Commits

- `ea00e27` — web-mirror: bridge-view parity + mobile/touch UX (Plan #13)
  - 24 files changed; 3694 insertions, 14 deletions
  - 8 new modules + 4 test files + 470 lines of CSS + page/server/build/config wiring

## Retrospective

What worked:
- Pure decision helpers (touch-gestures, process-aggregator,
  keyboard encoder, notification deciders, summary builder) made
  hermetic testing trivial. 73 tests in 13 ms cover the whole
  load-bearing logic surface — the DOM-bound code is thin glue.
- Audit-first via an Explore agent saved a lot of redundant
  reading. The agent's "missing 3 panels, 1 breakpoint, no
  gestures, no PWA" report matched what I found and let me scope
  the commit accurately.
- Mirroring the native Process Manager's *behaviour* (CPU sort,
  click-to-focus) without inventing a new protocol envelope —
  everything we needed was already in the surface metadata
  snapshot. Same for Settings, where the genuine mirror prefs
  are local-only by design.
- The build pipeline accepted a second entrypoint cleanly. SW
  cache versioning fell out naturally from the
  `__BUILD_VERSION__` substitution + `package.json` read.

What I'd do differently:
- I built the touch gestures, soft-keyboard, and PWA modules in
  isolation before wiring them into main.ts. That made the wiring
  step a single 80-line edit at the end — easy to read but harder
  to debug if any module had a subtle integration mismatch.
  Alternating "build module + immediately wire" might catch
  integration bugs earlier.
- The CSS additions are ~470 new lines — about half the original
  file. A future polish pass could split client.css into per-area
  partials (sidebar, panels, overlays, breakpoints) at build
  time, but that's a build-script change, not a CSS change.
- I deferred the agent-panel mirror without trying to estimate
  it. Worth a quick "what would this take?" look before plan #09
  commit B starts so the two efforts can coordinate.

Carried over to follow-ups:
- Agent-panel mirror — couples to plan #09 commit B.
- F1..F12 row in the soft-keyboard toolbar (if a user asks).
- `beforeinstallprompt` capture + an "Install τ-mux" button in
  Settings (if Chrome's auto-prompt UX is found wanting).
- Process Manager kill action (only if the mirror gains a
  privileged write channel).
- Visual confirmation on a real iPhone / iPad. The hermetic tests
  pin behaviour; nothing replaces a real touch device for spotting
  hit-target mistakes or keyboard-shadowing UX problems. Filing as
  a manual QA follow-up alongside the Plan #06 §A flicker review
  the user already has on the live-repro list.
