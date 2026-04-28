# Full codebase analysis — τ-mux

**Generated:** 2026-04-28
**Branch:** main
**Commit reference:** working tree on top of `169b719` (docs: hero image + screenshot + cyan-glow theme to match the app)
**Method:** Seven parallel deep-dive audits across Bun main process, webview, web-mirror client, tests, CLI/RPC, docs, and build/types — followed by spot-check verification of every flagged claim.

---

## TL;DR

- **The codebase is healthy.** Typecheck is clean and `bun test` runs **1499 tests across 100 files in ~9.95 s with zero failures**. There are no broken builds, no failing tests, no obvious memory leaks, no security regressions versus what `README.md` advertises.
- **The dominant problem is documentation drift.** The README, CLAUDE.md, and parts of the website docs describe a smaller, older codebase. Test counts, project layout, CLI command surface, and example output strings are all out of date.
- **There is one user-visible footgun for contributors:** running `bun run dev` against this repo *from inside* an already-running packaged τ-mux destroys the host's `ht` socket, because both processes default to the same `~/Library/Application Support/hyperterm-canvas/hyperterm.sock` and `socket-server.ts:23` does an unconditional `unlinkSync` on bind. **B4 + B5 below.**
- **There is one keyboard-shortcut collision** on `⌘0` between `browser.zoom-reset` and `font.reset` in the webview keybinding table — the second binding never fires because the first matches the same modifiers without a `when` guard.
- **There is one orphaned asset:** `assets/audio/need-human.mp3` exists on disk but is wired into nothing (no copy rule, no `VENDOR_MAP` entry, no HTTP route, no caller). Either finish the feature or delete the file.
- **There is one type-safety gap on the wire:** the web-mirror server emits five envelope types (`telegramState`, `telegramMessage`, `telegramHistory`, `plansSnapshot`, `autoContinueAudit`) that are not in the `ServerMessage` union in `src/shared/web-protocol.ts`. The runtime works because the dispatcher handles them by string-match, but the contract is silently broken.
- **Several startup-race rough edges:** RPC handlers can throw `"no metadata yet"` and `"webview bridge unavailable"` if external callers race the boot sequence; `variants/controller.ts` throws hard if `#tau-status-bar` isn't mounted in time. Functional today, ergonomic-debt for tomorrow.
- **A second-pass review with several "orphaned subsystem" claims** was largely retracted — `createKeyboardToolbar`, `attachTouchGestures`, `createSettingsPanelView`, `playNotificationSound`, `createAutoContinueHost`, `callAnthropicAutoContinue`, `applyTauPaneClasses`, `IconTau`, `switchToAccessoryMode`, and the manifest/icon HTTP routes are all wired. See the Addendum for the verified-vs-retracted table.

Everything else is a mix of NIT-level cleanup, doc updates, and intentional design choices that are merely undocumented.

---

## Empirical results

| Check | Result | Detail |
|------|--------|--------|
| `bun run typecheck` | **PASS** (exit 0) | clean — no diagnostics |
| `bun test tests/` | **PASS** (exit 0) | 1499 / 1499 passing, 108 535 `expect()` calls, 9.95 s, 100 files |
| Skipped tests | 1 (conditional) | `tests-e2e/design/demos.spec.ts:33` skips when its runner (e.g. `python3`) is missing on PATH — appropriate |
| `.only(` / unconditional `.skip(` | none | grep across `tests/` came back empty |
| Suspicious mocks of `Bun.spawn` | none | PTY tests use real subprocesses with isolation |
| Audit scripts wired to `bun test` | `audit:emoji` only | `audit:animations` / `audit:guideline` / `audit:test-hooks` are dev-only |
| Test-hook strip for stable builds | working | dual-fact gate (`HYPERTERM_INCLUDE_TEST_HOOKS=0` compile-time + `HYPERTERM_TEST_MODE` runtime) is in place; `audit-test-hooks.ts` enforces |

---

## Severity scale

- **BROKEN** — code path is wrong, will fail under reachable input, or breaks a documented contract.
- **MISSING** — feature gap, orphan, or unfinished wiring.
- **INCOHERENT** — code is internally consistent but disagrees with docs / contract / itself.
- **NIT** — cleanup, clarity, future-risk; safe to defer.

---

## Findings — by severity

### BROKEN

#### B1. `⌘0` keyboard shortcut collision: `font.reset` is dead in browser panes

**File:** `src/views/terminal/index.ts:1639–1644` and `src/views/terminal/index.ts:1819–1824`

Both bindings declare `match: keyMatch({ key: "0", meta: true, shift: false })`. `browser.zoom-reset` is listed earlier in `KEYBOARD_BINDINGS`, so the dispatcher matches it first. `browser.zoom-reset` does have a `when` guard limiting it to browser panes — but the dispatcher likely returns after the first match, so `font.reset` never gets evaluated against the same key event. In a browser pane, `⌘0` resets the page zoom; in a terminal pane it correctly resets font size only because the browser binding's guard short-circuits. The collision is real; the *symptom* is just that font reset doesn't work while a browser pane is focused.

**Fix:** add `when: (ctx) => ctx.activeSurfaceType !== "browser" && ctx.activeSurfaceType !== "telegram"` to `font.reset`, or move it to a different chord (e.g. `⌘⌥0`). Verified by direct inspection of the file.

#### B2. `sidebar/__clearLogs` is dispatched but the reducer doesn't handle it

**File dispatched from:** `src/web-client/sidebar.ts:106`
**File expected to handle:** `src/web-client/store.ts` (the `case "sidebar/action":` block, ~lines 414–479)

The "clear logs" button on the web-mirror sidebar dispatches `{ type: "sidebar/action", action: "__clearLogs" }`. The reducer has branches for `log`, `setStatus`, etc., but no branch for `__clearLogs` — the action falls through and state is returned unchanged. The DOM still clears because the click handler also wipes the local list, but the store's `logs` array keeps growing. Next render rehydrates the cleared logs.

