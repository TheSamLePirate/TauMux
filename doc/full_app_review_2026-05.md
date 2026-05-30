# τ-mux — Full Application Review & Improvement Report

**Date:** 2026-05-30
**Version reviewed:** 0.3.160
**Scope:** Whole repository — `src/bun/` (main process), `src/views/terminal/` (Electrobun webview), `src/web-client/` (web mirror), `src/shared/`, `bin/ht`, `tests/`, CI/build, docs.
**Method:** Multi-agent review — **18 subsystem + 10 cross-cutting reviewers** reading the actual source across two passes, then an **adversarial verification pass** that re-checked every high/critical claim against the code (part 2: 16 high/critical → **13 confirmed, 0 refuted, 3 partial/nuanced**). A subset of the most consequential claims was additionally **hand-verified at exact `file:line`** (Appendix A). **128 findings** across 18 areas. Findings are rated by severity (critical/high/medium/low), effort (S/M/L), and confidence.

> **How to read this.** §1 is the executive summary and the prioritized roadmap — start there. §2 collects the **critical/high** items that are independently code-verified. §3+ are the per-subsystem deep dives (every finding, including medium/low). §A is the hand-verification log with exact line numbers.

---

## 1. Executive summary

τ-mux is, at the macro level, a **well-architected and unusually disciplined** codebase for an "early-stage" project. The four-package split (`bun` / `views` / `web-client` / `shared`) is genuinely enforced — `src/shared/` is an acyclic leaf, `bun` never imports webview code, and the webview never imports bun internals. Cross-process traffic is funneled through a clean RPC contract with a `satisfies BunMessageHandlers` typecheck gate. The hard parts of a terminal emulator are done carefully: split-UTF-8 handling, pending-resize flush, graceful SIGHUP→SIGKILL escalation, back-pressure on the sideband parser, a defensive 1 Hz metadata poller that can never crash the main process, atomic settings writes, an iframe-sandboxed renderer for LAN-facing panel HTML, and a token + brute-force-throttle scaffold on the web mirror. There is a lot of real operational scar tissue baked in.

The problems cluster into a few clear themes:

1. **Security wiring gaps & fail-open defaults defeat defenses that already exist.** The most serious issues are not missing architecture — they're *unwired* architecture and *unsafe defaults*. The web-mirror auto-start path silently ignores the user's `webMirrorBind`/`webMirrorAuthToken` and serves **0.0.0.0 with no auth** (verified twice). A real **personal Telegram ID is hardcoded into every build's allow-list** (verified), and an empty allow-list **fails open**. The sideband iframe sandbox is bypassed by a parallel `innerHTML` path for inline panel data (verified). `setAuthToken` is dead code; the brute-force throttle keys on a spoofable header; the cookie `.tmp` and settings secrets have a brief world-readable window; cookies/tokens sit in plaintext at rest. These are mostly **S/M-effort** fixes with outsized payoff — every defense primitive needed already exists.

2. **"Idle CPU ~0" — the #1 stated priority — is not actually met.** The metadata poller spawns `ps`+`lsof` every second regardless of change; the WebGL bloom layer re-rasterises the whole grid on every cursor blink (verified) and keeps running for invisible background-workspace panes.

3. **Durable state is silently lost on the normal quit paths.** `gracefulShutdown` only runs on SIGINT/SIGTERM, which macOS GUI quits (window-close, ⌘Q, Dock) never deliver — Electrobun hard-exits first (verified). Layout/settings/cookies changed just before quit can vanish.

4. **Personal data & half-finished rename ship in every build.** Beyond the Telegram ID, `auditsGitUserNameExpected` defaults to a specific person, and user state is split across two brand names (config under `hyperterm-canvas/`, logs under `tau-mux/`).

5. **A handful of god objects** (`SurfaceManager` 131 methods, `Sidebar` 78 methods, `bun/index.ts` ~2,871 lines, `bin/ht` 2,341 lines) concentrate coupling and merge risk; the sidebar workspace-card DOM is forked between native and web.

6. **Tooling/dependency & CI gaps:** the webview runs `xterm@5.3.0` core with v6-era scoped addons whose types point at an *uninstalled* package (verified); no eslint/prettier wired (the packages are installed but dead); the release workflow ships binaries with **no typecheck/test gate** (verified); and the e2e removal took the web-mirror **auth/origin security tests** offline, not just pixel-diffs (verified).

None of the macro-architecture needs to change. The highest-leverage work is **closing the security wiring gaps and unsafe defaults, making idle truly idle, fixing the quit-path persistence, gating the release pipeline, and decomposing the 2–3 god objects** — most of it small, well-scoped, and directly aligned with the project's own stated priorities.

### 1.1 Prioritized roadmap

**Wave 0 — Ship-stoppers (do before the next release; almost all S):**
- Pass `webMirrorBind`/`webMirrorAuthToken` to the auto-start and port-change `WebServer` constructors via one `createWebServer()` factory; make those params **required** (drop the defaults) so omission is a typecheck error. *(C1 critical, S — verified ×2)*
- Default `telegramAllowedUserIds` to `""` and `auditsGitUserNameExpected` to `null`; make an empty allow-list **reject all**. *(C4 + H11.3 critical/high, S — verified)*
- Route the inline `meta.data` html/svg path through the sandboxed renderer (web + native); make the sandbox the *only* markup sink. *(C2 critical, S–M — verified)*
- Add a `verify` job (typecheck + `bun test`) the release `build-and-upload` `needs:`. *(high, S — verified)*
- Re-add the functional (non-pixel) e2e specs to CI as a third job. *(high, M — verified)*

**Wave 1 — Security hardening (mostly S):**
- Wire `setAuthToken`/bind into `updateSettings` so rotation/bind take effect live. *(high, S — verified)*
- Key the auth throttle on `server.requestIP()`, not the spoofable Host/XFF header. *(high, S — verified)*
- Create the atomic-write `.tmp` with `mode:0o600` (fixes cookies **and** settings-secret leak window); add `fsync` before rename. *(high+medium, S — verified)*
- Drop `file://` from the browser RPC navigate allowlist; add the 256 KiB eval cap (also closes the `addscript`/`addstyle` bypass). *(high+medium, S–M — verified)*
- Add a redaction pass to the logger; add a per-instance RPC socket token for mutating methods; move secrets to the OS keystore. *(high, S–M)*

