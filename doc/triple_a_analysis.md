# Triple-A quality analysis — τ-mux

**Generated:** 2026-04-29
**Branch:** main
**Commit reference:** working tree on top of `5afd12f` (docs(tracking): record D.3 commit SHA), version `0.2.60`
**Method:** Five parallel deep-dive audits across (1) architecture & contract drift, (2) resource lifecycle & reliability, (3) external-surface security on `0.0.0.0`, (4) UX polish & accessibility, (5) test coverage & test-quality. Each agent was instructed to skip findings already tracked in `doc/full_analysis.md`, `doc/issues_now.md`, `doc/deferred_items.md`, `doc/tracking_full_analysis.md`, or `doc/tracking_deferred_items.md`. This pass picks up where the 2026-04-28 sweep left off (last landed item: D.3 SW update banner @ `a82ee6b`).
**Verification:** every HIGH-severity item below has had its file:line refs spot-checked against the working tree on 2026-04-29 (`5afd12f`). MED and LOW refs are agent-reported and within ±5 lines in spot samples — sanity-check before acting on a specific line. A 200-line refactor since the agent read the file will make any reference stale.

---

## TL;DR

- **The codebase is healthy at the surface.** `bun test` is green, typecheck is clean, no failing build. The findings below are the second-tier work that separates "ships and works" from "triple-A quality."
- **The dominant new debt is mirror-vs-native drift.** Chip rendering, pane-tree math, settings panel, panel renderers, and the `escapeHtml` helper all exist twice. Every UI touch is double work and a drift bug. Single biggest leverage: extract 4–6 shared modules under `src/shared/`.
- **Stringly-typed dispatch keeps creeping back in.** A 180-line action-string router in `index.ts`, `protocol-dispatcher.ts` typed as `any`, a 47-channel `window.dispatchEvent` event bus, and surface-kind-by-string-prefix all share the same shape: a typed boundary that someone bypassed. The `satisfies BunMessageHandlers` trick is the right pattern; it isn't applied everywhere.
- **The lifecycle story is "happy-path solid, failure-path neglected."** SIGKILL-without-SIGHUP, double-Ctrl+C re-entry, half-open WebSockets that survive 2 hours, dead `pi-agent` instances that linger in the manager, non-atomic settings writes — none of these break until exactly the moment a user is already frustrated.
- **`0.0.0.0` is a deliberate choice; the compensating controls aren't all there.** Token-entropy enforcement, brute-force throttle, security headers, sideband-HTML sandbox in the mirror, ping/pong dead-peer eviction, and Telegram outbound allow-list are the seven items that turn that choice from "convenient" into "responsibly convenient."
- **Triple-A polish is mostly accessibility and reduced-motion.** Modals lack `role="dialog"`/`aria-modal`/focus-trap/focus-restore. The workspace list isn't keyboard-reachable (`tabindex="-1"`). Reduced-motion respects only two CSS blocks out of dozens. Light-mode and high-contrast are absent. Web-mirror touch targets are below the 44 px minimum on phones.
- **Test breadth is great, depth is uneven.** 1531 tests at 10 s is impressive — but five of the six biggest UI modules (`sidebar.ts` 2523 LOC, `settings-panel.ts` 1856, `browser-pane.ts` 999, `terminal-effects.ts` 1011, `command-palette.ts`, `telegram-pane.ts`) have ~zero direct unit tests, and the bootstrap path that ties everything together is untested. There is no `--coverage` gate.

The five suggested PR clusters at the bottom mirror the cadence of the existing `tracking_full_analysis.md` work (F → "drift cleanup," G → "lifecycle correctness," H → "0.0.0.0 hardening," I → "AAA polish," J → "test depth").

---

## Severity scale

- **HIGH** — fix before next stable cut. Either a real failure mode under reachable input, a security gap that compensates for the `0.0.0.0` choice, or a cross-platform UX regression that disqualifies the app from "AAA."
- **MED** — schedule. Either creeping debt (god classes, duplication) that compounds with every UI feature, or a polish item with non-trivial user impact.
- **LOW** — when convenient. Future-risk, ergonomic, or rare-edge.

Categories used in the IDs:

- **A#** — Architecture / contract drift
- **L#** — Lifecycle / reliability / robustness
- **S#** — Security / external-surface hardening
- **U#** — UX polish / accessibility
- **T#** — Test coverage / test quality

---

## Findings — by severity

### HIGH

#### A1. Stringly-typed parallel RPC dispatcher next to the typed one

**File:** `src/bun/index.ts:2331-2508` (impl) + every `src/bun/rpc-handlers/*.ts`

`dispatch(action: string, payload: Record<string, unknown>)` is a ~180-line `if/else` chain on action strings that re-implements `setStatus`/`clearStatus`/`setProgress`/`clearProgress`/`log`/`runScript`/`renameSurface`/`notification`/`createBrowserSurface`/… already covered by typed handlers. Each branch casts `workspaceId as string` from the untyped record. The whole `rpc-handlers/*` split — and the `satisfies BunMessageHandlers` compile-time gate — is bypassed by this second router.

**Fix:** Replace `dispatch` with a typed `WebviewActionEnvelope` discriminated union (mirror of `socketAction` payload shapes) so adding a case is a compile error, not a string typo. Cluster F.

#### A2. `protocol-dispatcher.ts` types `Payload = any`, defeating the broadened `ServerMessage` union

**File:** `src/web-client/protocol-dispatcher.ts:44`

The `ServerMessage` union work landed in commit `d4d2e04` (B3 from the previous sweep) is cosmetic until the dispatcher takes `ServerMessage` and switches on `msg.type` to narrow `payload`. Today, the dispatcher receives broadened envelopes but still indexes `p.surfaceId`/`p.audit`/etc. on `any`. A future server-side payload-shape change won't fail the client typecheck.

**Fix:** Change the dispatcher signature to `(msg: ServerMessage)` and switch on `msg.type`, narrowing `msg.payload` per branch. Bonus: enables `noFallthroughCasesInSwitch`. Cluster F.

#### A3. Surface kind detected four different ways

**Files:**
- `src/bun/index.ts:578-595, :2064-2071` — `id.startsWith("tg:") || piAgentManager.isAgentSurface(id) || browserSurfaces.isBrowserSurface(id)`
- `src/shared/types.ts:19` — `PaneLeaf.surfaceType?: "terminal" | "browser" | "agent" | "telegram"` (optional, even though every consumer requires it)
- `WorkspaceSnapshot` / `PersistedWorkspace` — parallel `surfaceTypes` map

"What kind of surface is this?" is answered four different ways: substring on id, manager-membership query, optional `surfaceType` field, and the `surfaceTypes` record. The `tg:` prefix is the only authoritative tag for telegram surfaces and it's a string convention. Adding a fifth surface kind is a 6-edit landmine.

**Fix:** Make `PaneLeaf.surfaceType` required. Route every "what kind?" through a single `getSurfaceKind(surfaceId): SurfaceKind | null` that consults a unified registry. Drop the `tg:` prefix check. Define `export type SurfaceKind = "terminal" | "browser" | "agent" | "telegram"` once and reference it from every site (currently duplicated in 4 interfaces). Cluster F.

#### A4. Pane-bar chip rendering fully duplicated between native and web mirror

**Files:**
- `src/views/terminal/surface-manager.ts:2503-2686` — `renderSurfaceChips`, `chipsSignature`, `fillGitChip`, `formatGitTooltip`
- `src/web-client/main.ts:800-905` — `renderPaneChips`

Two parallel implementations of `command/cwd/git/port` chip rendering, with subtly different truncation, tooltip text, and click handlers. CSS classes match by convention only. The web one types `meta: any`. Adding a chip kind requires editing both.

**Fix:** Extract a framework-free `renderChips(host, meta, opts)` into `src/shared/chip-render.ts` (DOM-only, no xterm dep). Both consumers import it. Cluster F.

#### A5. Pane-tree rect computation has two implementations with diverged gap math

**Files:**
- `src/views/terminal/pane-layout.ts:101-152` — `PaneLayout.computeRects` reads module-level state via `setPaneGap`
- `src/web-client/layout.ts:32-95` — `computeRects` takes gap as a parameter

Two pure tree-walkers with different gap math. Drift here = panes don't line up between native and the mirror. The web version is the better design (param-injected); the native version regressed.