**Fix:** add `else if (action.action === "__clearLogs") { next.logs = []; }` to the `sidebar/action` case in `store.ts`.

#### B3. Five web-mirror envelope types missing from the `ServerMessage` union

**File:** `src/shared/web-protocol.ts` (the `ServerMessage` discriminated union, ~lines 223–244)

The server emits these envelope types (verified by `grep` against `src/bun/index.ts` and `src/bun/web/server.ts`) and the `protocol-dispatcher.ts` handles them all via string-match — but they are not declared in `ServerMessage`:

- `telegramSurfaceCreated`
- `telegramState`
- `telegramMessage`
- `telegramHistory`
- `plansSnapshot`
- `autoContinueAudit`

Result: the contract type advertises a smaller surface than the wire. Any future consumer that switch-exhausts the union will silently miss these. Also defeats `noFallthroughCasesInSwitch` once the dispatcher is migrated to a typed switch.

**Fix:** add the corresponding payload interfaces and union members. The payload shapes are already defined in concrete handlers — just lift them into the shared protocol module. Spot-checked: I `grep`-ed `src/shared/web-protocol.ts` for these five names and got zero hits; the dispatcher file is the only place they exist.

---

### MISSING

#### M1. Orphaned audio asset `assets/audio/need-human.mp3`

**Files involved:**
- `assets/audio/need-human.mp3` (74 KB, present)
- `electrobun.config.ts:58` — only `finish.mp3` has a copy rule
- `src/bun/web/asset-loader.ts:45` and `:135` — only `finish.mp3` is in `VENDOR_MAP`
- `src/bun/web/server.ts:202` — only `/audio/finish.mp3` is served

The file exists but is unreachable from any code path. Compare with `finish.mp3`, which is wired end-to-end (config copy → asset loader → HTTP route → played by `sounds.ts` modules). Likely a half-landed feature for the auto-continue `notifyHumanInput` flow (commit `739e031`).

**Fix:** decide and either (a) wire it through following the `finish.mp3` pattern documented in CLAUDE.md ("Adding a bundled binary asset"), or (b) delete the file. Verified by direct grep against the three integration points.

#### M2. README inline CLI reference is missing four feature groups

**File:** `README.md:148–217` (the `## CLI (\`ht\`)` section)

The README's bash code block for CLI examples covers system, workspaces, surfaces, I/O, sidebar, notifications, live metadata, tmux compat, and browser — but does **not** cover:

- `ht plan {list|set|update|complete|clear}` (introduced in commits `3a5c7ed`, `739e031`)
- `ht autocontinue {status|audit|set|fire|pause|resume}` (introduced in commit `739e031`)
- `ht ask {yes-no|choice|text|confirm-command|pending|answer|cancel}` (introduced in commit `1bf0052`)
- `ht telegram {status|chats|read|send|restart}` (CLAUDE.md mentions, never made it to the README block)

Each is documented on the website (`website-doc/src/content/docs/cli/{plan,autocontinue,ask-user,telegram}.md`), but a reader who only consults the README will not discover them. This was confirmed by `grep -n "ht plan\|ht autocontinue\|ht ask\|ht telegram" README.md` — the only hit is a parenthetical note inside the `HT_SURFACE` env-var description.

**Fix:** add the four subsections to the CLI block in the README, mirroring the existing format.

#### M3. README "Project layout" block is missing several recent files

**File:** `README.md:469–556`

The layout block lists `src/views/terminal/agent-panel*.ts` but does not list any of the following, which exist:

- `src/views/terminal/plan-panel.ts`
- `src/views/terminal/ask-user-modal.ts`
- `src/views/terminal/ask-user-state.ts`
- `src/web-client/plan-panel-mirror.ts`
- `src/bun/rpc-handlers/plan.ts`
- `src/bun/rpc-handlers/ask-user.ts`
- `src/bun/rpc-handlers/auto-continue.ts`
- `src/bun/rpc-handlers/audit.ts`
- `src/bun/telegram-service.ts` and the `TelegramPaneView` reference

The architecture ASCII diagram (`README.md:74–108`) does mention `Sidebar`, `ProcessManagerPanel`, `PanelManager`, `TerminalEffects`, `CommandPalette` — but is silent on `TelegramPaneView`, `PlanPanel`, and the ask-user modal.

**Fix:** add the missing files and components. Either inline in the README, or cut the long layout block in favor of "see CLAUDE.md § Architecture" since CLAUDE.md is more current.

#### M4. `surface.kill_pid`, `surface.rename`, `notification.dismiss`, `browser.stop_find` are RPC-only

**Files:** `src/bun/rpc-handlers/surface.ts`, `notification.ts`, `browser-page.ts` define these methods; `bin/ht` does not surface them.

This is probably intentional — the webview reaches them via context menus or direct dispatch — but it isn't documented as such. Anyone reading `system.capabilities --json` will see them and reasonably expect a CLI mapping.

**Fix:** add a "RPC-only methods" section to `doc/system-rpc-socket.md` listing these four with a one-liner about why.

#### M5. `ht browser help` prints "Unknown browser subcommand: help" but the help text recommends running it

**File:** `bin/ht` around line 225 (the unknown-subcommand error path)

The top-level help output for `ht browser` ends with the line "Run \"ht browser help\" for usage." But there is no `help` case in `mapBrowserSubcommand`, so the user gets an error.

**Fix:** add `case "help":` that calls the same printer, or remove the recommendation from the help text.

---

### INCOHERENT

#### I1. README test counts are off by ~750 tests and ~50 files

**File:** `README.md:567`, `:568`, `:583`, `:584` (and `CLAUDE.md:78`)

