# Tracking — execution of `doc/full_analysis.md` action list

**Started:** 2026-04-28
**Source plan:** `doc/full_analysis.md` § Prioritized action list + Updated prioritized action list (addendum)
**Working tree at start:** branch `main`, on top of `169b719`. Several pre-existing uncommitted edits exist in `bin/ht`, `README.md`, multiple docs, and three RPC handlers — these are separate in-flight work and are **not** touched by this execution unless explicitly noted.

## Convention

Each step gets a heading with:
- **What** — the change
- **Files** — touched files with line refs
- **Verification** — the commands run and their result
- **Commit** — short SHA + message
- **Deviations / issues** — any place the plan needed to bend

Per `CLAUDE.md`, every functional commit is preceded by `bun run bump:patch` so the version reflects the change. Pure tracking-doc commits skip the bump and note why.

---

## Steps

### Step 1 — B4 + B5: socket collision (probe-before-unlink)

**What:** `SocketServer.start()` no longer blindly unlinks the socket inode. It first calls `existsSync` and, if a path exists, opens a 250 ms `Bun.connect` probe; if a peer answers, the new server refuses to bind and prints a clear remediation message ("Set `HT_CONFIG_DIR` or `HT_SOCKET_PATH` to a different path, e.g. `HT_CONFIG_DIR=/tmp/tau-mux-dev bun run dev`"). On stale paths the probe falls through and the inode is unlinked as before. `start()` is now `async`; a new `isBound()` getter lets the bootstrap code in `index.ts` flip the `socket` health row to `error` when the bind didn't take.

**Files:**
- `src/bun/socket-server.ts` — full rewrite of `start()`; added `bound` field, `isBound()` getter, `isPeerLive()` private probe.
- `src/bun/index.ts:2640` — `await socketServer.start();` and conditional health update.
- `tests/socket-server.test.ts` — `await server.start()` everywhere; new tests `refuses to overwrite a live peer` and `reclaims a stale socket path when no peer is alive`.

**Verification:**
- `bun run typecheck` — clean (top-level `await` already in use elsewhere in `index.ts`).
- `bun test tests/socket-server.test.ts` — 9 / 9 pass; the live-peer test demonstrates the refusal path explicitly.
- `bun test tests/` — 1501 / 1501 pass (was 1499; +2 for the new probe tests).

**Deviations / issues:**
- **Did not auto-pick a separate `configDir` for dev mode** (the original B4 second-half suggestion). Auto-detection of "am I running under `electrobun dev`?" is brittle (no canonical env signal across packaged/source/CI), and the probe-based refusal already prevents the silent data loss. Users get an explicit error pointing at the env-var override, which is more honest than magic. Listed as a deferred design choice.
- ESLint `no-require-imports` fired during the new test edit (forbade `require("fs")`); fixed by adding `writeFileSync` to the existing top-of-file `import { ... } from "fs"`. Unrelated to the bug fix.

**Commit:** `a6daa1d` (bump 0.2.39 → 0.2.40).

---

### Step 2 — B1: ⌘0 keyboard shortcut collision

**What:** Added a `when` guard to the `font.reset` binding so it skips browser and telegram panes. The colliding `browser.zoom-reset` already had the inverse guard. Both now coexist cleanly: terminal/agent panes get font reset, browser/telegram panes get zoom reset.

**Files:**
- `src/views/terminal/index.ts:1819–1828` — added `when: (ctx) => ctx.activeSurfaceType !== "browser" && ctx.activeSurfaceType !== "telegram"` plus an explanatory comment.

**Verification:**
- `bun run typecheck` — clean.
- `bun test tests/` — 1501 / 1501 pass (no test regression; no dedicated test for the binding table — the contract is "one binding per chord+context").

**Deviations / issues:** none.

**Commit:** `7c2a0b7` (bump 0.2.40 → 0.2.41).

---

### Step 3 — B2: `__clearLogs` reducer wiring

**What:** The web-mirror "clear logs" button dispatches `{ kind: "sidebar/action", action: "__clearLogs" }`, but the reducer's `sidebar/action` block had no branch for it. The action fell through and `state.sidebar.logs` kept its entries — the next render rehydrated whatever the click had visually wiped. Added an early-return branch (workspace-agnostic, since `sidebar.logs` is a flat array, not workspace-keyed) so the reducer empties `logs` before the `wsId` guard.

