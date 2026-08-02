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

_Backlog cleared 2026-06-09 — Extension App Platform (v0.4.0 / v0.4.1) folded into:_
- `website-doc/.../changelog.md` (en + fr) — top section **"0.4.0 — Extension apps"**.
- `website-doc/.../features/extensions.md`, `cli/extensions.md`, `api/extensions.md` (en + fr).

---

_Backlog cleared 2026-06-10 — full sweep folded the v0.3.184 → v0.3.188 polish wave
(status-key chart redesign + flicker fixes, AAA Waves 1–3: zero-flicker sidebar
cards / smooth resize / scroll-preserving refits / panel + notification
reconciliation, idle CPU + leak fixes, service resilience, the `ht` config-dir
socket default, live Settings apply), the v0.3.186 shareBin expansion, AND the
v0.4.2 → v0.4.7 extension wave (Nebula, full SDK control-surface coverage,
vendored-SDK installs, pane fixes) into:_

- `website-doc/src/content/docs/changelog.md` (en + fr) — two new top sections:
  **"0.4.7 — Nebula, the full SDK surface & extension-platform fixes"** and
  **"0.3.188 — UI polish: zero-flicker rendering, smoother resize & live
  settings"** (Rendering & flicker / Feel & resilience / CLI & shareBin).
- `website-doc/src/content/docs/features/extensions.md` (en + fr) — vendored-SDK
  note, the full 17-domain SDK namespace table, Nebula added to the examples.
- `website-doc/src/content/docs/features/sharebin.md` (en + fr) — ten new
  utilities (show_logs, show_csv_profile, show_http, show_mermaid, show_env,
  show_sqlite, show_ports, show_proc, show_image_diff, show_openapi), each
  description verified against the script source.
- Socket-path corrections (en + fr): `configuration/env-vars.md`,
  `cli/overview.md`, `concepts/architecture.md`, `getting-started/
  installation.md`, `getting-started/quick-start.md`, `api/overview.md` — the
  default is now `<config dir>/hyperterm.sock`, not `/tmp/hyperterm.sock`.
- `api/system.md` + `cli/system.md` (en + fr) — version 0.4.7 (auto-bumped).

---

_Pending — desktop performance & reactivity wave (v0.4.8 → v0.4.11).
Plan: `doc/desktop-perf-plan.md` · Tracking: `doc/tracking_desktop_perf.md`._

- **Changelog (en + fr)** — new section **"0.4.11 — Desktop performance"**:
  - **Metadata poller rewritten on libSystem FFI (v0.4.8).** `ps` +
    two `lsof` calls per 1 Hz tick (~200 ms of CPU every second) replaced
    by `sysctl(KERN_PROC_ALL)` + `proc_pidinfo`/`proc_pidfdinfo`.
    Measured 135.8 ms → 2.42 ms per tick (56×); steady-state bun-process
    CPU dropped from 7–10 % to ~1 %. Falls back to `ps`/`lsof`
    automatically if self-validation fails or off macOS.
  - **More accurate CPU% in chips / Process Manager / sidebar (v0.4.8).**
    Derived from cumulative CPU-time deltas instead of `ps`'s decaying
    average, so a process that just finished a burst no longer lingers
    at a high reading.
  - **Adaptive stdout coalescing (v0.4.10).** Keystroke echo no longer
    waits out the 8 ms batching window on a quiet terminal; batching
    still engages under sustained output.
  - **Optional GPU terminal renderer (v0.4.9, opt-in since v0.4.11).**
    New `terminalRenderer` setting (`dom` default, `webgl` opt-in) plus a
    command-palette toggle. **Document it as experimental** — it shipped
    on by default in v0.4.9 and rendered panes blank; the cause is not
    yet confirmed.
- **`configuration/settings.md` (en + fr)** — new `terminalRenderer`
  field: values, `dom` default, the experimental caveat, and the
  automatic DOM fallback on unsupported hardware / context loss.

---

_Pending — v0.4.12 audit-remediation wave (`doc/full_app_review_2026-08.md`,
everything except §2.1 web-mirror defaults, which the user deferred):_

- **`web-mirror/auth-and-hardening.md` (en + fr)** — the **RPC socket token
  is now ON by default** (`rpcSocketRequireToken: true`, §2.5). Rewrite the
  section that describes it as opt-in. Cover: the token file is written on
  every launch regardless; the bundled `ht`, the pi ht-bridge, the extension
  SDK and the claude-integration bridge all read it automatically, so no
  first-party workflow changes; read-only diagnostics
  (`system.ping`/`version`/`identify`/`capabilities`/`health`/`tree`) stay
  open so `ht doctor` still works against a mismatched token; and the escape
  hatch for a third-party client that speaks the socket protocol directly.
