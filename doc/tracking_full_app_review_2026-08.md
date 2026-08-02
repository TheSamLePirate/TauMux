# Tracking — `full_app_review_2026-08.md` remediation

**Plan:** `doc/full_app_review_2026-08.md`
**Scope agreed with the user:** implement everything **except §2.1** (web-mirror
`0.0.0.0` / empty-token defaults), which was explicitly deferred.
**Started:** 2026-08-02, from `cfaa406e` (v0.4.11).
**Shipped as:** v0.4.12 — commit `a50306cd`.

---

## Status

| § | Item | Severity | Status |
|---|------|----------|--------|
| 2.1 | Web-mirror LAN defaults | critical | **DEFERRED — user's call** |
| 2.2 | `pruneCpuSamples` dead guard | high | done |
| 2.3 | Extension `enabled` unenforced | high | done |
| 2.4 | Extension trust boundary | high | done (docs + `bun x` removal; capability scoping still open) |
| 2.5 | `rpcSocketRequireToken` off by default | high | done |
| 3.1 | Stale `?? "webgl"` fallbacks | medium | done |
| 3.2 | Coverage gate blind to new files | medium | done (both halves) |
| 3.3 | 1 Hz webview tick while hidden | medium | done |
| 3.4 | Dev-server port collision | medium | done |
| 3.5 | `stop()` kill escalation | medium | done |
| 3.6 | God modules growing | medium | done (ratchet) |
| 3.7 | `brace-expansion` override | medium | done |
| 4.1 | Renderer fallback invisible | low | done |
| 4.2 | `socketPath` plausible-lie default | low | done (deviated — see below) |
| 4.3 | Sandbox threat-model overclaim | low | done |
| 4.4 | `uncaughtException` runs on forever | low | done (fault budget) |

**Gates:** `bun run typecheck` clean · `bun test` **3170 pass / 0 fail** (262
files, up from 3136/260) · `bun run lint` 0 errors · `bun run audit:module-size`
clean · `bun run report:coverage:check` clean over **214** files ·
`bun audit` **no vulnerabilities** (was 2 high) · app launched and verified
by screenshot + live `ht` round-trips.

---

## Mid-flight discovery: the v0.4.9 blank-pane regression was never actually fixed

Found while verifying §2.5 against a running dev instance, after the user
reported "terminal is not rendered … shown a quick moment then not shown".

**What was wrong.** v0.4.9 shipped `terminalRenderer: "webgl"` as the
*default* and it left panes blank. v0.4.11 "fixed" it by flipping the default
back to `"dom"`. But a default only applies to installs that have never
written `settings.json` — **every user who actually ran v0.4.9 or v0.4.10 has
`"webgl"` persisted on disk**, and merge-over-defaults preserves it. So the
revert reached nobody it was written for: the faster a user updated, the more
certainly they were left staring at a blank terminal. Reproduced exactly on
the dev profile (`hyperterm-canvas-dev/settings.json` line 9:
`"terminalRenderer": "webgl"`), screenshot-confirmed: full chrome renders,
terminal pane black; `ht read-screen` showed the PTY was healthy the whole
time, so it was purely the webview.

**Why it was found here.** It is the *same defect class* as §2.5 — "flipping
`DEFAULT_SETTINGS` does nothing for existing installs" — which is why writing
the token migration surfaced it immediately.

**Fix.** Extended the v1→v2 migration to also reset a persisted `"webgl"` to
`"dom"`. One-time (the `__schemaVersion` stamp reaches 2 and never re-runs),
logged in `SettingsManager`, and a deliberate re-opt-in afterwards sticks.
Resetting rather than preserving is the right call because the value was
never chosen by the user — it arrived as a v0.4.9 default — and it breaks the
app's core function.

**Verified end-to-end:** relaunched → log line
`[settings] migrated schema v1 → v2; reset terminalRenderer webgl → dom …`,
settings.json now `"terminalRenderer": "dom"` / `"__schemaVersion": 2`, and a
screenshot after `ht send "echo RENDER_CHECK_OK && date"` shows the prompt,
the typed command and full colour rendering correctly.

