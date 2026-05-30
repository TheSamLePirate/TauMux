# Tracking — dependency vulnerability fixes (surfaced by Wave 4 `bun audit`)

Started: 2026-05-30. Follows Wave 4 (`tracking_wave4_deferred_maintainability.md`, commit 1dfddf20, v0.3.166).
Goal: clear the 7 vulnerabilities `bun audit` reported (4 high, 3 moderate).

## The 7 advisories

| Package | Sev | Installed → Fix | Chain | Approach |
|---------|-----|-----------------|-------|----------|
| `ws` | moderate | 8.20.0 → 8.21.0 | direct devDep (+ happy-dom, sandcastle) | bump direct range + override (covers transitive copies; all `^8`) |
| `ip-address` | moderate | 10.1.0 → 10.2.0 | electrobun › proxy-agent › … › socks › ip-address | override `^10.2.0` (satisfies socks `^10.0.1` — minor, safe) |
| `brace-expansion` | moderate | 5.0.5 → 5.0.6 | typescript-eslint › … › minimatch › brace-expansion | override `^5.0.6` (only ONE version in tree — patch, safe) |
| `basic-ftp` ×4 | **high** | 5.2.0 → 6.0.1 | electrobun › proxy-agent › pac-proxy-agent › get-uri › basic-ftp | override `^6.0.1` (see note) |

### basic-ftp note (the only non-trivial one)
All four HIGH advisories are FTP-server-controlled DoS / CRLF-injection — they require the client to connect to a *malicious FTP server*. There is **no patched 5.x** (GHSA-rpmf marks `≤5.3.0` vulnerable), so the fix is a **major** bump to 6.x. `get-uri` declares `basic-ftp: "^5.0.2"`, so the 6.x override technically violates that range — BUT this code is only reached if `pac-proxy-agent` fetches a `ftp://` PAC URL, which never happens in τ-mux (no proxy auto-config / FTP usage). Real exposure: ~zero. The override is install-forced; verified the app still boots + all tests pass, proving the unused FTP path doesn't break. If a runtime break ever surfaced, the fallback is to document basic-ftp as accepted-risk (unreachable transitive).

## Approach
Surgical `overrides` in package.json (don't bump electrobun 1.16.0 → 1.18.1 — a GUI-runtime major is a separate, larger change). Caret ranges so future patches flow.

## Verification (2026-05-30)
- `bun install` applied overrides; resolved: ws 8.21.0, ip-address 10.2.0, brace-expansion 5.0.6, basic-ftp 6.0.1.
- **`bun audit`: No vulnerabilities found** (was 7 — 4 high, 3 moderate).
- `bun run typecheck`: ✅ clean. `bun test`: ✅ **2989 pass / 0 fail**.
- `bun start`: ✅ boots cleanly — electrobun's internal server (which owns the proxy-agent/get-uri/basic-ftp chain) starts with no FTP/proxy/module-resolution errors, confirming the basic-ftp 6.x major override doesn't break the unused FTP path.

## Commit / release
- (recorded below)
