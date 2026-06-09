---
title: Changelog
description: Notable changes — most recent at the top.
sidebar:
  order: 1
---

This page summarizes user-facing changes. The full commit log is on [GitHub](https://github.com/TheSamLePirate/TauMux/commits/main), and the project also ships a generated `CHANGELOG.md` at the repo root that groups commits by conventional-commit type (added in 0.3.145).

## 0.4.0 — Extension apps

A new surface type: **extension apps**. An extension is a **Bun backend** (a real child process that can `bun install` its own deps) + a **Vite frontend** rendered in an `<iframe>` (hot-module reload while editing, built static once installed) + a typed **`@tau-mux/sdk`** that drives every τ-mux control surface — create panes, open browser surfaces, push notifications, set sidebar status, and more. Extensions are saved on disk, restored with your layout, and created / edited / removed from inside the app.

- **`extension` surface (0.4.0).** Open one in a pane like any other surface. Each running surface gets its own Bun backend (started fresh, stopped on close) and an iframe pointed at the Vite dev URL (HMR) or a built bundle served over a tiny loopback host. Saved with the workspace by extension id; on restart the surface + a fresh backend are restored (the extension reloads its own `state.json`), or the slot degrades to a terminal if the extension was uninstalled. See [Extension apps](/features/extensions/).
- **`@tau-mux/sdk` (0.4.0).** One typed surface from both halves of an extension — `notification`, `sidebar`, `surface`, `workspace`, `browser`, `system`, plus a raw `call(method, params)` to reach any [JSON-RPC method](/api/overview/). The backend talks over the unix socket; the frontend over a `postMessage` bridge the host dispatches through the same RPC the CLI uses.
- **`ht extension` CLI + `extension.*` API (0.4.0).** `list`, `templates`, `open`, `split`, `new`, `install`, `remove`, `reload`, `stop`. See [`ht extension`](/cli/extensions/) and the [`extension.*` API](/api/extensions/).
- **Bundled examples (0.4.0).** `hello` (zero-dependency static app — the fastest way to see the bridge), `three-demo` (Vite + three.js with HMR; backend drives the sidebar + notifications), and `http-client` (a Postman-style request builder whose backend runs `fetch` with no CORS and persists history). They double as scaffold templates.
- **In-app editor (0.4.1).** The command palette (`⌘⇧P`, "Extensions") now offers, per installed extension, **Open**, **Edit** (opens its backend source — or `manifest.json` — in the [editor surface](/features/file-explorer-and-editor/), the live edit → HMR loop), and **Remove**, plus **New Extension…** to scaffold from a template.

Extensions are **fully trusted** — there is no sandbox; manifest `permissions` are advisory. Install only what you trust, exactly as you would a shell script.

## 0.3.183 — Workspace screenshots

- **`ht screenshot workspace` (0.3.183).** The screenshot CLI now captures a whole **workspace** — the bounding box of every visible pane — alongside the existing single-pane (default) and whole-window (`window` / `--full-window`) targets. `ht screenshot workspace [id]` or `--workspace [id]` targets the active workspace (or a specific one). A hidden/background target now falls back to the full-window grab instead of an empty crop. See [Surfaces & I/O](/cli/surfaces-and-io/#screenshot).

## 0.3.182 — Reliability, performance & CLI hardening

A second pass over the code review (`doc/full_app_review_2026-05.md`) closed the remaining critical/high findings — graceful-shutdown data loss, idle CPU, agent-cost runaways, a native sideband-XSS gap — plus internal cleanups. Newest first.

### Security

- **Native sideband HTML/SVG is now sandboxed (0.3.181).** Display-only `html` / `svg` panel content (inline `meta.data` or fd 4 frames) renders inside a strict-CSP `<iframe sandbox>` on the native app too — not just the web mirror — so a careless or compromised sideband producer can't run script with the app's full IPC privilege. A panel that needs to forward DOM events still opts into the direct path by setting `interactive`. See [Binary data (fd 4)](/sideband/data-fd4/).

### Performance & reliability

- **No more silent data loss on quit (0.3.174).** Closing the window, ⌘Q, Dock-quit, or the last surface exiting now reliably persists your layout, settings, cookies, and browser history. (macOS GUI quits bypass the Unix signals the previous save path relied on, so those saves were being skipped on the common exit paths.)
- **Idle CPU drops sharply (0.3.179).** The 1 Hz process-metadata poller now backs off (1s → 2s → 4s, capped 5s) while a terminal is idle and unchanging, snapping back to 1s the instant output, a pane open/close, or window focus changes. An idle-but-focused terminal goes from ~6–9% of a core to a trickle; an active one is unchanged.
- **Effects stop burning idle cycles (0.3.173).** WebGL bloom no longer re-renders on every cursor blink and pauses for background (non-visible) workspaces; the Process Manager's CPU / RSS columns also stopped freezing.
- **Auto-continue can't run up a bill (0.3.175).** The agent auto-continue engine now applies its cooldown and runaway gates *before* consulting the model, so a chatty or looping agent no longer triggers a paid round-trip per turn-end notification; the "agent looped" notice is logged once per episode instead of every time.
- **Crashed agent panes are recoverable (0.3.176).** When a pi agent subprocess exits, its pane now disables input, shows "Agent process exited (code N)", and offers a one-click **Restart agent** — previously the input stayed live and silently swallowed everything you typed, with no way to recover.
- **Web-mirror sidebar parity fix (0.3.180).** The workspace card's shortened cwd and RAM figure now match the native sidebar exactly (the mirror used to show a different path form and rendered any sub-1 MB process as a bogus `0M`).

### Architecture & tooling

- **`ht` CLI internals split (0.3.182).** The 2,361-line CLI entry was broken into a thin `bin/ht` plus testable `src/cli/` modules (flags, RPC transport, command mapping). No command, flag, or output change.
- **pi-agent manager dead-code removal (0.3.177).** Dropped ~200 lines of an unused Promise-based agent IPC path; the live fire-and-forget path is unchanged.
- **Metadata poller test coverage (0.3.178).** The previously-untested 1 Hz orchestration gained 11 tests via injectable subprocess runners. Pure internal hardening.

## 0.3.172 — Security review & architecture hardening

A full code review (`doc/full_app_review_2026-05.md`) drove a wave of security ship-stoppers, dependency/tooling cleanups, and an architecture decomposition. Newest first.

### Security (0.3.161 → 0.3.167)

- **Web mirror honours your bind + auth token on auto-start (0.3.161).** Previously the auth token (`webMirrorAuthToken`) and `127.0.0.1` bind were applied only via the manual Settings toggle; when the mirror auto-started at launch (or its port changed) it silently bound `0.0.0.0` with **no auth**. Fixed — your configured token / loopback bind now take effect on auto-start.
- **Telegram allow-list defaults to empty and fails closed (0.3.161).** `telegramAllowedUserIds` no longer ships a hardcoded id, and an empty allow-list now **rejects all** inbound messages + notification-button taps (was: accept-anyone). Enter your numeric Telegram id in **Settings → Telegram** to enable remote control.
- **Sideband HTML/SVG sandboxed in the web mirror (0.3.161).** Inline panel `meta.data` markup now renders in the same sandboxed `<iframe>` (CSP `script-src 'none'`) as binary frames, closing a LAN-XSS hole.
- **Live auth-token rotation (0.3.162).** Changing the mirror token / bind in Settings now takes effect without a restart; rotating the token also clears the brute-force cooldown.
- **`ht browser navigate` rejects `file://` (0.3.162).** Prevents reading arbitrary local files via a pane over the socket; `http(s)://`, `about:`, `data:`, `chrome-extension://` still work. `browser.eval` / `addscript` / `addstyle` now share a 256 KiB payload cap.
- **More hardening (0.3.162).** Brute-force throttle keyed on the real peer IP (not a spoofable header); settings + cookie files are created `0600` from the first byte (+ `fsync` for power-loss durability); the on-disk log redacts Telegram / auth tokens.
- **Opt-in RPC socket token (0.3.163, default off).** **Settings → Network → "Require RPC socket token"** gates state-mutating `ht` commands (typing into panes, killing processes) behind a per-boot token; read-only diagnostics stay open. Defense-in-depth against opportunistic same-user processes — not a hard boundary. New env override `HT_RPC_TOKEN_PATH`.
- **All dependency-audit vulnerabilities cleared (0.3.167).** `bun audit` went 7 → 0 via targeted `overrides` (ws, ip-address, brace-expansion, basic-ftp).

### Architecture & tooling (0.3.164 → 0.3.172)

- **xterm migrated to `@xterm/xterm@6` (0.3.164).** The webview core is now aligned with the v6 addons + headless it already used (the deprecated unscoped `xterm@5.3.0` is gone). No user-facing change.
- **ask-user modal gets High-Contrast styling (0.3.164).** The "This will execute on your machine" confirm prompt previously fell through to default styling in Windows High Contrast / `prefers-contrast` (the CSS targeted a class the modal never emits). Fixed.
- **Settings schema versioning (0.3.165).** `settings.json` now carries a `__schemaVersion` + an ordered migration runner, so a future field rename/removal won't silently drop your data.
- **Supply-chain hygiene (0.3.166).** A Renovate config + a non-blocking dependency-vulnerability scan (`bun audit`) in CI.
- **eslint fixed + wired into CI (0.3.168).** A flat eslint config scoped to the project's authored TypeScript (the previous config crawled `.claude/` git worktrees → ~22k bogus errors and was never run).
- **`SurfaceManager` decomposition (0.3.169 → 0.3.171).** The browser / Telegram / editor / agent surface concerns were extracted into dedicated controllers — ~285 net lines out of the 2,700-line module. Pure internal refactor; no behavior change.
- **Brand consolidation (0.3.172).** Brand identifiers centralized in one module; the `ht` CLI now prints "τ-mux" rather than "HyperTerm Canvas". (The config dir, bundle id, and socket name stay for back-compat.)
- **CI / release gates.** The release workflow now runs typecheck + tests before uploading binaries; CI re-runs the functional (non-pixel) web-mirror security e2e specs and lints on every push.

### Earlier 0.3.x (0.3.150 → 0.3.160)

- **Command palette completeness (0.3.150).** ~30 more verbs reachable via ⌘⇧P — workspace, pane, browser, theme, and editor operations.
- **CLI rename verbs auto-detect (0.3.151).** `ht rename-workspace NAME` / `ht rename-surface NAME` resolve the target from `HT_SURFACE` when run inside a pane (no `--workspace` needed).
- **IME candidate positioning (0.3.153).** Native + web mirror no longer force xterm's helper textarea off-screen, so IME candidate windows appear at the cursor.
- **Ask/plan prompt opacity + top-layer reliability (0.3.154 → 0.3.158).** Prompts render as global blocking overlays with an opaque sheet + scrim; root-caused to the native webview not loading the `--ht-*` design-token stylesheet (now linked into `index.html`).
- **Web mirror terminal-sizing parity (0.3.160).** Web/native cell math aligned (pane padding, resize plumbing, a sub-pixel epsilon) so `clear` no longer surfaces a stray `%` and long lines don't wrap a column short.

## 0.3.x — Triple-A polish (Phases 6 → 9)

The 0.3 series ran a multi-phase polish push grading every feature against an S/A/B/C rubric and lifting concrete gaps to a higher grade in each session. The work is tracked in `doc/feature_grades.json` + `doc/feature_grades.md` + per-phase `doc/tracking_feature_upgrade_to_AAA_phase*.md` files in the repo.

### 0.3.146 → 0.3.148 — Phase 9 follow-up (B-grade gap closures)

- **Workspaces — strict `layout.json` validator.** `src/shared/layout-persistence.ts` exports `validatePersistedLayout` + `parsePersistedLayout` (pure functions). Walks the full shape: top-level `activeWorkspaceIndex` (integer in `[-1, len]`), `sidebarVisible` (boolean), `workspaces` (non-empty array), each workspace's required + optional record fields, every `PaneNode` subtree (`leaf` with valid `surfaceId` + optional `SurfaceKind`, or `split` with valid `direction` + `ratio` in `[0,1]` + exactly 2 valid children). `loadLayout` in `src/bun/index.ts` now calls `parsePersistedLayout`. A truncated `layout.json` (fsync interrupted, disk full, kernel panic mid-write, rsync of a partial backup) now boots to a clean slate rather than throwing downstream in `collectLeafIds` / `remapPaneNode`. **26 new tests** cover happy paths + every parse-failure mode + every shape-mismatch mode.
- **Panel-registry — per-surface 256-cap with oldest-eviction.** `PanelRegistry` ctor takes an optional `maxPanelsPerSurface` (default 256, exported as `DEFAULT_MAX_PANELS_PER_SURFACE`). When a new id arrives and the per-surface map is at the cap, the oldest entry (smallest `createdAt`) is evicted before insertion. Updates to existing ids never trip the cap. Cap clamped to ≥ 1 so a bogus `0` / negative arg degrades gracefully. A runaway script that emits a fresh panel id every tick can no longer leak the registry. **13 new tests.**
- **Sidebar file explorer — symlink-cycle protection.** `SidebarFileExplorerEntry` gains two optional fields: `linkTarget: string | null` (resolved realpath of a symlink, null for dangling links) and `cycle: true` (set when the realpath equals the listed directory or any ancestor). The new `isAncestorOrSelf(candidate, root)` helper correctly anchors on the path separator so `/foo` is NOT mistakenly treated as an ancestor of `/foobar`. The webview can now refuse navigation into a loop with a clear "this would loop" affordance instead of letting the user walk into the cycle. **9 new tests.**

### 0.3.145 — Phase 9 first push (observability)

- **CI coverage gate.** `.github/workflows/ci.yml` gains a `coverage-gate` job running `bun run test:coverage` then `bun run report:coverage:check` on macOS-14 in parallel with the existing typecheck-and-unit job. A per-file lines-hit-ratio regression beyond the 0.5pp slack baseline at `tests/baselines/coverage-baseline.lcov` fails the build. To lower the floor: `bun run baseline:coverage` locally and commit the new baseline (review-gated). 4 source-grep tests in `tests/ci-coverage-gate.test.ts` lock in the job declaration.
- **Logger size-based rotation (logging A → S).** `src/bun/logger.ts` now rotates by size in addition to date. When the active file exceeds `HT_LOG_MAX_BYTES` (50 MiB default, ≤ 0 disables) it's renamed to `app-DATE.<n>.log` and a fresh `app-DATE.log` opens. `tail -f app-DATE.log` always follows the newest chunk; numbered chunks form the archive. `bytesInActive` is seeded from `fstatSync` on open so a same-day restart picks up where it left off. The 14-day prune pattern matches the numbered variants too.
- **Project `CHANGELOG.md` populated.** `bun scripts/bump-version.ts patch --changelog` was run against the real repo to seed `CHANGELOG.md` at the repo root with 312 commits since v0.2.30, grouped by conventional-commit type. Future bumps via `--changelog` prepend new sections.

### 0.3.143 → 0.3.144 — Phase 8 (release engineering)

- **`scripts/bump-version.ts` C → A.** Five new flags + two-tier rollback:
  - `--commit` — creates a `chore(release): vX.Y.Z` commit staging only the seven version-tracked files. Refuses on dirty trees unless `--allow-dirty`.
  - `--tag` — annotated `vX.Y.Z` at HEAD (implies `--commit`); refuses to overwrite existing tags.
  - `--changelog` — generates / extends `CHANGELOG.md` with a conventional-commit-grouped section (feat / fix / perf / refactor / docs / test / chore / other). Empty sections skipped. Range = `$(prev-tag)..HEAD`.
  - `--allow-dirty` — bypass the working-tree-clean check.
  - `--dry-run` — print everything without writing or git-touching.
  - **Two-tier rollback.** File-phase snapshots restored on any update throw (CHANGELOG.md deleted if it didn't pre-exist). Git-phase LIFO undo-stack resets the commit if `--tag` fails afterwards.
  - **`BUMP_VERSION_ROOT` env override** lets tests sandbox the script against a tmpdir without mocking. 12 new tests.
- **`scripts/post-package.ts` cross-platform.** Previously hard-exited on non-macOS. Now branches three ways: `macos` (full pipeline — Info.plist patch via PlistBuddy, `.tar.zst` rebuild, DMG rebuild via hdiutil), `linux` (skip Info.plist + DMG; reuse the same `tar | zstd` shell pipeline with the Linux-flat `APP_DIR_NAME` `tau-mux/` instead of `tau-mux.app/`), `other` (Windows, BSD, … keep the old skip-with-message behaviour). 9 new tests.
- **`tau-focus-audit` C → A.** Wired into `bun test` via a happy-dom fixture suite (`tests/tau-focus-audit.test.ts`, 10 tests). A chromatic-glow leak in chrome CSS now fails the build instead of waiting for someone to open DevTools.

### 0.3.4 → 0.3.142 — Phase 7 close (Cluster H + F.10)

The Phase 7 push ran 43 sessions plus a finish run, closing the two long-standing structural items the masterplan was tracking.

- **Cluster H — `audit:theming` clean for the first time across both CSS files.** ~1013 hard-coded colour literals across `src/views/terminal/index.css` and `src/web-client/client.css` are now zero — every literal sits behind an `--ht-*` CSS custom property. The vocabulary totals **200+ tokens** grouped by family:
  - `--ht-vnext-*` (post-Phase-6 redesign palette — 20+ tokens covering text scale, surface chrome, status colours, sheet shells).
  - `--ht-agent-*` (pi-agent panel — 35 tokens covering toolbar, badges, dropdowns, code/think/tool-call states, msg bubbles, slash menu, confirm dialog, input bar, status chips).
  - `--ht-window-*` (window-theme shell — titlebar / sidebar / surface / overlay / toast).
  - `--ht-sidebar-v2-*` (sidebar v2 log / stat / script-pulse / server-dot status palette).
  - `--ht-telegram-*` (telegram pane chrome).
  - `--ht-web-*` (web-mirror exclusive — 39 tokens for status glows, sidebar drawer, WM overlays, telegram extras, tau-meter glow trio).
  - `--ht-contrast-*` (`@media (prefers-contrast: more)` border bumps).
- **Cluster F.10 — webview-handler extraction.** The 82-method / 671-line `bunMessageHandlers` inline block in `src/bun/index.ts` is extracted into 13 per-domain modules under `src/bun/webview-handlers/` (clipboard, viewport, surface, reply, workspace, notification, system, browser, agent, telegram, editor, ask-user + `types.ts` + `index.ts` aggregator). `satisfies BunMessageHandlers` exhaustiveness is preserved via `BunMessageHandlerSlice<K> = Pick<BunMessageHandlers, K>` plus a getter-backed late-binding pattern. `src/bun/index.ts` shrinks 3471 → 2860 lines. Zero behaviour change. 2823 / 2823 tests pass.
- **Theme-token test suite.** Grew 0 → 619 source-grep tests asserting per-region migrations to the token vocabulary.

### 0.3.0 → 0.3.3 — Web mirror parity (M11 → M18, minor bump at M17)

The M11 → M17 plan brought the web mirror to feature parity with the native sidebar; the M18 series chased the multi-pane terminal sizing tail down to zero drift.

- **M17 (0.3.0) — plan panel + logs polish (parity feature complete).** Plan panel is now a fourth persistent sidebar zone (ordered first: `[plan, notif, main, log]`) owned by `createSidebarView`. The dispatcher routes `plansSnapshot` + `autoContinueAudit` envelopes through `sidebarView.setPlans` / `setAutoContinueAudit`. Auto-continue audit hides when the user disables auto-continue natively. Logs zone gains per-row level badge (info / warning / error / success) + `HH:MM:SS` timestamp + source label + body, with click-to-copy.
- **M16 (0.2.90) — pane chrome chips + `paneGap` from settings.** Web mirror's pane DOM renamed from `.pane-bar*` / `.pane-chip*` to `.surface-bar*` / `.surface-chip*`, mirroring native. Shared `renderSurfaceChips` extracted to `src/shared/pane-chips.ts`. `paneGap` flows from settings on every layout pass. Focus ring follows `--ht-border-focus` token.
- **M15 (0.2.89) — floating notification overlay.** When a notification arrives carrying a `surfaceId`, the browser mirror anchors a card stack inside that pane (top-right) — same DOM + auto-dismiss + hover-pause + +N overflow pill semantics as native. Up to 3 cards visible per surface; older cards collapse into an overflow pill. Driven by the M11 settings broadcast (`notificationOverlayEnabled`, `notificationOverlayMs`).
- **M14 (0.2.88) — manifest cards (npm + Cargo).** `package.json` and `Cargo.toml` cards render in the web mirror's workspace card via shared `renderManifestCard`. Header with icon + name + version + type chip; expanded body shows description + `bin` chips + per-script action rows with state dots. Cargo card auto-derives default subcommands (`build`/`run`/`test`/`check`/`clippy`/`fmt`). Per-manifest expand/collapse persists in localStorage. `runScript` deferred for web mirror v1 (clicks fire a Web Notification + dispatch the same `ht-run-script` window event the native sidebar uses; real surface spawning tracked as M14-1).
- **M13 (0.2.87) — rich sidebar workspace cards.** Each workspace card renders the same content shape as native: 3 px coloured stripe, header with dot + name + pane-count badge, focused command + listening-port chips (+N overflow past 3), aggregated CPU + RAM with rolling sparkline, pinned-CWD chip row, collapsible pane list, status pills via shared `renderStatusEntry`, OSC 9;4 progress bar. Shared `buildSidebarWorkspaces` projection in `src/shared/sidebar-state.ts`. New `selectWorkspaceCwd` envelope (client → server) when the user pins a CWD; v1 stores in localStorage and the server hook is null-safe so bun-side wiring is deferred without breaking the protocol contract.
- **M12 (0.2.86) — bottom status bar.** 26 px fixed bar at the foot of the browser mirror runs the same data-driven `renderStatusKey` registry the native bottom bar uses — workspace identity, CPU/mem meters, focused fg / cwd / branch, plus `ht set-status` bridge keys. Three zones (identity / meters / focus) match the native split. `src/views/terminal/status-renderers.ts` + `status-keys.ts` moved to `src/shared/`; `Meter` extracted to `src/shared/tau-meter.ts`. `tau-primitives.ts` re-exports for back-compat.
- **M11 (0.2.85) — theme + settings broadcast.** New `settingsSnapshot` and `htKeysSeen` envelopes on the v2 protocol carry theme preset + ANSI palette + font + density + status-bar key order + `ht set-status` discovery list to every connected web client. Sensitive fields (auth token, telegram bot token, allowed user ids) are intentionally dropped by `pickWebSettings` and never reach the wire. The browser mirror switches palette without reload when the user picks a different theme natively.
- **M18 (0.3.3) — multi-pane terminal sizing.** New `src/shared/xterm-fit.ts` ports the native webview's `fitSurfaceTerminal`: bails on zero parent dimensions, reads cell metrics from the render service, calls `_renderService.clear()` before `term.resize` so fresh metrics replace cached ones, subtracts `.xterm` CSS padding from the cell-count math. `applyLayout` writes inline rects → forces a CSS layout flush via `void termEl.offsetHeight` → calls `fitTerminal` per pane in the same tick. The deferred-rAF fit pass is gone. `applySettings` re-fits on `fontSize` / `fontFamily` / `lineHeight` change.
- **0.3.1 sizing fix.** Per-pane `fit()` now refits each pane to its own container (pre-fix, all panes were forced to the SERVER's authoritative size). Status bar no longer clips the last terminal row.

### Native sidebar CWD file explorer

- **Workspace cards always show CWD.** The webview sidebar renders a CWD row for every workspace card, including single-CWD cards and metadata-unavailable states.
- **Native-only file explorer.** Collapsible explorer rooted at the selected workspace CWD, with lazy per-directory listing, refresh, dotfile + max-entry Settings controls. Native-only — the HTTP mirror is not wired for it (yet).
- **AAA polish.** Filtered-count summaries (shown / hidden / ignored), root path header, richer file metadata (size + modified time), accessible `role="tree"` / `role="treeitem"` semantics, stronger focus states, "New File" action that opens a create-enabled CodeMirror editor split.

### CodeMirror editor pane

- **Editor surface (`editor:*`).** A native webview-only editor pane backed by CodeMirror 6. Files open from the sidebar file explorer or via `ht edit` / `ht editor ...`. Edits in a split pane, save with `⌘S`, reload, close, restore across layout persistence.
- **Editor file RPC.** Bun performs local text-file reads and atomic saves with binary / large-file guardrails and mtime conflict detection. HTTP mirror not wired for editor panes in this iteration.

### `ht run-in-split` pane readiness

- **Wait for the new pane before typing.** The pi `ht-bridge` extension snapshots `surface.list`, handles legacy `surface.split` responses that only return `"OK"`, polls until the new surface appears, and only sends the command after `surface.wait_ready` confirms the new terminal metadata is observable. Times out cleanly without losing input.
- **`surface.split` returns the created surface id when available.** Internal split dispatch passes the requested source surface / CWD through and returns `{ id }` for synchronous split creation, keeping `"OK"` as a compatibility fallback.

## 0.2.82

- pi-extensions/ht-bridge: active-label and `agent_end` summaries now follow the live pi session model (auth + base URL match too). Switching pi from Haiku to Sonnet retargets the summariser without a config edit. New `useSessionModel` flag (default `true`) + `PI_HT_BRIDGE_USE_SESSION_MODEL` env override; the existing `provider` / `modelId` pair is now the fallback path.
- claude-integration: new `tau-mux` Claude Code skill at `claude-integration/skills/tau-mux/SKILL.md`. Mirrors the *active* / LLM-callable side of `pi-extensions/ht-bridge` (plans → `.claude/plans/<name>.md` review-gated via `ht ask choice` then `ht plan set`, `ht ask {yesno|choice|text|confirm-command}` for structured questions, milestone `ht notify`, `ht new-split` + `ht send` for long-running processes, `ht browser` for verification, `ht screenshot` for evidence, `ht set-status` / `ht set-progress` for in-progress signals, bash-safety gating). The runtime hook bridge keeps owning the passive pills (active label, cost ticker, idle/permission). `install.sh` now installs both pieces; `SKIP_HOOKS=1` / `SKIP_SKILL=1` for partial installs.

## 0.2.x

- Telegram bridge: chat pane, long-poll bot service, SQLite log, `ht telegram` CLI, optional notification forwarding.
- Sharebin: drop-and-share files served from the web mirror.
- Browser pane improvements: 40+ `ht browser` commands, address bar with smart URL detection, force dark mode, terminal link interception.
- Process Manager: collapse/expand per surface, port chips inside rows, summary header.
- Live process metadata: git state (branch, ahead/behind, dirty counts) added to the per-surface payload, TTL-cached.
- Web mirror: protocol v2 envelopes, resume-on-reconnect via 2 MB ring buffer, `@xterm/headless` snapshot replay, constant-time token comparison.
- Workspace package.json card with one-click script run + green/red/grey state dots.

## 0.1.x

- Initial public preview.
- Workspaces, tiling splits, draggable dividers.
- xterm.js + `Bun.spawn` PTYs.
- Sideband protocol (fd 3/4/5) with Python + TypeScript clients.
- Floating canvas panels.
- `ht` CLI for socket-driven control.
- Web mirror v1.
