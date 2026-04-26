# Tracking — Plan 05 (Commit C): show_qr, show_chart, show_gitlog, show_webcam + lib/cli.ts

**Plan**: [`plan_sharebin_native.md`](plan_sharebin_native.md)
**Sister tracking**: [`tracking_sharebin_native.md`](tracking_sharebin_native.md) (Commit A) · [`tracking_sharebin_native_b.md`](tracking_sharebin_native_b.md) (Commit B)
**Status**: done
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

The four remaining utilities the plan called for, plus the
`lib/cli.ts` scaffold the commit-B retrospective flagged as a
follow-up:

  show_qr      — Reed-Solomon QR encoder + SVG render
  show_chart   — line / bar / scatter via pure-SVG renderer
  show_gitlog  — `git log` → branch-graph table
  show_webcam  — getUserMedia in interactive HTML panel
  lib/cli.ts   — typed flag parser + readInput scaffold + PANEL_FLAGS preset

## Step-by-step progress

- [x] `shareBin/lib/cli.ts` — generic `parseArgs<schema>` returning
      a typed `{ positional, flags }` pair; `readInput(path, opts)`
      that handles file-or-stdin with a friendly missing-input
      error; `PANEL_FLAGS` preset for the five flags every panel
      utility ships (--inline / --no-wait / --x / --y / --width /
      --height). Supports `--flag value` and `--flag=value`,
      explicit `--flag=false` to disable a boolean, throws on
      unknown flags so typos don't get silently ignored.
- [x] `shareBin/lib/qr.ts` — pure ISO/IEC 18004 QR encoder. Byte
      mode, EC levels L/M/Q/H, auto version selection, GF(256)
      Reed-Solomon codeword generation, all 8 mask patterns scored
      via N1+N2 penalty (the simplification is fine — readers don't
      care which mask was picked as long as format-info is correct).
      Tables for v1..v12 (367 bytes at level M is plenty for any
      shareBin payload). Plus `qrToSvg()` convenience that
      run-length-merges horizontal dark modules into single rects
      to keep the SVG small.
- [x] `shareBin/lib/chart.ts` — pure SVG line/bar/scatter renderer.
      Wilkinson-flavoured nice-tick math (`niceRange`, `niceTicks`),
      categorical fallback when x column isn't numeric, group-bar
      layout when multiple y series, palette of eight Catppuccin-
      adjacent colours, header row supplies legend + axis labels.
      All XSS-escaped through the shared `escape.ts`.
- [x] `shareBin/lib/git-log.ts` — `parseGitLog(raw)` for the
      `--pretty=format:%H%x1e%h%x1e%P%x1e%an%x1e%ae%x1e%ad%x1e%s%x1f`
      format (RS/US delimited so subject lines with `:` `|` `,`
      pass through verbatim); `layoutGraph(commits)` walks commits
      newest-first, assigning each commit's first parent to the
      same rail and secondary parents to fresh rails (railroad-
      style graph); `graphWidth(rows)` for sizing the leading
      column.
- [x] `shareBin/show_qr` — accepts text from positional arg OR
      stdin (positional wins so `show_qr "$(cat file)"` works);
      `--ec L|M|Q|H`, `--scale`, `--margin`, `--dark`, `--light`;
      header shows EC level + truncated payload preview; SVG
      rendered into a white-background frame so dark colours scan
      against a light surface.
- [x] `shareBin/show_chart` — auto-sniffs CSV/TSV; `--kind line|bar|scatter`,
      `--x-col`, `--y` (comma-list of column indices), `--csv` /
      `--tsv` / `--no-header` / `--title`. Defaults to a wider 760
      panel because charts breathe better with more horizontal
      room.
- [x] `shareBin/show_gitlog` — `git log` invoked via spawnSync in
      the target dir (positional arg, defaults to cwd); `--max N`,
      `--branches` (passes `--all`); table has graph column with
      ●/│ markers per rail, abbreviated SHA, subject (truncated
      with full text in `title`), author, ISO date trimmed to
      `yyyy-mm-dd HH:MM`. Default panel widened to 880 because the
      five-column table needs the room.
- [x] `shareBin/show_webcam` — getUserMedia + permission flow, optional
      `--device "label-substring"` matcher, `--mirror` for selfie
      view, snapshot button that downloads a PNG via canvas
      data-URL. `interactive: true` so the snapshot button stays
      clickable. Tracks stopped on `beforeunload` so the camera
      LED turns off when the panel closes.
