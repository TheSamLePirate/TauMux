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