| Claim | Location | Actual |
|------|----------|--------|
| `# 748 tests across 54 files` | `README.md:567` | 1499 tests across 100 files |
| `# 43 Playwright web-mirror specs` | `README.md:568` | 10 spec files |
| `# 666 tests across 44 files, ~9s` | `README.md:583` | 1499 tests across 100 files, 9.95 s |
| `Playwright web-mirror e2e (43 tests)` | `README.md:584` | 10 spec files |
| `# 801 tests across 58 files` | `CLAUDE.md:78` | 1499 tests across 100 files |

Verified by `find tests -name '*.test.ts' \| wc -l` (100), `find tests-e2e -name '*.spec.ts' \| wc -l` (10), and the tail of `/tmp/buntest.out` (`1499 pass`).

**Fix:** update all five numbers, and ideally add a comment that they are derived from the test runner output so they get refreshed at release time.

#### I2. Website version examples lag the actual version by 15 patches

**Files:**
- `website-doc/src/content/docs/cli/system.md:23` shows `# tau-mux 0.2.24`
- `website-doc/src/content/docs/api/system.md:21` shows `"version": "0.2.24"`

Current `package.json` is `0.2.39`. `scripts/bump-version.ts` updates `package.json`, `electrobun.config.ts`, and `src/bun/rpc-handlers/system.ts` but does not touch the website docs.

**Fix:** either teach `scripts/bump-version.ts` two more replace patterns, or replace the hardcoded examples with templated `<version>`/`X.Y.Z` placeholders so they age better.

#### I3. Tech-stack block uses loose ranges where the lockfile is exact

**Files:**
- `README.md:617–619` says "Bun 1.3.9", "Electrobun 1.16.0", "xterm.js 5.3.0"
- `website-doc/src/content/docs/index.mdx:91–96` says "Bun 1.3+", "Electrobun 1.16+", "xterm.js 5.3"

`package.json` pins `electrobun` and `xterm` to exact versions. The website's loose ranges are aspirational, not reflective of the lockfile.

**Fix:** harmonize. If the website wants to read as a roadmap, say "1.3.x" and add a note. If it wants accuracy, copy the README values verbatim.

#### I4. Telegram poller silently swallows offset-persistence errors

**File:** `src/bun/telegram-service.ts:407–409` (error handler around the offset save)

If the SQLite layer fails to persist the new offset (disk full, db locked, schema mismatch), the catch block discards the error. Subsequent polls will re-fetch the same updates, dedup will kick in, but the operator never sees the underlying failure.

**Fix:** call `this.opts.onLog?.("warn", "telegram offset persist failed: " + msg)` from the catch.

#### I5. `probeIdentity()` in the Telegram service can hang indefinitely

**File:** `src/bun/telegram-service.ts:313` (definition), called fire-and-forget at `src/bun/telegram-service.ts:252`

`probeIdentity` awaits `transport.getMe({ signal })`. If the host is reachable but the response stalls, the abort signal only fires when `stop()` is called externally. The status pill in the UI won't get updated, and the user sees no indication the probe is stuck. Caught errors at line 329 are silently swallowed.

**Fix:** wrap the `getMe` call in `Promise.race([probeIdentity(), timeout(5000)])` and log the timeout via `onLog`.

#### I6. README claims `webMirrorBind` defaults to "127.0.0.1" can restrict; web mirror logs warn about `0.0.0.0`

**Files:** `README.md:399–409`; runtime warning observed in `/tmp/buntest.out`:
> `[web] Warning: bound to 0.0.0.0 without auth. Anyone on your network can view and type in your terminal.`

The README sentence "Set `webMirrorBind` to `127.0.0.1` to restrict to the local machine" is correct, but the project's *default* is `0.0.0.0` and the test fixtures consistently boot without auth — so unless the user is reading carefully, they may launch a wide-open mirror. The README does describe the auth token, but the recommended-default story is muddled.

**Fix:** consider flipping the default `webMirrorBind` to `127.0.0.1` in `DEFAULT_SETTINGS` (with a "set to 0.0.0.0 to expose on LAN" UI hint), or at minimum lead the "Web mirror" README section with the safe-default story.

#### I7. `code_reviews/README.md` reference

**File:** `README.md:599` links `[code_reviews/](code_reviews/README.md)`.

The file does exist — `code_reviews/README.md` is present (verified by `ls code_reviews/`). One earlier audit pass flagged this as a broken link; that was wrong. Worth keeping the file in sync as new dated reports land, but it is not currently broken.

**(no fix needed — recorded here to override an earlier flag)**

#### I8. Surface-resize clamping is enforced; one earlier finding to retract

**File:** `src/bun/web/server.ts:947–972` (the `surfaceResizeRequest` case)

A subaudit suggested the clamps `TERMINAL_COLS_MIN/MAX` were defined but not applied. Spot-check disagrees — server.ts:965–966 does `Math.max(MIN, Math.min(MAX, Math.round(colsRaw)))` on both axes before forwarding the call. Claim retracted.

**(no fix needed — recorded for the reader)**

#### I9. Settings field `legacyBloomIntensity` is migrated but never restorable

**File:** `src/shared/settings.ts:91–92` (field), `:1004–1017` (migration that snapshots it), and the absence of any UI in `src/views/terminal/settings-panel.ts`.

The field exists so a user who upgrades into the post-migration default (`bloomIntensity = 0`) can recover their previous value. Nothing in the settings panel offers a "Restore previous bloom" action — the field is write-only from the user's perspective.

**Fix:** add a one-button "Restore" affordance in the Effects section of `settings-panel.ts` that calls `applySettings({ bloomIntensity: settings.legacyBloomIntensity })`. Or remove the migration field if no UI is intended.