**Still open:** the underlying WebGL fault remains **unconfirmed**. The
symptom ("paints via DOM for a moment, then the deferred attach blanks it")
points at `ensureRendererAttached` in `surface-manager.ts:2569` /
`attachRenderer` in `terminal-renderer.ts`, with `webglSupported()`'s
probe-context `loseContext()` and the per-pane context budget (xterm +
`TerminalEffects` bloom each hold one) as the leading suspects. Not chased
further in this wave — the renderer is opt-in and now genuinely so.

---

## What changed, by finding

### §2.2 — `pruneCpuSamples` (`src/bun/native-proc.ts`)
Deleted the `if (cpuSamples.size <= livePids.size) return` guard. The caller
passes the whole system process table (~1000 pids) while the sample map only
holds pids whose lazy getters fired (dozens), so the condition was true on
every real tick and the function had never pruned anything.

Added `cpuSampleCountForTest()` as the observable seam and a regression test
that prunes against a **large** live set — the exact shape the old guard
short-circuited on. **Verified the test fails when the guard is restored**
(1 fail) and passes without it, so it is a genuine regression test rather
than one that happens to pass.

### §2.3 / §2.4 / §3.4 / §3.5 — extension platform (`src/bun/extension-manager.ts`)
- `ensureBackend` rejects a disabled extension; `extension.open` / `.split`
  reject earlier with a clearer message (`requireOpenable`).
- New `setEnabled()` / `isEnabled()`; disabling also **stops** running
  surfaces. New `extension.enable` / `extension.disable` RPCs, `ht extension
  enable|disable`, and the matching SDK namespace entries (the
  `sdk-api-coverage` test caught the omission — the gate worked).
- Removed the `bun x <bin>` dev-server fallback. It resolved a package name
  from the manifest against the registry and executed it, turning "open a
  pane" into RCE against a name the user never reviewed. Missing binary now
  logs a local fix instead.
- Dev ports: `portInUse` + `firstFreePort` claim a known-free port *before*
  spawning, and the resolved port is stored on the instance so the iframe URL
  and the spawned server cannot disagree. `waitForPort` alone only proved
  *something* was listening.
