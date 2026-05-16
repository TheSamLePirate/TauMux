# Phase 4 — Security hardening (LAN-visible mirror)

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase4.md`
**Status:** In progress — started 2026-05-16.
**Owner:** platform.
**Engineer-weeks:** ~1.5 (medium confidence).
**Lifts:** Web mirror A→S, Panel content renderers B→A, Telegram A→S, Cookie store B→A, Browser history B→A, Logging A→S.

---

## Goal

The web mirror exposes `tau-mux` on `0.0.0.0` with auth. The token gates the connection, but once authenticated, sideband HTML/SVG payloads are rendered via `innerHTML` (S2 HIGH) — anything that can write to fd 4 of any pane (a careless `curl|sh`, a npm postinstall, a Homebrew formula) can inject script that runs in the mirror page's origin, with access to the auth token and `localStorage`.

Phase 4 closes that path. The other items are smaller compensating controls already partially landed (file modes via H.1, brute-force throttle via H.4) that Phase 0 audited for source presence but didn't verify under runtime conditions.

---

## Steps

### Step 1 — S2 / H.7: iframe-sandbox sideband HTML/SVG in the mirror

`src/web-client/panel-renderers.ts` renders sideband HTML and SVG with `contentEl.innerHTML = …`. Replace with an iframe carrying `sandbox` + `srcdoc` + strict CSP via `<meta http-equiv>`.

The sandbox attribute strategy:
- Default to `sandbox=""` (most restrictive — no scripts, no same-origin, no top-nav).
- Allow `allow-same-origin` only if explicitly requested by the panel meta (default off).
- Never allow `allow-scripts` from a sideband payload — that defeats the point.

CSP shape (in srcdoc):
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               style-src 'unsafe-inline';
               img-src data: blob:;
               script-src 'none';
               object-src 'none';
               base-uri 'none';
               frame-ancestors 'none';">
```

The CSP allows inline styles (sideband content is presentation-heavy) and data/blob image sources (sparklines, icons) but nothing else. Scripts are blocked twice — once by `sandbox` (no `allow-scripts`) and once by CSP (`script-src 'none'`).

Tests: `tests/web-client-panel-sandbox.test.ts` — render HTML / SVG, assert the iframe carries the right `sandbox` attribute and that the srcdoc embeds the CSP meta.

### Step 2 — S11 / H.11: Telegram parse_mode validation

The bot's `sendMessage` / `sendMessageWithButtons` payloads can carry a `parse_mode` field. Telegram supports `HTML`, `Markdown`, `MarkdownV2` — each with different escaping rules. A bad allow-list lets a forwarded notification embed Telegram's own HTML/Markdown injection points (e.g. `<a href="javascript:…">`).

Fix: a strict allow-list, default `MarkdownV2`, fall back to plain text for anything outside the list. Add a small escape helper for the default mode.

### Step 3 — H.10: `doc/system-security.md`

The trust model lives in scattered comments today. Catalogue it once:

- The threat model: LAN-attacker with auth token, local-user attacker, npm postinstall / sideband payload, Telegram messages.
- The controls: token entropy floor (S4), brute-force throttle (S5), file modes 0o600 (S1), security headers (S6), sandbox + CSP (S2 — landed in Step 1), parse_mode allow-list (S11 — landed in Step 2), Telegram outbound cap + chatId allow-list (S3 + S7), WebSocket idleTimeout + sendPings (L3).
- The red-team checklist: ten items each paired to a test or a CI grep that prevents regression.

### Step 4 — Verification tests for already-landed items

The audit doc captured these as already-landed but the runtime tests for them are thin:

- H.4 (brute-force throttle) — `tests/web-auth.test.ts:~142` exists; verify it's exercising the 10-fails-in-60s → 10-min cooldown invariant end-to-end.
- H.1 (file modes) — `tests/file-modes.test.ts` covers logger/telegram-db; extend if cookies / history paths weren't covered.

### Step 5 — Per-surface browser partition (H.8) and session cap (H.9)

H.8 / H.9 are more invasive. They touch `BrowserSurfaceManager` (electrobun OOPIF partition) and the web-server session creation. Plan them here but defer to **P7** unless they fit in this session.

---

## Per-step acceptance criteria

| Step | Acceptance |
|---|---|
| 1 | mirror HTML/SVG panels render via iframe; `innerHTML` is gone for these renderers; CSP meta embedded; tests assert the sandbox + CSP shape. |
| 2 | telegram service rejects unknown parse_mode values; default Markdown_V2 with escaped special chars; tests cover allow-list + escape. |
| 3 | `doc/system-security.md` exists with the 10-item red-team checklist; each item references a test. |
| 4 | H.4 test asserts cooldown end-to-end; H.1 file-mode test covers cookies + history if not already. |
| 5 | H.8 / H.9 — deferred to P7 with explicit handoff notes if not landed. |

---

## Lifts to track in `feature_grades.json`

- `web-mirror` A → S (S2 + S6 + headers + heartbeat + brute-force + sandbox = all hardening leg complete).
- `panel-content-renderers` B → A (mirror sandboxed; native trust model documented).
- `telegram-bridge` A → S (parse_mode validation + outbound cap + allow-list + per-chat token bucket — all hardening leg complete).
- `cookie-store` B → A (file modes verified).
- `browser-history` B → A (file modes verified).
- `logging` A → S (file modes verified, rotation works, security docs in place).

---

## Open questions

1. **CSP `style-src 'unsafe-inline'` vs hash-based** — hash-based would be tighter but breaks every existing sideband producer that ships inline styles. `unsafe-inline` is the pragmatic line; inline styles can't pivot to code execution anyway.
2. **Should the sandbox apply to the native webview too?** Native runs in the same Electrobun process; the trust model there is "the script that wrote to fd 4 is the local user". Document in `doc/system-security.md`.

---

## Exit criteria

- mirror HTML/SVG panels survive a payload that tries to embed a script tag — script is blocked.
- Telegram drops a message with `parse_mode: "evil"`.
- `doc/system-security.md` exists and is linked from the top-level README pointer.
- `bun test` green; `bun run report:coverage:check` green; `bun run report:feature-grades:check` green.