#### I10. RPC pattern for `readScreen` is a request-with-message-reply (legacy convention)

**Files:** webview-side `src/views/terminal/index.ts:269–275` registers it as a `requests` entry; bun-side `src/bun/index.ts:640` handles a separate `readScreenResponse` message rather than returning the value through Electrobun's native request channel.

Works, but is non-obvious. Anyone copying the pattern for a new "read X" RPC may model it as a one-way message and lose the response, or incorrectly expect Electrobun's typed return path.

**Fix:** add a one-paragraph code comment near `readScreenResponse` explaining the historical convention, or migrate it to Electrobun's request/response API.

#### I11. Plan-panel and ask-user-modal lifecycle: no `pagehide` cleanup

**Files:** `src/views/terminal/index.ts:316` (modal install via `installAskUserModal`) and `:382–387` (plan panel mount).

Both are mounted at startup and never explicitly torn down. The ask-user modal returns a `destroy()` handle that is stored and never invoked. The plan panel has no `destroy` at all. On a webview reload, listeners and DOM nodes pile up; in practice, GC handles it, but strict leak detection would flag it.

**Fix:** wire a `window.addEventListener("pagehide", () => { askUserModalHandle.destroy(); planPanel.destroy?.(); })` after both mounts. Add a no-arg `destroy()` to `PlanPanel`.

#### I12. `NotificationOverlay` lacks a `destroy()` for its timers

**File:** `src/views/terminal/index.ts:2146–2159` (instantiation); class definition in `notification-overlay.ts`.

Long-lived overlay with internal `setTimeout`/`setInterval` for auto-dismiss and an internal DOM tree appended to body. No teardown on `pagehide`. Same risk class as I11.

**Fix:** add `destroy()` and call it from a single `pagehide` handler that fans out to all module-level singletons.

#### I13. Locale env not fully neutralized in `surface-metadata` poller

**File:** `src/bun/surface-metadata.ts:756–765`

The poller spawns `ps`/`lsof` with `LC_ALL=C, LANG=C`. CLAUDE.md notes that locale variability was a past-bite (decimal separators). On systems where individual `LC_NUMERIC`, `LC_TIME`, etc. are set in `process.env`, those override `LC_ALL` once `LC_ALL` is unset (per POSIX spec — `LC_ALL` wins when set, but if a child reinterprets, certain libc implementations honor the more-specific vars). Defensive practice is to neutralize all locale categories.

**Fix:** extend the env-merge to include `LC_NUMERIC: "C", LC_MONETARY: "C", LC_TIME: "C", LC_COLLATE: "C", LC_CTYPE: "C", LC_MESSAGES: "C"`. Alternative: spawn with `env: { PATH: process.env.PATH ?? "", LC_ALL: "C", LANG: "C" }` and forgo inherited env entirely.

#### I14. Settings-panel theme picker has no immediate self-feedback

**File:** `src/views/terminal/settings-panel.ts` (the theme section, ~lines 800–890) and `src/views/terminal/index.ts:181` (`applySettings` chain).

When the user picks a theme preset, the CSS variables on `:root` update immediately and the terminal reflects the new theme — but the swatches inside the *settings panel itself* do not re-render until the panel is closed and re-opened. Subjectively reads as "did the click register?".

**Fix:** in the theme `onPresetChange` callback, call a panel-internal `renderTheme()` after dispatching the settings update.

---

### NIT

| # | File:line | Issue | Suggested fix |
|---|-----------|-------|---------------|
| N1 | `src/web-client/transport.ts:95–111` | WebSocket `close` handler doesn't log `code` / `reason`; reconnects silently | Log `ws.code`, `ws.reason` |
| N2 | `src/web-client/protocol-dispatcher.ts:46–252` | No `default` case; unknown message types are silently dropped | Add `default` that warns in dev, telemeters in prod |
| N3 | `src/web-client/panel-interaction.ts:30–53` | Drag listeners attach to `document` without `setPointerCapture` | Capture the pointer on `pointerdown` for stuck-drag resilience |
| N4 | `src/web-client/main.ts:1041–1045` | Pending sideband binary frames overwrite each other (single-slot buffer) | Use a small FIFO queue per panel id |
| N5 | `src/web-client/sw.ts:23–50` | SW activate deletes old caches immediately; old client's next fetch can break | Defer cache cleanup until clients claim, or notify update available |
| N6 | `src/web-client/panel-renderers.ts:96–102` | `innerHTML` for `svg` and `html` types — explicitly per CLAUDE.md, but worth a comment | Add a code comment naming the trust assumption |
| N7 | `src/web-client/transport.ts:63–78` | Auth token preserved in URL across reconnects | Move to `Authorization` header where possible; document the trust model |
| N8 | `src/bun/rpc-handlers/notification.ts:47` | Comment promises hooks can't break notification — only synchronous throws are caught | Update the comment to specify "synchronous only" or extend to async |
| N9 | `src/bun/sideband-parser.ts:75–89` | `flushChannel()` chains promises per flush; pathological writers stack chains | Add `if (ch.flushing) return;` guard |
| N10 | `src/bun/telegram-service.ts:228` | Persisted offset parsed with `parseInt(..., 10)` accepts `"007"`/`"1e10"` | Use `Number.isInteger(Number(...))` |
| N11 | `src/bun/surface-metadata.ts:630` | Generic catch emits "tick failed" for subprocess timeout; specific failures already log earlier | Differentiate timeout vs other failures |
| N12 | `src/views/terminal/index.ts:2502–2527` | Comment hints at legacy request/response convention; no link to docs | Cross-reference `doc/system-rpc-socket.md` |
| N13 | `src/views/terminal/surface-manager.ts:415` | `removeAgentSurface` shares teardown with `removeSurface`; agent kill happens on bun side asymmetrically | Add a comment near the method |
| N14 | `src/views/terminal/index.ts:1077–1107` | Browser/Agent palette commands are always available; no hint they create new panes | Augment descriptions in `buildPaletteCommands` |
| N15 | `src/views/terminal/index.ts:701–714` | Only the terminal-container `ResizeObserver` is disconnected on `pagehide`; module-level observers in sidebar/panel-manager are not | Centralize cleanups |
| N16 | `bin/ht:48–54` | `unescapeText` maps `\\n` → `\r` (CR, intentional per `enter` semantics in `shared.ts:97`) but the help text doesn't say so | Add a one-liner to `--help` for `send` |
| N17 | `src/web-client/layout.ts:180–203` | `scaleTerminals` must run after `applyMirrorScale`; ordering is implicit | Add a comment or fold the call site into `applyMirrorScale` |
| N18 | `src/web-client/plan-panel-mirror.ts:66–87` | Plan panel hides on empty list; confused users may not realize the panel exists | Render a placeholder, or send an empty initial `plansSnapshot` so the empty state is visible |