- **`configuration/settings.md` (en + fr)** — `rpcSocketRequireToken` default
  flips `false` → `true`.
- **NEW page or a large section under `features/` — "Extensions & trust"
  (en + fr).** This is the important one: the extension platform runs
  **fully trusted code** (install runs `bun install` incl. postinstall
  scripts; open runs the backend with a token granting the whole control
  surface). State the rule plainly — *install an extension only if you would
  pipe it to a shell*. Then what IS enforced: no network fetch of dev
  binaries (the `bun x` fallback was removed, §2.4), `enabled` enforcement,
  id validation, SIGTERM→SIGKILL escalation. And what is not: no
  install-time consent, no capability scoping, no manifest signing.
  Mirror `doc/system-security.md` § "Extensions are fully trusted code".
- **`cli/extension.md` + `api/extension.md` (en + fr)** — two new verbs:
  `ht extension enable <id>` / `disable <id>` (`extension.enable` /
  `extension.disable`). Note that disabling also **stops** any surface
  currently running the extension, and that a disabled extension now
  refuses to open (it silently launched anyway before v0.4.12).
- **`cli/extension.md` (en + fr)** — dev-server ports are now allocated
  per-instance: a manifest's `frontend.devPort` is a *preference*, and τ-mux
  walks to the next free port when it is occupied. Previously two
  devPort-less extensions (or any unrelated Vite project on 5173) collided
  and a pane could load the wrong app.
- **`changelog.md` (en + fr)** — new top section **"0.4.12 — Audit
  remediation"**, grouped Security / Correctness / Performance / Tooling:
  - Security: RPC socket token on by default; extension trust boundary
    documented + `bun x` network fallback removed; `enabled` enforced.
  - Correctness: CPU-sample pruning actually runs (was a no-op guard —
    the sample map never shrank); renderer palette toggle no longer
    inverted before settings load; `system.identify` reports `null`
    instead of a stale `/tmp/hyperterm.sock` when unwired; extension
    backends can no longer outlive the app.
  - Performance: the webview's 1 Hz status-bar tick is skipped while the
    window is hidden (it was rebuilding the whole status-key subtree every
    second to compute a skip-hash, even when occluded).
  - Tooling: coverage gate now reports files it isn't gating (it had been
    blind to ~2,000 LOC since 2026-05-16); new module-size ratchet.
- **`configuration/settings.md` (en + fr)** — the Renderer field now shows a
  live "Currently running on DOM — <reason>" hint when the GPU renderer has
  fallen back (unsupported / init-failed / context-lost). Worth a screenshot.
- **`changelog.md` (en + fr) — ADD to the 0.4.12 section, under a
  "Fixed for real this time" heading.** v0.4.11 reverted the GPU renderer
  default to `dom`, but that only helped *new* installs: anyone who ran
  v0.4.9/v0.4.10 had `"webgl"` written to settings.json, so the revert never
  reached them and their panes stayed blank. v0.4.12 adds a one-time settings
  migration (schema v1 → v2) that resets a persisted `webgl` back to `dom`.
  Worth saying plainly in the changelog, because affected users have been
  looking at a blank terminal across two releases and won't connect it to a
  line about defaults. Note that re-enabling the GPU renderer after upgrading
  sticks (the migration runs once), and that the underlying WebGL fault is
  still unconfirmed — the renderer remains experimental.

---

_Pending — august-plan M1 "τ-mux sees Claude" (v0.5.0).
Plan: `doc/august-plan.md` · Tracking: `doc/tracking_august-plan.md`._