- [x] chmod +x on all four executables
- [x] `tests/sharebin-libs-c.test.ts` — 45 hermetic cases:
      - cli (10): positional collection, boolean default,
        space + equals value forms, number parsing + error path,
        unknown flag rejection, missing-value rejection, mixed
        ordering, PANEL_FLAGS preset shape, explicit `--flag=false`
      - qr (12): version selection, finder-pattern centres, dark-
        module placement, timing-pattern alternation, EC-level
        capacity ordering, oversize payload rejection, invalid
        version rejection, SVG xmlns + viewBox + colour overrides
        + minimum dark rect count
      - chart (13): nice-range expansion + degenerate-zero case,
        nice-tick uniform spacing, line / bar / scatter element
        counts, header-row label propagation, hasHeader=false
        fallback labels, categorical x fallback, title rendering,
        XSS escape on header values
      - git-log (10): single-record parse, multi-parent split,
        trailing-newline tolerance, subject with `:` and `|`,
        format constant uses git's hex-escape tokens, linear-history
        rail assignment, merge flagging, merge expanding rail count,
        commit-on-rail invariant, root-commit rail snapshot
- [x] `bun run typecheck` clean
- [x] `bun test tests/sharebin-libs-c.test.ts` — 45/45 pass
- [x] `bun test` (full) — 1224/1224 pass (was 1179; +45 lib-c)
- [x] `bun scripts/audit-emoji.ts` clean
- [x] `bun run bump:patch` — 0.2.15 → 0.2.16
- [x] Commit — pending (next step)

## Deviations from the plan

1. **QR encoder ships v1..v12 only.** v12 byte-mode L holds 367
   bytes; the plan's "AAA quality" intent is for short payloads
   (URLs, secrets, login tokens). Adding tables for v13..v40 is
   another 80 lines of constants for content nobody is going to
   point at `show_qr`. If a future caller hits the limit, the
   error message is explicit: `payload of N bytes exceeds version
   12-X capacity`.
2. **QR mask penalty uses N1+N2 only**, omitting the standard's
   N3 (finder-like patterns) and N4 (dark/light balance). The
   chosen mask is still deterministic and the format-info bits
   are written correctly, which is what readers actually validate.
   N3/N4 are quality knobs, not correctness ones — adding them
   would inflate the file by ~50 lines for no functional gain
   given how short shareBin payloads are.
3. **Chart renderer is pure-SVG**, no canvas or animation. Charts
   in `ht.showHtml` panels stay interactive through panel-level
   features (drag, resize) but don't need their own animation —
   the data is static once rendered. Pure SVG is also test-friendly
   (the 13 chart tests are all string-match assertions).
4. **`show_chart` doesn't auto-detect numeric columns.** The plan
   suggested smart column inference; instead we expose `--y 1,2,3`
   and let the caller specify. Auto-detect would have been a
   guessing layer that fails noisily on mixed data; explicit is
   better here.
5. **`show_gitlog` requires the user to pass a repo dir** (or use
   cwd). The plan suggested branch picking via UI flags; the
   smaller `--branches` switch covers the 90% case (show every
   branch's history). Anything fancier should live in `show_gitdiff`
   which already has a richer interactive shell.
6. **`show_webcam` is fully self-contained** — the snapshot button
   downloads via the standard `<a download>` mechanism rather than
   uploading to a sideband channel. Sideband upload would require
   a new "binary channel from webview to bun" path that doesn't
   exist yet; the download path works today and matches the
   browser-native expectation.
7. **`lib/cli.ts` is opinionated, not full-featured.** No `--`
   terminator, no abbrev matching, no help generation. Agents
   never invoke shareBin scripts with hostile argv — keeping the
   parser minimal keeps the test surface minimal.
8. **`PANEL_FLAGS` defaults are 100/100/520/480** which collide
   with several existing utilities' explicit overrides (show_chart
   wants 760×400; show_gitlog wants 880×540). Rather than
   parameterise the preset, each utility short-circuits "if
   width === 520 then 760" so explicit `--width` still wins. Slightly
   cute but keeps the preset stable for new utilities.

## Issues encountered

1. **`show_gitlog` initially imported `GitCommit` as a type-only**
   then tried to `void GitCommit` to silence the unused-import
   warning. Type-only imports get erased; the void was at the
   value level and would have failed typecheck. Fix: dropped the
   import (and the void).
2. **`show_webcam` initially imported `escapeHtml`** "for symmetry"
   but never used it (no user-typed strings in the rendered HTML
   — the device label flag is JSON-stringified into the script
   block). Removed the import after typecheck flagged it.
