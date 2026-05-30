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

## Pending — post-0.3.172 reliability & performance wave

- **Graceful persistence on macOS GUI quit (C3, v0.3.174).** Window-close, ⌘Q,
  Dock-quit, and last-surface-exit go through Electrobun's `quit()` →
  `forceExit(0)` and never deliver SIGINT/SIGTERM, so layout / settings /
  cookies / browser-history saves were silently skipped on the common exit
  paths. Now an idempotent `persistAndCloseSync()` runs from
  `Electrobun.events.on("before-quit", …)` (and is shared by the existing
  SIGINT/SIGTERM `gracefulShutdown`). No user-facing API/CLI change — fold into
  the changelog only.
- **Performance wave (v0.3.173).** Bloom/WebGL effects no longer re-render on
  every cursor blink (H5) and pause for background (non-visible) workspaces
  (H6); Process Manager CPU/RSS now refresh on small deltas instead of staying
  frozen (H7). Changelog-only.
- **Auto-continue cost gates (H8 + 10.2, v0.3.175).** The auto-continue engine
  now runs its deterministic cooldown and runaway gates *before* any paid model
  call, so a chatty or runaway/looped agent can no longer trigger an
  Anthropic round-trip per turn-end notification. The "agent looped" audit
  entry is now emitted once per loop episode instead of every notification.
  Changelog-only (no API/CLI surface change).
- **Crashed agent recovery (H13, v0.3.176).** When a pi agent subprocess exits
  (crash / OOM / self-exit), the agent pane now disables its input + send
  button, shows an "Agent process exited (code N)" banner, and offers a
  one-click **Restart agent** button — previously the input stayed enabled and
  silently swallowed every keystroke with no way to recover. Changelog-only.
- **Dead-code removal in the pi-agent manager (H12, v0.3.177).** Deleted the
  unused Promise-based `send()` + ~25 typed wrappers + `responseWaiters`
  machinery from `PiAgentInstance` (−199 lines); the agent IPC has always used
  the fire-and-forget `sendNoWait` path. Internal-only, no behavior change —
  changelog-only if mentioned at all.
- **Metadata poller test coverage (H14, v0.3.178).** Made the four subprocess
  runners (`ps`/`lsof`/`git`) injectable on `SurfaceMetadataPoller` (defaulting
  to the real impls) and added 11 orchestration tests for the previously
  untested 1 Hz `tick()` (emit-on-change, cpu/rss delta gate, dead-surface
  eviction, prune-on-empty, git TTL + multi-repo). Internal hardening, no
  behavior change — not user-facing.
- **Adaptive idle polling cuts idle CPU (§5.3, v0.3.179).** The 1 Hz process
  metadata poller now backs off (1s → 2s → 4s, capped 5s) while a terminal is
  idle and unchanging — instead of spawning `ps`/`lsof` every second forever —
  snapping back to 1s the instant anything changes (output, a new/closed pane,
  window focus). An idle-but-focused terminal drops from ~6–9% of a core to a
  trickle; an active terminal is unchanged. Worth a one-line changelog mention
  (perf), no config/API surface.
- **Web-mirror sidebar parity fix (H11 leaf helpers, v0.3.180).** The workspace
  card's cwd-shortening and RAM formatting are now shared between the native
  sidebar and the web mirror, fixing drift where the web mirror showed a
  different shortened path and rendered any sub-1 MB process as a bogus `0M`
  (now `512K` etc.). Worth a one-line changelog mention (web-mirror parity bug
  fix); the full card-DOM unification is deferred.
- **Native sideband html/svg sandbox (H4, v0.3.181).** Display-only `html`/`svg`
  panel content (inline or fd4) now renders inside a strict-CSP sandboxed
  iframe on the **native** app too — not just the web mirror — closing a path
  where a sideband producer's markup could run script with the native webview's
  full (RPC-bridge) privilege. Interactive panels keep the direct path as a
  documented opt-in trust boundary. Worth a short security/changelog note;
  affects the sideband-protocol security docs (`doc/system-sideband-protocol.md`
  is now partly stale re: §7.6).