**Fix:** Move `computeRects` to `src/shared/pane-layout-math.ts` as a pure function; have both consumers wrap it. The native `PaneLayout` class can keep its mutation methods; remove the module setter. Cluster F.

#### A6. 47+ implicit `window.dispatchEvent` channels with no schema

**Files:** Across `src/views/terminal/` — 124 `dispatchEvent`/`new CustomEvent` sites and 25 `window.addEventListener("ht-…")` calls in `index.ts` alone (verified via `grep -rn` on 2026-04-29). Channels include `ht-agent-prompt`, `ht-browser-zoom`, `ht-statuses-changed`, `ht-notify-state-changed`, `ht-clear-logs`, `ht-workspaces-changed`, `ht-surface-focused`, etc.

A renaming refactor is impossible to do safely — adding a typo at the dispatch site silently no-ops at the listener. Module boundaries pretend to be clean while everything is actually coupled through a global broadcast channel.

**Fix:** Introduce a typed `EventBus<EventMap>` in `src/views/terminal/event-bus.ts` keyed on a literal-string union; replace `window.dispatchEvent`/`addEventListener` with `bus.emit/on`. Co-locate the union with handler signatures. Cluster F.

#### A7. Variant modules reach into SurfaceManager via four `window` globals

**Files:**
- `src/views/terminal/index.ts:312, :1219` — sets `__tauSurfaceManager`, `__tauNotifyWorkspaces`, `__tauFocusedSurfaceId`
- `src/views/terminal/variants/atlas.ts:105, :111, :303, :446, :453, :558` — reads them
- `src/views/terminal/variants/cockpit.ts:101, :141`

The variant chrome dodges a circular import by reaching into private SurfaceManager state via a global cast. Exactly the coupling the directory split was meant to prevent.

**Fix:** Pass a small `VariantContext` interface (`getActiveWorkspace`, `getFocusedSurfaceId`, `getNotifyWorkspaces`, `selectWorkspaceById`) into `VariantController` at construction. No globals. Cluster F.

#### L1. PiAgentManager dead instances leak — `onExit` is never wired

**Files:**
- `src/bun/index.ts:243` — `new PiAgentManager()` constructed with no `.onExit = …` assignment
- `src/bun/pi-agent-manager.ts:524` — the unwired manager-level `onExit` field
- `src/bun/pi-agent-manager.ts:205-206` — instance-level exit handler flips `this.dead = true` and fires `this.onExit?.(code)` but the manager-level callback is null, so nobody removes the entry

When a `pi --mode rpc` subprocess crashes, OOMs, or exits unexpectedly (without the user closing the surface), the dead `PiAgentInstance` stays in `PiAgentManager.instances` forever. `getAgent(id)` keeps returning a corpse whose `send()` throws `"Agent process is not running"`. The user sees a frozen agent surface and the manager grows by one entry per crash.

**Fix:** `piAgentManager.onExit = (id) => { piAgentManager.removeAgent(id); rpc.send("agentSurfaceCrashed", { surfaceId: id }); }`. Cluster G.

#### L2. PTY destroy uses raw SIGKILL — child processes lose all cleanup

**Files:**
- `src/bun/pty-manager.ts:275-294` — `destroy()` calls `this.proc.kill(9)` directly at `:282`, no SIGHUP/SIGTERM step
- `src/bun/session-manager.ts:353-360` — `destroy()` iterates surfaces and fans out to `surface.pty.destroy()` (call site `:357`)

On app quit or surface close, every shell descendant gets SIGKILL with no chance to flush, save, or unwind. Editors lose buffers; long-running scripts skip `trap` handlers; spawned daemons (e.g. dev servers) become orphans inheriting init. Conventional terminal emulators send SIGHUP first.

**Fix:** `kill(SIGHUP)`, await `proc.exited` race against ~500 ms, then SIGKILL only if the child is still alive. The 2 s `gracefulShutdown` watchdog already covers the upper bound. Cluster G.

#### L3. No WebSocket heartbeat — half-open connections survive ~2 hours

**Files:**
- `src/bun/web/server.ts` — no `idleTimeout` or `sendPings` on `Bun.serve.websocket`
- `src/web-client/transport.ts` — no client-side ping

A phone going to sleep on cellular (or a NAT silently dropping the flow) leaves both sides in `OPEN` state. The server keeps buffering output into the per-session 2 MiB ring (until truncation), the client thinks it's connected. The backpressure-kick at `WS_STALL_KICK_MS=10s` only fires once buffered bytes pile up — a quiet session never trips it. Bun's WS supports both controls; neither is configured.

**Fix:** `Bun.serve.websocket: { idleTimeout: 60, sendPings: true }`. Client sends a `{type:"ping"}` envelope every ~25 s; force a reconnect if no message arrives within 2 ping intervals. Cluster G/H.

#### L4. Unix socket buffer is unbounded — local DoS via no-newline write

**File:** `src/bun/socket-server.ts:69`

`socket.data.buffer += text` with no size cap. A local client (or a buggy `ht` retry loop) that writes bytes without a `\n` will grow the per-connection buffer until OOM. Owner-only `chmod` limits this to local-user attacks, but a runaway `ht` script could still wedge the whole app.

**Fix:** Drop the connection (or reset the buffer with an error response) when `socket.data.buffer.length` exceeds, e.g., 1 MiB. Cluster G.

#### L5. WebSocket reconnect has no jitter and no max-attempt cap — thundering herd

**File:** `src/web-client/transport.ts:159-162`

`reconnectDelay = Math.min(reconnectDelay * 2, 30000)` doubles deterministically to 30 s, then loops forever. When `bun start` restarts the host, every web mirror (phone + laptop + tablet) reconnects in lockstep. A permanently-wrong token retries every 30 s forever, leaking console-warn lines.

**Fix:** ±25 % jitter on the timeout; stop retrying after, say, 30 attempts with a "click to reconnect" UI. Cluster G/H.

#### L6. `gracefulShutdown` is not idempotent — a second SIGINT mid-shutdown re-enters every step

**Files:**
- `src/bun/index.ts:2982` — function definition
- `src/bun/index.ts:3067-3068` — `process.on("SIGINT", () => void gracefulShutdown())`

Hitting Ctrl+C twice (impatient user when shutdown stalls) starts a parallel shutdown: two `forceLayoutSync` round-trips, two `saveLayout()`s racing on the same JSON, two `socketServer.stop()`s, two `telegramDb.close()`s. The hard-exit watchdog will pull the plug at 2 s, but corrupted writes can land first.

**Fix:** Top-of-function guard: `if (shuttingDown) { process.exit(1); } shuttingDown = true;`. Cluster G.

#### L7. Settings / cookie / history writes are non-atomic

**Files:**
- `src/bun/settings-manager.ts:54` — `writeFileSync(this.filePath, …)`
- `src/bun/cookie-store.ts:257` (`saveNow`), `:339-344` (`saveSync` → `writeFileSync`)
- `src/bun/browser-history.ts:101` (`saveNow`), `:176-181` (`saveSync` → `writeFileSync`)

A crash during the synchronous write produces a truncated JSON. The `load()` path backs up `*.bak` and starts from defaults — the user loses their last save (theme, shell path, telegram token, browser cookies, browser history).

**Fix:** Write to `${filePath}.tmp`, fsync, then `renameSync` — atomic replace on POSIX. Cluster G.

#### S1. Bot token + handshake URLs end up in the daily log file

**Files:**
- `src/bun/logger.ts:124, :141` — `openSync(activePath, "a")` with no mode arg (defaults to 0o666 + umask = typically 0644)
- `src/bun/index.ts:240` — `new SettingsManager(configDir, settingsFile)` (settings file opened with default mode in turn)
- `src/bun/index.ts:256` — `new TelegramDatabase(...)` (sqlite file opened with default mode)
- `src/bun/cookie-store.ts:344` and `src/bun/browser-history.ts:181` — same pattern

The logger tees stdout/stderr to `~/Library/Application Support/hyperterm-canvas/log/<date>.log`. Any local user, any cloud-sync agent that ingests `Application Support`, can lift the bot token, the resume URL, and the contents of `cookie-store.json`.