**Wave 2 — Idle cost & lifecycle (the #1 priority):**
- Drop the bloom `onRender` subscription; gate effects on pane visibility. *(high, S — verified)*
- Subscribe to Electrobun `before-quit`; run synchronous persistence there (don't rely on signals). *(C3 critical, M — verified)*
- Adaptive idle backoff for the metadata poller; unfreeze Process Manager CPU/RSS; reorder auto-continue gates before `tryModel` + latch the runaway gate. *(high/medium, S–M — verified)*

**Wave 3 — Maintainability & dependencies:**
- Migrate the webview to `@xterm/xterm@6` (aligns core+addons, makes compat typecheck-enforced). *(high, M — verified)*
- Extract per-surface-kind controllers from `SurfaceManager`; share the sidebar card renderer; split `bin/ht`; centralize brand strings in `src/shared/brand.ts`; archive stale `doc/`. *(high/medium, M–L)*
- Wire eslint/biome; add Renovate + a vuln scan; delete the stale `package-lock.json`. *(medium, S)*
- Add a settings `schemaVersion` + migration runner; fix the `.ask-user-sheet` HCM selector. *(medium/high, S–M — verified)*

---

## 2. Critical & high findings (code-verified)

The table indexes the most important findings; full detail is in the per-subsystem sections (§3+). "✔ verified" means re-checked by hand against the source (see §A).

| # | Severity | Area | Finding | Effort | Status |
|---|----------|------|---------|--------|--------|
| C1 | **critical** | Web mirror | Auto-start & port-change ignore `webMirrorBind`+`webMirrorAuthToken` → 0.0.0.0, no auth | S | ✔ verified ×2 |
| C2 | **critical** | Sideband / web | Inline `meta.data` html/svg → raw `innerHTML`, bypasses iframe sandbox (LAN XSS) | S–M | ✔ verified |
| C3 | **critical** | Lifecycle | `gracefulShutdown` never runs on window-close/⌘Q/Dock-quit → silent state loss | M | ✔ verified |
| C4 | **critical** | Telegram | Default allow-list ships a hardcoded third-party Telegram user ID that can drive the terminal | S | ✔ confirmed |
| H0a | high | Security | Empty Telegram allow-list = accept-from-anyone (fail-open) | S | confirmed |
| H0b | high | CI/release | Release workflow ships binaries with no typecheck/test gate | S | confirmed |
| H0c | high | CI/testing | e2e removal took the web-mirror **auth/origin** tests offline, not just pixel-diffs | M | confirmed |
| H0d | high | Browser | `file://` navigation reachable over the socket → local file read / SSRF | M | confirmed |
| H0e | high | Browser | Cookies plaintext at rest; `.tmp` world-readable during write (also leaks settings secrets) | S–L | confirmed |
| H0f | high | Deps | `xterm@5` core + v6 addons typed against an uninstalled `@xterm/xterm` (compat by luck) | M | confirmed |
| H0g | high | Settings | Hardcoded personal data (Telegram ID + git username) in shipped `DEFAULT_SETTINGS` | S | confirmed |
| H0h | high | Logging | Logger tee has no redaction — a future telegram `catch` leaks the bot token to disk (latent) | S | partial |
| H0i | high | a11y | HCM/forced-colors CSS for the safety-critical ask-user modal targets a non-existent class | S | confirmed |
| H0j | high | Naming | Half-done rename — state split across `hyperterm-canvas/` (config) and `tau-mux/` (logs) | M | confirmed |
| H1 | high | Web mirror | Per-IP auth throttle keys on attacker-controlled header → shared bucket / bypass / self-DoS | S | ✔ confirmed |
| H2 | high | Web mirror | `setAuthToken` is dead code — runtime token rotation has no effect | S | ✔ verified |
| H3 | high | RPC/CLI | Any same-user process can inject keystrokes / shutdown via the 0600 socket | M | ✔ verified |
| H4 | high | Sideband | Native webview renders fd4 html/svg via raw `innerHTML`, no CSP (full-privilege sink) | M | ✔ verified |
| H5 | high | Perf | Bloom re-rasterises whole grid on every cursor blink → idle CPU ≠ 0 | S | ✔ verified |
| H6 | high | Perf | Background-workspace panes keep running WebGL effects on a `display:none` canvas | S | partial |
| H7 | high | Metadata | Process Manager CPU/RSS columns freeze (`metadataEqual` ignores cpu/rssKb) | M | ✔ verified |
| H8 | high | Agents | Auto-continue calls the LLM *before* cooldown/runaway gates → unbounded cost | S | ✔ verified |
| H9 | high | Lifecycle | SIGINT/SIGTERM graceful path races Electrobun's `forceExit` → truncated save | M | partial |
| H10 | high | Architecture | `SurfaceManager` is a 131-method god object every webview module routes through | L | partial |
| H11 | high | Architecture | Sidebar workspace-card DOM forked between native & web (already drifting) | M | partial |
| H12 | high | Agents | `PiAgentInstance` request/response machinery + ~25 wrappers are dead code | M | partial |
| H13 | high | Agents | Crashed pi-agent surface becomes a zombie UI that silently swallows input | M | partial |
| H14 | high | Metadata/testing | `tick()` orchestration entirely untested (only pure parsers covered) | M | partial |

_The H0x rows are the cross-cutting high/criticals from the security, telegram, browser, settings, testing/CI, deps, logging, a11y and docs passes; full detail in §§11–20. Verification: of the 16 part-2 high/criticals, **13 confirmed, 0 refuted, 3 partial** (severity/framing nuanced, not refuted)._

---

## 3. Architecture, modularity & duplication

**Assessment.** Strong macro-architecture (see executive summary). The `src/shared/` consolidation of status-key/status-render/notification-overlay/sidebar-state with native+web adapter projections is exactly the right reuse pattern and should be the template for the rest. Weaknesses are concentrated in a few god objects and one duplication the shared layer stopped short of.

### 3.1 (H10) Decompose `SurfaceManager` — a 131-method god object — *high, L*
- **Where:** `src/views/terminal/surface-manager.ts` (2,730 lines, 131 methods); browser pass-throughs at `1340-1414`; per-kind add/remove at `412-508`.
- **Problem:** Owns xterm instances, Sidebar, PanelManager, TerminalEffects, WorkspaceCollection, pane layout, drag controller, search bar, settings application, *and* the full lifecycle of five surface kinds (terminal/browser/agent/telegram/editor). 11 other webview modules depend on it. The 13 `browser*` methods are thin pass-throughs to already-separate `browserPane*` functions.
- **Impact:** Highest-coupling node in the webview graph; the bottleneck for testing and parallel feature work; merge conflicts concentrate here.
- **Proposal:** Extract per-surface-kind controllers (`BrowserSurfaceController`, `EditorSurfaceController`, `TelegramSurfaceController`, `AgentSurfaceController`) that `SurfaceManager` composes via a `SurfaceKindController` interface `{ create, createAsSplit, remove }`. The browser controller is the cheapest first extraction (logic already lives in `browser-pane.ts`). This also collapses the CLAUDE.md "Adding a non-PTY surface kind" shotgun-surgery checklist to "one controller + one registry entry."
- **Tech decision:** Registry of controller implementations over class inheritance — matches the project's stated "interface-heavy, minimal class inheritance" style.

### 3.2 (H11) Forked sidebar workspace-card DOM rendering — *high, M*
- **Where:** native `src/views/terminal/sidebar.ts:1396-1972` (+ `shortCwd` `3366`); web `src/web-client/sidebar/workspace-card.ts:211-455` (+ `shortenCwd` `340`, `formatMem` `310`).
- **Problem:** The M12–M15 plan hoisted the *data* projection into `src/shared` but **not** the card DOM rendering. Native has `buildCardHeader/MetaRow/StatRow/CwdRow/PanesList/StatusGrid/ProgressBar`; web reimplements them as `buildHeader/Meta/Stats/Cwds/Panes/Status/Progress`. They've **already diverged**: native `shortCwd` → `…/last2` vs web `shortenCwd` → `~/Users/x`; native `humanRss` vs web `formatMem` produce different strings.
- **Impact:** Every card change must be done twice and silently drifts. The web mirror is advertised as a "parity" surface but parity is now manual discipline. ~580 native card lines shadow ~250 web lines.
- **Proposal:** Move card builders into `src/shared/sidebar-card-render.ts` as pure functions taking `WorkspaceInfo` + a small deps bag (`createIcon`, callback hooks), exactly like `notification-overlay.ts` and `sidebar-manifest-card.ts` already do. Start by unifying the leaf helpers (`shortCwd`/`shortenCwd`, `humanRss`/`formatMem`) since the divergence there is clearly a bug.

### 3.3 (medium) `Sidebar` is a second god object — *medium, L*
- **Where:** `src/views/terminal/sidebar.ts` (2,766 lines / 78 methods); file explorer `1665-1855`; manifest cards `2876-2960`; drag-reorder `2167-2308`.
- **Problem:** Covers header+search+stats, card rendering, an embedded file explorer, package.json/Cargo manifest cards, status grids, sparklines, progress bars, notifications, logs, drag-and-drop reorder, keyboard nav, rename/pin/filter, and localStorage UI-state. The file explorer alone is an independent feature.
- **Proposal:** Split out `FileExplorerView`, a sidebar UI-state store (the `loadJson/saveJson/ensureUiState/...` cluster), and a `SidebarReorderController`. Dovetails with 3.2 — once cards are shared, the native Sidebar shrinks substantially.

### 3.4 (medium) `bun/index.ts` is a 2,871-line wiring god-module — *medium, L*
- **Where:** ~30 module singletons `118-325`; inline telegram orchestration `1024-1373`; 190-line `dispatch()` if/else `1940-2131`; five near-identical create/split surface pairs `801-978`.
- **Problem:** RPC handlers were correctly extracted to `rpc-handlers/`, but host wiring + telegram fan-out + surface-creation orchestration stayed inline and closes over module singletons (barely unit-testable). `createRpcHandler` has 9 positional params before the options bag.
- **Proposal:** (1) Extract a `TelegramOrchestrator` module; (2) replace `dispatch()` with a typed `Record<WebviewActionKind, (payload)=>void>` table keyed off `ActionPayloadByAction` for compiler-enforced exhaustiveness; (3) collapse the five create/split pairs into one kind-parameterized helper; (4) convert `createRpcHandler` positionals into a deps bag.

### 3.5 (low) `buildPaletteCommands` — one 600-line function, 118 inline commands — *low, S*
- **Where:** `src/views/terminal/index.ts:957-1559`.
- **Proposal:** Move the catalog into `palette-commands.ts` exporting `buildPaletteCommands(ctx)`, grouped by category, with a small callbacks `ctx`. Makes the catalog testable (unique ids, every command resolves) without booting the webview.

### 3.6 (medium) Per-surface-kind add/split/remove sprawl = shotgun surgery — *medium, L*
- **Where:** `surface-manager.ts:412-508`, `bun/index.ts:844-978`, `shared/webview-actions.ts:46-139`, plus a `tryRestoreLayout` branch.
- **Proposal:** A `SurfaceKind` descriptor (`idPrefix`, `createView`, `restoreFromPersisted`, `skipTerminalFit`) registered once; generic add/restore look it up. Turns the documented ~6-site checklist into "add one descriptor on each side" and makes leak-prevention (the restore branch) a required field rather than a thing to remember.

---

## 4. Bun main process, PTY session & lifecycle

**Assessment.** The PTY core is genuinely solid: streaming `TextDecoder` with final flush (no split-UTF-8 loss), pending-resize flush when the Bun handle arrives late, pre-handle write buffer, silent-process watchdog, graceful SIGHUP→500 ms→SIGKILL escalation. `SessionManager` is defensive (shell/cwd validation with fallbacks, spawn-failure → synthetic exit). The serious problems are at the **process-lifecycle** layer, not the PTY layer.

### 4.1 (C3) `gracefulShutdown` never runs on GUI quit → silent data loss — *critical, M*
- **Where:** `src/bun/index.ts:2870-2871` (only SIGINT/SIGTERM hooks), `2749` (def), `724`/`747` (programmatic `mainWindow.close()`); Electrobun `Utils.quit()`→`forceExit(0)`.
- **Problem:** The only hook that forces `saveLayout()`, `settingsManager.saveNow()`, `cookieStore.saveNow()`, `browserHistory.saveNow()`, `piAgentManager.dispose()`, `telegramDb.close()` is the signal handler. macOS GUI quits (window-close button, ⌘Q, Dock-quit, last-surface auto-close) never deliver those signals — Electrobun's own `window.close`→`quit()`→`native.forceExit(0)` hard-exits first. **No `before-quit`/window-close subscription exists anywhere in `src/`** (verified by grep).
- **Impact:** A just-made split/rename/cwd change, a settings tweak made right before quit, freshly-set cookies, and browser history are dropped on the *dominant* exit path. `tryRestoreLayout` rehydrates a stale snapshot. The elaborate shutdown machinery is effectively dead code for GUI quits.
- **Proposal:** Subscribe to Electrobun's `before-quit` and run the **synchronous** half of teardown there (`saveNow` variants already exist). Because `quit()` is synchronous and ends in `forceExit`, keep `app.workspaceState` continuously hydrated (the existing 100 ms `workspaceStateSync` debounce nearly does this) so `saveLayout()` is correct without the async round-trip — **or** set `runtime.exitOnLastWindowClosed:false`, hide on close, and drive the full async `gracefulShutdown()` yourself before calling `quit()`. Add a regression test asserting a settings/layout write survives a simulated `before-quit`.
- **Tech decision:** Electrobun owns the quit sequence and overrides `process.exit`; an Electron-style app cannot rely on POSIX signals for cleanup. The framework-blessed hook is `before-quit`, so durable-state writers must be synchronous-capable or window-close auto-quit must be disabled.

### 4.2 (H9) SIGINT/SIGTERM graceful path races Electrobun's `forceExit` — *high, M*
- **Where:** `src/bun/index.ts:2870-2871`; Electrobun worker also registers SIGINT/SIGTERM → `quit()` → `forceExit(0)`.
- **Problem:** Both the app and Electrobun register signal listeners; the runtime invokes all of them. The app's `await requestWebview("forceLayoutSync")` yields the event loop, letting Electrobun's synchronous handler reach `forceExit` and kill the process mid-save. Even the one "graceful" path can be truncated.
- **Proposal:** Don't rely on signal handlers in an Electrobun app — move teardown into `before-quit` (4.1). If signal handling stays for headless/CI, do only **synchronous** saves there (no `await`).

### 4.3 (medium) `runScript` writes the command after a fixed 600 ms guess — *medium, M*
- **Where:** `src/bun/index.ts:1959-1977`.
- **Problem:** Spawns a login shell then `setTimeout(() => writeStdin(cmd+"\n"), 600)`. On a heavy `.zshrc` (nvm/pyenv/oh-my-zsh/conda) 600 ms is routinely exceeded, so the command is typed into a half-initialized shell — swallowed, interleaved, or run before PATH/aliases are ready.
- **Proposal:** Replace the fixed delay with a readiness signal (inject a `precmd`/`PROMPT_COMMAND` sentinel and flush the queued command on first prompt), **or** pass `-l -c '<command>; exec $SHELL'` so the shell itself sequences after init. Option 2 removes the race for the common case.

### 4.4 (low) PTY termination doc contradicts the SIGHUP→SIGKILL implementation — *low, S*
- **Where:** `doc/system-pty-session.md:66-77` vs `src/bun/pty-manager.ts:275-305`.
- **Problem:** Doc says "Bun sends SIGKILL immediately"; code sends **SIGHUP first**, 500 ms grace, then SIGKILL. The doc's orphan-child reasoning is built on the false premise.
- **Proposal:** Update §4 to the real sequence; note scripts can usefully trap SIGHUP.

### 4.5 (low) `getOutputHistory` runs SerializeAddon synchronously on the main thread per rejoining web client — *low, S*
- **Where:** `src/bun/session-manager.ts:321-339`; hot path at `web/server.ts:698,1236,1287`.
- **Problem:** `serializer.serialize()` walks the full (2,000-line-capped) buffer synchronously on the single-threaded main process on every web-mirror connect/resync. A flaky client reconnect loop serializes every surface inline, briefly blocking PTY stdout dispatch.
- **Proposal:** Acceptable today given the cap, but cache the serialized snapshot per surface and invalidate on write, and/or rate-limit per-client full serializes. Document the synchronous cost.

### 4.6 (low) PTY env forces `LC_ALL=""` instead of omitting it — *low, S*
- **Where:** `src/bun/pty-manager.ts:136-153`.
- **Problem:** `LC_ALL: process.env["LC_ALL"] || ""` injects an explicit empty assignment when unset, which is not identical to absent for some locale paths. (Opposite intent from the poller, which correctly forces POSIX for *its own* subprocesses.)
- **Proposal:** Only include `LC_ALL` when non-empty; otherwise omit the key. A small helper dropping empty-string env entries covers both `LC_ALL` and `LANG`.

---

## 5. Metadata poller & process-metadata pipeline

**Assessment.** Exemplary, defensive engineering: single-poller fan-out keeps subprocess count at 1–3/tick regardless of surface count; pure, unit-tested parsers; `runSubprocess` drains stderr in parallel (no 64 KiB pipe-deadlock), 5 s timeout with kill+reap, returns `null` on every failure. **No command-injection surface** — every subprocess is argv-array `Bun.spawn`, never a shell string. The git-stall cooldown, `inFlight`/`stopped` fences, and warn-once-on-ENOENT are thoughtful.

### 5.1 (H7) Process Manager CPU/RSS columns freeze — *high, M*
- **Where:** `surface-metadata.ts:356-362` (`metadataEqual` compares only pid/ppid/command — verified), consumer `process-manager.ts:131-146,352-360`, wiring `views/terminal/index.ts:290-291`.
- **Problem:** `onMetadata` fires only when the tree **shape** changes; `ProcessManagerPanel.refresh()` is driven exclusively by that. While the tree is stable (a running dev server), the ⌘⌥P overlay's live CPU% and RSS are **frozen** at whatever they held when the tree last changed.
- **Impact:** The headline feature of the Process Manager — live CPU/MEM — is effectively non-functional for steady-state workloads. Quietly erodes trust in every number the tool shows.
- **Proposal:** Decouple "should we emit" from "is this UI-visibly different." Best: when the Process Manager (or Surface Details) overlay is **open**, have it register a "wants live cpu" subscription that bun honors by emitting that surface's metadata every tick regardless of `metadataEqual`, unregistering on close — keeps the steady-state channel quiet for the 99% case. Add a test asserting cpu/rss movement reaches the panel.

### 5.2 (H14) `tick()` orchestration is entirely untested — *high, M*
- **Where:** `surface-metadata.ts:520-645,675-725`; tests cover only pure functions.
- **Problem:** The 1 Hz orchestration (surface filtering, dead-snapshot eviction, tree/fg computation, port/cwd union, git/pkg/cargo resolution, prune-on-empty, gitCache eviction, emit decision) has **zero** coverage; the runners are module-private and not injectable.
- **Proposal:** Make `{ runPs, runPorts, runCwds, runGit }` injectable (default to real impls), then unit-test `tick()` with canned fixtures: emit-on-change, no-emit-on-stable, dead-surface eviction, empty-surfaces cache clear, multi-repo parallelism, and the cpu/rss behavior once 5.1 is fixed. Mirrors how `SessionsLike` is already a seam.

### 5.3 (medium) Idle CPU ≠ 0 — poller spawns subprocesses every second even with zero change — *medium, M*
- **Where:** `surface-metadata.ts:473-513,520-569`; visibility hook `webview-handlers/viewport.ts:66-70`.
- **Problem:** As long as ≥1 surface exists, every tick runs `ps -axo` (over **all** system processes, ~900 rows) + combined `lsof` (~60–85 ms warm) even when metadata has been byte-identical for minutes. The only throttle is 1000 ms→3000 ms when `document.hidden`. Sustained ~6–9% of one core on an idle-but-focused terminal — contrary to the #1 priority.
- **Proposal:** Activity-adaptive cadence: count consecutive no-emit ticks and back off 1 s→2 s→4 s (cap 5 s) while idle, snapping back to 1 s on first change or focus/keystroke (the `setPollRate` speed-up path already supports the snap-back). Keep the active rate at 1 s.

### 5.4 (low) Two `lsof` runners omit the POSIX-locale env the module documents — *low, S*
- **Where:** `surface-metadata.ts:848-868` (`runListeningPorts`), `898-913` (`runCwds`) vs `runPs`/`runGit` which pass `posixLocaleEnv()`.
- **Problem:** Currently harmless (`lsof -F pn` output isn't locale-formatted) but violates the documented "every parsed subprocess runs with LC_ALL=C" invariant and sets a trap for the suggested netstat migration.
- **Proposal:** Make `runSubprocess` apply `posixLocaleEnv()` by default and let callers opt out, so the invariant holds module-wide.

### 5.5 (low) `walkTree` has no cycle guard — *low, S*
- **Where:** `surface-metadata.ts:294-322`.
- **Problem:** Recurses with no visited set; a ppid cycle from PID reuse / non-atomic snapshot could stack-overflow inside the always-on tick. Caught by `tick`'s try/catch but would silently kill that tick's metadata and log noisily each second.
- **Proposal:** One-line `visited` set in `visit()`; add a 2-node-cycle test.

### 5.6 (low) Large pid lists joined into one `lsof` argv — ARG_MAX risk on big trees — *low, S*
- **Where:** `surface-metadata.ts:848-863,898-910`.
- **Proposal:** Cap/chunk the pid list above a threshold (e.g. 1,000) and merge parsed maps, or cap with a one-time warn.

---

## 6. RPC layer & the `ht` CLI

**Assessment.** Well-architected: domain-per-file `register*(deps)` merged by `createRpcHandler`; the `satisfies BunMessageHandlers` gate genuinely fails typecheck on an unwired method; socket is `chmod 0600` (verified); 1 MiB per-connection buffer cap; stale-vs-live peer probe before unlinking; process-global rejection net + per-handler try/catch means a throwing handler can't crash the main process. Good coverage invariants.

### 6.1 (H3) Any same-user process can inject keystrokes / shut down the app — *high, M*
- **Where:** `socket-server.ts:143-149` (chmod 0600 only — verified, no token), `rpc-handlers/surface.ts:259-278` (`send_text`→`writeStdin`), `rpc-handlers/system.ts:37-47` (`shutdown`).
- **Problem:** Access control is filesystem-only. Every process the user runs (any `npm install` postinstall, any dependency) can speak JSON-RPC. `surface.send_text` writes arbitrary bytes into a pane's PTY stdin; `send_key` can send Ctrl-C/Ctrl-D; `system.shutdown` kills the app. **Connecting is authorization.** The real risk is *same-user*, not other-user.
- **Impact:** A single compromised dev dependency running in any τ-mux pane can type `rm -rf …\r` into your *other* panes, exfiltrate, or shut the app down. Meaningful privilege escalation for a shell-orchestration tool.
- **Proposal:** Per-instance shared secret: random token at startup written to a 0600 `socket.token` under configDir; require it in a handshake or per-request `__token`. `bin/ht` reads the same file transparently (it already resolves the socket path the same way). Gate state-mutating methods behind the token; leave read-only methods open if desired.
- **Tech decision:** A filesystem-bound 0600 token mirrors ssh-agent / Docker-socket bootstrap trust and beats `SO_PEERCRED` (which can't distinguish same-user processes — exactly the threat here).

### 6.2 (medium) `browser.addscript`/`addstyle` bypass the 256 KiB cap that `browser.eval` enforces — *medium, S*
- **Where:** `rpc-handlers/shared.ts:187-197` (cap on `browser.eval` only), `browser-page.ts:239-258` (addscript/addstyle dispatch to the **same** `evalJs` action with no schema).
- **Proposal:** Add both methods to `METHOD_SCHEMAS` with the same `script`/`css` and `surface_id` maxLength. Factor a shared `BROWSER_SCRIPT_PARAM` spec. Add a coverage test asserting every method dispatching to `browser.evalJs` has a script-size schema.

### 6.3 (medium) `surface.kill_port` accepts any signal, unlike `kill_pid`'s whitelist — *medium, S*
- **Where:** `rpc-handlers/surface.ts:166-177` vs `101-116`.
- **Problem:** `kill_pid` restricts to a termination-family whitelist; `kill_port` passes `params['signal']` straight to `process.kill`, so `signal:'STOP'` freezes a tracked listener and `USR1/2` can trigger handler behavior.
- **Proposal:** Extract `ALLOWED_SIGNALS` + normalization into a shared helper used by both; add `kill_port.signal` to the schema.

### 6.4 (medium) Input validation is opt-in — ~6 of 80+ methods — *medium, M*
- **Where:** `rpc-handler.ts:195-196`; schemas in `shared.ts:164-197`; unvalidated examples `editor.ts:14-25`, `workspace.ts:25-28`.
- **Problem:** Only methods in `METHOD_SCHEMAS` (6 entries) are validated; everything else does `params['x'] as string` with no shape check — including security-relevant `editor` paths, `workspace` cwd, `script` command, `send_text`. Errors surface deep in dispatch with cryptic messages.
- **Proposal:** Make schemas the default contract for every state-mutating method (string/required/maxLength on surface_id, path, cwd, command, text, title, body); add a coverage test asserting every non-read-only method has a schema (inverse of the existing one). Consider co-locating each schema with its handler.

### 6.5 (medium) `bin/ht` is a 2,341-line single-file CLI with a monolithic switch — *medium, L*
- **Where:** `bin/ht:304-1096` (`mapCommand` ~790 lines), `126-301` (`mapBrowserSubcommand`), `1600+` (`formatOutput`).
- **Problem:** Flag parsing + two giant switches + ~10 `main()` interceptors + the whole presentation layer in one file. `parseFlags` mis-parses edge cases (a value starting with `--` read as a boolean; `-x` only fires at `length===2`; `--reason --foo` and negative-number values mis-parse).
- **Proposal:** Split into a thin entry importing per-domain `commands/*.ts` each exporting `{ match, map, format }`, with a shared `runRpc`/`formatOutput` core; replace `parseFlags` with a small declarative per-command spec.
- **Tech decision:** Keep it dependency-free (no commander/yargs) to preserve the <50 ms startup priority — a per-command spec object is enough structure.

### 6.6 (low) `runRpc` uses a fixed id and resolves on first line — *low, S*
- **Where:** `bin/ht:1108-1161` (always `id:"1"`, resolves on first parseable line; unconditional `clearTimeout` at 1157 vs guarded at 1143).
- **Proposal:** Generate a unique id per call and match `res.id`; guard the error-path `clearTimeout`. Removes latent multiplexing traps.

### 6.7 (low) `pendingBrowserEvals` can leak orphaned entries; no cap — *low, S*
- **Where:** `browser-cookies.ts:86-132` (has a 5 s cleanup) vs `browser-page.ts:224-229` (`snapshot` has **none**).
- **Proposal:** Always pair an insert with a TTL timeout; add a soft size cap; centralize insert+timeout in a helper.

### 6.8 (low) CLI error reporting flattens server error type to a bare string — *low, M*
- **Where:** `socket-server.ts:128-133`, `bin/ht:1145-1146,1586-1594`.
- **Problem:** `{ error: err.message }` → `Error: <message>`; no code, no method context — "unknown method" vs "validation failure" vs "handler threw" all arrive identical, so scripts can't branch.
- **Proposal:** Minimal JSON-RPC-style `{ code, message }` (-32601 unknown method, -32602 invalid params, -32000 handler error); map -32601 to the existing "unknown command" UX. Additive, back-compat via string fallback.

---

## 7. Sideband protocol (fd 3/4/5) & content-rendering security

**Assessment.** The parser is genuinely well-engineered: offset-based line scan with single tail slice, hard 16 MiB cap rejected *before* allocation, per-channel FIFO serialization, 64-deep backpressure guard, per-read timeouts, non-blocking meta dispatch. `EventWriter` has an in-flight high-water-mark with real metrics. Crucially, the web mirror **already** sandboxes html/svg in `<iframe sandbox="">` with strict CSP — exactly the right architecture. The problem is the defense is *incomplete*.

### 7.1 (C2) Inline `meta.data` html/svg bypasses the iframe sandbox (LAN XSS) — *critical, S–M*
- **Where:** `src/web-client/main.ts:1042,1093` (`contentEl.innerHTML = meta.data` — verified, both sinks), sandbox at `panel-renderers.ts:96-188`, server broadcast `web/server.ts:920`, type `shared/types.ts:271`.
- **Problem:** The sandbox fires only on the **binary** frame path. `SidebandContentMessage.data` (inline payloads < 2 KB, which most demo scripts use) is broadcast verbatim and rendered with raw `innerHTML`, bypassing the sandbox entirely. The mirror page's CSP allows `unsafe-inline` script, so `<img src=x onerror=…>` / `<svg onload=…>` executes in the mirror origin — which holds the auth token, localStorage, and a live WebSocket that can `writeStdin` to any pane.
- **Impact:** Any producer that can write fd 3/4 of any pane (curl|sh, npm postinstall, Homebrew formulae — the documented "trusted" producers) can push inline html and achieve cross-peer XSS against every connected web-mirror client on the LAN, exfiltrating the token and typing into the user's shells. Default bind is 0.0.0.0, so it's network-reachable. Reachable in *normal* operation (most demos use inline data).
- **Proposal:** Route the inline path through the same sandboxed renderer (`wrapInSandboxedShell`) — when `meta.type` is html/svg call the registry renderer instead of `innerHTML = meta.data`. Better: drop the inline `data` shortcut on the wire for the mirror and force all markup through fd4 binary so there's exactly one rendering path. Extend `web-client-panel-sandbox.test.ts` to cover the inline-meta path.
- **Tech decision:** Keep the iframe+CSP approach and make it the *only* html/svg path; it's strictly stronger than sanitization for arbitrary producer markup.

### 7.2 (H4) Native webview renders fd4 html/svg via raw `innerHTML`, no CSP — *high, M*
- **Where:** `content-renderers.ts:121-147`, `panel.ts:83-84,112-113`, `index.html:3-18` (no CSP meta).
- **Problem:** The native renderers do `contentEl.innerHTML = decode(data)` with zero sandboxing. The native webview holds the **Electrobun RPC bridge**, so injected script has far more reach than the mirror (it can drive the whole RPC surface). "Safe" only because of the local-trusted-script assumption — a load-bearing boundary asserted in CLAUDE.md but not surfaced at the sink.
- **Impact:** A single malicious/compromised local producer gets full webview script execution **with RPC access**. The team hardened the LAN-facing mirror but left the higher-privilege native sink fully open.
- **Proposal:** Promote `wrapInSandboxedShell` to `src/shared/` and reuse it natively (accepting the loss of interactive-panel event forwarding for sandboxed content); or strip `<script>`/handler attributes via a shared sanitizer + add a CSP to `index.html`; or, at minimum, document the native renderer as an explicit privilege boundary and gate html/svg behind a settings opt-in.

### 7.3 (medium) One slow/underflowing frame permanently wedges a data channel — *medium, M*
- **Where:** `sideband-parser.ts:350-361,218-234,78-98,301-306`.
- **Problem:** On read timeout or oversized-byteLength abort, `ch.aborted` is set and **never reset**; every subsequent read short-circuits via `onDataFailed`. Recovery requires the writer sending a `flush`, but the client libraries never auto-flush. So a single 5 s-slow frame silently kills all future panels on that channel for the process lifetime.
- **Proposal:** Emit a distinct actionable `onDataFailed` reason ("channel wedged: send flush") and have the client libs auto-flush on the next `show()`/`update()` after a `__system__` error; also clear `ch.queueDepth` on abort paths.

### 7.4 (medium) Protocol advertises a version but does no negotiation — *medium, S*
- **Where:** `sideband-parser.ts:157-264`, `shared/types.ts:219,254-276`.
- **Problem:** `HYPERTERM_PROTOCOL_VERSION='1'` is decorative — the parser never reads a version, never adapts on mismatch; `SidebandContentMessage` has no version field. A future framing change desyncs the binary stream rather than failing cleanly.
- **Proposal:** Either honestly document that only additive `type` changes are supported and framing is frozen at v1, or make the version load-bearing (read + reject on major mismatch via the existing `HYPERTERM_CHANNELS` handshake).

### 7.5 (low) Native image/canvas renderer feeds `data.buffer` instead of the typed-array view — *low, S*
- **Where:** `content-renderers.ts:88,173` (`new Blob([data.buffer])`), parser fast-path `sideband-parser.ts:425`.
- **Problem:** When bytes arrive as the single-chunk fast-path return (a subarray with non-zero `byteOffset`), `Blob([buffer])` ignores `byteOffset`/`byteLength` and includes garbage bytes — the exact bug the web client documents and **fixed** in `panel-renderers.ts:82-85`.
- **Proposal:** Mirror the fix: `new Blob([data], …)` so `Blob` honors the view.

### 7.6 (low) `doc/system-sideband-protocol.md` security section is stale — *low, S*
- **Where:** `doc/system-sideband-protocol.md:255-256`.
- **Problem:** Says underflow makes the parser "hang indefinitely" (false — there's a 5 s timeout) and "no sanitization" as a blanket claim (false for the mirror's sandboxed iframe; true for native + the inline-data hole).
- **Proposal:** Document the timeout+wedge+flush behavior; distinguish the sandboxed mirror path from the native raw-innerHTML path; flag the inline `data` path as the unsandboxed exception (until 7.1 is fixed).

---

## 8. Webview SurfaceManager, pane layout & rendering

**Assessment.** Well-engineered with clear evidence of prior perf passes: rect math deduped into one pure, parity-tested `shared/pane-layout-math.ts`; layout passes coalesced through a single rAF batcher with a positions-only fast path for divider drags; chip rendering guarded by `chipsSignature`; the bloom RAF loop is demand-driven (stops when no pulses and not dirty). xterm/effects/panel disposal ordering is correct. The main gaps are around **idle cost**.

### 8.1 (H5) Bloom re-rasterises the whole grid on every cursor blink — *high, S*
- **Where:** `terminal-effects.ts:343-347` (`onRender → markDirty` — verified), `surface-manager.ts:2238` (`cursorBlink: true` — verified), `rasterise()` `621-696`.
- **Problem:** xterm fires `onRender` each cursor-blink phase toggle (~600 ms) even on a fully idle pane. `markDirty` schedules a rAF; `rasterise()` has no early-out and walks **every cell** (rows×cols, e.g. 60×240 = 14,400 cells) plus a `getBoundingClientRect`. So an idle focused pane runs a full-grid CPU scan ~1.6×/s forever. The GPU `draw()` early-returns (cheap) but the CPU rasterise does not.
- **Impact:** Directly violates "idle CPU ~0." On a 4-pane workspace this is ~6 full-grid scans/s at rest, scaling with grid size and pane count — measurable battery drain for zero visible benefit.
- **Proposal:** Drop the `onRender` subscription entirely — `onWriteParsed`+`onScroll` (already subscribed at `terminal-effects.ts:345-346`) cover every content mutation the rasteriser reads; `onRender`'s only extra trigger is cursor blink/selection, which the occluder/lights pipeline doesn't consume.

### 8.2 (H6) Background-workspace panes keep running WebGL effects on a `display:none` canvas — *high, S*
- **Where:** `surface-manager.ts:806-812` (`writeToSurface` calls `pulseOutput` for **every** surface), `1853-1888` (`switchToWorkspace` hides via `display:none` but never disables effects), `terminal-effects.ts:403-414,428-438`.
- **Problem:** `effects.active` is driven only by the global bloom setting, never by visibility. A backgrounded workspace running a streaming process (build log, `tail -f`, agent stdout) keeps firing `pulseOutput → markDirty → rasterise + draw` into an off-screen canvas, capped at ~28 fps of entirely wasted work.
- **Proposal:** Gate effects on visibility — in `switchToWorkspace` call `view.effects?.setEnabled(inActive && terminalEffectsEnabled)` alongside the display toggle (mirror `browserPaneSetHidden`), or short-circuit `pulseOutput` for non-active-workspace surfaces. The `setEnabled` approach also fixes 8.1 for hidden panes.

### 8.3 (low) Split/new-surface has a fixed ~50 ms + double-rAF latency — *low, M*
- **Where:** `surface-manager.ts:696-709` (`scheduleLayoutForNewSurface` — two nested rAF + hardcoded `setTimeout(…,50)`).
- **Proposal:** Replace the fixed 50 ms with a readiness check (poll for measured cell metrics on the next rAF, bounded by a max-attempts fallback) — `fitSurfaceTerminal` already falls back safely when metrics aren't ready.

### 8.4 (low) `computeRects` can emit negative w/h for deep nesting with a gap — *low, S*
- **Where:** `shared/pane-layout-math.ts:47-87`; tests only cover single splits.
- **Proposal:** Clamp child w/h to `Math.max(0, …)` in `walk()`; add a 4+-level nested-tree parity test asserting non-negative, non-overlapping rects.

### 8.5 (low) `renderDividers` tears down + rebuilds all divider DOM + listeners every full layout — *low, M*
- **Where:** `surface-manager.ts:2594-2655` vs the signature-gated `applyPositions` at `2540-2592`.
- **Proposal:** Reposition existing divider elements keyed by split-node identity (attach mousedown once), or add a divider-set signature to skip unchanged rebuilds — matching the `layoutSig` pattern. Also fixes a stale-`bounds` closure.

### 8.6 (low) `findNeighbor` uses centroid Manhattan distance over a fixed 1000×1000 virtual layout — *low, M*
- **Where:** `pane-layout.ts:113-151`.
- **Problem:** Directional pane navigation can pick a diagonally-closer but not edge-adjacent pane in nested layouts, and ignores real container aspect ratio.
- **Proposal:** Compute against actual container bounds and switch to edge-overlap-aware selection (prefer candidates whose perpendicular extent overlaps the source edge, tie-break by gap distance); add a nested-layout test.

---

## 9. Web mirror (server + client)

**Assessment.** A genuinely well-engineered subsystem: pure, exhaustively-tested reducer store; transport with reconnect-with-jitter, token capture/URL-scrub, resume-via-delta-replay with a bounded ring buffer, backpressure with hysteresis, frame-size caps before `JSON.parse`, token-bucket rate limiter, session TTL + eviction caps, and the iframe sandbox. The protocol is versioned and the server stores a full snapshot for hydration. **But two serious security holes defeat much of this care, and every defense primitive already exists — these are wiring/coverage gaps.**

### 9.1 (C1) Auto-start & port-change ignore `webMirrorBind`+`webMirrorAuthToken` → 0.0.0.0, no auth — *critical, S*
- **Where (verified):** constructor `web/server.ts:129-137` (`bind="0.0.0.0"`, `authToken=""` defaults); `toggleWebServer` `index.ts:1906-1914` passes both (correct); `autoStartWebMirror` `index.ts:2493-2499` and `applyWebMirrorPort` `index.ts:2518-2524` pass **only 5 args**, omitting bind+token.
- **Problem:** The two paths that run on **normal launch** (auto-start when `autoStartWebMirror=true`, or whenever `HYPERTERM_WEB_PORT` is set) fall through to the least-safe defaults. A user who set `webMirrorBind:'127.0.0.1'` or a token in settings.json gets it **silently ignored**; the server logs "bound to 0.0.0.0 without auth. Anyone on your network can view and type in your terminal."
- **Impact:** Full unauthenticated read/write to every terminal from any host on the LAN, in direct contradiction of the user's explicit config. A LAN attacker connects to `http://victim.local:<port>/`, gets a snapshot of every surface, and types arbitrary commands. The complete auth code in `server.ts` is never reached because `authToken` is `""`.
- **Proposal:** Pass `settingsManager.get().webMirrorBind` and `webMirrorAuthToken` to **both** auto-start constructors. **Make `bind`/`authToken` required params (drop the defaults)** so every unwired call site becomes a typecheck failure. Add a test that constructs via the auto-start helper and asserts the server is unreachable without a configured token.
- **Tech decision:** Defaulting security-sensitive params to the least-safe value is a footgun; making them required turns this class of bug into a compile error.

### 9.2 (C2 dup) Inline sub-2 KB html/svg → `innerHTML`, bypasses the sandbox — *critical, M*
- Same root cause as §7.1, from the web-mirror angle. `web-client-panel-sandbox.test.ts` pins the **binary** path; the inline-meta path is unguarded. Fix: unify on the sandboxed renderer; extend the test.

### 9.3 (H1) Per-IP auth throttle keys on the server's own Host header — *high, S*
- **Where:** `web/server.ts:157-164` (`clientIp` falls back to `headers.get('host')` — the server's host:port, identical for all clients), `296-302`, `278` (the `server` arg with `server.requestIP(req)` available but **never called** — only referenced in a comment).
- **Problem:** `AUTH_FAIL_LIMIT` (10 fails/60 s → 10 min 429) is enforced on **one shared bucket** for all LAN clients. An attacker who fails auth 11× trips the cooldown and **429s every legitimate user** (self-DoS); distinct attackers are never isolated.
- **Proposal:** Use `server.requestIP(req)?.address` as the primary key, falling back to `x-forwarded-for` only behind a trusted proxy; never use Host as the primary key. Add a test driving two synthetic IPs.

### 9.4 (H2) `setAuthToken` is dead code — runtime token rotation has no effect — *high, S*
- **Where (verified):** `web/server.ts:143-146` (exists), grep shows **no caller**; `updateSettings` `index.ts:2311-2320` re-broadcasts settings but never threads `webMirrorAuthToken`/`webMirrorBind` into the live server.
- **Problem:** A user who adds/rotates a token while the mirror is running keeps serving with the old/empty token until full restart — and given 9.1, often with no token at all. No runtime path to apply a bind change either.
- **Proposal:** In `updateSettings`, on `webMirrorAuthToken` change call `webServer.setAuthToken(next)`; on `webMirrorBind` change stop+reconstruct; clear the `authFails` map on token change. Add a test asserting rotation causes a previously-valid request to 401.

### 9.5 (medium) Stale `lastSeenSeq` across server restart breaks resume; `connection/reset` never dispatched — *medium, S*
- **Where:** `web-client/protocol-dispatcher.ts:69-82`, `store.ts:225-248`, `transport.ts:234-235`.
- **Problem:** On server restart the new session's seq starts at 0, but the hello handler **keeps** the old high watermark, so `connection/seq` (`seq <= lastSeenSeq` guard) freezes and never advances; the client then requests a resume window that doesn't exist. The reducer has a `connection/reset` action intended for exactly this — never dispatched.
- **Proposal:** Detect a `serverInstanceId` change on hello (or unconditionally) and dispatch `connection/reset`, then set `lastSeenSeq` to -1. Add a two-hello-different-id test.

### 9.6 (medium) Multiple clients fight over PTY size — *medium, M*
- **Where:** `index.ts:2429-2432` (`onSurfaceResizeRequest`→`resize`+broadcast), `web-client/main.ts:631-668,1197-1206`, `web/server.ts:1204-1231`.
- **Problem:** Each client independently proposes its fitted cols/rows; the PTY is resized to whichever landed last; the broadcast forces all *other* clients to refit and re-propose — a continuous ping-pong on multi-client (desktop + phone) sessions, reflowing TUI apps. The doc claims native is "authoritative" but the code gives it no priority.
- **Proposal:** Adopt smallest-bounding-box sizing (`min(cols)`, `min(rows)` across attached viewports — the tmux model) recomputed on subscribe/detach, and suppress self-echo. Alternatively gate authority to the native webview when attached.

### 9.7 (low) Origin check trusts the client-supplied Host header as the baseline — *low, S*
- **Where:** `web/server.ts:255-266`.
- **Proposal:** Compare Origin host against a server-config allowlist (bind + configured hostnames + explicit origins) rather than the request's own Host; prefer requiring the token when one is set.

### 9.8 (low) Untyped `panelMouseEvent` cast straight into the PanelEvent union — *low, S*
- **Where:** `web/server.ts:1294-1352,1148-1159` (`as unknown as SidebandPanelEvent`, no range validation, `surfaceId` not checked against the subscribed set).
- **Proposal:** Validate `surfaceId ∈ subscribedSurfaceIds`; clamp numeric fields like the resize path; replace the blind cast with an explicit field-by-field builder.

---

## 10. Agent panels, pi-agent-manager & auto-continue

**Assessment.** Carefully built and defensively coded. The pi-agent JSONL framing is robust (partial-line buffering, CRLF, non-JSON tolerance, decoder streaming); process lifecycle has a dual exit hook with a forced-crash regression test; the auto-continue engine never throws and degrades to the heuristic on any LLM failure with cooldown + runaway gates + a persisted pause set. The agent-panel decomposition is a good refactor with a table-driven response dispatcher, rAF-coalesced streaming, and HTML-escaped markdown (no XSS).

### 10.1 (H8) Auto-continue consults the LLM *before* the cooldown & runaway gates — *high, S*
- **Where (verified):** `auto-continue-engine.ts:224,235` (`tryModel` in model/hybrid mode) run **before** the cooldown gate at `265` and runaway gate at `280`.
- **Problem:** Every turn-end notification triggers a paid Anthropic call even when the cooldown would skip the fire and even after the surface has hit `maxConsecutive`. A chatty agent firing faster than `cooldownMs` makes one paid round-trip per notification with **no fire**; a runaway-latched agent keeps paying indefinitely.
- **Impact:** Unbounded LLM cost on exactly the runaway/chatty scenarios the engine exists to contain — the opposite of design intent.
- **Proposal:** Reorder so the cheap deterministic gates run first; short-circuit to `skipped` before any `tryModel` when `sinceLast < cooldownMs` or `consecutive >= maxConsecutive`.

### 10.2 (medium) Runaway gate never latches the surface into the paused set — *medium, S*
- **Where (verified):** `auto-continue-engine.ts:278-292` sets `loopWarned=true` (`281`) but never adds to `pausedSurfaces` (only `pause()` at `101`/`141` does). `loopWarned` is written in 4 places, read in **zero** — dead state.
- **Problem:** A looping surface re-runs the full heuristic (and, until 10.1 is fixed, the LLM) on every notification rather than being durably paused, and emits a fresh "paused — looped" audit entry each turn.
- **Proposal:** Call `this.pause(surfaceId, 'runaway limit reached')` on first trip (durable short-circuit + persist), or use `loopWarned` to emit a single transition notification and suppress duplicates. Remove `loopWarned` if neither.

### 10.3 (H12) `PiAgentInstance` request/response machinery + ~25 wrappers are dead code — *high, M*
- **Where:** `pi-agent-manager.ts:316-519`; all ~40 webview handlers use `sendNoWait` (`webview-handlers/agent.ts:57-241`).
- **Problem:** Nothing calls the Promise-based `send()` or its ~25 typed wrappers (`prompt`, `abort`, `getState`, `setModel`, `compact`, `fork`, `exportHtml`, `bash`, …). Responses are correlated in the webview by pi's `command` field, not the injected `id`. `responseWaiters`, `reqCounter`, per-request timeouts, and the id-correlation branch exist only to serve `send()`. ~230 lines of intricate async plumbing that looks load-bearing but isn't; a test pokes `responseWaiters` just to keep it "covered."
- **Proposal:** Pick one model. (a) Delete `send()` + `responseWaiters` + `reqCounter` + wrappers + id-correlation, keeping `sendNoWait`/`steer`/`followUp`/`kill`/`start`; or (b) migrate handlers onto `send()` so RPC failures surface as rejections. Given the panel already keys on `command`, (a) is lower-risk.

### 10.4 (H13) Crashed pi-agent surface becomes a zombie that silently swallows input — *high, M*
- **Where:** `agent-panel.ts:870-879` (`agent_exit` only adds a system message), `index.ts:255-257` (`removeAgent`), `webview-handlers/agent.ts:57-65` (`if (agent) …` no-op).
- **Problem:** On pi crash the instance is evicted, but the input textarea, send button, pickers, and toolbar stay **enabled**. Every subsequent command hits `getAgent(id) → undefined` and is a silent no-op — the user types, sees the message echoed locally, gets zero response, with no path to restart.
- **Proposal:** On `agent_exit` set a `dead` flag: disable input + send, swap footer to "Agent exited (code N)", render a "Restart agent" action (reuse `createAgentSurface` with the same cwd/model). At minimum gate `submitInput`/keydown on the flag.

### 10.5 (medium) Unbounded stdout line buffer — *medium, S*
- **Where:** `pi-agent-manager.ts:236-295`.
- **Problem:** `readStdout` appends every chunk to `this.buffer`; `processBuffer` drains only to the last `\n`. No cap on buffer or per-line length; a pathological huge/unterminated line grows main-process memory unbounded (compare the web stdin path's `CLIENT_STDIN_MAX_BYTES`).
- **Proposal:** Max-buffer guard: if `buffer.length` exceeds a few MiB with no newline, drop and emit an error event.

### 10.6 (medium) Every stderr chunk / system message triggers a full transcript re-render (O(N²)) — *medium, M*
- **Where:** `agent-panel.ts:851-857,1778-1785,1348-1367`.
- **Problem:** `agent_stderr` → `addSystemMessage` → `renderAllMessages` which does `messagesEl.innerHTML=''` and rebuilds **every** message. Streaming deltas are rAF-coalesced (good) but system messages/tool flushes/bash output are not — each costs O(N) for O(N²) total. No transcript cap.
- **Proposal:** Append incrementally (single new node + autoscroll), reserve `renderAllMessages` for session load; coalesce stderr into a tail message; cap/virtualize retained nodes.

### 10.7 (low) Redundant `AgentPanelCallbacks` duplicates the `htEvents`/`dispatch` channel — *low, M*
- **Where:** `agent-panel.ts:66-82,976-1034`, `surface-manager.ts:2063-2101`.
- **Proposal:** Collapse to one command channel — route the 8 callback commands through `dispatch('ht-agent-…')` like the other ~30, dropping `AgentPanelCallbacks` to genuinely view-local hooks (onClose/onSplit/onFocus).

### 10.8 (low) `start()` resolves "ready" on a fixed 500 ms timer never cleared on early exit — *low, S*
- **Where:** `pi-agent-manager.ts:208-234`.
- **Proposal:** Resolve `readyPromise` on the first stdout line/RPC response; reject (clearing the timer) if `proc.exited` fires before ready.

### 10.9 (low) Per-agent login-shell PATH probe runs `Bun.spawnSync` twice per agent on the main thread — *low, S*
- **Where:** `pi-agent-manager.ts:39-100,169-183`.
- **Problem:** `resolvePiBinary` (memoized) runs up to two synchronous `[shell,'-ilc',…]` spawns; `start()` runs **another** non-memoized `[shell,'-ilc','echo $PATH']` per agent. An interactive login shell can take hundreds of ms and `spawnSync` blocks the main loop (PTY I/O, poller, RPC) each pane open.
- **Proposal:** Resolve+memoize the login-shell PATH once at boot and reuse across `resolvePiBinary` and `start()`; do the probe async at startup.

### 10.10 (low) Auto-continue heuristic error/question scan over ANSI-laden tail is substring-fragile — *low, M*
- **Where:** `auto-continue.ts:68-104`, `auto-continue-host.ts:64-80`.
- **Problem:** Strips only CSI sequences (OSC/hyperlinks survive); case-insensitive substring matches for `failed`/`denied`/`exception` + trailing-`?` misfire on benign output ("no errors", a file named `failure_test.py`, "permission to continue?").
- **Proposal:** Anchor tokens to line starts, strip OSC/non-CSI escapes, require the trailing-`?` line to look like a prompt; document the known false-positive classes.

---

## 11. Security (holistic / cross-cutting)

**Assessment.** A genuinely strong, honest security posture for a single-user desktop terminal. `doc/system-security.md` is a real, test-backed ledger. **All runtime subprocess invocations use argv-arrays — no shell-string injection** (`surface-metadata.ts:783`, `pty-manager.ts:155`, `surface.ts` execFile, pi-agent-manager). **Path traversal is closed**: the web server serves only hardcoded literal routes; `asset-loader.ts` resolves through a flat `VENDOR_MAP` allowlist with no user-controlled path component. The mirror's iframe sandbox, timing-safe token compare, and consistent `0600` file modes (settings/cookies/telegram.db/logs/history) are all real. The serious issues are **wiring gaps that defeat controls that exist** and **default-config choices that fail open**.

### 11.1 (C1 dup) Web-mirror auto-start & port-restart force 0.0.0.0 + no auth — *critical, S — confirmed*
Independently confirmed a second time by the security pass (full detail in §9.1). The fix — thread `webMirrorBind`/`webMirrorAuthToken` into all three call sites via one `createWebServer()` factory and make the params **required** — directly restores red-team controls #1–#3 in `doc/system-security.md`.

### 11.2 (C4) Default Telegram allow-list ships a hardcoded third-party user ID — *critical, S — confirmed*
- **Where:** `src/shared/settings.ts:768-775` (`telegramAllowedUserIds = "8446656662"` — a real Telegram ID, also the example chat throughout `doc/SKILLS.md`); reach-to-shell chain `telegram-button-dispatch.ts:42-89` → `index.ts:1320-1365` → `surface.ts:269-277` (`send_text`/`send_key`; `send_key ctrl+c` writes a real SIGINT byte to the PTY).
- **Problem:** A real personal Telegram account is baked into **every build**. Once `telegramNotificationButtonsEnabled` or `telegramAskUserEnabled` is on, that fixed external account can type into and SIGINT the installing user's shells, read forwarded notifications, and chat as the bot.
- **Impact:** Privacy leak (author's ID shipped to all users) **and** a remote-control foothold on any install that turns on Telegram buttons without first editing the allow-list. Also: `auditsGitUserNameExpected` defaults to `"olivierveinand"`, false-positiving the git audit for every other contributor.
- **Proposal:** Default `telegramAllowedUserIds` to `""` and `auditsGitUserNameExpected` to `null`; force the user to enter their own ID during setup; never bake a personal ID into committed shared defaults (move any author-convenience default to a gitignored local seed or env var).

### 11.3 (high) Empty Telegram allow-list is fail-open — *high, S — confirmed*
- **Where:** `telegram-service.ts:658-664,619-636` (guards are `if (allowed.size > 0 && !allowed.has(id))` — an empty set **skips** the guard); `parseAllowedTelegramIds` silently reduces blank/non-numeric input to empty.
- **Problem:** A cleared or misconfigured allow-list becomes an **open relay** for a channel that can SIGINT shells and answer confirm-command prompts. Fail-open is the wrong direction here.
- **Proposal:** Invert: empty allow-list **rejects all** inbound (log once). If "allow anyone" must be expressible, make it an explicit deliberate boolean, never a byproduct of an empty string.

### 11.4 (H3 dup) `ht` Unix socket has no per-call token — *high, M — partial*
Confirmed mechanism (socket is `chmod 0600`-only); the verifier notes the impact is slightly overstated relative to the project's defensible local-trust model, and there's a citation nuance (`bin/ht:447` is where a positional `token` arg is noted as having "no effect"). Still worth the incremental hardening in §6.1: a 0600 token file gating state-mutating methods narrows the gap between "any code as the user" and "can hijack a live root shell."

### 11.5 (H1 dup) Brute-force throttle keys on attacker-controlled headers — *high, S — confirmed*
Full detail in §9.3. `clientIp()` uses `x-forwarded-for`/`host` (both client-controlled on a direct LAN connection); `server.requestIP(req)` is available but never called. An attacker rotates `X-Forwarded-For` per request and never trips the cooldown. Fix: key on `server.requestIP()?.address`; treat XFF as untrusted unless an explicit `trustProxy` is set.

### 11.6 (low) Native fd4 HTML/SVG via `innerHTML`, no sandbox — *low (documented non-goal), M*
Same as §7.2; recorded here as the cross-cutting security view. CLAUDE.md documents "no sandboxing of fd4" as a deliberate trust assumption, but the native sink is the **highest-privilege** one (RPC bridge), so promoting `wrapInSandboxedShell` to shared and reusing it removes the asymmetry.

### 11.7 (low) Secrets stored plaintext in settings.json — *low→medium, M*
Telegram bot token and web-mirror auth token live in cleartext in `settings.json` (0600). See §17.1 (logging) and §14.2 (cookies) for the same theme. Proposal: OS keystore (macOS Keychain via Electrobun's system-keychain access) for the three secret fields, keeping non-secret settings plaintext.

---

## 12. Telegram bridge

**Assessment.** Carefully engineered. **GOOD:** SQLite is **fully parameterized** (no string-built SQL); DB + WAL/SHM sidecars are `0600`; dedup via partial UNIQUE index + `INSERT OR IGNORE`; offset persisted per batch; long-poll backoff with a dedicated 409-conflict state; `getMe` 5 s timeout race; per-chat token-bucket rate limit; `parse_mode` allow-listed to MarkdownV2; notifications forwarded as plain text; token omitted from the web mirror and masked in the UI; allow-list enforced on inbound **and** callbacks. The weaknesses are access-control **defaults** and secret-at-rest, covered as criticals/highs in §11.2–§11.3.

### 12.1 (medium) Bot token stored plaintext in settings.json — *medium, M* — `shared/settings.ts:191,769`. → OS keystore (§11.7).
### 12.2 (medium) Web-mirror clients can send arbitrary Telegram messages as the bot with no per-action authorization — *medium, S*. Gate the `telegram.send` RPC behind the mirror auth token / a capability.
### 12.3 (medium) ask-callback resolves `agent.ask_answer` using the **wire** requestId, not the stored link requestId — *medium, S* (correctness: a crafted/mismatched callback could answer the wrong pending ask). Use the stored link id.
### 12.4 (low) Long-poll offset persists only on non-empty batches — a mid-batch crash replays the window — *low, S*. Persist offset after each processed update (dedup index already makes replay safe, but the window cost is avoidable).

---

## 13. Browser pane & cookie store

**Assessment.** The cookie store is engineered with real care: atomic POSIX-rename writes, owner-only `0600` on the destination, corrupt-file backup-and-recover, a secondary domain index for O(k) lookups, per-domain (500) and global (50k) LRU caps, and browser-collision-correct domain normalization. **Resource cleanup on surface close is genuinely good** — `destroyBrowserPaneView` detaches every `webviewEl.on()`/`addEventListener` via a tracked `_cleanup` array, with deliberate close ordering. The weaknesses are security-by-design tradeoffs worth hardening.

### 13.1 (high) Cookie `.tmp` file is world-readable during the write window — *high, S — confirmed*
- **Where:** `cookie-store.ts:388-414` (`Bun.write(`${filePath}.tmp`)` with **no mode**, then `renameSync`, then `chmodSync(dest, 0o600)` — the tmp is never chmod'd; default umask 022 → 0644), same shape in `atomic-write.ts:30-49`.
- **Problem:** For the interval between tmp creation and the post-rename chmod, the file containing **every session cookie** (auth tokens, JWTs) is world-readable. Saves fire every ~2 s after any cookie change and on every navigation.
- **Proposal:** Create the tmp with `mode: 0o600` from the start (`writeFileSync(tmp, data, { mode: 0o600 })` / open with `O_CREAT|0o600`), and chmod the parent configDir to `0700` once at startup. **This `atomic-write.ts` fix also closes the same brief-window leak for settings.json** (which holds the auth/bot tokens).
### 13.2 (high) Cookies persisted plaintext, no encryption at rest — *high, L — confirmed*
- **Where:** `cookie-store.ts:388-426`; nothing uses safeStorage/Keychain anywhere (grep-confirmed). Stores `httpOnly` and live captured session cookies verbatim.
- **Proposal:** Encrypt values via the OS keystore (macOS Keychain / Electrobun system keychain); keep metadata (domain/path/expiry) plaintext for indexing. Minimum viable: AES-GCM the value column under a Keychain-stored random key. Or document the threat model explicitly if plaintext is accepted.
### 13.3 (high) Socket RPC exposes unbounded arbitrary JS eval into any pane origin — *high, M — partial (by-design, severity nuance)*
- **Where:** `browser-page.ts:144-152,239-258` (`browser.eval`/`addscript`/`addstyle` take a raw `script` with **no length cap, no validation**) → `executeJavascript` in the page origin.
- **Nuance:** CLAUDE.md says "scripts are trusted," so this is partly by-design; the verifier downgraded the framing. Still, the blast radius (live **authenticated** web sessions) exceeds the terminal-trust model.
- **Proposal (the concrete win):** add the 256 KiB cap (matching what `browser.eval` *claims* — see §6.2 where `addscript`/`addstyle` bypass it), and document in `system-browser-pane.md` that the 0600 socket is credential-equivalent. Optionally gate eval/DOM methods behind the mirror auth token.
### 13.4 (high) `file://` navigation reachable over the socket → local file read — *high, M — confirmed*
- **Where:** `browser-page.ts:29-44` (`ALLOWED_URL_PREFIXES` literally includes `file://`), `103-117`. `browser.navigate {url:'file:///etc/passwd'}` loads a `file://` origin; combined with eval/`get html`, a socket client reads arbitrary local files. Internal hosts (localhost/127/::1/169.254) are also reachable (SSRF-style).
- **Proposal:** Drop `file://` (and `about:` except `about:blank`) from the RPC navigate allowlist, or gate behind an explicit opt-in scoped to a configured directory with traversal rejection; block link-local/metadata ranges; re-apply navigation rules on programmatic loads.
### 13.5 (medium) Shared cookie store re-injects cookies into every pane → defeats per-surface partition isolation — *medium, M*. Scope injection to the pane's partition.
### 13.6 (low) `getForUrl` ignores `__Host-`/`__Secure-` prefixes & full secure/path scoping; capture trusts page-supplied url/host and stores all `document.cookie` pairs as non-secure — *low, M*. Honor prefix/secure semantics.

---

## 14. Settings system

**Assessment.** Well-engineered and clearly hardened. **GOOD:** persistence is **genuinely atomic** (`atomic-write.ts` tmp+rename) with `0600` for secrets; corrupt files are backed up to `.bak`, not silently discarded; `load()` merges over defaults so partial/old files survive (the rename kept the config dir `hyperterm-canvas`, so old `settings.json` loads fine — correct). The "two sources of truth" worry is mostly mitigated: `settings.schema.ts` holds a typed `FieldSchema` seam, a test asserts each schema default equals `DEFAULT_SETTINGS`, and `validateSettings` routes all 56 fields through schemas. **The hardcoded personal data in defaults is the headline issue — see §11.2.**

### 14.1 (medium) Atomic write skips `fsync` — durable across crash but not power loss — *medium, S*. `fsync` the tmp fd before `rename` (and `fsync` the dir) for power-loss durability of settings/cookies/history.
### 14.2 (medium) No schema version field, no migration framework — *medium, M*. Only an ad-hoc bloom stamp exists; field **rename/removal is impossible** without silent data loss. Add a `schemaVersion` + a tiny ordered-migration runner on load.
### 14.3 (medium) `validateSettings` has no exhaustiveness guard — *medium, S*. A new `AppSettings` field can silently pass through unvalidated. Add a key-set exhaustiveness test (`keyof AppSettings` ⊆ validated keys).
### 14.4 (low) `mergeSettings` shallow-merges nested `autoContinue` — a partial nested patch clobbers siblings — *low, S*. Deep-merge known nested objects.
### 14.5 (low) `settingsEqual` short-circuits on key-count equality and stringifies `ansiColors` per call — *low, S*. Minor perf/correctness.
### 14.6 (low) 2,144-line native `settings-panel.ts` is maintainable but grows linearly per field — *low, M*. Consider a declarative field-descriptor table that renders generically (and could be shared with the web panel).

---

## 15. Performance (cross-cutting)

**Assessment.** Strong posture, clearly the product of deliberate passes. **GOOD:** continuous timers are well-contained (poller diff-gated + 3 s when hidden; bloom RAF only schedules when dirty and skips no-op GPU draws; agent streaming rAF-coalesced with cancel-on-teardown; status bar hashes output so an uneventful 1 Hz tick is free). Memory is bounded (PTY history cap, poller cache pruning, single-`AbortController` teardown). Web server is null when disabled. **No idle CPU leaks or unbounded growth found** beyond the items below (and the bloom/poller items in §5/§8).

### 15.1 (medium) Process Manager CPU/MEM frozen while open — *medium, M*. = §5.1 (`metadataEqual` ignores cpu/rssKb). Cross-confirmed by the perf pass.
### 15.2 (medium) Agent panel rebuilds the entire conversation DOM per message — O(M²)/session — *medium, M*. = §10.6.
### 15.3 (low) `broadcastEnvelope` re-serializes identical payloads once per web-mirror session — *low, S*. Serialize once, fan out the buffer.
### 15.4 (low) Streaming markdown re-parses the full accumulated text every frame — *low, M*. Incremental parse / parse only the tail.
### 15.5 (low) EventBus typed-consumer migration is dead code — `on()` unused, type-safety goal unmet — *low, S*. Either adopt `on()` or remove the unused typed layer (see also §10.7).
### 15.6 (low) Web-client bundle rebuilt unconditionally on every `bun start` — *low, S*. Skip the build when sources are unchanged (mtime/content hash) to cut startup cost — directly serves the <50 ms priority.
### 15.7 (low) Native status bar runs `renderStatusKey` for every key at 1 Hz even when the hash will match — *low, S*. Hash inputs before rendering.

---

## 16. Type safety, error handling & logging

**Assessment.** Type safety is genuinely strong: strict tsconfig, **0 ts-ignore**, only **6 `as any`** (all benign — DOM fonts API, loose Electrobun event detail) and ~13 `: any` (RPC-send aliases, xterm `declare const`). Trust boundaries are well-defended (sideband parser caps, settings backup-on-corrupt, thorough telegram field-level `typeof` checks, WS frame caps + rate-limit + timing-safe auth, RPC schema validation with a size-only audit log). Error handling broadly follows "log, don't throw from callbacks." **The real gap is logging.**

### 16.1 (high) Logger is a tee with no redaction — token can reach disk — *high, S — partial (latent)*
- **Where:** `logger.ts:312-345` tees every arg into `~/Library/Logs/tau-mux/app-*.log` via `Bun.inspect()` on non-string args; `telegram-service.ts:709` builds the token-bearing `api.telegram.org/bot<TOKEN>/…` URL; ~30 sites log a raw `err` object.
- **Problem:** `Bun.inspect()` of a Bun fetch failure prints the token-bearing URL. **Verifier nuance:** no *currently-reachable* path leaks the token (the transport swallows its own fetch errors and logs `err.message`), so this is **latent, one refactor away** — the next telegram-adjacent `catch (err) { console.warn(prefix, err) }` leaks the token to a 14-day on-disk log. The logger's own header even admits "the log can contain bot tokens."
- **Proposal:** (1) make `err instanceof Error ? err.message : String(err)` the rule for network errors; (2) add a ~10-line **redaction pass** in `formatArgs()` scrubbing `bot\d+:[A-Za-z0-9_-]+`, `[?&](token|auth)=…`, and `Cookie:` headers — defends every call site at once, including future ones; (3) optionally split the telegram base URL so the token never appears in a fetch URL.
- **Tech decision:** Prefer an output-side redacting filter in the existing tee over adopting pino/winston — a small secret-shaped-regex allowlist covers every `console.*` centrally, no new dependency, survives refactors.
### 16.2 (medium) No leveled logging — ~299 `console.*` all persist to disk unconditionally — *medium, M*. Only `LOG_RPC` gates one debug line. Add levels (error/warn/info/debug) + an env-configurable threshold so debug noise isn't persisted by default.
### 16.3 (low) Pi-agent JSONL events cast `as PiAgentEvent` then field-accessed via unchecked `as string` — *low, S*. Validate at the semi-trusted pi boundary (see §10 framing).
### 16.4 (low) Socket-server reads `req.method`/`req.params` via unchecked casts before dispatch — *low, S*. Shape-check the envelope before dispatch (ties into §6.4 validation).

---

## 17. Testing, CI & build/release

**Assessment.** 1,500+ tests with strong unit coverage of pure logic, a per-file coverage-regression gate, and rich design-report tooling. **But the CI gate has real holes**, and the recent e2e removal cut more than pixel flake.

### 17.1 (high) CI e2e removal threw out functional web-mirror **security** tests, not just flaky pixel-diffs — *high, M — confirmed*
- **Where:** `ci.yml:76-82` justifies removal citing font-smoothing pixel drift, but it dropped the whole `test:e2e` (`package.json:21` = all of `tests-e2e/`). Only 2 of 10 spec files use screenshots; `auth.spec.ts`/`security.spec.ts`/`protocol.spec.ts`/… are **functional** (401 without token, 401 wrong token, cross-origin WS upgrade rejected 403, no-Origin native upgrade allowed).
- **Impact:** The mirror defaults to 0.0.0.0 — exactly the surface needing a regression net — and a refactor breaking the 401 path / cross-origin rejection / Bearer parsing now ships green. (Verifier: `playwright.config.ts` runs all 10 specs; use `--grep-invert @design-review` rather than the path the proposal first suggested.)
- **Proposal:** Add `test:e2e:functional` = `playwright test --grep-invert @design-review` as a third macOS CI job (no pixel baselines → runner-stable); move the design/pixel suites to a scheduled `nightly.yml` with thresholds + dynamic-region masking.
### 17.2 (high) Release workflow runs no tests/typecheck and doesn't depend on CI passing — *high, S — confirmed*
- **Where:** `release.yml:24-118`; `build-and-upload` is `needs: create-release` only, no typecheck/test before `package:mac` + `gh release upload`. A tag on a red/in-progress commit ships binaries regardless.
- **Proposal:** Add a `verify` job (install --frozen-lockfile, typecheck, `bun test`) and `needs: [create-release, verify]`, or gate on the CI run for the tagged SHA. A few lines; closes the most consequential release gap.
### 17.3 (medium) Coverage gate is blind to **new** untested files — `index.ts` + all `webview-handlers/` untracked — *medium, M*. The per-file baseline only guards files already in it; a new untested file isn't a regression. Add a "every source file must appear in the baseline" check.
### 17.4 (medium) No lint/format runner wired — `eslint.config.js` is dead/absent — *medium, S*. See §18.1.
### 17.5 (medium) Integration tick is unit-only — live poller / bun↔webview RPC / end-to-end mirror only exercised by the offline native suite — *medium, M*. Add a headless integration job.
### 17.6 (medium) Two tracked lockfiles (`bun.lock` + stale `package-lock.json`) — split source of truth — *medium, S*. = §18.2.
### 17.7 (medium) Release artifacts are unsigned, no checksums/attestation — *medium, M*. Add SHA-256 sums + (ideally) notarization/codesign + SLSA provenance.
### 17.8 (low) CI is macOS-only, single-job, no dependency caching, redundant double install — *low, S*. Cache `~/.bun/install/cache`; dedupe installs.

---

## 18. Dependencies & supply chain

**Assessment.** Lean, intentional dependency set. The headline is the xterm version split.

### 18.1 (H — see §2) xterm v5 core + v6 scoped addons — addons type against an **uninstalled** `@xterm/xterm` — *high, M — confirmed*
- **Where:** `package.json:65-71` (`xterm@5.3.0` + `@xterm/addon-fit@0.11`/`addon-search@0.16`/`addon-web-links@0.12`/`addon-serialize@0.14` + `@xterm/headless@6`); webview imports `Terminal` from `xterm` (`surface-manager.ts:1`, `panel-manager.ts:1`, `terminal-effects.ts:1`) and loads the v6 addons at `2245-2250`. The addon `.d.ts` files import from `@xterm/xterm`, which is **not installed** — invisible only because `skipLibCheck:true`. Runtime works today by API luck (v5.3.0 happens to expose the `registerDecoration` API the v6 search addon uses), and the addons carry `^` ranges so a future minor bump can call a v6-only API with **no compile-time signal** (tests mock the addons, so they won't catch it either).
- **Proposal:** Migrate the webview core to `@xterm/xterm@^6.0.0` (3 imports `from "xterm"` → `from "@xterm/xterm"`, swap the CSS import, drop `xterm@5.3.0`). Then core+addons live in one scoped v6 world and compat becomes typecheck-enforced (bun side is already v6). Verify the `proposeDimensions` math reimplemented at `surface-manager.ts:2658-2668` still holds against v6's FitAddon; `bun start` to confirm rendering.
### 18.2 (medium) Stale committed `package-lock.json` alongside canonical `bun.lock` — *medium, S*. All CI uses `bun install --frozen-lockfile`; the npm lock (older) diverges, so `npm install` resolves a different graph CI never tests. Delete it + `.gitignore` + document `bun install` as the only path.
### 18.3 (medium) No dependency/vulnerability scanning (no renovate/dependabot/audit/SBOM) — *medium, S*. Add Renovate (group `@codemirror/*`, separate majors) + a non-blocking `osv-scanner`/`bun audit` step. Would have auto-flagged the deprecated unscoped `xterm`.
### 18.4 (medium) Unused devDependencies — `@ai-hero/sandcastle` + the `@typescript-eslint` pair (no eslint config) — *medium, S*. Either commit a flat `eslint.config.js` + a `lint` script + CI step, or remove the packages. (Resolves §17.4.)
### 18.5 (low) `@types/bun` pinned to `"latest"` — non-reproducible type surface — *low, S*. Pin to `^1.3.0`.
### 18.6 (low) `@types/node` forced to `^20` via overrides while runtime is node v24 — *low, S*. Document the rationale (avoids a transitive `@types/node` clashing with `@types/bun`) or align to `^22`.
### 18.7 (low) electrobun pinned exact `1.16.0` (latest `1.18.1`) — *low, S*. Track upstream; pair with Renovate.

---

## 19. Accessibility & UX consistency

**Assessment.** A real a11y effort exists (ModalHost focus trap, `role`/`aria-label` on chips, `prefers-reduced-motion`/`prefers-contrast`/`forced-colors` blocks, audit scripts). The chip row is thoughtfully modeled (informational chips carry `aria-label`; only the actionable port chip is focusable — a clean resolution of "keyboard never goes to panels"). The gaps are concrete and mostly S.

### 19.1 (high) HCM/forced-colors CSS for the ask-user modal targets a **non-existent** class — *high, S — confirmed*
- **Where:** `index.css:12096,12123` list `.ask-user-modal`, but `ask-user-modal.ts:114,120` only ever assign `ask-user-overlay`/`ask-user-sheet`. The selector matches nothing.
- **Impact:** The **most safety-critical** surface — the "This will execute on your machine" confirm-command prompt — falls through to its default dark/cyan styling in Windows High Contrast / `prefers-contrast: more` instead of mapping to system tokens. The one modal where misreading "Run" vs "Cancel" is most dangerous gets the *least* contrast treatment.
- **Proposal:** Replace `.ask-user-modal` with `.ask-user-sheet` (+ `.ask-user-overlay`) in both blocks; add a test asserting every selector in those blocks corresponds to a class the TS actually produces (§19.6).
### 19.2 (medium) Contradictory ARIA on cards/toasts — `role=alert` + `aria-live=polite`, plus nested live regions — *medium, S*. `role=alert` implies assertive; overriding to polite is inconsistent across SRs; toast errors set `role=alert` inside a `role=status` container (nested live regions double-announce). Pick one model per element.
### 19.3 (medium) Cheat-sheet modal doesn't gate global ⌘-shortcuts — *medium, S*. The document keydown handler gates the settings/ask-user/palette modals but not the cheat-sheet, so layout-mutating shortcuts (split/close-pane) fire behind it. Add an `isVisible()` gate, or make ModalHost block non-Tab/Escape keys by default.
### 19.4 (low) Modals set `aria-modal=true` but never apply `inert`/`aria-hidden` to background — *low, M*. VoiceOver can still wander into background content. Add `inert` on the app root in `ModalHost.open()`.
### 19.5 (low) `--tau-text-mute` (#55646c) fails WCAG AA on dark surfaces (3.0–3.25:1) — *low, S*. Used for small uppercase labels. Bump to ~#6b7c85 (≈4.5:1) or remap to `--tau-text-dim` in the contrast block.
### 19.6 (low) No `:focus-visible` ring on ask-user buttons (incl. danger "Run") in the default theme — *low, S*. A focus ring exists only inside the contrast/forced-colors media blocks. Add a default `*:focus-visible` baseline — most needed on the programmatically-focused "Run".
### 19.7 (low) a11y media-query test asserts block **presence** only — *low, M*. Can't catch dead selectors (how §19.1 survived) or token collapse (`--tau-ok`/`--tau-cyan`→Highlight). Parse selector lists + assert distinct tokens don't collapse; add a forced-colors Playwright smoke.

---

## 20. Documentation, dead code & naming

**Assessment.** **GOOD:** the *source tree* is disciplined — zero TODO/FIXME/HACK markers in `src/`, no large commented-out blocks, and `variants/atlas.ts` is **fully wired** (not dead — registry + palette command + settings enum + lifecycle test), so no src cleanup pass is needed. The debt is concentrated in `doc/` and brand naming.

### 20.1 (high) Product rename is half-done — user state split across two brand names — *high, M — confirmed*
- **Where:** config/settings/layout/cookies under `Application Support/hyperterm-canvas` (`index.ts:104`) but logs under `~/Library/Logs/tau-mux` (`logger.ts:87`); socket `/tmp/hyperterm.sock` (`bin/ht:10`); bundle `tau-mux.app` but identifier `dev.hyperterm.canvas` (`electrobun.config.ts:12-13`); RPC handshake advertises `protocol:"hyperterm-socket"`. Brand census: τ-mux 257, HyperTerm 35, lowercase `hyperterm` 54, tau-mux 37; `bin/ht:1287,1589` still print "HyperTerm Canvas is not running."
- **Impact:** Two answers to "where is my data"; inconsistent brand tokens for anyone scripting/debugging; load-bearing values (bundle id, config dir) can't be blindly renamed.
- **Proposal:** Don't rename load-bearing values blind. (a) Centralize the four magic strings (config-dir name, log-dir name, socket basename, bundle id) into one `src/shared/brand.ts`; (b) fix cheap user-facing strings now (`bin/ht` "HyperTerm Canvas" → "τ-mux"); (c) if migrating the config dir, ship a one-time rename-on-first-launch (`if old exists && new doesn't, mv`); (d) leave the bundle identifier (macOS keychain/permissions/LaunchServices keyed on it) and document *why* at `electrobun.config.ts:13`.
### 20.2 (medium) `doc/` is an unmaintained graveyard — 51 of 108 files are stale tracking/phase logs — *medium, S*. 1.6 MB total; a single `tracking_…_phase7.md` is 163 KB; dated one-shots (`full_analysis.md`, `triple_a_analysis.md`, …) sit beside the ~22 evergreen `system-*.md`. Nothing is build-wired (only a comment reference). `git mv` the trackers + `doc/todos/` + `doc/feature_upgrade_to_AAA/` + dated analyses into `doc/archive/`; keep evergreen `system-*.md` + `how-to-*.md` + `changes_to_document.md` at top level; add a 10-line `doc/README.md` index distinguishing reference vs archive. Pure file moves, reversible.
### 20.3 (medium) Env-var namespace is bimodal — `HYPERTERM_*` (9) vs `HT_*` (10), no documented rule — *medium, S*. The split is *almost* coherent (`HYPERTERM_*` = the frozen public sideband/PTY protocol injected into children, consumed by `scripts/demo_*` + the pi/Claude bridges; `HT_*` = internal app/CLI config) but leaks (`TEST_MODE` exists under both). **Document and freeze, don't rename** (renaming the protocol vars breaks third-party scripts): add a `doc/system-env.md` stating the rule, collapse the duplicate `TEST_MODE`, mandate `HT_*` for new internal vars.
### 20.4 (low) `variants/atlas.ts` is **not** dead; `src/` is free of dead code — *informational*. No action; if a guard is wanted, add a CI `knip`/`ts-prune` run (would be near-empty today).
### 20.5 (low) CLAUDE.md is dense but not overloaded — *low, S*. Keep structurally; two micro-fixes: make the pi-docs path version-agnostic (it hardcodes `.nvm/.../v24.14.0/…`, breaks on node upgrade) and trim the longest "Common Patterns" recipes to pointers into `doc/system-*.md`.

---

## 21. Hand-verification appendix (§A)

Hand-verified against the source on 2026-05-30 (independent of the agent reviewers):

- **C1** ✔ `web/server.ts:135-136` defaults `bind="0.0.0.0"`,`authToken=""`; `index.ts:1906-1914` (toggle) passes both; `index.ts:2493-2499` (auto-start) & `2518-2524` (port-change) pass only 5 args.
- **C2** ✔ `web-client/main.ts:1042` & `1093` both `contentEl.innerHTML = meta.data`.
- **C3** ✔ Only `process.on("SIGINT"/"SIGTERM")` at `index.ts:2870-2871`; no `before-quit`/window-close/`exitOnLastWindowClosed` subscription in `src/`.
- **H2** ✔ `web/server.ts:144` `setAuthToken` exists; no caller in `src/`.
- **H3** ✔ `socket-server.ts:146` `chmodSync(path, 0o600)`; no token logic.
- **H5** ✔ `surface-manager.ts:2238` `cursorBlink:true`; `terminal-effects.ts:344` `onRender(()=>markDirty())` (345/346 already cover onScroll/onWriteParsed).
- **H7** ✔ `metadataEqual` compares pid/ppid/command only; no cpu/rssKb.
- **H8** ✔ `auto-continue-engine.ts:224,235` `tryModel` before cooldown gate `265` and runaway gate `280`.
- **10.2** ✔ runaway gate sets `loopWarned` (`281`) but never `pausedSurfaces.add`; `loopWarned` read nowhere.
- **Settings atomic write** ✔ *(mitigated — not a finding)* `settings-manager.ts:8,77` uses `writeFileAtomic` (tmp+rename) + corrupt-file backup at `133`.
- **Telegram allowlist** ✔ enforced at `telegram-service.ts:619,658` — but guarded by `allowed.size > 0`, so an **empty allowlist = open to anyone** (see §12). Token stored plaintext in settings (`shared/settings.ts:191,769`).
- **xterm mix** ✔ webview imports `Terminal` from `xterm@5.3.0` (`surface-manager.ts:1`) + v6-era `@xterm/addon-*`; bun uses `@xterm/headless@6` + `@xterm/addon-serialize@6` (`session-manager.ts:5-6`); `node_modules/@xterm/xterm` is **not installed** (addon `.d.ts` import unresolved, masked by `skipLibCheck`).
- **electrobun** pinned `1.16.0`, latest `1.18.1`.

The part-2 adversarial pass additionally confirmed against source (verdict in parentheses): **C4** Telegram ID `8446656662` hardcoded at `settings.ts:772` + reach-to-shell chain (confirmed); **H0a** empty-allowlist fail-open `telegram-service.ts:619,658` (confirmed); **C1** re-confirmed at `index.ts:2492-2527` (confirmed); **H1** throttle keys on spoofable header, `requestIP` never called (confirmed); **H0b** `release.yml` `needs: create-release` only, no test step (confirmed); **H0c** `tests-e2e/auth.spec.ts`/`security.spec.ts` are functional, not pixel (confirmed); **H0d** `ALLOWED_URL_PREFIXES` includes `file://` (confirmed); **H0e** cookie `.tmp` written with no mode then chmod'd post-rename (confirmed); **H0f** addons import from uninstalled `@xterm/xterm` (confirmed); **H0g** `settings.ts:710,772` personal data (confirmed); **H0i** `.ask-user-modal` matches nothing — actual classes `ask-user-overlay`/`ask-user-sheet` (confirmed); **H0j** config `hyperterm-canvas` vs logs `tau-mux` (confirmed). Partial/nuanced (mechanism real, framing softened): **H0h** logger token-leak is *latent* (no currently-reachable path); **H3/11.4** socket no-token impact slightly overstated; **13.3** browser eval is partly by-design per CLAUDE.md.

---

## Appendix B — Coverage & counts

- **Areas reviewed:** 18 (8 subsystem + 10 cross-cutting). **Findings:** 128 (4 critical, 30 high, ~46 medium, ~48 low).
- **Criticals:** C1 web-mirror 0.0.0.0/no-auth · C2 inline-data LAN XSS · C3 GUI-quit state loss · C4 hardcoded Telegram ID.
- **Recurring themes:** (1) defenses exist but are unwired/fail-open; (2) "idle CPU ~0" not yet met; (3) god objects concentrate risk; (4) native↔web duplication drifts; (5) release/CI gates are decoupled from the test suite; (6) personal data + half-finished rename in shipped defaults.
- **Notable strengths (do not regress):** argv-array subprocs everywhere (no shell injection); atomic settings/cookie writes + corrupt-file recovery; the iframe sandbox for mirror markup; parameterized SQLite + 0600 file modes; the pure, parity-tested layout math; the defensive, never-crashes metadata poller; disciplined `src/` with zero dead code.