**Files:**
- `src/web-client/store.ts:414–424` — early `__clearLogs` branch inside `case "sidebar/action"`.
- `tests/web-client-sidebar.test.ts:315–333` — extended the existing client-side-only assertion to also verify `state.sidebar.logs === []` after the click.

**Verification:**
- `bun run typecheck` — clean.
- `bun test tests/web-client-sidebar.test.ts tests/web-client-store.test.ts` — 43 / 43 pass; the strengthened assertion exercises the new branch.

**Deviations / issues:** none.

**Commit:** `9720724` (bump 0.2.41 → 0.2.42).

---

### Step 4 — B3: missing web-mirror envelope types

**What:** The mirror server emitted **eight** envelope types that weren't declared in `ServerMessage` in `src/shared/web-protocol.ts` — five flagged in the original audit (`telegramState`, `telegramMessage`, `telegramHistory`, `plansSnapshot`, `autoContinueAudit`) plus three more I caught while wiring this fix (`telegramSurfaceCreated`, `askUserShown`, `askUserResolved`). Each is already broadcast (`src/bun/index.ts:127, :144, :159, :1424, :1465, :1475, :2582, :2735`) and dispatched (`src/web-client/protocol-dispatcher.ts:197–248`), so the fix is purely contractual: import the wire types from `src/shared/types.ts` and add the corresponding `Envelope<"...", ...Payload>` branches.

**Files:**
- `src/shared/web-protocol.ts` — added 8 payload interfaces and 8 union members; pulled in 7 wire types from `./types`.

**Verification:**
- `bun run typecheck` — clean (the dispatcher still compiles because it casts `unknown` payloads explicitly; with the union now broader, future strict-narrowing migrations become possible without changing the wire).
- `bun test tests/web-protocol.test.ts tests/web-server.test.ts tests/web-client-store.test.ts` — 35 / 35 pass.