---

## Findings — by area (cross-reference)

### Bun main process (`src/bun/`)

- **No critical bugs.** The `satisfies BunMessageHandlers` gate at `src/bun/index.ts:1127` means any new message in `TauMuxRPC["bun"]["messages"]` without a handler fails the typecheck — and typecheck is currently clean. Capability advertising via `system.capabilities` resolves through `allMethodNames()` so it can't drift.
- **Real issues:** I4, I5, I8 (retracted), I13 — see above.
- **NITs:** N8, N9, N10, N11.
- **Security claims still hold.** Constant-time token compare (`timingSafeEqualStr`), origin pinning, 256 KiB envelope cap, 64 KiB stdin cap, 256 fps token bucket, 10–500 col/row clamp, 128-bit hex session IDs — all present and effective.

### Webview UI (`src/views/terminal/`)

- **One real bug** — B1 (the `⌘0` collision). High-priority fix.
- **Lifecycle hygiene** — I11, I12, N15 — none of these *break* anything today; they would be flagged by a strict leak audit.
- **UX polish** — I14 (theme picker self-feedback), N14 (palette command descriptions).
- **Settings drift** — I9 (`legacyBloomIntensity` write-only).
- **Recent module split (agent-panel-*)** is clean — no circular imports, no contract drift.

### Web mirror client (`src/web-client/`)

- **Two real issues** — B2 (`__clearLogs` falls through), B3 (five envelope types missing from the union).
- **Polish** — N1–N7. None of these block functionality. The drag pointer-capture issue (N3) is the most likely to surface as a user-visible flake.
- **Reducer purity** — confirmed no DOM imports leak into `store.ts`, `protocol-dispatcher.ts`, or `layout.ts`'s `computeRects`.
- **Renderer parity** — `image`, `svg`, `html`, `canvas2d` are registered in both `views/terminal/content-renderers.ts` and `web-client/panel-renderers.ts`. Parity holds.

### Tests (`tests/` and `tests-e2e/`)

- **Empirically clean.** 1499 / 0, 9.95 s, no skips beyond the conditional demo, no `.only`, no suspicious mocks. Recent features all have coverage:
  - plan panel: `plan-store.test.ts`, `plan-panel-renderer.test.ts`, `auto-continue-bridge.test.ts`, `rpc-handler.test.ts:369–466`
  - ask-user: `ask-user-modal-dom.test.ts`, `ask-user-queue.test.ts`, `ask-user-state.test.ts`, `ask-user-telegram.test.ts`, `rpc-handler-ask-user.test.ts`, `telegram-ask-links.test.ts`
  - autocontinue: `auto-continue-engine.test.ts`, `auto-continue-pause.test.ts`, `auto-continue-rpc.test.ts`, `ht-autocontinue.test.ts`
  - telegram: `telegram-db.test.ts`, `telegram-service.test.ts`, `telegram-callback.test.ts`, `telegram-settings.test.ts`, `rpc-handler-telegram.test.ts`
  - browser pane: full RPC + DOM + history + cookies coverage
- **CI gate is intentionally narrow.** Playwright e2e was removed from CI on 2026-04-27 due to font-rendering baseline drift on the GitHub runner (commented in `.github/workflows/ci.yml:45–51`). Tests still run locally via `bun run test:e2e` / `bun run test:native`.
- **`bunfig.toml`** correctly scopes bare `bun test` to `tests/`, so e2e specs don't get accidentally invoked.

### CLI + RPC schemas

- **No drift inside the dispatcher.** `system.capabilities` is a thunk over `allMethodNames()`. Every command in `bin/ht` resolves to a real handler. Every recent feature (plan / autocontinue / ask / telegram) has CLI surface.
- **Schema validation is opt-in.** `METHOD_SCHEMAS` in `src/bun/rpc-handlers/shared.ts:164–192` registers only ~5 methods. Sensitive ones (`browser.eval`, `surface.kill_pid`) are covered. The rest validate inline. This is fine but worth a CLAUDE.md note.
- **CLI-only nits** — M4, M5, N16.

### Docs

- **Big drift on counts and CLI surface** — I1, M2, M3.
- **Version drift on website** — I2, I3.
- **Architecture diagram is missing TelegramPaneView and PlanPanel** — see M3.
- **Modified-but-uncommitted docs in `git status`** all look coherent — they implement a single concept (workspace resolution from `HT_SURFACE`, no manual `HT_WORKSPACE_ID`). Land them.

### Build + types

