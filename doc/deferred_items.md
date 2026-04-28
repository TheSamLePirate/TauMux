# Deferred items — execution plan

**Generated:** 2026-04-28
**Source:** items in `doc/full_analysis.md` that the [tracking_full_analysis.md](./tracking_full_analysis.md) sweep deliberately left for future passes.
**Last commit relevant to this plan:** `079e235` (the closeout of the previous sweep). Version at hand-off: `0.2.50`.

This document is a real plan, not a wishlist. Every item has scope, approach, files, tests, risk, effort, and the open questions that have to be answered before code is written. Items are grouped so they cluster into clean PRs.

## Effort and risk legend

- **S** — < 30 min, single file, mechanical change.
- **M** — 1–3 hours, may touch 2–4 files and need a small test.
- **L** — half-day or more, needs design discussion and/or behavior change.
- **XL** — multi-day, RFC-class change.

- **Risk: low** — strictly more lenient or strictly clearer than before; no behavior shifts for any existing user.
- **Risk: medium** — small behavior shift behind a setting or in a clearly scoped path.
- **Risk: high** — touches a contract or default that ships to all users.

---

## Cluster A — Quick-win NIT cleanups (one PR)

Five-minute fixes that should land together. No behavior change anywhere.

| ID | What | Files | Effort |
|----|------|-------|--------|
| N8 | Update notification handler comment to specify "synchronous throws only" | `src/bun/rpc-handlers/notification.ts:47` | S |
| N9 | `flushChannel()` re-entry guard: `if (ch.flushing) return;` | `src/bun/sideband-parser.ts:75–89` | S |
| N10 | Stricter offset parse: `Number.isInteger(Number(x))` | `src/bun/telegram-service.ts:228` | S |
| N11 | Differentiate subprocess timeout from "tick failed" log line | `src/bun/surface-metadata.ts:630` | S |
| N12 | Add comment cross-ref to `doc/system-rpc-socket.md` near `readScreenResponse` (also covers I10) | `src/bun/index.ts:640` and an explanatory paragraph in `doc/system-rpc-socket.md` | S |
| N13 | Comment near `removeAgentSurface` explaining the bun-side kill asymmetry | `src/views/terminal/surface-manager.ts:415` | S |
| N16 | Add a one-liner to `ht send --help` clarifying `\\n → \r` (per `bin/ht:48–54`) | `bin/ht` (the `printHelp` block for `send`) | S |
| N17 | Comment in `scaleTerminals` requiring it run after `applyMirrorScale` | `src/web-client/layout.ts:180–203` | S |
| M4  | "RPC-only methods" section in `doc/system-rpc-socket.md` naming `surface.kill_pid`, `surface.rename`, `notification.dismiss`, `browser.stop_find` as deliberately CLI-absent | `doc/system-rpc-socket.md` (new section near the dispatch overview) | S |

**Plan.** One PR titled `chore(nits): comment + guard cleanups + RPC-only doc section (N8–N17, M4)`. No behavior change, no bump strictly required, but bump anyway because public-facing `ht send --help` text is touched. Risk: low.

**Tests.** None new. Existing suite must stay green.

**Open questions.** None.

---

## A.1 — M5 `ht browser help` subcommand (own micro-PR)

**Problem.** `bin/ht`'s `mapBrowserSubcommand()` (lines 69–229) has no `case "help":`, but the catch-all error at line 227 tells the user to run `ht browser help`. Following the advice produces `Unknown browser subcommand: help`.

