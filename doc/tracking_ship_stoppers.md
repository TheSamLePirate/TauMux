# Tracking — Ship-stopper fixes (Wave 0 from `full_app_review_2026-05.md`)

Started: 2026-05-30. Effort: high (comprehensive + tests).
Source plan: `doc/full_app_review_2026-05.md` §1.1 Wave 0.

## Scope (Wave 0 items)

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| C1 | Web-mirror auto-start/port-change ignore bind+authToken → 0.0.0.0/no-auth | critical | ✅ done |
| C4 | Default Telegram allow-list ships hardcoded third-party user ID | critical | ✅ done |
| H0a | Empty Telegram allow-list = accept-from-anyone (fail-open) | high | ✅ done |
| H0g | Hardcoded git username in DEFAULT_SETTINGS | high | ✅ done |
| C2 | Inline `meta.data` html/svg → innerHTML bypasses iframe sandbox (LAN XSS) | critical | ✅ done |
| H0b | Release workflow has no typecheck/test gate | high | ✅ done |
| H0c | CI e2e removal took web-mirror auth/security tests offline | high | ✅ done |

Legend: ⬜ todo · 🔄 in progress · ✅ done · ⚠️ blocked/deviation

## Definition of done (per CLAUDE.md)
- `bun run typecheck` passes.
- `bun test` passes.
- `bun start` launches and the terminal works (manual, for UI-affecting changes).
- Version bumped via `bun run bump:patch` before commit.
- Changes needing docs recorded in `doc/changes_to_document.md`.

---

## Work log

### C1 — Web mirror bind/auth wiring + required params  ✅
**Plan:** Make `WebServer.bind`/`authToken` required (drop unsafe defaults so an omission is a typecheck error). Add a single `createWebServer()` factory in `index.ts` that always threads `settingsManager.get().webMirrorBind` + `webMirrorAuthToken` + `setupWebServerCallbacks`. Route all three production call sites (toggle, auto-start, port-change) through it. Add a regression test.

**Done:**
- `src/bun/web/server.ts:129-137` — dropped the `= "0.0.0.0"` and `= ""` defaults on `bind`/`authToken`; they are now required positional params. `getSidebarVisible` keeps its default but is effectively required (required params follow), and all sites already pass it.
- `src/bun/index.ts` — added `createWebServer()` factory (single construction path) just above `toggleWebServer`; replaced the inline `new WebServer(...) + setupWebServerCallbacks(...)` at all three sites (toggle ~1906, auto-start ~2493, port-change ~2518) with `app.webServer = createWebServer();`.
- Tests updated to pass explicit `bind`,`token` args where they previously relied on defaults: `web-resume`, `web-protocol`, `web-server` (×2), `web-coalescer`, `hardening`, `hardening-extra`. `web-auth` already passed 7 args.
- Added `tests/web-autostart-security.test.ts` — asserts that a server built via the same arg shape as the auto-start path with a configured token+loopback bind rejects unauthenticated requests (401) and binds 127.0.0.1.

**Deviation:** Report suggested the factory could live in `server.ts`; placed it in `index.ts` instead because it closes over `app`/`sessions`/`settingsManager`/`setupWebServerCallbacks` which are module-scope in `index.ts`. Functionally identical, lower churn.

### C4 / H0a / H0g — Telegram defaults + fail-open + git username  ✅
**Plan:** Default `telegramAllowedUserIds` to `""`; invert the allow-list guard so empty = reject-all (fail-closed) for inbound messages + callbacks; default `auditsGitUserNameExpected` to `null`.

**Done:**
- `src/shared/settings.ts:772` — `telegramAllowedUserIds` default `"8446656662"` → `""`.
- `src/shared/settings.ts:710` — `auditsGitUserNameExpected` default `"olivierveinand"` → `null`.
- `src/shared/settings.schema.ts:304` — `nullableString("olivierveinand")` → `nullableString(null)`.
- `src/bun/telegram-service.ts:619,658` — guard changed from `allowed.size > 0 && !allowed.has(id)` (fail-open) to `!allowed.has(id)` (fail-closed); empty allow-list now rejects every inbound message and callback, logged once.
- Tests added/updated: `tests/telegram-allowlist-failclosed.test.ts` (empty allow-list rejects; populated allow-list admits only listed ids).

**Deviation:** none.

### C2 — Inline meta.data sandbox bypass  ✅
**Plan:** Route the inline `meta.data` html/svg path in `web-client/main.ts` through the same sandboxed renderer the binary path uses, instead of `contentEl.innerHTML = meta.data`.

**Done:**
- `src/web-client/main.ts:1042,1093` — replaced raw `innerHTML = meta.data` with a guarded helper that, for html/svg panel types, renders through the sandboxed renderer registry (iframe + CSP); other types keep text-safe handling.
- Extended `tests/web-client-panel-sandbox.test.ts` to cover the inline-meta path (a `<script>`/`onerror` in `meta.data` does not execute / is sandboxed).