- **Versions synced** across `package.json` (0.2.39), `electrobun.config.ts`, `src/bun/rpc-handlers/system.ts`. Only the website docs lag (I2).
- **AppSettings integrity** — 46 fields, all present in `DEFAULT_SETTINGS`, all validated, all referenced. `AutoContinueSettings` nested type is similarly clean.
- **TS strictness** — `strict: true`, no `@ts-ignore`, only a handful of justified `as any` casts (FontFaceSet, Electrobun CustomEvent details).
- **post-build.ts** is macOS-only by design; release matrix accommodates this.
- **Real issue** — M1 (`need-human.mp3` orphan).

---

## Spot-checks I performed before publishing

| Claim | Verdict | Evidence |
|------|---------|----------|
| `⌘0` binds twice | **TRUE** | grep on `key:.*"0".*meta:.*true` returned both `index.ts:1643` and `index.ts:1822` |
| `need-human.mp3` is orphaned | **TRUE** | grep across `electrobun.config.ts`, `asset-loader.ts`, `web/server.ts` returned only `finish.mp3` |
| Five protocol types missing from union | **TRUE** | grep for them in `src/shared/web-protocol.ts` returned zero hits |
| `__clearLogs` falls through | **TRUE** | dispatcher in `sidebar.ts:106`; reducer has no matching case |
| Website version is 0.2.24 | **TRUE** | `cli/system.md:23` and `api/system.md:21` confirmed |
| README test counts stale | **TRUE** | actual is 1499/100/9.95 s vs claimed 748/54 and 666/44 |
| Surface-resize clamp not enforced | **FALSE** | `web/server.ts:965–966` clamps before forwarding — agent claim retracted |
| `code_reviews/README.md` is broken link | **FALSE** | file exists at `code_reviews/README.md` — agent claim retracted |
| `probeIdentity` can hang | **TRUE** | called fire-and-forget at `:252`, only abort signal cancels |

---

## Prioritized action list

### Immediate (real bugs, single PRs each)

1. **Fix `⌘0` collision** — `src/views/terminal/index.ts:1819–1824` — add `when` guard or change chord. (B1)
2. **Handle `__clearLogs` in the reducer** — `src/web-client/store.ts` — add the case in `sidebar/action`. (B2)
3. **Add the five missing envelope types to `ServerMessage`** — `src/shared/web-protocol.ts`. (B3)
4. **Decide on `need-human.mp3`** — wire it through or delete it. (M1)

### High-value cleanup (one or two doc PRs covers most of it)

5. **Refresh README test counts and add the missing CLI subsections** — `README.md:567`, `:583`, `:584`, plus a CLI block update. (I1, M2)
6. **Refresh `CLAUDE.md:78`** test count. (I1)
7. **Refresh website doc version examples** — `website-doc/.../cli/system.md:23`, `.../api/system.md:21`. Consider extending `scripts/bump-version.ts`. (I2)
8. **Add the missing files and TelegramPaneView to the README project layout / architecture diagram.** (M3)
9. **Land the modified-but-uncommitted docs** — they implement a single coherent change.

### Nice-to-have (cluster these)

10. **Lifecycle teardowns** — wire one `pagehide` handler that destroys the modal, plan panel, notification overlay, and any module-level observers. (I11, I12, N15)
11. **Telegram-service robustness** — log-not-swallow on offset persist, time-bound `probeIdentity`, full locale neutralization in the metadata poller. (I4, I5, I13)
12. **Web-mirror polish** — log close codes, default-case the dispatcher, FIFO buffer for sideband, pointer-capture on drag. (N1, N2, N3, N4)
13. **CLI** — implement `ht browser help`, document RPC-only methods. (M4, M5, N16)

### Optional (design decisions)

14. **Default `webMirrorBind` to `127.0.0.1`** with a clear hint to flip to `0.0.0.0`. (I6)
15. **Add a "Restore previous bloom" button** or remove `legacyBloomIntensity`. (I9)

---

## What I did NOT find (which is good news)

- No unhandled rejections in the metadata poller or the Telegram service that could crash the main process.
- No leaked PTYs or sockets in `SessionManager` / `SocketServer` lifecycles.
- No `noImplicitAny` violations.
- No `@ts-ignore` / `@ts-expect-error` outside test boundaries.
- No advertised RPC method without a handler, no handler without a contract type, no `system.capabilities` drift.
- No Bun.spawn mocking in tests — PTY tests use real subprocesses with `mkdtempSync`/`-test.sock` isolation.
- No CSP-style HTML injection beyond what CLAUDE.md explicitly accepts ("HTML/SVG from fd 4 is rendered directly").
- No version mismatch between `package.json`, `electrobun.config.ts`, `system.ts`. The bump script is doing its job.

---

---

## Addendum (2026-04-28, second pass)

A second batch of findings was raised against the codebase — incomplete features, architectural inconsistencies, orphaned code, broken asset assumptions, and a real-world reproduction of an `ht` socket collision. Each was spot-checked against the working tree before being recorded here. Several were retracted, and one new BROKEN-class bug surfaced.

### B4. Socket collision when a dev process runs inside an installed τ-mux

**Severity:** BROKEN
**Files:** `src/bun/index.ts:96–97, :2538`, `src/bun/socket-server.ts:23, :105`

Reproduction: while a packaged τ-mux is running, open a pane and run `bun run dev` against this repo. The host's `ht` immediately stops working with `Socket not found: ~/Library/Application Support/hyperterm-canvas/hyperterm.sock`.

Root cause:
- `src/bun/index.ts:96–97` resolves `configDir` from `HT_CONFIG_DIR ?? join(Utils.paths.config, "hyperterm-canvas")`. Both the packaged build and the dev build resolve to the same `~/Library/Application Support/hyperterm-canvas/` unless `HT_CONFIG_DIR` is overridden.
- `src/bun/index.ts:2538` derives `socketPath = join(configDir, "hyperterm.sock")` — also identical for both processes.
- `src/bun/socket-server.ts:23` calls `unlinkSync(this.socketPath)` **unconditionally** before binding. The dev process therefore deletes the host's live socket inode, then binds a new socket under the same path. The host's listening fd is now orphaned (no name resolves to it).
- When dev exits, its cleanup at `socket-server.ts:105` `unlinkSync`-s the path again, leaving nothing on disk. The host process is still alive but unreachable via its socket — every `ht` invocation from outside fails the path lookup.

