---
title: Changelog
description: Notable changes — most recent at the top.
sidebar:
  order: 1
---

This page summarizes user-facing changes. The full commit log is on [GitHub](https://github.com/TheSamLePirate/TauMux/commits/main), and the project also ships a generated `CHANGELOG.md` at the repo root that groups commits by conventional-commit type (added in 0.3.145).

## 0.9.0 — The Claude Code pane, on the τ-mux design system

The pane now looks and behaves like a native τ-mux agent surface rather than a guest app.

- **Amber agent identity (§7).** A Claude session is a robot's session, so the pane now carries the same **amber** identity signal as the pi agent pane — identity dot, focused pane border, sidebar workspace card, and status-bar entry. At a glance you can tell an agent pane from your own cyan shells. (It previously rendered in the human cyan, with a Catppuccin palette inherited from the v1 hook bridge.)
- **Full palette/shape/motion alignment.** Every colour now comes from a TAU design token, radii use the token scale, telemetry is monospace with tabular numerals, and animation is limited to the canonical τ-mux keyframes. A new conformance test suite pins all of it so the palette can't drift again.
- **Grouped control strip.** Identity + status badge + model + permission mode on the left, live token/cost/elapsed meters and New · Sessions · Stop on the right. The phase is now spelled out in a status badge (`idle`, `working`, `approval needed`, `ended`) instead of being encoded only in a dot colour.
- **Working directory everywhere.** The pane shows its cwd immediately on open — in the header and as the same cwd chip terminal panes get — and it feeds the sidebar workspace card, so a Claude pane no longer sits at "resolving…".
- **Queued-message feedback.** Sending while a turn is in flight marks the message as queued and shows a footer chip, instead of appearing to do nothing.
- **Copy affordance** on finished assistant messages (hover), alongside the existing copy buttons on tool input/output.
- **`ht claude pane`** — open a Claude Code pane from the CLI or a script (`--cwd`, `--split`, `--direction`, `--resume`), mirroring `agent.create` for the pi pane. Also exposed as `claude.pane` over JSON-RPC and in the extension SDK.

## 0.8.0 — The Claude Code pane, full-featured

The [native pane](/features/claude-code-pane/) grows from a working v1 into the flagship surface:

- **Markdown transcript** with O(N) live streaming, code blocks, inline code, headers and lists; **thinking blocks** stream into a collapsed, pulsing block.
- **Tool cards v2** — status dot (running → ok/failed), one-line summaries, expandable full **input and matched output** (`tool_use_id` pairing) with copy buttons.
- **In-place sessions** — *New* starts a fresh session in the same pane; *Sessions* resumes (or **forks**) a previous one with its transcript replayed under a divider. The pane rebinds its SDK stream; the layout slot never changes.
- **Model switcher** (mid-session, via the SDK) next to the permission-mode switcher; `bypassPermissions` is highlighted red.
- **Inline approval status** — "Waiting for approval: Bash" appears in the transcript while the τ-mux modal / Telegram question is open; denials and timeouts leave a red record.
- **Meters + state** — token / cost / elapsed pills, a pulsing state dot, smart stick-to-bottom autoscroll with a ↓ latest pill, a proper empty state, and cwd inheritance: new panes start in the directory of the pane you were focused on.
- Composer: auto-growing textarea; **sending mid-turn queues** the message.

## 0.7.1 — Claude Code integration (milestones 1–3)

τ-mux becomes a first-class harness for Claude Code — plan: `doc/august-plan.md`. Three releases in one wave; see the rewritten [Claude Code integration](/integrations/claude-code/) page.

- **Full-lifecycle awareness (0.5.0).** The hook bridge now forwards **fourteen** Claude Code events (was four): session start/end, prompt/stop, API failures, subagent start/stop, compaction, cwd changes, task created/completed, idle/permission notifications. A per-session registry tracks each session's phase — working / waiting for input / **approval needed** / compacting / error — attributed to the pane it runs in. API errors get their own red state and an actionable notification ("Rate limited").
- **`ht claude statusline` (0.5.0).** One line in `~/.claude/settings.json` gives Claude Code a τ-mux-styled statusline (model, effort, dir, git branch, permission mode, PR badge, color-coded context bar, cost, ±lines, rate-limit warnings ≥80%) **and** feeds cost / context % / rate limits / session title into the sidebar ticker (`Opus · 42% ctx · $0.31`). These are numbers Claude Code computes itself — the old transcript parsing, hand-maintained pricing table, and the `pi`-based title generator are deleted; the pills now always match `/cost` and `/context`.
- **Remote approvals, opt-in (0.6.0).** `ht claude install --features approvals` routes Claude Code permission prompts to a τ-mux [ask-user modal](/features/ask-user/) — and to **Telegram** — with Allow / Deny / "Answer in terminal". Fail-safe by construction: any failure (τ-mux down, timeout, error) falls back to Claude Code's own prompt; the gate can only *add* an answer path. Approve a `Bash` command from your phone.
- **Automatic task mirror (0.6.0).** Claude Code's native task list projects into the [plan panel](/features/plan-panel/) deterministically (hooks, not model cooperation), per session, cleared on session end, coexisting with pi plans. Together with turn-end notifications this plugs Claude Code sessions into the existing [auto-continue](/features/auto-continue/) engine.
- **One-command install (0.6.0).** [`ht claude install / uninstall / doctor`](/cli/claude/) — timestamped backups, additive merge, idempotence, refuse-on-parse-failure, and a doctor that names exactly what's missing.
- **Native Claude Code pane (0.7.0).** A first-class surface hosting an Agent SDK session: streamed responses, tool cards, permission-mode switcher, interrupt, cost pills, and a **Sessions picker that resumes previous sessions**. Tool permissions ride the same modal + Telegram path. See [Claude Code pane](/features/claude-code-pane/).
- **Agent-teams pill (0.7.1).** With Claude Code's experimental agent teams enabled, a passive sidebar pill shows `3 members · 2/6 tasks` from the on-disk team state.
- New [`claude.*` JSON-RPC domain](/api/claude/) + `claude` namespace in the extension SDK.

## 0.4.12 — Audit remediation

Everything actionable from the 2026-08 whole-repo audit (`doc/full_app_review_2026-08.md`) except the web-mirror defaults (deferred).

- **Security — RPC socket token ON by default.** `rpcSocketRequireToken` now defaults to `true`: state-mutating socket calls require the per-boot token. Every first-party client (the bundled `ht`, the pi bridge, the extension SDK, the Claude bridge) reads it automatically, so nothing changes in normal use; read-only diagnostics stay open so `ht doctor` still works. See [auth & hardening](/web-mirror/auth-and-hardening/).
- **Security — extension trust boundary.** The `bun x` network fallback for dev servers was removed; the `enabled` flag is now actually enforced (a disabled extension refuses to open — previously it silently launched); new [`ht extension enable / disable`](/cli/extensions/) verbs; backends get a real SIGTERM→SIGKILL escalation so they can't outlive the app. The trust model is now stated plainly: **extensions are fully trusted code — install only what you would pipe to a shell.**
- **Correctness.** CPU-sample pruning actually runs (a guard made it a no-op — the sample map never shrank); the GPU-renderer palette toggle no longer shows inverted before settings load; `system.identify` reports `null` instead of a plausible-but-wrong socket path when unwired; extension dev-server ports are allocated per instance (two devPort-less extensions — or any unrelated Vite project on 5173 — could previously collide and load the wrong UI into a pane).
- **Fixed for real this time — blank GPU panes.** v0.4.11 reverted the renderer default to `dom`, but anyone who ran v0.4.9/v0.4.10 had `webgl` *persisted* in settings, so their panes stayed blank across two releases. A one-time settings migration (schema v1 → v2) resets a persisted `webgl` back to `dom`; re-enabling it afterwards sticks. The renderer remains experimental, and the settings panel now shows a live "running on DOM — <reason>" hint when the GPU renderer has fallen back.
- **Performance.** The webview's 1 Hz status-bar tick is skipped while the window is hidden (it was rebuilding the whole status-key subtree every second even when occluded).
- **Tooling.** The coverage gate now reports files it isn't gating (it had been blind to ~2,000 LOC of new files since May); a new module-size ratchet fails CI when an oversized module grows further.

## 0.4.11 — Desktop performance

The `doc/desktop-perf-plan.md` wave (v0.4.8 → v0.4.11).

- **Metadata poller rewritten on libSystem FFI (0.4.8).** `ps` + two `lsof` calls per 1 Hz tick (~200 ms of subprocess CPU every second) replaced by direct `sysctl(KERN_PROC_ALL)` + `proc_pidinfo` / `proc_pidfdinfo` calls: measured **135.8 ms → 2.42 ms per tick (56×)**; steady-state CPU of the main process dropped from 7–10% to ~1%. The module self-validates its kernel struct offsets at startup (own pid/cwd, a throwaway listener) and falls back to `ps`/`lsof` cleanly on any mismatch or off macOS.
- **More accurate CPU% (0.4.8).** Chips, Process Manager, and sidebar now derive CPU from cumulative CPU-time deltas instead of `ps`'s decaying average — a process that just finished a burst no longer lingers at a high reading.
- **Adaptive stdout coalescing (0.4.10).** Keystroke echo on a quiet terminal no longer waits out the batching window; batching engages only under sustained output.
- **Optional GPU terminal renderer (0.4.9, opt-in since 0.4.11).** New `terminalRenderer` setting (`dom` default, `webgl` opt-in) plus a command-palette toggle. **Experimental** — it shipped enabled in 0.4.9 and rendered panes blank on some setups; see the 0.4.12 note above for the persisted-setting migration.

## 0.4.7 — Nebula, the full SDK surface & extension-platform fixes

The extension platform's first hardening wave, plus a flagship example.

- **Nebula — a 3D HTTP API explorer (0.4.4).** A showcase extension: a full Postman-style HTTP client rendered as a living three.js scene with a glassmorphism HUD. It **discovers the dev servers running in your terminals** (via the process-metadata listening ports) and turns each into a one-click orbiting endpoint, fires requests through the scene (status-colored response rings, latency-mapped animation), and drives τ-mux from your API workflow — open a URL in a browser pane, send the request as `curl` into a new terminal split, live latency sparkline in the sidebar, notifications on failures. `ht extension install …/examples/extensions/nebula`. See [Extension apps](/features/extensions/#bundled-examples).
- **`@tau-mux/sdk` now types the complete control surface (0.4.7).** The typed facade grew from 6 curated namespaces to **all 17 RPC domains (~120 methods)** — including the full browser driver (click / type / eval / snapshot / cookies / console), agents (incl. `askUser` modals), telegram, editor panes, plans, auto-continue, audits, screenshots, and the extension platform itself — identical from the Bun backend and the Vite frontend. A two-directional coverage test keeps the SDK and the host registry in lockstep. (Also fixed: `sidebar.setStatus` previously targeted a non-existent wire name — it now correctly calls `sidebar.set_status`.)
- **Extensions install anywhere (0.4.6).** The SDK is vendored into each bundled example (`file:./vendor/tau-mux-sdk`), so `bun install` resolves offline in dev, installed, and packaged builds — previously a repo-relative path broke once the extension was copied into the config dir, leaving the pane blank.
- **Extension pane fixes (0.4.2 – 0.4.5).** The pane close button now stops the extension's backend + dev server (no process leaks); the status pill flips to "running" when the iframe actually loads; dev mode waits for the Vite server to listen before pointing the iframe at it; and a webview-init regression that disabled the command palette + title-bar double-click (a TDZ throw during module init) was fixed with a structural regression test.

## 0.4.0 — Extension apps

A new surface type: **extension apps**. An extension is a **Bun backend** (a real child process that can `bun install` its own deps) + a **Vite frontend** rendered in an `<iframe>` (hot-module reload while editing, built static once installed) + a typed **`@tau-mux/sdk`** that drives every τ-mux control surface — create panes, open browser surfaces, push notifications, set sidebar status, and more. Extensions are saved on disk, restored with your layout, and created / edited / removed from inside the app.

- **`extension` surface (0.4.0).** Open one in a pane like any other surface. Each running surface gets its own Bun backend (started fresh, stopped on close) and an iframe pointed at the Vite dev URL (HMR) or a built bundle served over a tiny loopback host. Saved with the workspace by extension id; on restart the surface + a fresh backend are restored (the extension reloads its own `state.json`), or the slot degrades to a terminal if the extension was uninstalled. See [Extension apps](/features/extensions/).
- **`@tau-mux/sdk` (0.4.0).** One typed surface from both halves of an extension — `notification`, `sidebar`, `surface`, `workspace`, `browser`, `system`, plus a raw `call(method, params)` to reach any [JSON-RPC method](/api/overview/). The backend talks over the unix socket; the frontend over a `postMessage` bridge the host dispatches through the same RPC the CLI uses.
- **`ht extension` CLI + `extension.*` API (0.4.0).** `list`, `templates`, `open`, `split`, `new`, `install`, `remove`, `reload`, `stop`. See [`ht extension`](/cli/extensions/) and the [`extension.*` API](/api/extensions/).
- **Bundled examples (0.4.0).** `hello` (zero-dependency static app — the fastest way to see the bridge), `three-demo` (Vite + three.js with HMR; backend drives the sidebar + notifications), and `http-client` (a Postman-style request builder whose backend runs `fetch` with no CORS and persists history). They double as scaffold templates.
- **In-app editor (0.4.1).** The command palette (`⌘⇧P`, "Extensions") now offers, per installed extension, **Open**, **Edit** (opens its backend source — or `manifest.json` — in the [editor surface](/features/file-explorer-and-editor/), the live edit → HMR loop), and **Remove**, plus **New Extension…** to scaffold from a template.

Extensions are **fully trusted** — there is no sandbox; manifest `permissions` are advisory. Install only what you trust, exactly as you would a shell script.

## 0.3.188 — UI polish: zero-flicker rendering, smoother resize & live settings

A focused quality pass on rendering churn, long-session memory, service resilience, and the Settings panel — plus ten new shareBin utilities.

### Rendering & flicker

- **Status-key charts redesigned + flicker-free (0.3.184 – 0.3.185).** The `ht set-status` chart renderers got a visual overhaul (smooth curved line/area graphs with gradient fills, baseline grid + latest-value headline, value-centered gauges, rounded bars/heatmap cells), and status grids now reconcile the DOM **minimally in place** — a 1 Hz `set-status` tick repaints only the entries whose value actually changed, on native and the web mirror. `shareBin/demo_status_keys --live` is a good showcase.
- **Zero-flicker sidebar workspace cards (0.3.187).** CPU bar, % / RAM / process chips, and the sparkline update in place on each metadata tick; the CPU-bar fill keeps its node identity so its transition animates instead of snapping. Cards now also refresh on live CPU/MEM movement, while a truly idle workspace still costs nothing.
- **No notification-overlay strobe (0.3.187).** The on-terminal notification stack reconciles in place, so existing cards keep their slide-in state and auto-dismiss countdown when new ones arrive.
- **Sideband panels never strand transparent (0.3.187).** Panels created while the window was backgrounded no longer depend on a rAF WKWebView may suspend — resting opacity is set synchronously, with a self-healing CSS entrance fade.

### Feel & resilience

- **Smooth sidebar resize (0.3.187).** Dragging the sidebar divider only repositions panes during the drag; the authoritative terminal refit runs once on release — no more per-frame reflow jank.
- **Terminal no longer jumps on resize (0.3.187).** Refits (sidebar/pane resize, sideband-panel triggers) preserve your scrollback position; alt-screen TUIs (vim, htop) are untouched.
- **Lower idle CPU + memory (0.3.187).** rAF-coalesced web-mirror status bar, in-place sidebar log/stat strips, metadata polling backs off when the window loses focus, and several long-session leaks were plugged (web-mirror per-pane observers/timers, browser-pane retry timer, auto-continue per-surface state, dead-workspace status in the web store, the ask-user title cache).
- **More resilient services (0.3.187).** A crash inside a Telegram handler can no longer demote the long-poll loop; a failed agent spawn surfaces an `agent_exit` banner instead of an inert pane; the PTY stdout pipeline is guarded against a misbehaving output sink.
- **Live, smooth Settings (0.3.188).** Dragging a slider no longer stalls per step — value-based change detection, rAF-coalesced apply, debounced persistence, and `applySettings` skips per-pane refit/layout work when the changed fields don't need it. Settings apply instantly, no Apply button.

### CLI & shareBin

- **`ht` works from any shell (0.3.187).** The CLI's default socket path is now the app's real config-dir socket (`~/Library/Application Support/hyperterm-canvas/hyperterm.sock`) instead of the legacy `/tmp/hyperterm.sock` — `ht` connects from terminals the app didn't spawn, no `HT_SOCKET_PATH` export needed (it still overrides; `ht doctor` diagnoses drift).
- **Ten new shareBin utilities (0.3.186).** `show_logs` (live log viewer), `show_csv_profile` (CSV/TSV profiling), `show_http` (HTTP response inspector), `show_mermaid` (Mermaid diagrams — first version renders via a CDN bundle), `show_env` (environment diagnostics), `show_sqlite` (read-only SQLite browser), `show_ports` (live listening-port dashboard), `show_proc` (live process tree), `show_image_diff` (image comparison), `show_openapi` (OpenAPI/Swagger explorer). See [shareBin](/features/sharebin/).

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
