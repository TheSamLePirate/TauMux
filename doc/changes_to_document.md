# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-05-30 — full sweep folded the post-`full_app_review_2026-05.md` work (security Waves 0–2 + vuln fixes, xterm v6 migration, settings schema versioning, supply-chain + eslint CI, the SurfaceManager H10 decomposition, brand consolidation) AND the prior 0.3.150 → 0.3.160 batch (command palette completeness, CLI rename auto-detect, IME positioning, ask/plan modal opacity + native design-token fix, web-mirror sizing parity) into:_

- `website-doc/src/content/docs/changelog.md` (en + fr) — new top section **"0.3.172 — Security review & architecture hardening"** grouping every entry by Security / Architecture & tooling / Earlier 0.3.x, covering v0.3.150 → v0.3.172.
- `website-doc/src/content/docs/api/system.md` + `cli/system.md` (en + fr) — version 0.3.172 (auto-propagated by `bump-version.ts`).
- `website-doc/src/content/docs/features/telegram-bridge.md` (en + fr) — access-policy section: `telegramAllowedUserIds` now empty-by-default + **fail-closed** (empty list rejects all inbound), with the security rationale (v0.3.161).
- `website-doc/src/content/docs/web-mirror/auth-and-hardening.md` (en + fr) — auth token + bind now honored on **auto-start** (v0.3.161 fix); new **"RPC socket token"** section (opt-in `rpcSocketRequireToken`, per-boot `socket.token`, `HT_RPC_TOKEN_PATH`, defense-in-depth threat model) (v0.3.163).
- `website-doc/src/content/docs/configuration/env-vars.md` (en + fr) — `HT_RPC_TOKEN_PATH`.
- `website-doc/src/content/docs/configuration/settings.md` (en + fr) — `rpcSocketRequireToken`, `telegramAllowedUserIds` (empty/fail-closed), `webMirrorAuthToken`/`webMirrorBind` auto-start note.
- `website-doc/src/content/docs/cli/browser.md` + `api/browser.md` (en + fr) — `navigate` rejects `file://` (allowed-schemes note); `eval`/`addscript`/`addstyle` share the 256 KiB cap (v0.3.162).

_(Always add new items below the cleared line above. When folding into the website, the version notes in api/system.md + cli/system.md + their French mirrors are auto-bumped by `bump-version.ts`; clear the backlog by overwriting the "Pending —" entries with a fresh "Backlog cleared <date> — …" line.)_

---

_Backlog cleared 2026-05-31 — folded the post-0.3.172 reliability/performance/
security wave (C3 graceful-shutdown persistence, the H5/H6/H7 perf wave, H8
auto-continue cost gates, H13 crashed-agent recovery, H12 dead-code removal, H14
poller test coverage, §5.3 adaptive idle backoff, H11 web-mirror sidebar parity,
H4 native sideband sandbox, §6.5 `bin/ht` split — v0.3.173 → v0.3.182) into:_

- `website-doc/src/content/docs/changelog.md` (en + fr) — new top section
  **"0.3.182 — Reliability, performance & CLI hardening"**, grouped Security /
  Performance & reliability / Architecture & tooling.
- `website-doc/src/content/docs/api/system.md` + `cli/system.md` (en + fr) —
  version 0.3.182 (auto-propagated by `bump-version.ts`).
- `website-doc/src/content/docs/sideband/data-fd4.md` (en + fr) — new
  **"Security: HTML & SVG are sandboxed"** section (H4): display-only html/svg
  renders in a strict-CSP `<iframe sandbox>` on native + web; `interactive: true`
  opts into the direct-DOM trust boundary.

_(Site builds clean: `cd website-doc && bun run build` — 137 pages, no broken
links.)_

---

## Pending — status-key UI polish

- **Status-key charts redesign + flicker fix (v0.3.184).** The `ht set-status`
  chart renderers got a visual overhaul (smooth curved line/area graphs with
  gradient fills + baseline grid + latest-value headline; gauges show the value
  centered in the arc; rounded bars/heatmap cells) and the sidebar workspace
  card now reconciles status entries **in place** on each update instead of
  rebuilding the whole grid — so a 1 Hz `ht set-status` tick no longer flickers
  every chart. Native + web mirror both updated. Worth a changelog line; the
  CLI/`set-status` surface is unchanged (`shareBin/demo_status_keys --live` is a
  good showcase).