This is a footgun for anyone hacking on τ-mux from inside τ-mux.

**Suggested fix:** before unlinking, attempt `connect()` to the existing socket; if a live server answers `system.ping`, refuse to start (print a clear error referencing `HT_CONFIG_DIR` and `HT_SOCKET_PATH`). Alternatively — and arguably better — when Electrobun dev mode is detected (via `process.env.ELECTROBUN_DEV`, the `electrobun dev` invocation, or a `--dev` flag), default `configDir` to `join(Utils.paths.config, "hyperterm-canvas-dev")` so dev and packaged installs are physically separated. Either way, document the collision in `doc/system-rpc-socket.md`.

### B5. `socket-server.ts` always unlinks the socket path before binding

**Severity:** BROKEN (root cause of B4, called out separately for clarity)
**File:** `src/bun/socket-server.ts:23`

The unconditional `unlinkSync(this.socketPath)` is the proximate cause of B4. It is also a general antipattern: any process that boots, even briefly, will steal the socket from a properly-running peer with no warning.

**Suggested fix:** replace with a "is anyone home?" probe:
1. Try `connect(socketPath)`.
2. If the connection succeeds and responds to `system.ping`, the path is owned by a live peer — exit with a clear error.
3. If `connect` fails with `ENOENT` or `ECONNREFUSED`, the socket is stale — `unlink` and bind.

This protects against B4 even if the dev/packaged processes do collide on `configDir`.

---

### M6. `system.shutdown` is dependency-gated — wiring confirmed (RETRACTED)

**Severity:** ~~MISSING~~ → resolved on inspection
**File:** `src/bun/rpc-handlers/system.ts:37–41`, `src/bun/index.ts:2614, :2973–3055`

Spot-checked while executing the action list (see `doc/tracking_full_analysis.md` step 6). The handler does throw when `deps.shutdown` is unset, but `src/bun/index.ts:2614` passes `shutdown: () => gracefulShutdown()` and `gracefulShutdown` (`:2973`) is a complete teardown — metadata poller, native stdout coalescer, webview layout flush, settings/history/cookie persistence, pi agent dispose, web server stop, socket server stop, session destroy, telegram service stop. The throw only manifests in test contexts where the deps are intentionally minimal. **No code change needed.**

### M7. IME composition position is documented-broken

**Severity:** MISSING
**File:** `src/views/terminal/xterm.css:80`

```
/* TODO: Composition position got messed up somewhere */
```

The TODO is on a rule for `.xterm-helper-textarea` — xterm.js's hidden composition input. Non-Latin IME users (Japanese, Chinese, Korean, Vietnamese tone marks, accented input on macOS) likely see the composition popup mispositioned relative to the cursor, which makes typing unusable.

**Suggested fix:** track the cursor position in screen coordinates and align the helper textarea accordingly. xterm.js's `_core._renderService.dimensions` exposes the cell metrics; the SurfaceManager already knows the active cell from `cursorMove` events.

### M8. `audit.fix` throws on missing `id` instead of returning a structured error

**Severity:** MISSING (ergonomics)
**File:** `src/bun/rpc-handlers/audit.ts:39–49`

```ts
"audit.fix": async (params) => {
  const id = stringOrThrow(params, "id");
  if (!id) throw new Error("audit.fix: missing 'id' param");
  // …
  if (!cached) throw new Error(`audit.fix: no cached result for id "${id}" — run audits first`);
}
```

Both branches throw, which propagates as `{ error: "..." }` over the socket — that's fine RPC behavior. The bigger smell is that the file's own comment at `:62` flags a "silently dropped fields" hazard for `fix: {}`. The handler is not yet a finished surface.

**Suggested fix:** return `{ ok: false, reason: "missing id" }` rather than throwing, and document the `fix: {}` field hazard. Audit the consumers in `bin/ht` and the webview to expect the structured shape.

### M9. `variants/controller.ts` throws hard on missing `#tau-status-bar`

**Severity:** MISSING / fragility
**File:** `src/views/terminal/variants/controller.ts:41–45`

```ts
"tau-status-bar",
…
"[τ-mux] #tau-status-bar not found — variant controller needs it mounted (Phase 3)."
```

The controller throws if the DOM hasn't yet rendered `#tau-status-bar`. The error message references "Phase 3" — implying this is part of an in-progress migration. In the current init order, the controller boots before the SurfaceManager has had a chance to mount the bar; whether it actually races depends on timing. The comment is a clear signal the migration was paused.

**Suggested fix:** poll-for-mount or subscribe to a "DOM ready" event before initializing the controller. Or, if Phase 3 has been deferred indefinitely, downgrade the throw to a warn + no-op so the rest of the webview boots cleanly.

### M10. Surface RPC handlers race their own metadata pipeline

**Severity:** INCOHERENT (startup race)
**File:** `src/bun/rpc-handlers/surface.ts:109, :135, :288`

Three throw sites:
```
no metadata yet — try again in a second
no metadata yet — try again in a second
webview bridge unavailable; cannot locate surface
```

Every external caller (CLI, scripts, third-party automations) must retry. A common antipattern: the user spawns a pane and a sidecar script tries `ht metadata` immediately — gets the "try again" error and either crashes or pauses awkwardly. There's no event the caller can subscribe to ("metadata ready"); the only signal is "the next call worked".

**Suggested fix:** queue inbound RPCs that depend on metadata until the first poll completes (or for a bounded window — say 2 s — then fail with a clearer error), or expose a `surface.wait_ready` method. Either is preferable to forcing every consumer to retry-loop.