- `stop()` now actually does the SIGTERM→SIGKILL escalation its doc comment
  had always promised (`EXTENSION_KILL_GRACE_MS`, unref'd timer).
- Trust boundary written down in `doc/system-security.md` (new section) and
  the `ht --help` extension block.

### §2.5 — RPC socket token (`src/shared/settings.ts`, `settings.schema.ts`)
Default flipped to `true`. Verified first that every first-party client
already presents the token — `src/cli/rpc-client.ts` (always sends it when
the file exists), `pi-extensions/ht-bridge/lib/ht-client.ts`,
`packages/tau-mux-sdk/src/backend.ts`, and `claude-integration/ht-bridge`
(which shells out to `ht`) — and that the token file is written on every
launch regardless of the setting (`src/bun/index.ts` "Always written").
`boolStrict` now defaults `true`, so a stray falsy value can't silently
*disable* the mode either.

**The default flip alone was not enough.** Testing it against a real running
instance showed the mutating call still succeeding without a token: existing
installs have `"rpcSocketRequireToken": false` persisted, and
merge-over-defaults keeps it. Added the **v1 → v2 settings migration** —
the first real use of the W4-1 migration framework, which had shipped with an
empty registry. Verified live: read-only `ht ping` still works without a
token, `ht notify` without a token is now rejected with the guidance message,
and `ht notify` with the token returns OK.

### §3.1 — renderer fallbacks (`src/views/terminal/index.ts`)
Three `?? "webgl"` literals replaced by one `activeRendererKind()` helper
reading `DEFAULT_SETTINGS.terminalRenderer`. Before the first settings
payload the palette entry showed an inverted label and its action wrote the
value the user was already on.

### §3.2 — coverage gate (`scripts/check-coverage.ts`)
- **(a)** Re-promoted the baseline: 2026-05-16 → now, **214 files**. The
  previously-ungated modules are now gated: `extension-manager.ts` 49.3 %,
  `native-proc.ts` 92.9 %, `terminal-renderer.ts` 98.8 %,
  `native-stdout-coalescer.ts` 100 %.
- **(b)** New `findUnbaselined()` prints measured-but-ungated files (biggest
  first) on every run, including green ones. Deliberately **non-fatal** — a
  new file has no "before" to regress from, and failing would block every PR
  that adds one. The point is that the gate can no longer silently shrink.
- New `tests/check-coverage-gate.test.ts` (11 tests) pins both, including an
  explicit test that a brand-new 900-line 0 % file passes `findRegressions` —
  documenting *why* `findUnbaselined` has to exist.

### §3.3 — idle tick (`src/views/terminal/index.ts`)
`if (document.hidden) return` on the 1 Hz tick + a `visibilitychange`
re-render so the bar is never stale on the way back. The existing hash only
skipped the *paint*; the subtree was still built every second to compute it.

### §3.6 — module-size ratchet (`scripts/audit-module-size.ts`)
A ratchet, not a wall: files over 1500 lines are baselined at their current
size and may shrink but never grow; a new file over the cap fails outright.
Seeded with the 8 current offenders. Wired into `package.json`
(`audit:module-size` / `baseline:module-size`) and the CI lint job.
**Verified both directions bite** — +2 lines on `sidebar.ts` fails, and a
fresh 1601-line module fails. 9 unit tests including a live-repo check.

Chose a custom audit over an eslint `max-lines` rule because the repo already
has an `audit:*` family, and because per-file ceilings can't be expressed as
a flat rule without an override block per offender.

### §4.1 — renderer fallback hint
`SurfaceManager.getRendererStatus()` → `SettingsPanel` (read live at render
time, not captured, so a later context loss shows up). The reason string was
computed since v0.4.9 and read by nothing but a test handler, while the
module's own doc claimed it fed "the settings panel's status hint".

### §4.4 — fault budget (`src/bun/index.ts`)
10 faults in 60 s → persist via `gracefulShutdown` and exit, with a 5 s
`process.exit(1)` backstop in case shutdown is itself what keeps throwing.
Isolated faults still swallowed, which is what the handlers were built for.

---

## Deviations from the plan

1. **§4.2 — did not make `socketPath` a required param.** The plan said
   "make it required like `WebServer`'s bind/token". That costs 16 test-file
   edits, and the C1 analogy doesn't hold: a wrong bind/token *exposes a
   terminal to the LAN*, whereas a wrong socket path is a diagnostics
   annoyance. The actual defect was that the default was a **plausible lie**
   `system.identify` reported as fact. Typed it `string | null` defaulting to
   `null` — matching the sibling `logPath` convention three lines below — so
   an unwired caller reports "unknown" instead of confidently wrong. One test
   updated instead of sixteen.

2. **§2.4 — implemented the documentation + `bun x` removal, not the
   capability-scoped token.** Scoping the injected `HT_RPC_TOKEN` to
   manifest-declared capabilities is a design task that wants its own plan
   doc (the per-domain registry under `src/bun/rpc-handlers/` is the natural
   granularity). Recorded as open in `doc/system-security.md`.

3. **§3.2b is a warning, not a failure.** Rationale above.

---

## Incidental fixes found while implementing

- `doc/system-security.md` § "Native vs mirror trust model" claimed the
  native webview "renders sideband HTML/SVG via `innerHTML` directly" —
  stale since H4 (v0.3.181) sandboxed it. Corrected, and the `interactive`
  escape hatch is now described precisely (§4.3).
- Two self-inflicted failures caught by the project's own gates, both fixed:
  an unescaped backtick in the `bin/ht` help template literal broke 9 CLI
  tests, and a `⚠` in the new settings hint tripped `audit:emoji`. Both
  audits earned their keep.

---

## Still open (not in scope for this wave)

- **§2.1** — web-mirror `0.0.0.0` + empty-token defaults. Deferred by the
  user. This remains the highest-severity finding in the report.
- **§2.4 capability scoping** — see deviation 2.
- **§3.6 follow-through** — the ratchet freezes the god modules; it does not
  shrink them. `sidebar.ts` (3715) still has no extraction plan.