**Deviations / issues:**
- The audit said "five missing types"; reality was eight. The `askUserShown` / `askUserResolved` pair is currently absorbed silently by the dispatcher (Plan #13 will add the modal to the mirror) — the contract entry doesn't change behavior but does mean the future modal can switch-exhaust on the union safely.

**Commit:** `d4d2e04` (bump 0.2.42 → 0.2.43).

---

### Step 5 — M1: orphan audio asset `need-human.mp3`

**What:** Deleted `assets/audio/need-human.mp3`. The file existed on disk but had no copy rule in `electrobun.config.ts`, no `VENDOR_MAP` entry in `src/bun/web/asset-loader.ts`, no HTTP route in `src/bun/web/server.ts`, and no caller anywhere in the source tree. The only related symbol is `notifyHumanInput` on the auto-continue engine — but that's a counter resetter (it clears the consecutive-runs gauge when the user types), not an alert trigger. No feature exists today that would play this sound.

**Decision:** delete now, re-add later if the feature lands. Per CLAUDE.md "Don't add features beyond what the task requires", carrying half-feature binary assets in the working tree is misleading.

**Files:**
- `assets/audio/need-human.mp3` — removed.

**Verification:**
- `bun run typecheck` — clean.
- `bun test tests/` — 1501 / 1501 pass.

**Deviations / issues:** none — git history retains the file, so re-adding is a single `git checkout HEAD~1 -- assets/audio/need-human.mp3` if the feature lands.

**Commit:** `51f8ab5` (bump 0.2.43 → 0.2.44).

---

### Step 6 — M6: verify `system.shutdown` wiring (RETRACTED)

**What:** Audit confirmed `shutdown: () => gracefulShutdown()` is passed in at `src/bun/index.ts:2614`, and `gracefulShutdown` (`src/bun/index.ts:2973–3055`) is a thorough teardown — metadata poller, native stdout coalescer, webview layout flush, settings/history/cookie persistence, pi agent dispose, web server, socket server, sessions, telegram service. The throw at `src/bun/rpc-handlers/system.ts:38` only fires in tests with minimal deps. **No code change.**

**Files:** none (read-only audit). Updated `doc/full_analysis.md` § M6 to mark the finding retracted.

**Verification:** read `src/bun/index.ts:2600–2640` and `:2973–3055`.

**Deviations / issues:** finding retracted as a false positive. Recorded the retraction in the source plan so future readers don't chase it.

**Commit:** `0ca347c` (no version bump — docs-only retraction).

---

### Step 7 — M9: variants controller soft-fail on missing `#tau-status-bar`

**What:** Replaced the constructor's hard `throw` with an inert-and-retry path. The controller now stays in a `ready = false` state if `#tau-status-bar` isn't in the DOM yet. Every subsequent `refresh()` retries `tryInit()`; as soon as the bar mounts, the active variant is entered for real. `setVariant()` still persists the user's choice through `updateSettings` even while inert, so a quick variant change during boot isn't lost.

**Files:**
- `src/views/terminal/variants/controller.ts` — full restructure: added `ready`, `tryInit()`, made `current` and `ctx` nullable, made `refresh()` and `setVariant()` defensive when not ready. The boot-time warn fires only once (module-level `warnedOnce` flag) so a slow boot isn't drowned in noise.

**Verification:**
- `bun run typecheck` — clean.
- `bun test tests/` — 1501 / 1501 pass.

**Deviations / issues:**
- No dedicated test exists for the controller (the variants module is exercised via the design report). Adding one would require a happy-dom harness; deferred. The boot path is now strictly more lenient than before — any path that worked before still works, and a path that previously crashed now stays inert.

**Commit:** `8b88af3` (bump 0.2.44 → 0.2.45).

---

### Step 8 — M12: τ-mux Help menu entry

**What:** Added a "τ-mux Documentation" menu item to both the app submenu (under the τ-mux name) and the Help menu, pointing at `https://thesamlepirate.github.io/TauMux/`. The existing "Electrobun Documentation" entry stays — kept as a useful link to the framework docs but no longer the only "Help" target.

**Files:**
- `src/bun/native-menus.ts:6–8` — exported `TAU_MUX_DOCS_URL`.
- `src/bun/native-menus.ts:26–30` — added `openTauMuxDocs` action constant.
- `src/bun/native-menus.ts:62–66, :208–212` — new menu items (placed first in each submenu).
- `src/bun/index.ts:51–58` — imported `TAU_MUX_DOCS_URL`.
- `src/bun/index.ts:2138–2140` — added action case using `Utils.openExternal`.

**Verification:**
- `bun run typecheck` — clean.
- `bun test tests/native-menus.test.ts tests/menu-events.test.ts` — 8 / 8 pass (existing tests don't enumerate menu order, so adding an item didn't regress them).

**Deviations / issues:** none.

**Commit:** `5e1ecf8` (bump 0.2.45 → 0.2.46).

---

### Step 9 — I1, M2, M3: README + CLAUDE.md doc refresh

**What:** Refreshed test counts, added the missing CLI subsections to the README, and added recently-introduced files / panels to the project layout block and architecture diagram.

**Files:**
- `README.md` — test counts updated to 1500+ / 100 files (was 748 / 666 / 54 / 44); added CLI subsections for `ht plan`, `ht autocontinue`, `ht ask`, `ht telegram`; added `PlanPanel`, `AskUserModal`, `TelegramPaneView` to the architecture ASCII; added `plan-store.ts`, `auto-continue-engine.ts`, `auto-continue-host.ts`, `telegram-service.ts`, `telegram-db.ts`, `plan-panel.ts`, `ask-user-modal.ts`, `ask-user-state.ts`, `telegram-pane.ts`, `variants/controller.ts` to the project layout block; expanded the rpc-handlers list to include `plan / telegram / audit / auto-continue / ask-user / __test`.
- `CLAUDE.md` — test count updated to 1500+ / 100 files (was 801 / 58).

**Verification:**
- `bun run typecheck` — clean.
- `bun test tests/` — 1501 / 1501 pass.

**Deviations / issues:**
- The commit also picks up the pre-existing in-flight README edits (the "Just a personal project" hero block and the `HT_WORKSPACE_ID` env-var clarification). They are cohesive with this docs refresh — both clarify reality versus an older, smaller version of the project — so bundling them in keeps the working tree clean rather than splitting hairs across two PRs. The website-doc modifications stay uncommitted; they're handled in step 10.

**Commit:** filled in below.
