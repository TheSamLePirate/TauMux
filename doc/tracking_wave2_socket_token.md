# Tracking — Wave 2: opt-in RPC socket token (from `full_app_review_2026-05.md`)

Started: 2026-05-30. Effort: high. Follows Wave 1 (`tracking_wave1_security_hardening.md`, commit edd5869a, v0.3.162).
Source: `doc/full_app_review_2026-05.md` §6.1 / §11.4 (H3). User decisions (this session):
- **Socket token = opt-in, default OFF.** Ship the full mechanism + wire every bundled client to present the token; the socket-server enforces ONLY when `rpcSocketRequireToken` is enabled. No external install breaks until the user opts in.
- **At-rest crypto (cookies/secrets) = deferred** (Electrobun exposes no persistent Keychain API; W1-3 already closed the world-readable window). Tracked for a later wave.

## Threat model note
The token is **defense-in-depth, not a hard boundary**: a 0600 token file is readable by any same-user process, so a *targeted* attacker can read it too. Its value is raising the bar from "connect to a well-known socket and send send_text" to "also locate + read the token file" — it stops opportunistic/naive abuse by a compromised dependency. This matches the review's "incremental hardening" framing. The token is NEVER placed in pane env (that would be strictly worse).

## Scope

| ID | Item | Status |
|----|------|--------|
| W2-1 | Setting `rpcSocketRequireToken` (default false) + schema | ✅ done |
| W2-2 | Generate per-boot token → `configDir/socket.token` (0600) at startup | ✅ done |
| W2-3 | SocketServer validates `__token` for mutating methods when enforcement on (timing-safe); read-only diag methods exempt | ✅ done |
| W2-4 | `bin/ht` reads the token file + sends `__token` on every request | ✅ done |
| W2-5 | pi-extensions/ht-bridge direct socket client sends `__token` | ✅ done |
| W2-6 | Settings panel toggle (network section) | ✅ done |
| W2-7 | Tests | ✅ done |

Legend: ⬜ todo · 🔄 in progress · ✅ done · ⚠️ deviation

## Design
- Token file: `join(dirname(socketPath), "socket.token")` — beside the socket (`configDir/socket.token`). App writes via `writeFileAtomic(..., {mode:0o600})`. Clients derive the path from `HT_SOCKET_PATH` (`dirname` + `socket.token`); `HT_RPC_TOKEN_PATH` env overrides.
- Wire field: top-level `__token` on the JSON request (sibling to `method`/`params`), stripped before the handler runs so it never reaches handler params or the rpc audit log.
- Unauthenticated allowlist (diagnostics, work without a token even when enforcement is on so `ht doctor` can diagnose a mismatch): `system.ping`, `system.version`, `system.identify`, `system.capabilities`, `system.health`, `system.tree`. Everything else (incl. `system.shutdown`) needs the token when enforcement is on — deny-by-default.
- Enforcement is read live from settings via a `requireToken()` thunk, so toggling the setting takes effect without a restart.

## Work log
Files: `src/shared/rpc-token.ts` (new — shared constants/helpers), `src/shared/settings.ts` + `settings.schema.ts` (field + boolStrict default), `src/bun/index.ts` (token gen at boot 0600, pass auth to SocketServer, unlink on shutdown), `src/bun/socket-server.ts` (SocketAuthOptions + timing-safe gate, `__token` stripped before handler), `bin/ht` (read token beside socket, send `__token`), `pi-extensions/ht-bridge/lib/ht-client.ts` (same), `src/views/terminal/settings-panel.ts` (Network toggle).

## Verification (2026-05-30)
- `bun run typecheck`: ✅ clean. `bun run build:cli`: ✅ bin/ht compiles.
- `bun test`: ✅ **2980 pass / 0 fail** (244 files). New `tests/rpc-token.test.ts` + 7 socket-server gate tests; token/settings/socket subset = 69 pass.
- `bun start` + live socket smoke: ✅ token file written at `configDir/socket.token` `-rw-------` (64 hex chars / 32 bytes); `ht version` + `ht identify` round-trip against the live socket presenting the token; mutating call works with enforcement OFF (default).
- Enforcement-on behaviour (reject without/with-wrong token, read-only exempt, shutdown not exempt, `__token` not leaked to handler params) covered by unit tests.

## Commit / release
- **Committed** on `main` as **`c5dd020a`** (v0.3.163). `bun run bump:patch` first (0.3.162 → 0.3.163; synced electrobun.config.ts, rpc-handlers/system.ts, website-doc {en,fr}/{cli,api}/system.md). 20 files, +399/-12. Not pushed.
