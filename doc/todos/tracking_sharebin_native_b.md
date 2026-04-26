# Tracking — Plan 05 (Commit B): show_table, show_yaml, show_html

**Plan**: [`plan_sharebin_native.md`](plan_sharebin_native.md)
**Sister tracking**: [`tracking_sharebin_native.md`](tracking_sharebin_native.md) (Commit A)
**Status**: done
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Three more shareBin utilities, each with its own lib module + tests:

  show_table — CSV / TSV → sortable HTML table
  show_yaml  — minimal YAML → reuse `lib/json-tree.ts`
  show_html  — thin wrapper: stdin / file → `ht.showHtml(...)`

Defer to a future commit:
  show_gitlog  — needs git invocation + commit-graph layout
  show_qr      — Reed-Solomon QR encoder is ~150 LOC of math
  show_chart   — needs a chart layout pass; tractable but its own
                  unit
  show_webcam  — getUserMedia in HTML; small but visual-only

## Step-by-step progress

- [x] `shareBin/lib/csv.ts` — RFC 4180-ish parser: quoted fields
      with doubled-quote escape, `\r\n` / `\n` / bare `\r` line
      endings, comma / tab auto-sniff or explicit, ragged-row
      tolerance (downstream pads), no-stray-empty-row on trailing
      newline
- [x] `shareBin/lib/table.ts` — `renderTable` → sortable HTML
      table. Header / body split, ragged-row padding, HTML escape
      on every cell, embedded `<script>` for click-to-sort with
      three-state cycle (asc → desc → unsorted) and numeric
      promotion when every cell in the column parses as finite
- [x] `shareBin/lib/yaml.ts` — minimal indentation-based parser.
      Supports: `key: value`, nested mappings, dash-prefixed
      sequences, sequence-of-mappings inline shape, scalar
      inference (int / float / sci / bool / yes-no / null / `~`),
      double + single quoted strings with escape handling. Throws
      on tab indent + on lines with no key/value separator so the
      caller can degrade to text.
- [x] `shareBin/show_table` — auto-sniffs CSV/TSV; honours
      `--tsv` / `--csv` / `--no-header` / `--inline` / `--width`
      / `--no-wait`; sticky header during scroll; numeric +
      lexicographic sort
- [x] `shareBin/show_yaml` — reuses `renderJsonTree` for the
      tree; YAML tag in the header so the user knows what they
      asked for; clear "try yq -o json" hint on parse failure
- [x] `shareBin/show_html` — thinnest possible wrapper over
      `ht.showHtml(...)` with a header comment about the
      no-sandbox contract from `doc/system-canvas-panels.md`
- [x] chmod +x on all three
- [x] `tests/sharebin-libs-b.test.ts` — 35 cases (CSV: 9
      including auto-sniff, quoted-with-newline, doubled-quote,
      CRLF, trailing-newline, empty-input;
      table: 8 including sortable-script presence, header on /
      off, ragged padding, XSS escape, empty placeholder;
      YAML: 18 including flat / nested / deep / sequences / seq
      of mappings / numbers / booleans / null / quoted /
      backslash escape / comments / blank lines / colon-in-value
      / tab rejection / bad-shape rejection / CRLF)
- [x] `bun run typecheck` clean
- [x] `bun test` — 1179/1179 (was 1144; +35 lib-b)
- [x] `bun scripts/audit-emoji.ts` clean
- [x] `bun run bump:patch` — 0.2.14 → 0.2.15
- [ ] Commit — next

## Deviations from the plan

1. **YAML parser is a strict subset.** Plan suggested a generic
   YAML→JSON path; I shipped an indentation-based parser
   covering the agent-dump shapes (mappings, sequences, scalars,
   sequence-of-mappings) and explicitly throw on flow style /
   anchors / multi-doc / block scalars. The error message
   directs power users to `yq -o json | show_json`. Anything
   richer would have meant vendoring a 1500-line dependency the
   shareBin scripts don't otherwise need.
2. **Click-to-sort lives in the panel itself**, not in
   bun-driven webview code. The renderer emits a small `<script>`
   block alongside the `<table>` so the panel is interactive
   even after the source script has exited. Trade-off:
   inline-script in `ht.showHtml` content is fine per
   `doc/system-canvas-panels.md` ("fd4 content is trusted").
3. **`show_html` is intentionally minimal.** Plan listed it as a
   "thin wrapper"; this commit ships exactly that — read input,
   forward to `ht.showHtml`. Anyone who wants more (live reload,
   route external CSS, etc.) can extend the existing
   `show_md`-style live-reload pattern.

## Issues encountered

(none — typecheck and tests passed first try after each edit;
formatter ran on multiple writes per the established pattern)

## Open questions

- YAML parser scope: the plan said "wrap with json-parse". I'm
  writing a *minimal* parser (dict-of-scalars / nested mappings /
  basic sequences); anything fancier (anchors, multi-doc, block
  scalars, flow style) falls through to a friendly error message
  pointing at `yq -o json | show_json`. Documented as a deviation.
- `show_table`: how to communicate "this is sortable" — JS
  click-to-sort handlers attached on the panel. The HTML stays
  static when the script exits, and tapping a header re-sorts in
  place via the panel's resident JS.

## Verification log

(empty)

## Commits

(empty)
