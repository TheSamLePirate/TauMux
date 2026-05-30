# Tracking — Wave 1 security hardening (from `full_app_review_2026-05.md`)

Started: 2026-05-30. Effort: high (comprehensive + tests). Follows Wave 0 (`tracking_ship_stoppers.md`, commit 58de2857, v0.3.161).
Source plan: `doc/full_app_review_2026-05.md` §1.1 Wave 1.

## Scope

| ID | Title | Sev | Status |
|----|-------|-----|--------|
| W1-1 (H2/§9.4) | Live-rotate web-mirror auth token + apply bind change without restart-by-hand | high | ✅ done |
| W1-2 (H1/§9.3) | Key the auth throttle on `server.requestIP()`, not spoofable XFF/Host | high | ✅ done |
| W1-3 (H0e/§13.1,§14.1) | atomic-write `.tmp` created `0600` from the start + `fsync` before rename | high | ✅ done |
| W1-4 (H0d/§13.4,§6.2) | Drop `file://` from browser RPC navigate; cap `addscript`/`addstyle` size | high | ✅ done |
| W1-5 (§16.1) | Redaction pass in the logger tee (telegram token / query token / bearer) | high | ✅ done |

Legend: ⬜ todo · 🔄 in progress · ✅ done · ⚠️ deviation

### Explicitly deferred (bigger / higher-blast-radius — Wave 2)
- **Per-instance RPC socket token** (§6.1) — M, changes the `ht` socket handshake and would need `bin/ht` + pi/Claude bridges updated in lockstep; risk of breaking external consumers. Deferred so it can ship with the CLI changes together.
- **OS-keystore encryption for cookies + secrets at rest** (§13.2/§11.7) — L, architectural (Keychain/safeStorage); W1-3 already closes the world-readable *window*, this is the at-rest-encryption follow-up.

## Definition of done
- `bun run typecheck` + `bun test` pass; `bun start` boots. Bump patch + commit; record commit id.

---

## Work log

### W1-1 — live auth-token rotation + bind apply  ✅
- `src/bun/web/server.ts` — `setAuthToken()` now also `authFails.clear()` so a rotation doesn't leave a stale per-IP cooldown.
- `src/bun/index.ts` — extracted `restartWebMirror()` (stop + recreate-if-running via `createWebServer`, used for bind changes); `applyWebMirrorPort` now delegates to it; added `setWebMirrorAuthToken()` (live, no restart).
- `src/bun/webview-handlers/types.ts` + `index.ts` ctx wiring — exposed `setWebMirrorAuthToken` + `restartWebMirror`.
- `src/bun/webview-handlers/system.ts` — `updateSettings` now: on `webMirrorAuthToken` change → `setWebMirrorAuthToken`; on `webMirrorBind` change → `restartWebMirror`.

### W1-2 — throttle keyed on real peer IP  ✅
- `src/bun/web/server.ts` — `clientIp(req, server)` now prefers `server.requestIP(req)?.address`; XFF/Host kept only as a labelled last-resort fallback (no trusted proxy in front). Call site passes `server`.

### W1-3 — atomic-write tmp 0600 + fsync  ✅
- `src/bun/atomic-write.ts` — tmp is opened with the requested `mode` and `fchmod`'d to it before writing (no world-readable window); data is `fsync`'d before `rename`; parent dir `fsync`'d best-effort after rename for crash durability. Closes the cookie/settings-secret leak window (H0e) + power-loss durability (§14.1).

### W1-4 — browser navigate file:// + script caps  ✅
- `src/bun/rpc-handlers/browser-page.ts` — removed `file://` from `ALLOWED_URL_PREFIXES` (local-file read / SSRF-to-file vector over the socket). `localhost`/internal hosts intentionally still allowed (dev-server browsing is the pane's whole point).
- `src/bun/rpc-handlers/shared.ts` — added `browser.addscript` + `browser.addstyle` to `METHOD_SCHEMAS` with the same 256 KiB `script`/`css` cap as `browser.eval` (they dispatch to the same `evalJs` action and previously bypassed the cap).

### W1-5 — logger redaction  ✅
- `src/bun/logger.ts` — added exported `redactSecrets()` (telegram bot token, `token`/`auth`/`access_token` query params, `Authorization: Bearer`), applied in `formatArgs` so the on-disk 14-day tee can't capture a leaked secret even if a future `catch` logs a raw error object. Live console keeps raw args (not persisted).

## Tests
- NEW `tests/web-auth-rotation.test.ts` — setAuthToken upgrades a tokenless→401, and clears the throttle bucket.
- NEW `tests/logger-redaction.test.ts` — telegram token / query token / bearer redacted; ordinary text untouched.
- `tests/atomic-write.test.ts` — extended: tmp never world-readable mid-write; final mode 0600; content intact.
- `tests/rpc-handler-browser.test.ts` — flipped the file:// test → now asserts `file://` is rejected, `about:`/`https://` accepted.
- NEW/extended browser schema test — `addscript`/`addstyle` reject >256 KiB.

## Verification (2026-05-30)
- `bun run typecheck`: ✅ clean.
- `bun test`: ✅ **2970 pass / 0 fail** (243 files). Targeted re-run of the 9 affected/new files = 128 pass.
- `bun start`: ✅ boots — web-client built, socket listening, audits pass, terminal surface spawned (atomic-write settings path exercised on load).

## Files changed
- `src/bun/web/server.ts` — `setAuthToken` clears `authFails`; `clientIp(req, server)` uses `server.requestIP()`.
- `src/bun/index.ts` — `restartWebMirror()` + `setWebMirrorAuthToken()`; `applyWebMirrorPort` delegates to restart; ctx wiring.
- `src/bun/webview-handlers/types.ts` + `system.ts` — ctx methods + `updateSettings` handling of bind/token changes.
- `src/bun/atomic-write.ts` — tmp opened+fchmod'd to `mode` before write; `fsync` data before rename + dir fsync after.
- `src/bun/rpc-handlers/browser-page.ts` — `file://` removed from navigate allowlist.
- `src/bun/rpc-handlers/shared.ts` — `browser.addscript`/`addstyle` schemas (256 KiB cap via shared `BROWSER_SCRIPT_MAX`).
- `src/bun/logger.ts` — exported `redactSecrets()`, applied in `formatArgs`.

## Tests added / changed
- NEW `tests/web-auth-rotation.test.ts`, `tests/logger-redaction.test.ts`.
- `tests/atomic-write.test.ts` (+1: forces 0600 on a reused loose .tmp), `tests/hardening.test.ts` (+2: addscript/addstyle cap), `tests/rpc-handler-browser.test.ts` (flipped file:// → rejected; about:/https:// accepted).

## Commit / release
- (pending bump + commit — recorded below)