- **Status-grid flicker fully fixed (v0.3.185).** The first pass reused entry
  nodes but still called `replaceChildren(...)`, which detaches + re-attaches
  every node (the browser repaints the whole grid each tick). Added a shared
  `reconcileChildren` that mutates the DOM minimally — a node already in its
  target position is never touched — and routed the status grid, the web card
  grid, and the native card's section list through it. Now only the entries
  whose value actually changed repaint. Changelog-only.

## Pending — AAA polish pass Wave 1 (flicker / scroll / resize)

- **Zero-flicker sidebar workspace cards (v0.3.187).** The workspace-card CPU
  bar, % / RAM / process chips, and sparkline now reconcile **in place** on
  each ~1 Hz metadata tick — only the values that actually changed are written,
  and the CPU-bar fill keeps its node identity so its transform transition
  animates smoothly instead of snapping. Cards also now refresh on live
  CPU/MEM movement (previously they only updated when a structural field like
  cwd/ports moved), while a *truly idle* workspace still triggers nothing
  (idle CPU stays ~0). Native webview + web mirror both updated.
- **Smooth sidebar resize (v0.3.187).** Dragging the sidebar divider no longer
  reflows every terminal grid on every frame (the "line-height jank"): the live
  drag now only repositions panes, and the authoritative terminal refit runs
  once on release — matching the existing pane-divider drag behaviour.
- **Terminal no longer jumps to the top on resize (v0.3.187).** Refits
  (sidebar/pane resize, and sideband-panel-triggered refits — which is why it
  bit pi-style agents harder) now preserve the user's scroll position in the
  scrollback. Alt-screen/fullscreen TUIs (vim, htop, less) are never touched.
- **Sideband panels never strand transparent (v0.3.187).** A panel created while
  the window was backgrounded could stay invisible (its fade-in depended on a
  rAF that WKWebView suspends). Panels now set their resting opacity
  synchronously; the entrance fade is a self-healing CSS animation.
- **No notification-overlay strobe (v0.3.187).** The on-terminal notification
  stack reconciles in place instead of tearing down + rebuilding every card on
  each arrival/dismiss, so existing cards keep their slide-in state and
  auto-dismiss countdown.

## Pending — AAA polish pass Waves 2–3 (memory / resilience / CLI)

- **Lower idle CPU + memory (v0.3.187).** Web-mirror bottom status bar now
  rAF-coalesces and skips repaints when nothing changed; native sidebar logs +
  global-stats strips reconcile in place instead of full rebuilds; metadata
  polling now backs off to an intermediate cadence when the window loses focus
  (not just when hidden). Several long-session leaks plugged: per-pane
  ResizeObserver/timers on the web mirror, the browser-pane hidden-state retry
  timer, auto-continue per-surface state on close, dead-workspace status/
  progress in the web state store, and the ask-user title cache (now capped).
- **More resilient services (v0.3.187).** A crash inside a Telegram inbound/
  callback handler can no longer demote the long-poll loop (so notifications +
  the `ht` socket keep working); a failed agent spawn/split now surfaces an
  `agent_exit` banner instead of an inert pane; the PTY stdout pipeline is
  guarded so a misbehaving output sink can't crash the terminal.
- **`ht` works from any shell (v0.3.187).** The `ht` CLI default socket path is
  now derived from the app's real config dir
  (`~/Library/Application Support/hyperterm-canvas/hyperterm.sock`) instead of
  the legacy `/tmp/hyperterm.sock`, so `ht` run from a terminal the app didn't
  spawn connects without an explicit `export HT_SOCKET_PATH`. `HT_SOCKET_PATH`
  still overrides; `ht doctor` still self-diagnoses drift.

## Pending — shareBin utility expansion

- **New shareBin visual utilities (v0.3.186).** Add documentation/changelog
  coverage for ten bundled commands: `show_logs` (live log viewer),
  `show_csv_profile` (CSV/TSV data profiling), `show_http` (HTTP response
  inspector), `show_mermaid` (Mermaid diagram renderer), `show_env`
  (environment diagnostics), `show_sqlite` (read-only SQLite browser),
  `show_ports` (live listening-port dashboard), `show_proc` (live process
  tree), `show_image_diff` (screenshot/image comparison), and `show_openapi`
  (OpenAPI/Swagger explorer). Include usage examples, stdin/file support notes,
  and limitations such as the first `show_mermaid` implementation using a CDN
  bundle.
