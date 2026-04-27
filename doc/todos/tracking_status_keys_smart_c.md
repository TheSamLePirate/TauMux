# Tracking — Plan 02 commit C: full v2 renderer catalogue

**Plan**: [`plan_status_keys_smart.md`](plan_status_keys_smart.md) (commit C)
**Sister tracking**: [`tracking_status_keys_smart.md`](tracking_status_keys_smart.md) (commit A — protocol + initial v1) · [`tracking_status_keys_smart_b.md`](tracking_status_keys_smart_b.md) (commit B — discovery + Settings)
**Status**: done
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Why a commit C

The plan listed ~20 renderer suffixes and recommended shipping v1
with 9 of them, deferring 10 to v2 "once we've used v1 in anger".
The user requested the **full** spec — and more — so this commit
expands the renderer catalogue from 9 to **38** and turns the
status-key DSL into a complete data-visualisation surface.

Catalogue, by family:

- **numeric** (11): text · longtext · code · num · count · pct · bytes · ms · duration · currency · rating
- **time** (4): time · eta · date · clock
- **state** (4): bool · status · dot · badge
- **chart** (11): bar · vbar · gauge · lineGraph · sparkline · area · histogram · heatmap · dotGraph · pie · donut
- **data** (5): array · kv · json · list · tags
- **rich** (6): link · image · md · color · kbd · file

Beyond the plan: `code · count · duration · currency · rating · date · clock · bool · status · dot · badge · vbar · gauge · area · histogram · heatmap · dotGraph · pie · donut · kv · json · list · tags · image · md · color · kbd · file` are all new.

## Step-by-step progress

- [x] `src/shared/status-key.ts`: extend `RendererId` union (9 → 38),
      `RENDERER_LAYOUT` map, and `ParsedBody` discriminated union with
      typed payloads for every renderer
- [x] Body parsers per renderer with **graceful text fallback** (never
      throws; malformed JSON / non-numeric / unknown CSS colour all
      return a `text` body so the chip renders the raw string)
- [x] Safety: `image` rejects non-http(s)/non-data:image schemes
      (XSS guard); `link` continues to reject non-http; `color` rejects
      unknown keywords
- [x] `src/views/terminal/status-renderers.ts`: full inline + block
      dispatchers; all renderers route through `renderStatusEntry`
- [x] SVG primitives: `buildSparklineSvg` (line + optional area),
      `buildVbarSvg`, `buildGaugeSvg` (half-circle arc with track),
      `buildHeatmapStrip` (5-stop rgb gradient), `buildPieSvg`
      (full slice paths, donut variant via inner radius),
      `buildStarSvg` (5-point geometric path — no emoji glyphs)
- [x] DOM primitives: badge chips, status pills with state dots,
      dot-graph (4-bucket: off / low / mid / on), `<dl>` kv-grid,
      JSON pretty-print `<pre>` block, list bullets, tag chips with
      overflow indicator, color swatches, `<kbd>` chords, file-name
      chip with full-path tooltip
- [x] Tiny safe markdown subset: `**bold**`, `*italic*`, `` `code` ``,
      `[label](url)` — link clicks routed via existing `ht-open-url`
      bus so the bun URL allowlist still applies
- [x] `src/views/terminal/index.css`: chrome for every new renderer
      using existing `--tau-*` tokens; respects §11 (no dotted borders,
      no decorative panel gradients)
- [x] Tests: `tests/status-key-parser.test.ts` 51 → 76 cases covering
      every new renderer; `tests/status-key-renderers.test.ts` 14 → 44
      DOM cases (chain composability, semantic propagation, safety
      rejections, SVG shape assertions for charts)
- [x] `bun run typecheck` clean
- [x] `bun test` — **1420/1420 pass**, 108340 expect() calls
- [x] `tests/audit-emoji.test.ts` clean (initial run flagged `★/☆`,
      replaced with `buildStarSvg` SVG path)
- [x] `tests/audit-guideline-do-donts.test.ts` clean (no dotted
      borders, gradient budget intact)
- [x] `doc/system-rpc-socket.md`: §4 "Smart status keys (suffix DSL)"
      now lists all 38 renderers in 6 grouped tables, with worked
      examples for every renderer family
- [x] `shareBin/demo_status_keys`: new bun script that calls
      `ht set-status` for every renderer with realistic payloads.
      Supports `--live` (animates `vbar / lineGraph / area` with
      random samples every 1.5s) and `--clear`. Embeds a 1×1 base64
      cyan PNG so the `image` demo works offline.
- [x] `bun run bump:patch` — 0.2.18 → 0.2.19

## Deviations from the plan

1. **Single-file renderers module retained.** Commit A noted that
   splitting per-renderer would matter once the file passes ~500 LOC.
   It now sits at ~1640 LOC. Inlining was the right call for v1 + v2
   because most renderers reuse `inlineKv` / `appendBlockLabel` /
   `applySemantic` / the SVG primitives — splitting would have
   churned ~40 imports. If a future renderer needs a heavyweight
   dependency (charts library, font-metrics measurer) that's the
   moment to split.
2. **Chart bodies use `|`-separated structured payloads** for
   `bar / gauge / currency / image / link / rating`. The plan only
   specified `<label>|<url>` for link; the rest are extensions. The
   `|` separator was chosen over `;key=value` because (a) shell
   quoting is simpler, (b) it composes naturally with the existing
   `link` body, (c) only 2–3 fields per renderer so positional is
   readable.
