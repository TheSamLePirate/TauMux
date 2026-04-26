# Tracking — Plan 02: Smart status-key system

**Plan**: [`plan_status_keys_smart.md`](plan_status_keys_smart.md)
**Status**: in progress
**Status changed**: 2026-04-26
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Step-by-step progress

The plan is large (rated L: ~2–3 days end-to-end). Splitting into two
commits to keep each reviewable:

### Commit A — parser + renderers + dispatcher + sidebar layout

- [x] `src/shared/status-key.ts` — pure parser (DSL + body grammar)
- [x] `tests/status-key-parser.test.ts` — 37 cases (DSL + body grammar)
- [x] `src/views/terminal/status-renderers.ts` — v1 renderers
  (text / longtext / num / pct / lineGraph / array / link / time / eta);
  inline + block contexts
- [x] Wire dispatcher into `status-keys.ts` (bottom status bar) — `renderHtEntry` now goes through `parseStatusKey` + `renderStatusEntry`
- [x] Well-known ht keys (`ht-status` / `ht-warning` / `ht-title`) match by parsed `displayName` so suffixes don't break them
- [x] Wire dispatcher into `sidebar.ts buildStatusGrid` (workspace card) — block renderers (lineGraph / array / longtext) get full vertical chrome; inline renderers slot inside the existing 2-row card
- [x] Hidden flag (leading `_`) excluded from sidebar; still rendered in the bar
- [x] `tests/status-key-renderers.test.ts` — 14 DOM tests covering bar + card contexts, semantic propagation, malformed-body fallback
- [x] Backwards compat: bare keys (`build`, `status`) still render as text
- [x] CSS for block renderers + safe link styling (no dotted borders — design rule)
- [x] `bun run typecheck` clean
- [x] `bun test` — 916/916 (was 915 pre-CSS-fix; was 865 baseline; +37 parser, +14 renderers)
- [x] `bun run bump:patch` — 0.2.1 → 0.2.2
- [ ] Commit A — next

### Commit B — discovery + settings UI for ht keys (stretch)

- [ ] Bun: track `htKeysSeen: Set<string>` in app context
- [ ] Bun: broadcast on change (debounced) via socket-action
- [ ] Webview: handle `htKeysSeen` action; expose to settings panel
- [ ] Settings → Status bar: second list with discovered ht keys
- [ ] `AppSettings.htStatusKeyOrder` + `htStatusKeyHidden`
- [ ] Tests
- [ ] Commit B

### Doc updates

- [x] `doc/system-rpc-socket.md` — suffix table + per-renderer body grammar + worked examples
- [~] `bin/ht set-status --help` — **deviation: deferred to follow-up**, the suffix DSL is exhaustively documented in the doc and the help text already points readers there. Adding it inline would crowd `printHelp` significantly.

## Deviations from the plan

1. **Single-file renderers module** instead of one-file-per-renderer
   under `src/views/terminal/status-renderers/`. The plan suggested a
   directory; I went with one `status-renderers.ts` (~350 LOC) because
   each renderer is small (~10–30 LOC) and they share helpers
   (`textValue`, `formatNum`, `inlineKv`, `applySemantic`). Splitting
   would have churned more imports than it saved. Easy to refactor
   later if a single renderer grows beyond reason.
2. **Well-known ht keys (`ht-status` / `ht-warning` / `ht-title`)
   match by parsed `displayName`** instead of literal key. So a
   script writing `status_text_warn` still resolves to the
   `ht-status` registry entry, with the warn semantic preserved.
   Strict literal matching would have broken the suffix DSL for the
   most-used keys.
3. **No `bin/ht set-status --help` text expansion.** The full DSL
   reference lives in `doc/system-rpc-socket.md`; cross-linking from
   help would inflate `printHelp` by ~40 lines. Decision: prefer the
   doc; add a `See: doc/system-rpc-socket.md §4` line if/when help
   needs it.
4. **Discovery + Settings UI for ht keys deferred to commit B**
   (separate session). Plan's effort estimate was 2–3 days for the
   whole thing; commit A delivers the protocol + dispatcher (the load-
   bearing part) so any future plan can produce smart entries
   immediately, and commit B is a polish item that can land later.

## Issues encountered

1. **Type narrowing in the `pct` inline fallback** — I wrote
   `body.value` without first narrowing `body.kind`, so
   `lineGraph` / `array` shapes (which don't have `.value`) failed
   typecheck. Fixed by routing through `textValue(body)` which knows
   how to extract a string from any body shape.
2. **`§11 no-dotted-borders` design audit failed** because I styled
   `.tau-status-link` with `border-bottom: 1px dotted currentColor`.
   Caught by the existing audit suite, replaced with
   `text-decoration: underline` + `text-underline-offset: 2px`.
   Lesson: when adding link / underline chrome, check the design audits
   first.

## Open questions for the user

- The plan lists ~20 renderer suffixes but recommends shipping only
  v1 (`text`, `longtext`, `num`, `pct`, `lineGraph`, `array`, `link`,
  `time`, `eta`). I'll follow that recommendation. Other suffixes
  (`bar`, `vbar`, `gauge`, `kv`, `md`, `image`, `code`, `sparkline`,
  `bytes`, `ms`) parse cleanly but render as plain text — easy to
  add later without a protocol change.

## Verification log

(empty)

## Commits

(empty)