**Fix:** `chmodSync(activePath, 0o600)` after `openSync`. Apply the same to settings file, `telegram.db`, `cookie-store.json`. Cluster H.

#### S2. Sideband `html`/`svg` rendered with `innerHTML` in the LAN-visible mirror

**File:** `src/web-client/panel-renderers.ts:96-102`

`renderSvg` and `renderHtml` set `contentEl.innerHTML` directly, broadcast over the same origin as the auth-bearing WebSocket. CLAUDE.md accepts this trust model in the *native* webview (script source = local user), but the network-exposed mirror is a different boundary. Any process inside the user's terminal — a careless `curl | sh` install, an npm postinstall, a Homebrew formula — can write to fd 4 and inject script that runs in the mirror page's origin. Same origin = the auth token, the resume-id, `localStorage`.

**Fix:** Render `html`/`svg` panels into an `<iframe sandbox="allow-same-origin">` srcdoc on the mirror only; ship a strict CSP (`default-src 'self'; frame-ancestors 'none'; object-src 'none'`). Cluster H.

#### S3. No size cap on web-mirror → Telegram outbound text

**File:** `src/bun/web/server.ts:985-991` (`telegramSend` case → `sendTelegramAndBroadcast`)

Accepts any `text: string` up to the 256 KiB frame cap and forwards. Telegram's 4096-char limit returns `ok:false` per call, but the per-chat 1 msg/sec bucket only throttles after persistence — nothing prevents flooding the on-disk SQLite log with 256 KB rows until the disk fills.

**Fix:** Reject `text.length > 4096` in the `telegramSend` case (and also in `sendTelegramAndBroadcast` for defense in depth). Cluster H.

#### S4. Empty / short auth token silently accepted on `0.0.0.0`

**Files:**
- `src/bun/web/server.ts:111-119` — `if (!this.authToken) return true;` (auth disabled on empty)
- `src/shared/settings.ts:806` — only `trim()`s; no minimum length

The "no auth" warning at `web/server.ts:329` fires only if the token is exactly empty. A user-typed `password` or `1234` is silently accepted with no entropy floor.

**Fix:** When `webMirrorBind === "0.0.0.0"` and `webMirrorAuthToken.length < 16`, refuse to start with a clear error. Add a "Generate" button in the settings panel using `crypto.getRandomValues(new Uint8Array(24))`. Cluster H.

#### S5. No brute-force throttle on the auth-token check

**File:** `src/bun/web/server.ts:148-172`

The rate bucket only exists after `open()` (`connection.ts:95-107`). Unauthenticated WS upgrades and `GET /` fail fast and can be retried at any rate. Even a strong token shrinks under unlimited online guesses across thousands of clients on `0.0.0.0`.

**Fix:** Per-IP failed-auth counter (`Map<ip, {count, until}>`); after 10 failures in 60 s, return 429 with a 10-minute cool-off. Cluster H.

#### S6. No HTTP security headers on any route

**File:** `src/bun/web/server.ts:177-261`

Every `Response` sets only `content-type` + `cache-control`. No CSP, no `X-Frame-Options`, no `X-Content-Type-Options: nosniff`, no `Referrer-Policy`, no `Permissions-Policy`. A neighbor's malicious page can iframe `http://your-laptop.local:8080/` and clickjack into typing into your terminal.

**Fix:** Shared `securityHeaders()` returning `{"x-frame-options":"DENY","x-content-type-options":"nosniff","referrer-policy":"no-referrer","permissions-policy":"geolocation=(),microphone=(),camera=()"}` and merge into every `Response`. Cluster H.

#### S7. Telegram allow-list bypassed on outbound from the mirror

**Files:**
- `src/bun/web/server.ts:985-991` (`telegramSend` case) → `src/bun/index.ts:910-912` (RPC handler) → `src/bun/index.ts:1487` (`sendTelegramAndBroadcast`) → `svc.sendMessage` directly
- Allow-list at `src/bun/telegram-service.ts:593` (inbound callback dispatch) and `:632` (inbound message dispatch) is checked **inbound only**; outbound paths bypass it entirely