- **Changelog (en + fr)** — new top section **"0.5.0 — Claude Code
  integration, milestone 1"**:
  - **Full-lifecycle Claude Code awareness.** The ht-bridge now forwards
    fourteen hook events (was four): session start/end, prompt/stop,
    StopFailure, subagent start/stop, compaction, cwd changes, task
    created/completed, idle/permission notifications. A new app-side
    session registry tracks every Claude Code session's phase (working /
    waiting input / approval needed / compacting / error) per pane.
  - **`ht claude statusline`.** One-line install into Claude Code's
    `statusLine` setting: renders a τ-mux-styled status line (model,
    effort, dir, git branch, permission mode, PR, context bar, cost,
    +N/-N lines, rate-limit warnings ≥80%) AND feeds cost / context % /
    rate limits / session title into the τ-mux sidebar. Replaces the v1
    bridge's transcript parsing, hand-maintained pricing table, and the
    `pi`-based title sidecar — all numbers now come from Claude Code
    itself, so they always match `/cost` and `/context`.
  - **Smarter ticker + notifications.** `cc` pill shows
    `Opus · 42% ctx · $0.31`; turn-end notification carries prompt +
    duration + cost; API errors (rate limit / overload) get their own
    red state + notification; idle pauses change the pill only.
- **`cli/` new page or section (en + fr)** — `ht claude` verbs:
  `statusline` (install snippet), `sessions [--all]`, `event` (internal).
- **`api/` (en + fr)** — `claude.event` / `claude.statusline` /
  `claude.sessions` RPC methods + the ClaudeSessionState wire shape.
- **claude-integration install docs (en + fr)** — settings.snippet.jsonc
  now carries the full 14-hook block + statusLine; v1 installs only need
  the new blocks added (the four v1 event names are unchanged).

---

_Pending — august-plan M2 "τ-mux acts for Claude" (v0.6.0).
Plan: `doc/august-plan.md` · Tracking: `doc/tracking_august-plan.md`._

- **Changelog (en + fr)** — new top section **"0.6.0 — Claude Code
  integration, milestone 2"**:
  - **Remote approvals (opt-in).** Wiring the `PermissionRequest` hook
    (`ht claude install --features approvals`) routes Claude Code
    permission prompts to a τ-mux modal — and to Telegram when the
    bridge is configured — with Allow / Deny / "Answer in terminal".
    Fail-safe by construction: timeout, τ-mux absent, or any error →
    Claude Code's own terminal prompt appears, exactly as before.
  - **Native task-list mirror.** Claude Code's TaskCreated/TaskCompleted
    now project into the sidebar plan panel automatically (per session,
    `claude:<id>` slot) — no skill cooperation needed. Session end
    clears the panel. Works alongside pi plans (distinct agent slots).
  - **One-command install.** `ht claude install` wires hooks + statusline
    into `~/.claude/settings.json` with a timestamped backup, additive
    merge, idempotence, and refuse-on-parse-failure. `ht claude
    uninstall` removes exactly the managed entries. `ht claude doctor`
    reports binary/hooks/statusline/skill/app health in one screen.
  - **Auto-continue synergy** (composition, no new setting): the mirrored
    plan + the turn-end notification feed the existing auto-continue
    engine, so plan-anchored continuation now works for Claude Code
    sessions under the same engine gates.
- **`cli/` Claude Code page (en + fr)** — add `install` / `uninstall` /
  `doctor` verbs with the feature buckets
  (lifecycle / tasks / statusline / approvals) and the safety contract.
- **Security note (en + fr)** — approvals are answered from the modal or
  Telegram; the modal shows the exact tool + input (ground truth, no
  summarization); `HT_CLAUDE_APPROVALS=0` is the kill switch.

---

_Pending — august-plan M3 "Claude lives in τ-mux" (v0.7.0).
Plan: `doc/august-plan.md` · Tracking: `doc/tracking_august-plan.md`._

- **Changelog (en + fr)** — new top section **"0.7.0 — Native Claude Code
  pane"**:
  - **A first-class Claude Code surface.** Command palette → "New Claude
    Code Pane" (or split right/down) opens a native chat pane hosting a
    Claude Code session via the official Agent SDK — streamed responses,
    tool cards (command + file summaries), permission-mode switcher,
    live model/cost pills, interrupt (Esc or Stop), and a Sessions
    picker that resumes any previous Claude Code session in a split.
    Uses your own `claude` install and login; falls back to the SDK's
    bundled CLI.
  - **Tool approvals inside the pane** ride the same τ-mux modal (and
    Telegram forward) as the hook-level remote approvals; no answer →
    deny with a timeout message.
  - **Layout restore** re-mounts Claude panes as fresh sessions (resume
    from the Sessions picker) instead of leaking shells.
  - **Skill v2** — the plan section now defers to the automatic task
    mirror; shorter, more reliable activation.
- **features/ new page "Claude Code pane" (en + fr)** — screenshots,
  the resume flow, permission modes, and the trust note (the pane runs
  with `canUseTool` gating; approvals default to ask).