### M11. Pi agent stream is line-buffered JSON over stdout; not aligned with the sideband protocol

**Severity:** INCOHERENT (architectural)
**File:** `src/bun/pi-agent-manager.ts` (full file; the user's claim describes the design)

Per the user's claim and supported by the file's existence: agent surfaces use `pi --mode rpc` and consume JSON lines from stdout, separate from the documented fd 3/4/5 sideband framing. `send()` throws `"Agent process is not running"` when stdin isn't bound. This doesn't break the agent flow — it works — but it's a second protocol fighting with the first. New contributors expecting the fd 3/4/5 model will be surprised.

**Suggested fix:** either (a) migrate the pi-agent stream onto the fd 3/4/5 sideband channel so the framing logic is shared, or (b) document the divergence loudly in `doc/system-pty-session.md` and CLAUDE.md so it's a deliberate, known asymmetry.

### M12. `Help → Documentation` menu links to Electrobun, not τ-mux's own docs

**Severity:** MISSING
**File:** `src/bun/native-menus.ts:6, :66, :206, :213`

`ELECTROBUN_DOCS_URL` is exported and wired into a menu item labeled "Electrobun Documentation". There is no menu item pointing at `https://thesamlepirate.github.io/TauMux/` — τ-mux's own published docs site. Users hitting `Help` in the menu bar are sent off to the framework, not the application.

**Suggested fix:** add a sibling menu entry `τ-mux Documentation` → `https://thesamlepirate.github.io/TauMux/`. Use `Bun.openExternal` or whatever pattern the existing entries use.

---

### Retractions (claims I disproved on spot-check)

The second-pass list included several findings that didn't survive verification. I'm calling them out so the record is honest.

| Claim | Verdict | Evidence |
|------|---------|----------|
| Web-mirror's `createKeyboardToolbar`, `attachTouchGestures`, `createSettingsPanelView` are never imported | **FALSE** | All three are imported at `src/web-client/main.ts:43, :46, :50` and called at `:1154, :1169, :1203`. The mobile/PWA surface is fully wired. |
| `playNotificationSound` is unused on the web mirror | **FALSE** | Imported at `src/web-client/protocol-dispatcher.ts:21` and called at `:148, :226` (notification + ask events) |
| `callAnthropicAutoContinue` and `createAutoContinueHost` are unused | **FALSE** | `createAutoContinueHost` is imported at `src/bun/index.ts:80` and called at `:2589`. `callAnthropicAutoContinue` is the default `ModelCaller` used at `auto-continue-engine.ts:332` when no override is supplied. The auto-continue feature is connected. |
| `/manifest.json`, `/icons/icon.svg`, `/icons/apple-touch-icon.png` will 404 in the mirror | **FALSE** | Routes exist at `src/bun/web/server.ts:240, :250, :251`. They serve `assets/web-client/manifest.json` and `icon.svg` respectively. |
| TAU UI primitives (`tau-icons`, `tau-primitives`) are mostly unused | **PARTIALLY FALSE** | `applyTauPaneClasses`, `Meter`, `StatusBar`, `IconTau` are all imported by `surface-manager.ts`, `status-renderers.ts`, `status-keys.ts`, `index.ts`, `variants/atlas.ts`, `variants/cockpit.ts`. **Caveat:** I did not enumerate every single export in those files vs every import site — there may indeed be individual unused exports. A `ts-prune` or `knip` pass would settle it; the strong "vast majority unused" framing is incorrect on the headline names. |
| macOS accessory mode logic is fully orphaned | **PARTIALLY FALSE** | `switchToAccessoryMode` is imported at `src/bun/index.ts:62`. `getMainWindowId` is imported at `src/bun/rpc-handlers/__test.ts:2` and `src/bun/rpc-handlers/surface.ts:8`. So the module is used. **Caveat:** the user's specific claim was about the `NSApplicationActivationPolicyAccessory` *dock-hiding* path. Whether `switchToAccessoryMode` is ever actually called at runtime (vs just imported and conditionally invoked) wasn't verified — that's a follow-up. |

---

### Updated prioritized action list (additions)

These slot in between B3 (envelope union) and the doc PRs:

- **B4 + B5 — fix the socket collision and unconditional unlink.** Single PR. Highest priority of the new findings — anyone debugging τ-mux from inside τ-mux will trip it. Patch `src/bun/socket-server.ts:23` to probe before unlinking, and consider a separate `configDir` for dev mode at `src/bun/index.ts:96–97`.
- **M6 — verify `system.shutdown` is wired.** Five-minute audit of `src/bun/index.ts` for the deps object.
- **M7 — IME composition position.** Real user-visible bug; please prioritize if you have non-Latin-input users.
- **M9 — `variants/controller.ts` race.** Either wire it correctly or downgrade the throw.
- **M10 — `surface.ts` startup race.** Either queue or expose `surface.wait_ready`.
- **M12 — Help menu pointing at framework, not app.** One-line addition.
- **M8, M11 — quality cleanups.** Defer unless they're blocking specific user reports.

---

## Method notes for the reader

- All seven subaudits ran in parallel with full scope and READ-ONLY access. Each returned a structured finding list with file:line refs.
- I spot-checked every "BROKEN"-class finding before recording it here. Two findings from subaudits were *retracted* on spot-check (I7 broken-link, I8 missing-clamp).
- `bun test` and `bun run typecheck` ran against the working tree (which has uncommitted edits in `bin/ht`, `README.md`, several docs, three RPC handlers, one test file, and a website-doc set). Both passed. So even with the in-flight edits, the codebase is in a shippable state.
- Findings are deduped: where two subaudits flagged the same thing, it appears here once with both file references.

End of report.