A token-holder on the LAN can use the bot to message any chatId the bot has spoken to (or has DM'd before), exfiltrating attention out of band.

**Fix:** Validate `chatId` against `db.listChats()` (or against `parseAllowedTelegramIds`) before forwarding from the mirror path. Cluster H.

#### U1. Modals lack `aria-modal` / `aria-labelledby` / focus trap / focus restore

**Files:**
- `src/views/terminal/settings-panel.ts:161`
- `src/views/terminal/process-manager.ts:66`
- `src/views/terminal/ask-user-modal.ts`
- `src/views/terminal/command-palette.ts`
- `src/views/terminal/prompt-dialog.ts`

Five overlays, none set `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, none trap Tab inside, and none restore focus to the previously-focused element on close. Tab leaks into the dimmed terminal beneath. Screen readers do not announce them as dialogs.

**Fix:** One `mountModal(el, { labelledBy })` helper that sets the ARIA, holds an internal Tab cycle, and stashes/restores `document.activeElement`. Cluster I.

#### U2. No `prefers-color-scheme` / `prefers-contrast` / `forced-colors`

**Files:** `src/views/terminal/index.css`, `src/web-client/client.css`, `src/shared/web-theme-tokens.css`

Zero matches for `prefers-color-scheme`, `prefers-contrast`, or `forced-colors` across all CSS (verified via `grep -rn` on 2026-04-29). Dark-only, no light-mode adaption, no Windows high-contrast support, no honoring of system contrast preference.

**Fix:** Add `@media (prefers-contrast: more)` raising borders/outlines and `@media (forced-colors: active)` mapping accents to `Highlight`/`ButtonText`. Cluster I.

#### U3. Reduced-motion coverage is partial

**Files:**
- `src/views/terminal/index.css:3896, :10983` — only two `@media (prefers-reduced-motion: reduce)` blocks
- `src/web-client/client.css` — zero blocks

Two blocks cover sidebar items only. Notification-overlay slide-in, glow pulse on chips, terminal-effects bloom updates, agent-panel running-dot animation, panel content cross-fade, overlay progress meter, `notify-glow` keyframes still animate.

**Fix:** Add a single global rule capping `animation-duration: 0.001ms !important; transition-duration: 0.001ms !important` inside one `prefers-reduced-motion: reduce` block, with explicit opt-outs for genuinely informative motion (running dot drops to a static color swap). Cluster I.

#### U4. Hardcoded Tailwind palette literals bypass theming

**File:** `src/views/terminal/index.css:813, 1003, 1267, 1311, 1318, 1514, 1552, 1557, 1625, 1635, 1907, 1912, 1935, 2384, 2389, 2399, 2411, 2436, 2813, 2913, 3401, 3421, …` — 30+ sites

`#86efac`, `#f87171`, `#fca5a5`, `#fecaca` for success/error/warning are sprinkled across the stylesheet. The Atlas variant (and any future theme) cannot recolor them; "danger red" stays the same Tailwind hue regardless of theme.

**Fix:** Add `--tau-success`, `--tau-danger`, `--tau-warning`, `--tau-success-fg/bg` semantic tokens in `tau-tokens.ts`, redefine each per variant, and replace the literals. Cluster I.

#### U5. Web-mirror touch targets below 44 px on phones

**File:** `src/web-client/client.css:1419-1425`

Inside `@media (max-width: 720px)`: toolbar button is 40×40, `.pane-bar-btn` is 32×32 — both below the Apple/Material 44 px minimum the comment in the file itself targets.

**Fix:** `.toolbar-btn` to 44×44 and `.pane-bar-btn` to 44×44 (or apply an `::after` invisible 44px hit-box) on phone breakpoints. Cluster I.

#### U6. Web mirror has no `visualViewport` handling — iOS keyboard hides composer

**Files:** `src/web-client/*.ts` — zero `visualViewport` usages (verified via `grep -rn` on 2026-04-29)

When the iOS soft keyboard appears, fixed-bottom UI sits beneath it with no offset. `interactive-widget=resizes-content` in the viewport meta only partly compensates and Safari ignores it.

**Fix:** Subscribe to `window.visualViewport.resize`; write `--vv-height` / `--vv-offset-bottom` CSS vars; pin keyboard-toolbar / composer to `bottom: var(--vv-offset-bottom)`. Cluster I.

#### T1. No coverage measurement at all

**Files:** `package.json` test scripts, `bunfig.toml`

No `--coverage` script, no CI gate; "1531 tests" is asserted but unmeasured against source LOC.

**Fix:** Add `"test:coverage": "bun test --coverage --coverage-reporter=lcov tests/"` and a follow-up `scripts/coverage-gate.ts` that fails when any `src/` file drops below a per-area floor. Cluster J.

#### T2. Five biggest UI files have ~zero direct unit tests

**Files:** `src/views/terminal/sidebar.ts` (2523 LOC), `src/views/terminal/settings-panel.ts` (1856 — only theme tab tested), `src/views/terminal/browser-pane.ts` (999), `src/views/terminal/terminal-effects.ts` (1011), `src/views/terminal/command-palette.ts`, `src/views/terminal/telegram-pane.ts`.

DOM rendering, resize gestures, log clearing, drag/drop, find-bar, devtools toggling, theme application, keyboard nav inside palette, telegram composer — all uncovered at the unit level (only validated by Playwright if at all).

**Fix:** happy-dom unit tests per module (mount, dispatch fixture state, assert DOM). For `terminal-effects.ts`, the WebGL parts are hard but the intensity-clamp curve and `destroy()` cleanup are pure and testable against a stub `WebGLRenderingContext`. Cluster J.

#### T3. `src/bun/index.ts` (3068 LOC) bootstrap is untested

**File:** missing tests for the cold-start sequence

Boot order — settings load → workspace restore via `tryRestoreLayout` → Telegram service start → metadata poller start → socket bind → web server bind — is exercised only by Playwright `persistence.spec.ts`. Unit-level: nothing.

**Fix:** Extract a `createBootstrapPlan(deps)` helper; unit-test that a malformed `layout.json`, missing `settings.json`, partially-truncated `cookies.json`, and a stale Telegram offset all degrade gracefully without throwing. Cluster J.

#### T4. No settings-migration / downgrade-safety tests

**File:** `tests/settings-manager.test.ts`

Only `applyBloomMigration` is covered. Persistence recovery is tested but not version-stamp migration paths; downgrade ("user opens an older app over newer settings.json") isn't tested at all. A future field rename will silently nuke user data.

**Fix:** Table-driven migration tests: input = `{schemaVersion: N, ...}` for each historical N, output = current `AppSettings`; round-trip `parseLegacySettings → DEFAULT_SETTINGS` for every known shape. Cluster J.

#### T5. Telegram offset persistence not tested across crash/restart

**Files:** `tests/telegram-service.test.ts`, `tests/telegram-db.test.ts`

DB tests cover `kv` round-trip; service tests cover happy/conflict/error paths — but no test instantiates `TelegramService` against a saved offset, kills it mid-poll, restarts with the same db, asserts no replay/no-skip. CLAUDE.md calls dedup+offset-persistence a load-bearing invariant.

**Fix:** Spin up a fake Telegram HTTP server; persist offset N; abort; restart — assert next `getUpdates` request uses `offset=N+1`, not `0`, and that previously-seen `tg_message_id`s are dedup'd. Cluster J.

#### T6. Surface-metadata diff emission correctness untested

**File:** `tests/surface-metadata.test.ts` (525 LOC) — parser-heavy, diff-light

README + CLAUDE.md emphasize "diff-based emit" but no test asserts that two identical `tick()` results produce **zero** `onSnapshot` events, or that a single field flip emits exactly one. With 56 tests on this module, this should be covered.

**Fix:** Stub `runSubprocess` to return identical fixtures twice; spy on `onSnapshot`; assert it fires exactly once. Mutate one field; assert second fire and that the diff payload contains that field only. Cluster J.

---

### MED

#### A8. `SurfaceManager` is a 2747-LOC god class

**File:** `src/views/terminal/surface-manager.ts:140-2502`

70+ public methods covering create/remove for 4 surface kinds, sidebar update coalescer, status pill cap eviction, script-run tracker, glow management, `notifyState` broadcast, browser zoom/find/cookies, font resize, theme application, layout coalescer. The "extraction not worth doing" verdict in `refactor-roadmap.md` § 7 underestimates the cost of leaving it: tests boot a stubbed xterm, but you cannot test "the workspace logic" without DOM. The class is the bottleneck for any concurrent UI feature.

**Fix:** Pull `WorkspaceCollection` (workspaces[] + active index + status-pills + scripts) out as a pure state class — no DOM. SurfaceManager becomes the DOM/xterm view that subscribes. Match the `store.ts` pattern the web mirror already uses. Cluster F (later phase).

#### A9. Dual broadcast (rpc.send + webServer.broadcast) inlined at ~40 sites

**File:** Across `src/bun/index.ts`

Every `rpc.send(...)` for `surfaceCreated`/`surfaceClosed`/`surfaceMetadata`/`sidebandMeta`/`sidebandData`/`telegram*`/`plans*`/`autoContinueAudit`/… is followed (or preceded) by an `app.webServer?.broadcast(...)` with a hand-translated envelope. Adding a new event type means remembering both lines plus the `ServerMessage` union plus the dispatcher. Order between the two pushes is informal.

**Fix:** `Broadcaster.emit(envelope)` interface that fans out to the rpc bridge and the web server in one call. Co-locate the envelope shape so a missing call to the second sink is unrepresentable. Cluster F.

#### A10. `bunMessageHandlers` (~600 LOC inline) — most handlers are 1-line passthroughs

**File:** `src/bun/index.ts:507-1133`

~38 of 80 handlers are 1-line agent passthroughs (`agentPrompt`, `agentAbort`, `agentSetModel`, … up to `agentExportHtml`). They could live next to `pi-agent-manager.ts` as a single registrar.

**Fix:** Move agent passthroughs to `registerAgentBunMessages(rpc, piAgentManager)` next to the existing `rpc-handlers/agent.ts`. Same for browser, telegram, ask-user. `index.ts` shrinks ~500 LOC. Cluster F.

#### A11. `validateSettings` is a 124-line decorator chain parallel to `DEFAULT_SETTINGS`

**File:** `src/shared/settings.ts:796-919`

Each field has clamp/coerce/typeof/default-fallback inline. Adding a field means editing the type, the default, and the validator separately; any drift silently ships. Tests can't enumerate the schema.

**Fix:** Field-descriptor table (`{ key, default, validator }`) → derive `AppSettings`, `DEFAULT_SETTINGS`, and `validateSettings` from one source. Cluster F.

#### A12. Settings panel duplicated native (1856 LOC) vs web (423 LOC), no shared schema

**Files:** `src/views/terminal/settings-panel.ts` vs `src/web-client/settings-panel.ts`

Each `AppSettings` field is rendered twice with different chrome and zero shared schema. Adding a field requires editing both panels manually + remembering to add to `validateSettings`.

**Fix:** Define a `SettingsSchema` once in `shared/`, drive both renderers from it. Validation falls out for free. Cluster F.

#### A13. `escapeHtml` reimplemented at least three times

**Files:**
- `src/web-client/sidebar.ts:21`
- `src/shared/plan-panel-render.ts:105`
- `src/design-report/render-html.ts:343`

Trivial helper but three copies = trust on each call site. One copy could quietly diverge (wrong escape for `'` etc.).

**Fix:** Move to `src/shared/escape-html.ts`. Cluster F.

#### A14. `dispatch("readScreen", …)` round-trips through the action-string bus instead of the typed channel

**File:** `src/bun/index.ts:2517-2540` — `pendingReads: Map<string, (value: any) => void>`, called from `surface.read_text`

The typed `requests.readScreen` already exists in `TauMuxRPC.webview.requests`. Two response paths exist: `readScreenResponse` (one-purpose) and `webviewResponse` (generic). New "read X" RPCs split between them.

**Fix:** Migrate `surface.read_text` to call `BrowserView.request("readScreen", …)` directly; delete the parallel pending-map plumbing. Cluster F.

#### L8. `command-palette.ts` adds a `document` keydown listener that's never removed

**File:** `src/views/terminal/command-palette.ts:126-135`

On hot reload (electrobun dev) or webview reload, the listener is re-added without removing the previous one — N reloads = N listeners, each capturing a different stale `this`.

**Fix:** Track via `AbortController` (like `browser-events.ts:108-167` already does), or push the disposer onto `lifecycleDisposers` (registry already exists at `src/views/terminal/index.ts:88`). Cluster G.

#### L9. Native pane-divider drag attaches `mouseup` to `document` without pointer-capture

**Files:**
- `src/views/terminal/surface-manager.ts:2483-2492` — divider drag
- `src/views/terminal/pane-drag.ts:144-145` — pane drag

Same class of bug as the web-mirror's N3 (already fixed there) but on the native side: a fast drag that releases over an iframe / Electrobun browser overlay misses `mouseup`, leaving a permanent listener pair until the next mouseup elsewhere. Symptom: panes "stick to the cursor."

**Fix:** Convert to pointer events with `setPointerCapture` on the divider element. Cluster G.

#### L10. `pi-agent-manager.ts` `send()` timeout never canceled — keeps event loop alive

**File:** `src/bun/pi-agent-manager.ts:317-325`

Even when the response arrives in under 30 s, the timeout fires later as a no-op. `kill()` doesn't reject pending waiters — if the proc was already dead, the exit-promise has resolved and pending waiters hang for the full 30 s.

**Fix:** Store the timer id alongside the waiter, `clearTimeout` on resolve / `kill()`. In `kill()`, drain `responseWaiters` with a synchronous reject. Cluster G.

#### L11. `domReadyDebounce` map leaks on surface close mid-debounce

**File:** `src/bun/index.ts:842-869`

When a browser surface fires `domReady` and is destroyed before the debounce expires, the timer entry stays in the `Map`. The closed surface's debounce eventually fires `cookieStore.getForUrl` and `rpc.send("browserInjectCookies", { surfaceId, … })` for a surface that no longer exists.

**Fix:** `domReadyDebounce.delete(surfaceId)` + `clearTimeout` in the `surface.close` / `browserSurfaceClosed` handler. Cluster G.

#### L12. Module-level timers never cleared on shutdown

**Files:**
- `src/bun/index.ts:121` — `plansBroadcastTimer`
- `src/bun/index.ts:1333` — `htKeysSeenTimer`
- `src/bun/index.ts:2585` — `autoContinueAuditTimer`
- `src/bun/index.ts:1143` — `domReadyDebounce` map
- `src/bun/app-context.ts:113` — `layoutSaveTimer`

None are cleared in `gracefulShutdown` (`index.ts:2982-3066`). When a save races shutdown, the 100/200/500/2000 ms callback can fire after `app.webServer` has been nulled mid-iteration, after `rpc.send` has lost its bridge, or — in tests/dev that re-import the module — keep the event loop alive.

**Fix:** `clearTimeout` for each at the top of `gracefulShutdown`, or `.unref()` them at creation since they're all debounced broadcasters with no semantic value at shutdown. Cluster G.

#### L13. `pbcopy` / `pbpaste` / `git` (audits) spawned without `await` or timeout

**Files:**
- `src/bun/index.ts:512-515` — `pbcopy` fired and forgotten
- `src/bun/index.ts:2276-2277` — `pbpaste` reads stdout but doesn't await `exited`
- `src/bun/audits.ts:57-68` — `defaultRunGit` awaits but has no timeout

A hung `git config --global` (e.g. NFS-mounted home) wedges the audit registry forever and never logs.

**Fix:** Route through the existing `runSubprocess` helper in `surface-metadata.ts` (or extract a shared one) that has timeout + reap semantics. Cluster G.

#### L14. `TelegramDatabase` re-prepares every statement; no `busy_timeout` PRAGMA

**File:** `src/bun/telegram-db.ts`

Every method calls `this.db.prepare(...)` inline (e.g. `:167`, `:230`, `:248`, `:289`, `:316`, `:323`, `:333`). Constructor at `:51-55` sets `journal_mode = WAL` and `synchronous = NORMAL` but no `busy_timeout`. Concurrent reader (read-side `telegram.history` RPC during the polling loop's insert) gets `SQLITE_BUSY` and throws.

**Fix:** Cache prepared statements as private fields (one per method); `PRAGMA busy_timeout = 5000`. Cluster G.

#### L15. Telegram offset-persist failure no longer silent (good) but doesn't disable polling

**File:** `src/bun/telegram-service.ts:431-449`

Now-logs (good fix to I4), but the loop continues without offset advance on a permanently-broken db (e.g. read-only filesystem). Next batch re-pulls the same updates; dedupe absorbs them; log spam grows at ~30 lines/min for a quiet bot and 100s/min during a chat.

**Fix:** After N consecutive offset-persist failures (say 5), set status to `error` and stop the loop until a `restart` is requested. Cluster G.

#### S8. All browser surfaces share one partition

**File:** `src/bun/browser-surface-manager.ts:50`

Every surface defaults to `persist:browser-shared`. Cookies are stored process-globally in `cookie-store.json` and matched by domain only. A login cookie set in a "personal" tab is auto-injected into a "work" tab on the same domain.

**Fix:** Default new surfaces to a unique partition name (`persist:browser-${id}`); per-partition cookies; chmod the file 0o600. Cluster H.

#### S9. `subscribeWorkspace` history replay is unauthenticated relative to subscriber

**File:** `src/bun/web/server.ts:1008-1023`

Any client can subscribe to any workspace and pull every surface's full xterm scrollback via `getOutputHistory`. No "this client only sees workspace N" model — the token is binary.

**Fix:** None for now. Document it in the trust model section of `doc/system-rpc-socket.md` so future scope-down (read-only / single-workspace tokens) has a hook. Cluster H (docs only).

#### S10. No max concurrent connections / sessions per peer

**File:** `src/bun/web/server.ts:46-55`

`clients: Set`, `sessions: Map` grow unbounded. Each session reserves up to 2 MiB ring buffer. A forgotten reconnecting phone holds N×2 MiB of resident memory plus N WebSocket sockets.

**Fix:** Cap `this.sessions.size` (e.g. 32); on overflow, close the oldest detached session. Cluster H.

#### S11. `manifest.json` and icons served pre-auth

**File:** `src/bun/web/server.ts:227-262`

`sw.js`, `manifest.json`, `icons/*` are served regardless of token. SW must remain public (registration scope), but `manifest.json` and the icon leak the app fingerprint to a port-scanner.

**Fix:** Gate `manifest.json` + icons behind `authorized()`. Cluster H.

#### S12. No origin allow-list for HTTP `GET /` (only WS upgrade)

**File:** `src/bun/web/server.ts:174-183`

`authorized()` is called but not `originAllowed()`; the latter only checks WS upgrade (`:154`). A malicious link `http://your-laptop.local:8080/?t=…` is served and bootstraps. `Sec-Fetch-Site: cross-site` on the HTML load is a useful signal currently ignored.

**Fix:** Reject `Sec-Fetch-Site: cross-site` on the HTML route (allow `none`/`same-origin`) when token auth is enabled. Cluster H.

#### U7. No persistent notification history

**File:** `src/views/terminal/notification-overlay.ts:62, :69`

`MAX_VISIBLE_PER_SURFACE = 3`. When >3 notifications land in a burst the older ones evaporate; no scrollback, no "see N earlier", no sidebar history view. A user who steps away misses everything.

**Fix:** Sidebar already renders a notifications section — also append every overlay payload there with a "see all" expansion (uncap the count, keep last 50 with timestamps). Cluster I.

#### U8. Error toasts auto-dismiss with no copy / no detail expansion

**File:** `src/views/terminal/toast.ts:44`

Error toasts disappear after 6 s; only content is `el.textContent = message`. Users cannot copy the error to paste in a bug report or read past the dismiss.

**Fix:** Clipboard icon button on `level === "error"` toasts; pause the dismiss timer on hover/focus; expose a "Recent errors" pane in the sidebar. Cluster I.

#### U9. Settings number/range inputs silently clamp

**File:** `src/views/terminal/settings-panel.ts:1505-1529`

`numberField` accepts any `parseFloat` value. Typing `99999999` or `-1` past the declared min/max emits the bad value to the bun side; user gets no visible "out of range" hint.

**Fix:** On input, clamp + flag the field with `aria-invalid`; show the limit and the clamped value (`"clamped to 65535"`). Cluster I.

#### U10. No "reset to default" / "show default beside current"

**File:** `src/views/terminal/settings-panel.ts` (only `:898` resets colors)

Sliders and number inputs don't surface their default. Once the user moves the bloom slider there's no in-app way to go back without remembering the original number.

**Fix:** Render `(default: 0.6)` in the row's note slot; small "↺" button next to each control that emits `DEFAULT_SETTINGS[key]`. Cluster I.

#### U11. No keyboard-shortcut cheat-sheet UI

**Files:** `src/views/terminal/keyboard-shortcuts.ts:4`, `index.ts:1549`

Inline comments document `id`/`description`/`category` "for a future help dialog" — nothing renders that array. Discoverability is purely tribal.

**Fix:** `?` palette command (or `⌘?`) opens a categorized two-column dialog rendered from `KEYBOARD_BINDINGS`. Cluster I.

#### U12. Sidebar workspace items use `tabindex="-1"`

**File:** `src/views/terminal/sidebar.ts:925`

Every workspace `item.setAttribute("tabindex", "-1")`. Keyboard-only users literally cannot Tab into the list; only mouse + palette.

**Fix:** Active workspace item `tabindex="0"`, others `-1`; handle ↑/↓ within the list (roving tabindex). Cluster I.

#### U13. No `⌘1..⌘9` workspace switch shortcut

**Files:** `src/views/terminal/keyboard-shortcuts.ts`, `src/views/terminal/index.ts`

iTerm, Warp, Wezterm, tmux all bind `⌘1..⌘9` to switch workspace/tab N. τ-mux requires the palette or sidebar click. The shortcut category exists but the bindings don't.

**Fix:** Nine `Binding<KeyCtx>` entries `⌘1..⌘9` switching to workspace by index. Cluster I.

#### U14. No drop-zone indicator / Escape-to-cancel on workspace drag-reorder

**File:** `src/views/terminal/sidebar.ts:1832-1861`

`dragstart`/`dragover`/`dragleave` fire but no visible drop indicator line, no ghost/placeholder element, no Escape-to-cancel handler, no `aria-live` announcement.

**Fix:** 2 px accent line at the calculated insert index during dragover; listen for keydown Escape on `document` while dragging; announce "Reordered to position N" via the existing status `aria-live` region. Cluster I.

#### U15. No IME composition guards on text-input handlers

**Files:** `src/views/terminal/command-palette.ts:641`, `settings-panel.ts:1500`, `ask-user-modal.ts`, `agent-panel-*.ts`

Only `web-client/dictation-input.ts` checks `compositionend`. Native-side text inputs filter on `keydown` (Arrow / Enter) without checking `event.isComposing`, so IME users can't safely use Enter to commit a Japanese / Korean / Chinese candidate without firing the action.

**Fix:** Guard every Enter / Arrow handler with `if (e.isComposing || e.keyCode === 229) return`. Cluster I.

#### U16. PWA manifest is bare

**Files:** `src/web-client/manifest.json`, `src/bun/web/page.ts:39-48`

One SVG icon (Android Chrome rejects in install scenarios), no `id` (host:port treated as different apps), no `screenshots` (PWA install card looks bare), no Apple splash images for non-default device sizes (current iOS install: black flash).

**Fix:** Generate 192/512 PNG icons + maskable 512 PNG; add `"id": "/"`; add `screenshots`; generate a small Apple-splash set (or accept the iOS default and document). Cluster I.

#### U17. Browser pane: no copy-URL, no `⌘L` to focus address bar

**File:** `src/views/terminal/browser-pane.ts:332, :806`

No `copyUrl|copy_url` handlers; selecting + ⌘C inside a webview-hosted address bar is awkward; no shortcut listed for "focus address bar."

**Fix:** 16 px copy icon next to the URL chip + `⌘L` to focus + select-all the address bar. Cluster I.

#### U18. Title-bar tooltips inconsistently include shortcut hints

**Files:** `src/views/terminal/index.html:25, :52, :59, :66, :73`; compare `src/views/terminal/surface-manager.ts:2036-2079`

Pane bar does it right (`"Split Right (Cmd+D)"`); titlebar uses bare labels (`"Command Palette"` / `"New Workspace"`) even though both shortcuts exist (`⌘⇧P`, `⌘T`).

**Fix:** Append the key hint to every titlebar `title=` attribute. One-line static fix. Cluster I.

#### T7. Real-PTY round-trip for fd 3/4/5 only via Playwright

**File:** `tests/integration-pipeline.test.ts` admits the gap upfront

The fd 3/4/5 production path (Bun-spawned child writing JSONL) is exercised end-to-end only by Playwright `sideband.spec.ts`. The unit pipeline never proves that `Bun.spawn → fd3 → SidebandParser → onMeta` works against a real subprocess.

**Fix:** Spawn a dedicated `tests/fixtures/sideband-emitter.ts` attached to a real PTY; capture fd 3 output through a `SidebandParser`; assert at least one well-formed metadata frame. Cluster J.

#### T8. Pane-tree split/merge invariants under-tested

**File:** `tests/pane-layout.test.ts` (~16 tests)

Covers happy paths. Missing invariants — no leaf with `surfaceId === ""`, every split has 2 children, removing all surfaces never produces an empty tree, fractional-divider drift after N random splits doesn't accumulate floating-point error.

**Fix:** Property-based: `fc.commands` over `splitSurface` / `removeSurface` / `moveSurface` / `setDividerRatio` for 1000 sequences; assert tree-structure invariants and `computeRects` sum equals container area within ε. Cluster J.

#### T9. Sideband-parser and `status-key` parser aren't fuzzed

**File:** `tests/parser-fuzz.test.ts` (400 LOC) covers `ps`/`lsof`/`cwds`/git/cookies via xorshift32

Sideband-parser, `status-key` parser, and the new web-mirror envelope dispatcher aren't fuzzed — exactly the modules that take untrusted input on the wire. No `fast-check` integration despite it being a perfect fit.

**Fix:** Extend the xorshift harness (or add `fast-check`) to feed random byte streams into `SidebandParser` and `parseStatusKey`, asserting "never throws + returns a typed result or null." Cluster J.

#### T10. `terminal-effects.ts` (1011 LOC, WebGL) has zero tests

**File:** missing tests for `src/views/terminal/terminal-effects.ts`

WebGL is hard to test, but the non-GL parts — `applySettings` clamp logic, intensity-curve math, lifecycle (`destroy()` clears RAF + listeners), `setPaused` semantics — are pure functions that *can* be tested.

**Fix:** Unit-test the bloom-intensity curve and `destroy()` cleanup against a stub `WebGLRenderingContext`; assert no `requestAnimationFrame` callback fires after `destroy()`. Cluster J.

#### T11. Mock-heavy `auto-continue-*` and `agent-panel-*` tests

**Files:** `tests/auto-continue-rpc.test.ts`, `tests/auto-continue-bridge.test.ts`, `tests/agent-panel-*.test.ts`

80+ auto-continue tests but most assert against in-memory engine + injected mocks; no integration test where the real `pi-agent-manager` JSONL stream actually drives the engine through to a status-bar update.

**Fix:** Single integration test that pipes a recorded JSONL transcript (fixtures/) into the manager and asserts the engine's emitted side-effects on a test bus. Cluster J.

#### T12. Web-mirror reconnect across token rotation untested

**Files:** `tests/web-resume.test.ts`, `tests/web-client-transport-token.test.ts`

Resume tests cover ring-buffer truncation and TTL expiry; token-scrub covers the URL strip. Nobody tests "server's auth token rotated while the client was disconnected" — the client should re-auth or fail visibly, not silently never reconnect.

**Fix:** Boot a fixture server with token A; connect; rotate to token B (server-side); drop the WS; assert the client either reconnects with the new token or surfaces an "auth failed" status — not a forever-spinning reconnect loop. Cluster J.

#### T13. Several timing-based tests will flake on busy CI

**Files:**
- `tests/rpc-handler-surface-wait-ready.test.ts` — `200/150ms` wall-clock waits
- `tests/socket-server.test.ts` — `3000ms`
- `tests/hardening*.test.ts`

Wall-clock timeouts on busy CI = flake risk. A 150 ms delay is the test-side equivalent of a race condition.

**Fix:** Refactor to deterministic — explicit `await stub.flush()` / event-driven `await once(emitter, "ready")` instead of `setTimeout(..., 150)`. Cluster J.

#### T14. Playwright web suite covers ~7 specs vs an extensive UI surface

**File:** `tests-e2e/{auth,protocol,resilience,security,stress,terminal,ui}.spec.ts`

Web mirror has touch gestures, PWA install, keyboard toolbar, dictation, settings panel, sidebar log clear, plan panel — none have a Playwright spec. Native suite (`tests-e2e-native/specs/`) is broader (~22 specs).

**Fix:** Add `tests-e2e/web-mirror-touch.spec.ts` and `tests-e2e/pwa-install.spec.ts` to gate the existing `web-mirror-touch-gestures.test.ts` / `web-mirror-pwa-and-notifications.test.ts` claims against a real Chromium. Cluster J.

---

### LOW

- **A15. `lifecycleDisposers` has no double-fire guard.** `src/views/terminal/index.ts:88-97` — flat array; `pagehide` + a manual `destroy()` call invokes the same disposer twice. Wrap each push in `once(fn)` or null entries after firing.
- **A16. `setPaneGap` is module-scoped state in native `pane-layout.ts`.** Two SurfaceManagers (e.g. a future detached window) would clash. Pass `gap` into `computeRects(bounds, gap)` like the web client. (See A5 — the same fix.)
- **A17. `surfaceTypes?: Record<…>` literal duplicated in 4 interfaces.** `src/shared/types.ts:19, :49, :522`; `src/bun/rpc-handlers/types.ts:35`. Define `SurfaceKind` once. (See A3 — the same fix.)
- **L16. `socketServer.start()` race window between probe and unlink.** The B5 fix acknowledges the forward race in a comment; reverse race (peer A probes empty, peer B binds, peer A races for the same path) is also reachable on slow disks. Add an `O_EXCL`-style file lock (`mkdirSync(${socketPath}.lock)`) bracketing the probe→bind transaction.
- **L17. `chmodSync(socketPath, 0o600)` runs *after* bind.** `src/bun/socket-server.ts:107` — same-uid TOCTOU. `process.umask(0o077)` around the bind closes it.
- **L18. `web/server.ts setNativeViewport` broadcasts after `stop()` is mid-call.** No early return when `this.server === null`. Wrap `broadcastEnvelope` and `wsSend` with `if (!this.server) return;`.
- **L19. Cookie/history saves race shutdown.** `src/bun/cookie-store.ts:339-353` and `src/bun/browser-history.ts:101+`: `saveNow()` clears the timer then writes, but a `set()` lands between `saveNow()` and `process.exit(0)` arms a fresh timer. Add a `closed` flag at top of `saveNow()`.
- **S13. `formatNotificationForTelegram` is plain-text, but `editMessage`/`sendRich` accept arbitrary `parseMode`.** `src/bun/telegram-service.ts:505-547`. `ask-user-telegram.ts:51-54` correctly escapes MarkdownV2, but a future caller with user-text + `parseMode:"HTML"` would render `<a href="javascript:…">`. Centralize escaping per parse mode.
- **U19. `terminal-effects.ts:508` clamps DPR at 2.** Soft halos on 3× retina (Studio Display, recent iPads). Raise the cap to 3 (or expose as a setting), gate on `navigator.hardwareConcurrency >= 8`.
- **U20. Notification overlay pulse / `notify-glow` keyframes not in reduced-motion block.** `src/views/terminal/index.css:3896-3917`.
- **U21. No "dismiss all" / "clear notifications" sidebar affordance.** `dismissAll()` exists internally (`src/views/terminal/notification-overlay.ts:368`); not exposed.
- **U22. Telegram chat history fetch shows no skeleton / spinner.** `src/views/terminal/telegram-pane.ts` — flips empty → populated with no in-flight indicator. 3 shimmer skeleton rows fix it.
- **U23. Panel content swap has no cross-fade.** `src/web-client/layout.ts`, `src/views/terminal/panel-manager.ts:165` — content blinks; 120 ms `opacity` cross-fade (gated on `prefers-reduced-motion`) fixes it.
- **U24. Settings panel >1500 LOC with no in-panel search.** Top-of-panel search input that hides non-matching `.settings-row` (text + label + note); `⌘F` in the panel focuses it.
- **T15. No test for cold-start with corrupt config dir.** Persistence recovery tested for `settings.json` only. Per-file fault-injection: write garbage, boot, assert empty defaults + one health-row error per corrupt file (`layout.json`, `browser-history.json`, `cookies.json`, `telegram.db`).
- **T16. Design-review baseline has no flakiness check.** `scripts/diff-screenshots.ts`. Add a `scripts/audit-design-stability.ts` that runs the report twice and fails on any image diff — flushes out non-determinism before it lands as a baseline.

---

## Themes & meta-observations

1. **Mirror-vs-native drift is the single biggest debt.** `chip-render`, `pane-layout-math`, settings panel, panel renderers, and the `escapeHtml` helper all exist twice. Every UI touch is double work and a drift bug. Cheapest leverage move: spend a focused PR pulling 4–6 functions into `src/shared/` with happy-dom tests. The pattern works well for `store.ts` and `web-protocol.ts` already — extend it.

2. **Stringly-typed dispatch keeps creeping back.** The `dispatch` action-string router (A1), the `protocol-dispatcher.ts` `any` payload (A2), the 47-channel window event bus (A6), and the surface-kind-by-string-prefix (A3) all have the same shape: a typed boundary that someone bypassed with a string and `any`. Each is a typo bug eventually. The `satisfies BunMessageHandlers` trick from `refactor-roadmap.md` is the right pattern; apply it everywhere.

3. **The lifecycle story is "happy-path solid, failure-path neglected."** SIGKILL without SIGHUP (L2), double-Ctrl+C (L6), half-open WS (L3), dead pi-agents (L1), non-atomic settings write (L7) — nothing breaks until exactly the moment a user is already frustrated.

4. **`0.0.0.0` is a deliberate choice; the compensating controls aren't all there.** Token-entropy enforcement (S4), brute-force throttle (S5), security headers (S6), CSP / sandbox for sideband HTML (S2), ping/pong eviction (L3), Telegram outbound allow-list (S7), file-mode 0600 on sensitive files (S1) are the seven items that turn that choice from "convenient" into "responsibly convenient."

5. **AAA polish is mostly accessibility and reduced-motion.** A11y (U1, U12, U13, U14, U15) is the single category where the codebase materially lags any commercial terminal. None of the five modals are screen-reader-correct; the workspace list isn't keyboard-reachable; reduced-motion is two CSS blocks out of dozens; light-mode and high-contrast are absent.

6. **Test breadth is great, depth is uneven.** 1531 tests at 10 s is impressive — but five of the six biggest UI modules (T2) have ~zero direct unit tests, and the bootstrap path that ties everything together (T3) is untested. A `--coverage` gate (T1) would expose this in 5 minutes.

---

## Suggested PR clusters

Numbered to slot into the existing PR sequence in `tracking_full_analysis.md` / `tracking_deferred_items.md` (their last numbered cluster is E; A.1, A.2 etc. are item suffixes inside).

### Cluster F — "drift cleanup" (one PR per item, sequenced)

Goal: make adding a feature one edit instead of two.

| F | Items | Effort | Risk |
|---|-------|--------|------|
| F.1 | A4 — `src/shared/chip-render.ts` extract; both consumers import | M | low |
| F.2 | A5 + A16 — `src/shared/pane-layout-math.ts` pure function; remove `setPaneGap` module state | M | low |
| F.3 | A13 — `src/shared/escape-html.ts` extract | S | low |
| F.4 | A3 + A17 — `SurfaceKind` shared type; `getSurfaceKind()` accessor; drop `tg:` prefix check | M | low |
| F.5 | A2 — `protocol-dispatcher` switches on `msg.type`, narrow `payload` per branch | M | low |
| F.6 | A11 + A12 — `SettingsSchema` field-descriptor table; drive both panels and validator | L | medium |
| F.7 | A1 + A14 — typed `WebviewActionEnvelope`; migrate `dispatch` and `pendingReads` | L | medium |
| F.8 | A6 + A7 — typed `EventBus<EventMap>`; `VariantContext` interface; remove `window.__tau*` globals | L | medium |
| F.9 | A9 — `Broadcaster` interface; collapse the ~40 dual-broadcast sites | M | low |
| F.10 | A10 — move agent / browser / telegram passthroughs out of `bunMessageHandlers` | M | low |
| F.11 | A8 — extract `WorkspaceCollection` from `SurfaceManager` | XL | medium |

### Cluster G — "lifecycle correctness" (one PR per cluster of 2-3 items)

Goal: fail-stop on the unhappy paths.

| G | Items | Effort | Risk |
|---|-------|--------|------|
| G.1 | L1 + L10 — wire `PiAgentManager.onExit`; cancel `send()` timeouts; drain waiters on kill | S | low |
| G.2 | L2 — SIGHUP-then-SIGKILL with grace window | M | low |
| G.3 | L6 + L12 — idempotent `gracefulShutdown`; clear all module-level timers at top | S | low |
| G.4 | L7 — atomic write helper (`writeFileAtomic`) used by settings/cookie/history | M | low |
| G.5 | L4 — bound `socket-server` per-connection buffer; drop on overflow | S | low |
| G.6 | L8 + L9 — `command-palette` + native pane drag use AbortController / pointer-capture | S | low |
| G.7 | L11 — `domReadyDebounce` cleanup on surface close | S | low |
| G.8 | L13 — shared `runSubprocess` with timeout for `pbcopy`/`pbpaste`/`git` | S | low |
| G.9 | L14 + L15 — Telegram DB cached statements + `busy_timeout`; halt on persistent persist-fail | M | low |
| G.10 | L16 + L17 + L18 + L19 — socket-bind lock, umask, `stop()` guards, save-on-close flag | S | low |

### Cluster H — "0.0.0.0 hardening"

Goal: turn the deliberate `0.0.0.0` choice from "convenient" into "responsibly convenient."

| H | Items | Effort | Risk |
|---|-------|--------|------|
| H.1 | S1 — file-mode 0600 on log, settings, telegram.db, cookie-store.json | S | low |
| H.2 | S6 — shared `securityHeaders()` helper | S | low |
| H.3 | S4 — token-entropy floor on `0.0.0.0` + "Generate" button | M | low |
| H.4 | S5 — per-IP failed-auth throttle (10 in 60 s → 429) | M | low |
| H.5 | L3 + L5 — WS `idleTimeout` + `sendPings`; client ping; reconnect jitter + max-attempt cap | M | medium |
| H.6 | S3 + S7 — outbound-text 4096 cap; outbound-chatId allow-list check | S | low |
| H.7 | S2 — sideband html/svg in mirror via sandboxed iframe + CSP | M | medium |
| H.8 | S8 — per-surface browser partition default | M | medium |
| H.9 | S10 + S11 + S12 — session count cap; gate manifest/icons; reject cross-site `Sec-Fetch-Site` | S | low |
| H.10 | S9 — document trust model in `doc/system-rpc-socket.md` | S | low |
| H.11 | S13 — centralize Telegram parse-mode escaping | S | low |

### Cluster I — "AAA polish"

Goal: a screen-reader-correct, motion-respectful, theme-coherent UI.

| I | Items | Effort | Risk |
|---|-------|--------|------|
| I.1 | U1 — `mountModal()` helper (aria-modal + focus trap + focus restore); apply to 5 modals | M | low |
| I.2 | U3 + U20 — global reduced-motion block; keyframe opt-outs for informative motion | S | low |
| I.3 | U2 — `prefers-color-scheme` light tokens; `prefers-contrast: more`; `forced-colors` | L | medium |
| I.4 | U4 — semantic color tokens (`--tau-success`/`--tau-danger`/`--tau-warning`); replace 30+ literals | M | low |
| I.5 | U5 + U6 — phone touch targets ≥44 px; `visualViewport` mobile composer pin | M | low |
| I.6 | U12 + U13 + U14 — sidebar roving tabindex; `⌘1..⌘9` workspace; drag-reorder polish | M | low |
| I.7 | U15 — IME composition guards on every text-input Enter handler | S | low |
| I.8 | U7 + U21 — sidebar notification history; "clear all" affordance | M | low |
| I.9 | U8 — error toast: copy-to-clipboard, pause-on-hover, "Recent errors" pane | M | low |
| I.10 | U9 + U10 + U24 — settings: clamp feedback, "reset to default", in-panel search | M | low |
| I.11 | U11 — keyboard cheat-sheet rendered from `KEYBOARD_BINDINGS` | M | low |
| I.12 | U16 — PWA manifest: PNG icons, maskable, `id`, screenshots, Apple splash | M | low |
| I.13 | U17 + U18 + U19 + U22 + U23 — browser pane copy-URL & ⌘L; titlebar tooltips; DPR cap; chat skeleton; panel cross-fade | M | low |

### Cluster J — "test depth"

Goal: a coverage gate, then fill the biggest holes.

| J | Items | Effort | Risk |
|---|-------|--------|------|
| J.1 | T1 — `bun test --coverage`; `scripts/coverage-gate.ts` with per-area floor | S | low |
| J.2 | T13 — replace wall-clock waits in 3 test files with deterministic flushing | M | low |
| J.3 | T2 (sidebar) — happy-dom unit suite for `sidebar.ts` | L | low |
| J.4 | T2 (settings-panel) — non-theme tabs + field→RPC pipeline tests | L | low |
| J.5 | T2 (browser-pane) — happy-dom unit suite for `browser-pane.ts` | M | low |
| J.6 | T2 (terminal-effects) — unit tests for clamp curve + `destroy()` | M | low |
| J.7 | T2 (command-palette) + T2 (telegram-pane) — fuzzy-rank + DOM mount tests | M | low |
| J.8 | T3 — extract `createBootstrapPlan(deps)`; fault-injection per file | L | medium |
| J.9 | T4 — table-driven settings-migration + downgrade tests | M | low |
| J.10 | T5 — Telegram offset crash-and-restart test against fake server | M | low |
| J.11 | T6 — surface-metadata diff emission test | S | low |
| J.12 | T7 — real-PTY fd 3/4/5 round-trip integration test | M | low |
| J.13 | T8 — pane-tree property tests with `fast-check` | M | low |
| J.14 | T9 — sideband-parser + status-key parser fuzz harness | M | low |
| J.15 | T10 — auto-continue end-to-end against a recorded JSONL transcript | M | low |
| J.16 | T11 — token-rotation reconnect test | M | low |
| J.17 | T14 — Playwright web specs for touch + PWA install | M | low |
| J.18 | T15 — cold-start fault-injection per config file | M | low |
| J.19 | T16 — design-review stability gate (run-twice-and-diff) | S | low |

---

## Effort and risk legend

(Same as `doc/deferred_items.md` for consistency.)

- **S** — < 30 min, single file, mechanical change.
- **M** — 1–3 hours, may touch 2–4 files and need a small test.
- **L** — half-day or more, needs design discussion and/or behavior change.
- **XL** — multi-day, RFC-class change.

- **Risk: low** — strictly more lenient or strictly clearer than before; no behavior shift for existing users.
- **Risk: medium** — small behavior shift behind a setting or in a clearly scoped path.
- **Risk: high** — touches a contract or default that ships to all users.

---

## Status: 5 clusters, 71 items

| Severity | Count |
|----------|-------|
| HIGH | 32 |
| MED | 31 |
| LOW | 16 (interleaved within clusters; see "LOW" section) |
| **Total** | **79** |

Item-count by category:

| Category | Count | Cluster |
|----------|-------|---------|
| A — Architecture / contract drift | 17 | F |
| L — Lifecycle / reliability | 19 | G |
| S — Security / external-surface | 13 | H |
| U — UX / accessibility | 24 | I |
| T — Tests | 16 | J |

(Some items appear in multiple categories' fix paths — e.g. L3 and L5 are co-fixed in cluster H.5.)

None of these are blocking the next stable cut by themselves. The HIGH items are what they sound like: each of them can be the first thing a user notices on a bad day. The MEDs are the quiet ones that compound. The LOWs are nice-to-have.

If you want a per-cluster execution plan in the format of `doc/deferred_items.md` (with files, tests, open questions, and PR ordering), say which cluster to expand and I'll write it as `doc/triple_a_cluster_<F|G|H|I|J>.md`.