**Approach.** Add `case "help":` that prints the same browser-section text the top-level `ht --help` already produces (extract once into a helper or duplicate inline — they're short).

**Files.** `bin/ht` (`mapBrowserSubcommand`).

**Tests.** Extend `tests/bin-ht-help.test.ts` to assert `ht browser help` exits 0 and prints text containing "navigate" / "click" / "fill".

**Effort.** S. **Risk.** Low.

---

## A.2 — Separate dev `configDir` (own micro-PR, promoted from E.3)

**Problem.** `bun run dev` against this repo reuses the host's `~/Library/Application Support/hyperterm-canvas/` `configDir`, so the probe-before-unlink fix from the prior sweep is the only safety net. A separate dev dir avoids the situation entirely.

**Approach.** Modify the `start`, `dev`, and `build:dev` scripts in `package.json` to set `HT_CONFIG_DIR=$HOME/Library/Application Support/hyperterm-canvas-dev`. Explicit, debuggable, no auto-detect heuristic.

**Files.** `package.json` (the three scripts; do not touch `build:canary` or `build:stable`).

**Tests.** Manual: run `bun start` with no installed τ-mux running and verify the new dir is created on disk; verify that an installed τ-mux's socket survives a `bun run dev` cycle.

**Effort.** S. **Risk.** Low — adds an env var; doesn't change packaged-build behavior.

**Open question.** Should `build:dev` also point at the dev dir? Recommend yes; document it inline in the script comment.

---

## Cluster B — Lifecycle teardown sweep (one PR)

Tied together because they share a single `pagehide` handler implementation. None of the leaks are user-visible today (browsers GC on unload), but a strict-leak audit would catch them and the diffs are mechanical.

| ID | What | Files |
|----|------|-------|
| I11 | `PlanPanel.destroy()` + `askUserModalHandle.destroy()` called on `pagehide` | `src/views/terminal/plan-panel.ts`, `src/views/terminal/ask-user-modal.ts`, `src/views/terminal/index.ts:316` and `:382–387` |
| I12 | `NotificationOverlay.destroy()` clears auto-dismiss timers + DOM tree | `src/views/terminal/notification-overlay.ts`, wired in `src/views/terminal/index.ts:2146` |
| N15 | Centralize `ResizeObserver` / `MutationObserver` cleanups so the terminal-container case stops being the only one with explicit teardown | `src/views/terminal/index.ts:701–714`, `src/views/terminal/sidebar.ts`, `src/views/terminal/panel-manager.ts` |

**Approach.** Build a tiny module-level `disposers: Array<() => void>` registry in `src/views/terminal/index.ts`. Every place that registers an observer/timer/listener pushes its inverse onto the registry. A single `window.addEventListener("pagehide", () => disposers.forEach(fn => { try { fn(); } catch { /* ignore */ } }))` runs them all. Components expose a `destroy()` method that simply runs their slice of the registry.

**Effort.** M (~2–3 hours). The trick is auditing every `setInterval` / `addEventListener` / `new ResizeObserver` site in `src/views/terminal/`. Use grep, not memory.

**Tests.** Add a happy-dom test that constructs `PlanPanel`, `AskUserModal`, and `NotificationOverlay`, calls `destroy()`, and asserts:
1. their root DOM nodes are gone, and
2. a follow-up state event doesn't trigger a render (use a spy).

**Risk.** Low. Strictly stricter cleanup; existing functional paths unchanged.

**Open question.** Should the registry live in a shared `src/views/terminal/lifecycle.ts` so it's importable from any module, or is a per-call-site `destroy()` returned to `index.ts` cleaner? **Recommendation:** per-call-site `destroy()`, registered in `index.ts`. Avoids the global-singleton smell.

---

## Cluster C — UX polish (group by area)

Four independent UX touch-ups. Land as separate small PRs unless one developer is sweeping the area.

### C.1 — I14 settings-panel theme picker self-feedback

**Problem.** Picking a preset updates the CSS variables and the terminal repaints, but the settings panel's own swatches don't re-render until the panel is closed and reopened. Reads as "did the click register?".

**Approach.** In the theme `onPresetChange` callback, after dispatching the settings update, call a panel-internal `renderTheme()` so swatches and the active-preset indicator reflect the new state.

**Files.** `src/views/terminal/settings-panel.ts` (the theme section, ~lines 800–890).

**Tests.** Add a happy-dom test that opens the panel, clicks a preset, and asserts the active-preset class moves to the clicked swatch on the same tick.

**Effort.** S–M (~30 min). **Risk.** Low.

### C.2 — N14 palette command descriptions

**Problem.** `Open Browser Split`, `New Browser Workspace`, `Split Agent Right`, `Split Agent Down` are always available in the palette regardless of focused-pane type. The descriptions don't hint that they create a *new* pane adjacent to the active one. Mild user confusion.

**Approach.** Augment each palette entry's `description` field in `buildPaletteCommands` with parenthetical clarifications: `Split Agent Right (creates a new agent pane)` etc.

**Files.** `src/views/terminal/index.ts:1077–1107`.

**Effort.** S. **Risk.** Low.

### C.3 — N18 plan panel empty-state placeholder

**Problem.** `repaint` in `plan-panel-mirror.ts` hides the panel when `plans.length === 0 && audit.length === 0`. A user on the web mirror won't even know the widget exists until an agent posts a plan.

**Approach.** Render a one-line empty-state ("No active agent plans") inside the panel and keep the panel mounted. Don't show it on the *first* render of a fresh connection — the server's hello may not include plans yet, and we don't want a flicker of the empty state followed by the real list. Use a small "received initial plansSnapshot yet?" flag.

**Files.** `src/web-client/plan-panel-mirror.ts`.

**Tests.** Add a unit test that asserts the empty-state node is present after the first `plansSnapshot` arrives with `plans: []`, and absent before.

**Effort.** M. **Risk.** Low.

### C.4 — I9 "Restore previous bloom" affordance

**Problem.** `legacyBloomIntensity` is migrated and stored but never reachable from the UI — the user can't restore their pre-τ-mux bloom in one click.

**Approach.** Add a single button in the Effects section of `settings-panel.ts`: enabled iff `legacyBloomIntensity > 0` and `bloomIntensity === 0` (or any other "user has lost their old setting" condition). Click → `applySettings({ bloomIntensity: settings.legacyBloomIntensity })`. Disable + grey out when conditions don't apply.

**Files.** `src/views/terminal/settings-panel.ts` (Effects section).

**Tests.** Happy-dom test: setup with `legacyBloomIntensity = 0.6, bloomIntensity = 0` → button visible/enabled, click → `applySettings` called with `{ bloomIntensity: 0.6 }`.

**Effort.** M. **Risk.** Low.

---

## Cluster D — Web-mirror polish (one PR)

Four small but real web-mirror improvements that the prior sweep deferred because they each warrant their own focused diff with manual testing.

### D.1 — N3 drag pointer-capture

**Problem.** `panel-interaction.ts` registers drag listeners on `document` without `setPointerCapture`. If a user drags a panel quickly off-screen or hits a complex DOM structure, the drag can stick and require a click-anywhere to release.

**Approach.** Migrate from `mousemove`/`mouseup`/`touchmove`/`touchend`/`touchcancel` to the unified Pointer Events API. On `pointerdown`, capture the pointer to the element. The browser then guarantees `pointerup` and `pointercancel` events to that element regardless of where the cursor goes.

**Files.** `src/web-client/panel-interaction.ts:30–53`.

**Tests.** Add a unit test using a mocked Pointer Events polyfill (or just dispatch synthetic events with `PointerEvent` constructor in happy-dom) that drives a drag, simulates a `pointercancel`, and asserts the controller transitions cleanly out of the drag state.

**Manual verification.** Required. Drag a panel quickly to the corner of the viewport and release while the pointer is over a different element; behavior must not stick.

**Effort.** M (~2 hours). **Risk.** Low — pointer capture is strictly safer than the current document-level listeners.

### D.2 — N4 FIFO buffer for pending sideband frames

**Problem.** `pendingPanelData` in `main.ts:1041–1045` is a single-slot buffer keyed by panel id. If a panel is created and three binary frames arrive in the same animation frame before the DOM mounts, only the last frame survives. Today this doesn't bite us because most renderers send their data after the meta, but the ordering contract isn't enforced.

**Approach.** Replace `Map<id, Uint8Array>` with `Map<id, Uint8Array[]>`. On flush in `ensurePanelDom`, drain the array in arrival order. Keep a per-panel cap (say 16 frames) so a buggy producer can't OOM the renderer.

**Files.** `src/web-client/main.ts:1041–1085`.

**Tests.** Add a transport test: create a panel, simulate three binary frames before the rAF fires, assert all three reach the renderer in order. Then exercise the cap: send 32 frames, assert only the last 16 land and a warn is logged.

**Effort.** M (~2 hours). **Risk.** Low.

### D.3 — N5 service-worker cache lifecycle

**Problem.** The activate handler in `sw.ts:23–50` deletes old caches immediately. If a user is mid-session when a new build deploys, the new SW activates, deletes the old cache, and the user's still-running old client may try to fetch an asset that's now gone — instant white-screen for them.

**Approach.** Two options:

1. **Defer cache cleanup** until `clients.matchAll()` returns no clients on the old version. Use the `claim()` + `skipWaiting()` flow more carefully; only purge after the last old client navigates.
2. **Notify the user.** Expose a `version-available` event and let the client render a "reload to update" toast. Cleanup happens after the user reloads.

**Recommendation:** option 2 — explicit user reload is more robust on flaky connections than the implicit clients-empty timing. Ship a `tau-mux-update-available` `CustomEvent` from the SW; the mirror's existing toast machinery picks it up.

**Files.** `src/web-client/sw.ts`, `src/web-client/main.ts` (toast wiring).

**Tests.** Hard. Service workers are notoriously hostile to unit tests. Recommend an end-to-end test in `tests-e2e/resilience.spec.ts` that simulates a SW update and asserts the toast appears. Manual verification is realistic too.

**Effort.** L. **Risk.** Medium — touching SW lifecycle is the part of the codebase most likely to be subtly wrong. Worth landing as a stand-alone PR with a careful manual test pass on at least Chrome and Safari.

### D.4 — N7 auth token in URL across reconnects

**Problem.** `transport.ts:63–78` keeps the auth token in the WebSocket URL across reconnects. If a script error logs `window.location` or the URL leaks into an analytics call, the token leaks.

**Approach.** Two-step mitigation:

1. After the first successful connect, scrub the token from `window.location` via `history.replaceState`. The token already lives in module state for reconnects.
2. Add a `beforeReconnect` hook that strips any token from URLs before they're passed to `console.log` / `console.warn`.

**Files.** `src/web-client/transport.ts`, `src/web-client/main.ts` (entry-point token capture).

**Tests.** Unit test: boot the client with `?t=secret`, verify `window.location.search` is empty afterwards but reconnects still authenticate.

**Effort.** M. **Risk.** Medium — wrong implementation can lock out reconnects on slow networks. Bench against `tests-e2e/resilience.spec.ts` to confirm.

---

## Cluster E — Architecture / RFC items (one item per PR, design first)

Each of these needs design discussion before code lands. Don't bundle.

### E.1 — M10 surface RPC startup-race queue / `surface.wait_ready`

**Problem.** `src/bun/rpc-handlers/surface.ts:109, :135, :288` throw `"no metadata yet — try again in a second"` and `"webview bridge unavailable"` when external callers race the boot sequence. Every consumer (CLI, scripts, automations) has to retry-loop. There's no event the caller can subscribe to.

**Approach options.**

1. **Internal queue.** When metadata isn't ready, queue the inbound RPC. Drain the queue on the first successful poll. Bounded window (say 2 s); after that, fail with a clearer error: `"surface metadata unavailable after 2s — pane may have crashed"`.
2. **Explicit `surface.wait_ready` method.** Returns when metadata is ready, with a timeout. Callers opt in. Existing throw behavior unchanged for callers that don't.
3. **Both.** Queue inside the existing methods (eliminates the race for naive callers) and expose `surface.wait_ready` for explicit waiting.

**Recommendation.** Option 3. The internal queue eliminates user-visible failures from naive scripts; `surface.wait_ready` gives sophisticated callers the explicit synchronization point they want.

**Files.** Substantial. New: a `pendingMetadataRequests: Map<surfaceId, Array<() => void>>` registry in `src/bun/rpc-handlers/surface.ts` or a sibling module. Modify the three throw sites. Add `surface.wait_ready` to the dispatch table and `bin/ht` and the schemas.

**Tests.** New tests in `tests/rpc-handler.test.ts`: dispatch a surface metadata RPC before the first poll completes, assert it resolves once the poll lands. A separate test for the timeout path.

**Effort.** L (~half day). **Risk.** Medium — touches the bootstrap sequencing.

**Open questions.**
- What's the max queue size? Recommendation: 32 per surface, drop oldest with a warn.
- Should the queue be per-RPC-method or single-queue-per-surface? Single-queue is simpler.
- Does `system.tree` (which surfaces metadata) need the same treatment? Probably yes.

### E.2 — M11 pi-agent stream alignment (or documented divergence)

**Problem.** `pi-agent-manager.ts` consumes `pi --mode rpc` JSON over stdout, separate from the documented fd 3/4/5 sideband. New contributors expecting the fd-based model are surprised. `send()` throws if stdin isn't bound.

**Approach options.**

1. **Migrate** the pi-agent stream onto fd 3/4/5. Agents would emit JSONL on fd 3 with their own message types; binary payloads on fd 4. Shared framing logic.
2. **Document the divergence** loudly — add a section to `doc/system-pty-session.md` and CLAUDE.md explaining why pi agents are a separate channel and what the contract is.

**Recommendation.** Option 2 first (cheap, captures the actual decision), then evaluate option 1 for a future revamp. The pi protocol is upstream-defined; we can't change the source format without coordinating with that project.

**Files.** `doc/system-pty-session.md`, `CLAUDE.md`. Defer code changes.

**Effort.** S for docs. XL for migration.

**Open question.** Does pi-the-CLI have a stable contract we could reasonably migrate without forking?

### E.3 — (promoted to A.2; see above)

This entry was moved into the immediate cluster as `A.2 — Separate dev configDir`. Keeping the heading here so anyone scanning cluster E in numerical order doesn't think the index skipped a slot.

### E.4 — I6 default `webMirrorBind` to `127.0.0.1`

**Problem.** Default `webMirrorBind` is `0.0.0.0`. Test fixtures and dev runs print a "bound to 0.0.0.0 without auth" warning every time. The README does describe the auth token, but the safe-default story is muddled.

**Approach.** Flip the default to `127.0.0.1`. Add a clear UI hint in the Network settings: `Set to 0.0.0.0 to expose on LAN`.

**Risks.**
- **Migration story.** Existing users with no explicit `webMirrorBind` setting will lose LAN access on upgrade. Mitigation: when the settings file is read and `webMirrorBind` is undefined, fall back to `0.0.0.0` *for one release*, then flip. Or add a one-time toast pointing the user at the setting.
- **Behavior change ships to all users.** This is a high-blast-radius default flip. Consider gating behind a major version bump.

**Files.** `src/shared/settings.ts` (`DEFAULT_SETTINGS`), `src/views/terminal/settings-panel.ts` (Network section UI hint), `doc/system-rpc-socket.md` and the website mirror docs (wording).

**Effort.** M (the code is trivial, the migration UX is the work).

**Open questions.**
- Do we ship the toast, or skip the migration and just bump the major?
- What does the upgrade-detection check look like? `settings.json` has no version field today.

### E.5 — M7 IME composition position

**Problem.** `xterm.css:80` has a `/* TODO: Composition position got messed up somewhere */` next to `.xterm-helper-textarea`. Non-Latin-input users see the IME popup mispositioned relative to the cursor.

**Approach.** xterm.js exposes the active cell metrics via `_core._renderService.dimensions.css.cell`. The SurfaceManager already tracks the cursor position from xterm `cursorMove` events. Wire those two together: on every cursor move, position `.xterm-helper-textarea` to `(cursorX × cellWidth, cursorY × cellHeight)` in the xterm container's coordinate space.

**Files.** `src/views/terminal/surface-manager.ts` (subscribe to `onCursorMove`), `src/views/terminal/xterm.css` (remove the `position` overrides that are fighting the JS).

**Tests.** Hard. xterm.js doesn't render in jsdom/happy-dom. A real Playwright test that runs `printf "test"` and asserts `.xterm-helper-textarea` is positioned near the rendered cursor would work but requires a font-loaded headless browser. Recommend including this in `tests-e2e/`, accepting that CI doesn't run those today.

**Manual verification.** Mandatory. Test with macOS Japanese (Hiragana) input, Vietnamese, and a tone-mark layout. Compare popup position before/after the change.

**Effort.** L (real test infrastructure work). **Risk.** Medium — touching xterm.js internals (the underscored `_core._renderService` is private) means future xterm upgrades may break it. Add a TODO comment naming the version we tested against (currently 5.3.0).

**Open question.** Is there a public xterm.js API we missed? Worth raising upstream.

### E.6 — M8 audit.fix ergonomics

**Problem.** `audit.fix` throws on missing `id` and on cache miss. Throwing IS valid socket-RPC behavior (errors propagate as `{ error: "..." }`), but the file's own comment at `:62` flags a "silently dropped fields" hazard for `fix: {}`.

**Approach.** Hold for now. The audit handler shape is still being defined (Plan #11 territory). Revisit after the consumer surface stabilizes.

**Effort.** Wait.

---

## Cluster F — Won't fix / non-actionable

These were recorded as findings but, on reflection, are intentional design choices:

- **N6** — `innerHTML` for `svg` and `html` types. Intentional per CLAUDE.md ("No sandboxing of fd 4 content for now"). Leave the existing comment; nothing to do until the security model changes.
- **I3** — website tech-stack version-range loosening. Already addressed informally in step 9 of the prior sweep (the README CLI block update); the website examples now match exactly via the bump-script extension in step 10.
- **I7** — `code_reviews/README.md` exists; original audit was wrong. Already retracted in `doc/full_analysis.md`.
- **I8** — surface-resize clamping is enforced; original audit was wrong. Already retracted.
- **I10** — `readScreen` legacy convention. Folded into N12 (cluster A) — a doc cross-ref is sufficient; full migration would be invasive and is not load-bearing.

---

## Suggested execution order

If a developer has a couple of free days and wants to clear deferred work, this is the recommended sequence:

1. **PR #1** — Cluster A (incl. M4). Quick-win NIT cleanups + RPC-only methods doc section. ~1 hour, builds momentum.
2. **PR #2** — A.1: `ht browser help` subcommand. ~15 min — fixes the broken help redirect immediately.
3. **PR #3** — A.2: separate dev `configDir` in `package.json` scripts. ~15 min — protects future contributors from the dev/host socket collision.
4. **PR #4** — Cluster B: lifecycle teardowns. ~3 hours.
5. **PR #5** — C.1, C.2: settings panel feedback + palette descriptions. Half a day (or two small PRs).
6. **PR #6** — D.1, D.2: pointer capture + FIFO buffer. ~half a day.
7. **PR #7** — C.3, C.4: empty-state placeholder + Restore previous bloom. ~half a day.
8. **PR #8** — E.1: surface RPC queue / `wait_ready`. ~half a day, design discussion first.
9. **PR #9** — D.3: service worker update flow. ~1 day, careful manual test.
10. **PR #10** — D.4: auth token URL scrub. ~3 hours.
11. **Tracking issue** — E.4: `webMirrorBind` default flip. Schedule for the next major version.
12. **Tracking issue** — E.5: IME composition. Pair with someone who uses non-Latin input daily.
13. **Drive-by** — E.2: pi-agent docs. Add to `doc/system-pty-session.md` whenever the next pi-related change lands.
14. **Wait** — E.6: `audit.fix`. Hold until Plan #11 consumer surface is stable.

That's roughly **~3 working days** of cleanup if a developer batches them. None block any in-flight feature work. A.1 and A.2 add ~30 min total, so the budget didn't shift.

## How to update this plan

When an item lands:
1. Move the entry to a "Done" section at the bottom with the commit SHA.
2. Update the prior `doc/tracking_full_analysis.md` summary table if it referenced the deferred item.
3. If a finding is invalidated (turns out it was already fixed, or no longer applies), update `doc/full_analysis.md` § Retractions and remove the entry here.

Don't let this file become a graveyard. If something has been deferred for two release cycles without anyone touching it, that's a signal it's not actually wanted — close it with a one-line note instead of carrying it forward indefinitely.
