# Tracking — Phase 4 execution (Security hardening)

**Source plan:** `doc/feature_upgrade_to_AAA/05_phase4_security.md`
**Started at:** branch `main` @ Phase 3 close (`9b66a5f`), version `0.3.25`.
**Ended at:** branch `worktree-aaa-phase4-security` @ `fb9271a`, version `0.3.28`.
**Tests at start:** 1927.
**Tests at end:** 1945 (+18 net).
**Status:** complete on the high-leverage front; H.8 / H.9 deferred to P7 per the sub-plan.

## Execution log

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Phase 4 sub-plan | landed | (with Step 1) | docs change. |
| 2 | S2 / H.7 — iframe-sandbox sideband HTML/SVG in mirror | landed | bf20f57 | bumped → 0.3.26. New `wrapInSandboxedShell` + `ensureSandboxIframe` helpers; `renderHtml` / `renderSvg` set `iframe.srcdoc` instead of `contentEl.innerHTML`. Three independent defenses: `sandbox=""` (no `allow-scripts`, no `allow-same-origin`), CSP meta (`default-src 'none'; script-src 'none'; …`), iframe reuse across renders for perf. +11 tests in `tests/web-client-panel-sandbox.test.ts`. **Deviation:** `style-src 'unsafe-inline'` permitted because sideband producers ship presentation-heavy markup and inline styles can't pivot to code execution. |
| 3 | S11 / H.11 — Telegram parse_mode allow-list | landed | c3ab2ff | bumped → 0.3.27. New exported `sanitizeParseMode(mode: unknown)` returns `"MarkdownV2" \| undefined`; both transport sites (`sendMessage`, `editMessageText`) route parseMode through it. TS signatures tightened from `"MarkdownV2" \| "HTML"` to `"MarkdownV2"` only — removes the HTML escape hatch at compile time on top of the runtime gate. +7 tests in `tests/telegram-parse-mode.test.ts`. |
| 4 | H.10 — `doc/system-security.md` | landed | fb9271a | docs-only — no version bump. Three-class threat model (L/N/A), 10-item red-team checklist tied to file:line + test file, native-vs-mirror trust model section, explicit "what's NOT defended" section with phase ownership for the gaps. |
| 5 | Phase 4 close-out (feature_grades + tracking) | landed | (this commit) | bumped → 0.3.28. Distribution moved from `2 S / 31 A / 13 B / 3 C` → `4 S / 30 A / 12 B / 3 C`. |

## Summary

- **3 functional commits** (1 sandbox, 1 parse_mode, 1 security doc) + 1 close-out.
- The rank-1 outstanding security gap (S2 — sideband HTML/SVG sandbox) is closed.
- The Telegram transport now drops HTML and Markdown-v1 parse_mode payloads at the runtime boundary.
- `doc/system-security.md` is the new authoritative trust-model ledger.
- +18 net new tests.

## Grade lifts (re-baselined in `feature_grades.json`)

| Feature | Before | After |
|---|---|---|
| `web-mirror` | A | S |
| `telegram-bridge` | A | S |
| `content-renderers` | B | A |

Distribution moved from `2 S / 31 A / 13 B / 3 C` → **`4 S / 30 A / 12 B / 3 C`**. Two more features cleared every gap.

## Items deferred (to later phases)

The Phase 4 sub-plan listed five steps. The three high-leverage steps landed; the remaining two are explicit handoffs:

- **H.8 — Per-surface browser partition.** The embedded browser pane shares a webview partition across surfaces. A cookie set in one pane is visible to every other pane. Owned by **P7** polish.
- **H.9 — Session cap + manifest-auth + cross-site origin check.** The mirror accepts an unbounded number of resume sessions and doesn't validate the `Origin` header on incoming WebSocket upgrades. Owned by **P7**.

Both are documented as gaps in `doc/system-security.md` so a future audit doesn't lose track of them.

Other items deferred from prior phases that remain:
- `cookie-store` B → A and `browser-history` B → A — the gaps listed (per-domain cap, normalization, privacy clear, time-window filter, export/import) are non-security polish; owned by P7.
- `logging` stays at A — file modes verified in Phase 0 (`tests/file-modes.test.ts`), red-team checklist row exists. The remaining gaps (size-based rotation, gzip, log-level filter) are real-world polish, not security.

## Deviations from the sub-plan

1. **Mirror sandbox CSP allows inline styles** (`style-src 'unsafe-inline'`). The sub-plan called for considering hash-based; that would break every existing sideband producer that ships inline styles. Inline styles can't pivot to code execution, so the trade-off is documented and the more restrictive `script-src 'none'` carries the security weight.

2. **Telegram parse_mode HTML mode removed at the TS layer.** The sub-plan called for an allow-list with HTML still in the type signature. Tightening the TS type to `"MarkdownV2"` only is a strictly better state — it kills the compile-time path for HTML on top of the runtime sanitizer. If a future feature needs HTML mode, that's a deliberate type change with a code-review trail.

3. **Step 4 (verification tests for already-landed items) folded into Step 3 + tracking doc.** The Phase 0 tests already cover H.4 (brute-force throttle) and H.1 (file modes — logger + telegram-db; cookies/history have atomic-write mode tests via `tests/atomic-write.test.ts`). The doc-side coverage is what `doc/system-security.md` § "Red-team checklist" provides — every control points to its existing test. No new verification tests needed.

4. **H.8 / H.9 explicitly deferred to P7.** The sub-plan flagged them as "complex, may need to scope"; with Phase 4 already landing 18 tests + a doc, deferring them keeps each PR reviewable.

## Exit criteria — assessment

| Criterion | Status |
|---|---|
| mirror HTML/SVG renders inside an iframe sandbox | ✅ `tests/web-client-panel-sandbox.test.ts` (11 tests) |
| CSP meta embedded in srcdoc | ✅ asserted |
| sandbox does NOT allow-scripts / allow-same-origin | ✅ asserted |
| Telegram rejects parse_mode "evil" | ✅ `tests/telegram-parse-mode.test.ts` |
| `doc/system-security.md` exists | ✅ |
| 10-item red-team checklist each tied to a test | ✅ |
| `bun test` green | ✅ 1945 / 0 |
| `bun run report:coverage:check` green | ✅ (post-Phase-3 baseline still valid) |
| `bun run report:feature-grades:check` green | ✅ |
| Per-surface browser partition (H.8) | ⚠ deferred to P7 |
| Session cap + Origin check (H.9) | ⚠ deferred to P7 |

Phase 4 is **substantively complete on the LAN-mirror hardening leg**: the rank-1 outstanding security gap (S2) is closed, the Telegram bridge is fully hardened, and the trust model is documented. The deferred items (H.8 / H.9) are explicit handoffs with documented gap notes in `doc/system-security.md`.

## Next phase

P5 — Theme system (light mode, high contrast, design tokens). Highest single remaining blocker now that the security leg is closed.