3. **`bool / status / dot` accept multiple input spellings**
   (`true/yes/1/on/ok` for true; matching set for false; lots of
   state synonyms — `done/ok/passed/complete`, `active/running/wip`,
   etc.). Surface area is large but the DSL is forgiving by design;
   scripts shouldn't need to read the docs to get a reasonable render.
4. **`pie` accepts three body shapes** (JSON object, JSON array of
   `[label, value]` pairs, and `a:3,b:7` shorthand). The shorthand
   was added because shell-quoted JSON with colons is annoying and
   pie charts are a common quick-glance use case.
5. **Renderer layout map upgrade.** `vbar / gauge / area / histogram /
   heatmap / pie / donut / kv / json / list / image / md` are all
   block-preferred in the sidebar card. The plan only marked
   `lineGraph / array / longtext`. The block-preferred list is now
   driven from `RENDERER_LAYOUT` and `BLOCK_RENDERERS`; the bottom
   bar always renders inline regardless.
6. **Star rating uses an SVG path, not Unicode `★`/`☆`.** Initial
   pass used Unicode chars; `tests/audit-emoji.test.ts` flagged them
   on first run. Replaced with `buildStarSvg(filled)` returning a
   geometric path (filled with currentColor, or stroke-only). Same
   rule: chrome stays emoji-free per §0.

## Issues encountered

1. **`agent_response_latency_ms_pct_warn` test failure** — once `ms`
   joined the renderer set, the chain peel stopped at `latency`
   instead of `ms`, changing the displayName from
   "agent response latency ms" → "agent response latency" and the
   chain from `[pct]` → `[ms, pct]`. This is the *correct* new
   behaviour (`ms` is now a real renderer). Updated the parser test
   to reflect it; documented the chain-precedence rule in the doc:
   "leftmost in chain wins as primary".
2. **happy-dom doesn't normalise `style.background`** the way jsdom
   does. The color-swatch test was asserting `rgb(111, 233, 255)`;
   adjusted to `.toLowerCase().contains("6fe9ff")` so the test is
   engine-agnostic.
3. **Star characters tripped the emoji audit.** Caught on the
   penultimate full-suite run, fixed via `buildStarSvg`. Lesson:
   any time I reach for a glyph for chrome, prefer SVG primitives
   first.

## Open questions for the user

- The plan's "options DSL on the key" idea (`cpu_pct@max=80`) was
  not implemented. Per-renderer options are encoded in the body
  (`30|60|GB` for `bar` / `gauge`) instead. If a future renderer
  needs many options, we can add a `--options 'k=v,k=v'` flag to
  `ht set-status` and a `parseOptions(parsed.rawKey, optString)`
  layer rather than overloading the key DSL.
- Color `--color` flag still resolves the keyword aliases the
  legacy renderer honoured (`cyan / agent / ok / warn / err / info`).
  Adding more was tempting but would diverge from the
  `SemanticToken` palette. Held the line.

## Verification log

| Run                                                    | Result                              |
| ------------------------------------------------------ | ----------------------------------- |
| `bun run typecheck`                                    | clean                               |
| `bun test tests/status-key-parser.test.ts`             | 76/76 pass                          |
| `bun test tests/status-key-renderers.test.ts`          | 44/44 pass                          |
| `bun test tests/audit-emoji.test.ts`                   | 1/1 pass                            |
| `bun test tests/audit-guideline-do-donts.test.ts`      | 1/1 pass                            |
| `bun test` (full suite, post-edit)                     | 1420/1420 pass, 108340 expect() calls |
| `bun run bump:patch`                                   | 0.2.18 → 0.2.19                     |

## Commits

- (this commit) — status: full v2 renderer catalogue (38 renderers)

## Retrospective (commit C, fully closes Plan #02 expansion)

What worked:
- **Parser-first, again**. Adding the renderer ids + body parsers
  + table-driven tests before the DOM renderers caught two parser
  bugs (`pct` clamping when `n>1 && n<1` heuristic for `pie` body
  on edge inputs) before any pixel hit the screen.
- **Total parsers + text fallback** continued to pay off. Five
  renderers (`color`, `link`, `image`, `pie`, `currency`) reject
  malformed input by returning `{kind: "text"}`; the dispatcher
  always renders the raw string instead of blanking the entry.
- **One file for renderers** is still ergonomic. The block / inline
  dispatchers are small `switch` statements; helpers like
  `inlineKv / applySemantic / textValue / formatNum` are shared
  across families.
- **SVG primitives compose**. `buildSparklineSvg` got an `area`
  flag for `area` charts; `buildPieSvg` got an `innerR` for donuts.
  No copy-paste.

What I'd do differently:
- I should have grepped `tests/audit-*.test.ts` before reaching for
  `★/☆`. Fast catch but a wasted iteration.
- The renderer file is now ~1640 LOC. The next renderer I add should
  trigger a split — likely `status-renderers/charts.ts`,
  `status-renderers/data.ts`, `status-renderers/rich.ts` with the
  dispatcher + helpers staying in `status-renderers/index.ts`.
- A live screenshot baseline of `shareBin/demo_status_keys` running
  in `--live` mode would make regressions in chart renderers
  obvious. Would need a Playwright recipe — out of scope here but
  worth noting.

Plan #02 is fully closed. The protocol (commit A), discovery + UX
(commit B), and the complete renderer catalogue (commit C) are all
shipped. Any future expansion is additive (new renderer suffixes
slot into `RENDERER_IDS` + a body parser + a dispatcher case +
DOM/CSS) — no protocol change required.
