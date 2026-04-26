# Plan 05 — shareBin: rewrite all utilities in TS / mjs (no Python)

## Source quote

> # sharedBin
> - Make all the utilities needed (img, md, json, webcam, diff, gitlog,
>   ...) AAA quality all in mjs or ts. no python

## Current state

Per `doc/system-sharebin.md`, shareBin is the auto-PATH'd directory
of executables. Today the `scripts/` folder mixes:

- TypeScript (preferred): `demo_clock.ts`, `demo_canvas_life.ts`,
  `demo_canvas_particles.ts`, `demo_chart`, `demo_colorpick.ts`, etc.
- Python: `demo_image.py`, `demo_canvas_heatmap.py`,
  `demo_canvas_mandelbrot.py`, `demo_chart.py`, `demo_dashboard.py`,
  `demo_interactive.py`, `demo_canvas_life.py`-equivalent, etc.

The user wants every utility shipped as production-quality TS/mjs:

- All the demos in `scripts/` that are referenced in docs
- A canonical set of "AAA" utilities: `show_img`, `show_md`,
  `show_json`, `show_diff`, `show_gitlog`, `show_webcam`

Python's only remaining role per the user is libraries we genuinely
can't replicate (ML data tools); for terminal-side utilities,
TypeScript via `bun` covers everything.

## Target inventory

### Renderers / viewers (the "AAA" set)

| Command       | Input                          | Renders                              |
| ------------- | ------------------------------ | ------------------------------------ |
| `show_img`    | path or URL or stdin (binary)  | inline image w/ pan + zoom           |
| `show_md`     | path or stdin                  | scrollable markdown panel            |
| `show_json`   | path or stdin                  | collapsible JSON tree                |
| `show_yaml`   | path or stdin                  | re-uses `show_json` with yaml-parse  |
| `show_diff`   | path or stdin (unified diff)   | side-by-side diff w/ syntax colors   |
| `show_gitlog` | repo path (default cwd)        | branch graph + commit details        |
| `show_webcam` | (none)                         | live webcam preview via getUserMedia |
| `show_qr`     | text                           | QR code SVG                          |
| `show_chart`  | csv / stdin                    | configurable line/bar/scatter        |
| `show_table`  | csv / json / stdin             | sortable table                       |
| `show_html`   | path or stdin                  | already exists; thin wrapper         |

### Internal helpers

- `share-bin/lib/ht-client.ts` — current `scripts/hyperterm.ts`,
  promoted to a versioned shared lib. Imported by every utility.
- `share-bin/lib/markdown.ts` — small markdown parser (or wrap
  marked / micromark). Heavy parsers should be vendored, not pulled
  per-call.
- `share-bin/lib/diff.ts` — wraps `diff` (jsdiff equivalent).
- `share-bin/lib/colors.ts` — ANSI/syntax tokens for diff + json.

## Migration strategy

### Phase 1 — inventory + retire Python demos

1. Sweep `scripts/`:
   ```sh
   ls scripts/*.py
   ```
2. For each `.py`:
   - If a TS twin already exists (`demo_canvas_life.ts` ↔
     `demo_canvas_life.py`), delete the `.py`.
   - If only Python: write a TS port and delete the Python.
3. `doc/sideband-script-reviews.md` — refresh listings.

### Phase 2 — promote `scripts/` to `shareBin/`

Today `shareBin/` doesn't exist on disk (we confirmed via `ls`); the
auto-PATH wiring is in `pty-manager.ts` (look for `shareBin` references
in `electrobun.config.ts`, `bin/ht`, and `pty-manager.ts`). Decision:

1. Create the `shareBin/` directory at repo root.
2. Move only the **user-facing AAA utilities** (`show_*`) into it.
3. Keep `scripts/demo_*` in `scripts/` — those are demos, not
   utilities. They are not on PATH.
4. Update `electrobun.config.ts` to bundle `shareBin/` into the .app
   under `Resources/shareBin/` (already done if doc is accurate;
   verify).
5. `pty-manager.ts` — verify the absolute path it injects into `$PATH`
   works in both dev and packaged builds (different prefixes).

### Phase 3 — write each `show_*`

For each utility:

- Use `bun` shebang.
- Import `ht` from `lib/ht-client`.
- Accept input from `argv[2]` (path) OR `stdin` if not a TTY.
- Use `--position float|inline|fixed` to control where the panel
  lands.
- Provide `--help` text.
- Exit cleanly on `ht.onClose`.

Style: every utility under 200 LOC. No transitive deps that aren't
already in `package.json`. If a dep is needed, add it once, vendor it
under `share-bin/lib/`.

### Phase 4 — replace Python references in docs

- `doc/how-to-use-sideband.md` — update examples.
- `doc/system-sharebin.md` — drop the Python boilerplate section, or
  demote it to "Legacy" with a note.
- `README.md` (if any) — update.

## Files to touch

- `shareBin/` (new) — `show_img`, `show_md`, `show_json`, `show_yaml`,
  `show_diff`, `show_gitlog`, `show_webcam`, `show_qr`, `show_chart`,
  `show_table`.
- `shareBin/lib/` (new) — `ht-client.ts`, `markdown.ts`, `diff.ts`,
  `colors.ts`.
- `scripts/` — delete `*.py`; keep the TS demos.
- `electrobun.config.ts` — verify bundle inclusion.
- `src/bun/pty-manager.ts` — verify `$PATH` injection covers both
  dev (`./shareBin`) and packaged (`Contents/Resources/shareBin`).
- `doc/system-sharebin.md`, `doc/how-to-use-sideband.md`,
  `doc/sideband-script-reviews.md`.

## Tests

- `tests/sharebin-cli.test.ts` (new) — for each `show_*`, run
  `bun shareBin/show_X --help` and assert exit 0 + non-empty stdout.
- `tests/sharebin-pipe.test.ts` — pipe a fixture file into each
  utility, assert it produces a `panel.created` sideband event.

## Risks

- Python demos may be the only canonical example for a couple of
  rendering paths (e.g. heatmap). Make sure the TS port preserves the
  visual behaviour — diff against design baselines via
  `bun run baseline:design`.
- The `lib/` folder choice (inside `shareBin/`) may pollute `$PATH`
  with a non-executable `lib`. Workaround: chmod 644 on `lib/*` so
  they don't appear as commands; or move `lib/` to
  `shareBin/.lib/` (dot prefix) to hide from completion.

## Effort

M — ~1 day per polished utility × 10 = ~2 weeks if done sequentially;
~1 week with parallelism. Suggested order: ship `show_md`,
`show_json`, `show_diff` first (most-used), then images / charts /
webcam.
