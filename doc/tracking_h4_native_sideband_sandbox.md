# Tracking — H4: sandbox the native webview html/svg sink

Source: `doc/full_app_review_2026-05.md` §7.2 (H4, high). The native half of
C2 (§7.1, which fixed only the web mirror).

## Problem

The native renderers did `contentEl.innerHTML = decode(data)` for fd4
`html`/`svg` with zero sandboxing — at three sinks: `content-renderers.ts`
`renderSvg`/`renderHtml` (binary path) and `panel.ts` (inline `meta.data`,
mount + update). The native webview holds the **Electrobun RPC bridge**, so
injected script there is strictly more dangerous than on the LAN mirror (it can
drive the whole RPC surface). C2 hardened the mirror but left this
higher-privilege sink fully open.

## Fix

### Shared sandbox — `src/shared/sideband-sandbox.ts` (new)

Promoted the web mirror's `wrapInSandboxedShell` + CSP + `ensureSandboxIframe`
+ `renderSandboxedMarkup` into a single shared module so the web and native
surfaces share ONE sandbox that can't drift. Display-only markup renders inside
a `<iframe sandbox="">` (no `allow-scripts`, no `allow-same-origin`) carrying a
strict CSP (`script-src 'none'`, `default-src 'none'`).

- **`src/web-client/panel-renderers.ts`** — deleted its local copies, imports +
  re-exports `renderSandboxedMarkup` from shared. Behavior identical (the
  existing `web-client-panel-sandbox` tests still pass).

### Native sinks — conditional on `interactive`

- **`content-renderers.ts`** — new `renderMarkup(contentEl, markup, kind, meta)`:
  non-interactive html/svg → shared sandboxed iframe; `meta.interactive` →
  direct `innerHTML`. `renderSvg`/`renderHtml` now take `meta` and route through
  it.
- **`panel.ts`** — new `renderInlineData(data)` replaces the two raw
  `innerHTML = meta.data` sinks (mount + updateMeta): non-interactive html/svg →
  sandboxed; interactive (or any non-markup type) → direct.

### Why interactive panels keep the direct path

`setupInteractive` forwards clicks/wheel/mouse by listening on `contentEl`; an
iframe intercepts those events, so a sandboxed interactive panel couldn't
forward them. Interactive is **producer opt-in**, so a producer that wants
full-privilege DOM explicitly asks for it. This is the single, documented native
trust boundary (commented at each sink + in CLAUDE.md). Display-only panels —
the overwhelming common case — are now sandboxed with zero feature loss.

Did NOT add a CSP `<meta>` to `index.html`: the native page hosts the whole app
(xterm, RPC bridge, dynamically-set styles) and a page-level CSP risks breaking
legitimate app behavior; the per-content iframe sandbox is self-contained and
scoped exactly to untrusted markup.

## Verification

- `bun run typecheck` — clean. `bun run lint` — 0.
- `bun test tests/native-sideband-sandbox.test.ts` — 9 pass: shared shell CSP +
  iframe attrs + reuse; native binary html/svg sandboxed (hostile `onerror`/
  `onload` not a live host node); interactive html keeps the direct path; inline
  `meta.data` html sandboxed vs interactive direct.
- `bun test tests/web-client-panel-sandbox.test.ts` — 14 pass (mirror path
  unchanged after the re-export).
- `bun test` — 3044 pass / 0 fail (+9).
- `bun start` — web bundle rebuilds with the shared import resolved; native
  boots clean.
- Updated the CLAUDE.md "No sandboxing of fd4 content" constraint to the new
  default-sandboxed reality.

## Deviations / notes

- Per the review's options, took the iframe-sandbox path (strictly stronger than
  a sanitizer for arbitrary producer markup) for display-only content, and kept
  the interactive direct path as the documented privilege boundary — rather than
  the weaker "document only" minimum.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