3. **No surprises from the QR encoder.** The 12 QR tests all
   passed first try, including the timing-pattern alternation
   property and EC-level capacity ordering. The Reed-Solomon
   tables and bit-stream construction are mechanical enough that
   typing them carefully against ISO 18004 §7 was sufficient.

## Open questions

- The QR penalty scoring omits N3 (finder-like 1:1:3:1:1
  patterns) and N4 (dark-module count balance). For the short
  payloads shareBin handles, the simplified scoring still picks
  consistent masks. If users hit scanning issues with specific
  payloads, adding N3/N4 is the natural follow-up.
- `show_webcam` snapshot uses `<a download>` rather than fd4
  upload. A future commit could route the PNG back through a
  binary sideband channel so the bun side can save it in a
  user-chosen location, but that needs new infrastructure.
- `show_gitlog` runs a fresh `git log` per invocation — for
  very large repos (10k+ commits) this is fine because we cap
  at `--max-count`, but it doesn't stream. If someone wants
  paginated browsing they should use `show_gitdiff` (which
  already has interactive nav).

## Verification log

| Run                                            | Result                              |
| ---------------------------------------------- | ----------------------------------- |
| `bun run typecheck`                            | clean                               |
| `bun test tests/sharebin-libs-c.test.ts`       | 45/45 pass, 102 expect() calls      |
| `bun scripts/audit-emoji.ts`                   | clean                               |
| `bun test` (full)                              | 1224/1224 pass, 108006 expect() calls |
| `bun run bump:patch`                           | 0.2.15 → 0.2.16                     |

## Commits

- (pending) — shareBin: show_qr + show_chart + show_gitlog + show_webcam + lib/cli.ts

## Retrospective

What worked:
- The lib/util pattern from commits A and B held up perfectly.
  Each utility ended up at ~120-160 LOC because the flag
  scaffolding (PANEL_FLAGS + parseArgs + readInput) collapsed
  the boilerplate. show_chart is 130 lines, show_gitlog 200,
  show_qr 140, show_webcam 165 — most of that is HTML/CSS for
  the panel chrome rather than plumbing.
- Pure-function libs are unit-test gold. 45 tests in 23 ms
  covering the hard parts (RS encoding, nice-tick math, graph
  layout, flag parsing) — every visual utility ships sitting on
  proven pure code.
- The QR encoder built first try because I followed Nayuki's
  algorithm shape (column-pair walk for placement, two-pass
  format-info BCH, mask-then-format-then-version order). Custom
  table-driven encoding always sounds scary; following an
  existing reference layout makes it tractable.
- show_webcam ended up being the simplest of the four — almost
  all of it is the snippet of JS inside the panel HTML. The bun
  side just renders the markup and waits.

What I'd do differently:
- Could have shared more between show_chart and show_table:
  both auto-sniff CSV, both honour --tsv/--csv/--no-header.
  A `lib/csv-input.ts` that wraps `parseCsv` + the input
  reading would have shaved another ~10 lines from each. Easy
  follow-up if a third CSV consumer lands.
- The QR encoder's table for v1..v12 could be derived from a
  smaller seed (the standard has formulas for the row counts);
  but the table is so small that parsing a formula at runtime
  would be more code, not less. The constant tables are the
  right answer here.
- `show_gitlog`'s railroad layout is correct but visually
  basic — no curved branch joins, no colours per long-lived
  rail. A future polish pass could add SVG-based connectors;
  the current ●/│ characters are functional but read more like
  a debug dump than a real graph.

Carried over to follow-ups:
- Migrate the Python *demos* in `scripts/` (separate from
  `shareBin/`; not on PATH) per Phase 1 of the original plan.
- `lib/csv-input.ts` to dedupe CSV-input plumbing across
  `show_table` + `show_chart` (and any future CSV utility).
- QR penalty N3/N4 if a real scanning issue surfaces.
- show_gitlog SVG branch connectors for a richer graph
  visualisation.
- Plan #05 is now complete: every utility the plan listed has
  shipped (show_md, show_json, show_diff, show_yaml, show_table,
  show_html, show_img, show_qr, show_chart, show_gitlog,
  show_webcam) — 11 utilities backed by 9 lib modules
  (escape, markdown, json-tree, diff-render, csv, table, yaml,
  qr, chart, git-log, cli). The auto-PATH `shareBin/` is the
  user's "AAA-quality TS/mjs utility set", with the Python
  hyperterm.py preserved as the external client lib for
  agent-authored Python scripts.