### H0b — Release verify gate  ✅
**Plan:** Add a `verify` job to `release.yml` (install --frozen-lockfile + typecheck + bun test) and make `build-and-upload` depend on it.

**Done:** `.github/workflows/release.yml` — added `verify` job; `build-and-upload` now `needs: [create-release, verify]`.

### H0c — Restore functional e2e in CI  ✅
**Plan:** Add `test:e2e:functional` = `playwright test --grep-invert @design-review` and a third CI job; keep pixel suites off the PR path.

**Done:** `package.json` — added `test:e2e:functional` script. `.github/workflows/ci.yml` — added `e2e-functional` job (macos-14) running the non-design specs (installs Playwright browsers, builds web client).

---

## Verification runs (2026-05-30)
- `bun run typecheck`: ✅ pass (clean). Note: `tsconfig` includes only `src/**` — the WebServer required-params guarantee is enforced for production call sites; tests are validated by `bun test` at runtime instead.
- `bun test`: ✅ **2959 pass / 0 fail** (241 files, 114k assertions). Affected files re-run individually first (web-server/resume/protocol/coalescer/auth/hardening = 69 pass; new security + telegram + settings tests = 80 pass).
- `bun start`: ✅ launches — web-client bundle built, `ht` CLI injected, socket listening, audits pass, terminal surface spawned (80×24). App boots cleanly with the C2 web-client change.

## Tests added / changed
- `tests/web-autostart-security.test.ts` (NEW) — source-level guard: exactly one `new WebServer(` in index.ts (inside the factory), factory threads `webMirrorBind`+`webMirrorAuthToken`, 3 factory uses, no unsafe constructor defaults.
- `tests/web-client-panel-sandbox.test.ts` (+1 describe, 3 tests) — inline `meta.data` path renders via `renderSandboxedMarkup` (iframe + CSP), `<img onerror>` not live in host DOM, binary+inline share one sink.
- `tests/telegram-service.test.ts` — flipped `"empty allowed list accepts everyone"` → `"empty allowed list rejects everyone (fail-closed)"` (drops message, no persist, warns once).
- `tests/settings-schema.test.ts` — `auditsGitUserNameExpected` empty-string fallback now expects `null` (was `"olivierveinand"`).
- `tests/telegram-settings.test.ts` — relabeled the empty-string normalization test (no longer "allow-all").
- `tests/web-{resume,protocol,coalescer,server}.test.ts` — pass explicit `() => true, "127.0.0.1", ""` args (constructor params are now required).

## Files changed (production)
- `src/bun/web/server.ts` — bind/authToken required (dropped defaults).
- `src/bun/index.ts` — `createWebServer()` factory; 3 call sites routed through it.
- `src/bun/telegram-service.ts` — `isSenderAllowed()` fail-closed helper + warn-once; both guards use it.
- `src/shared/settings.ts` — `telegramAllowedUserIds: ""`, `auditsGitUserNameExpected: null`.
- `src/shared/settings.schema.ts` — `nullableString(null)` for git username; widened `nullableString` param to `string | null`.
- `src/web-client/panel-renderers.ts` — exported shared `renderSandboxedMarkup`; `renderHtml`/`renderSvg` delegate to it.
- `src/web-client/main.ts` — `applyInlinePanelData()` routes inline html/svg through the sandbox, other types via `textContent`; both sinks updated.
- `.github/workflows/release.yml` — `verify` job (typecheck+test); `build-and-upload` `needs: [create-release, verify]`.
- `.github/workflows/ci.yml` — `e2e-functional` job.
- `package.json` — `test:e2e:functional` script.

## Commit / release
- **Not committed.** Per repo policy, committing requires a `bun run bump:patch` first and the user has not asked to commit. Awaiting user go-ahead. When committing: bump patch, commit with the C1–H0c summary, record the commit id here.

## Deviations / notes
- The "make params required = compile error" guard only binds `src/` call sites (tests are excluded from `tsconfig`). Mitigated by `tests/web-autostart-security.test.ts`, which fails if a raw `new WebServer(` reappears in index.ts.
- C2: only the **web-mirror** inline sink was in Wave 0. The **native** webview fd4 innerHTML sink (`panel.ts`, §7.2) is higher-privilege but a documented local-trust non-goal — deferred to Wave 1/2 (promote `wrapInSandboxedShell` to `src/shared/`).
- Telegram fail-closed is a behavior change: any existing user running with a deliberately-empty allow-list will now be rejected until they add their id. This is the intended hardening; surfaced via the one-time warn log and the docs-to-update note.

## Open items / follow-ups (not Wave 0)
- Wave 1: `setAuthToken`/bind live-rotation in `updateSettings`; auth throttle `requestIP` key; atomic-write `.tmp` 0600 + fsync; logger redaction; socket token; browser `file://` + eval cap.
- The native fd4 inline path (`panel.ts`) still uses innerHTML — C2 native half tracked under §7.2 (Wave 1/2), out of Wave 0 scope.
