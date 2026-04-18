# Design report

A standalone HTML gallery at `test-results/design-report/index.html` that
consolidates every screenshot captured by the web-mirror and native
Playwright suites, pixel-diffs each shot against a committed baseline,
and surfaces annotations + terminal output so a reviewer can judge
visual regressions without opening each PNG by hand.

## Commands

```
bun run test:full-suite      # typecheck + unit + web + native + gated report + audit
bun run report:design        # advisory report (no gate); skips typecheck/unit
bun run report:design:gate   # rebuild + pixel-diff + CI gate (exits 1 on regression)
bun run report:design:web    # advisory, web only — no macOS/Electrobun needed
bun run test:design:web      # web design suite, no report rebuild
bun run test:design:native   # native @design-review suite, no report rebuild
bun run test:design:audit    # strict audit: manifest ↔ PNGs ↔ spec step names
bun run baseline:design      # promote current shots + regenerate manifest
```

Each command ends with an `index.html` you can `open` directly — no
server needed, PNGs are copied in and referenced relatively.

## Advisory mode vs gate mode

Two modes share the same report structure.

- **Advisory** (`report:design`, `report:design:web`). Writes the HTML
  gallery, always exits 0. Right for local exploration where you want
  to browse the shots regardless of drift.
- **Gate** (`report:design:gate`, or any command ending in `--gate`).
  Exits non-zero when any shot has status `over`, `missing`,
  `dim-mismatch`, `baseline-only`, or `corrupt`, or an un-allowlisted
  `new` shot. The HTML report shows a red banner at the top with the
  set of failing statuses. This is the mode `test:full-suite` runs.

Gate fail statuses:

- `over` — pixel diff > 0.5% of total pixels.
- `dim-mismatch` — current PNG resolution differs from baseline. Always
  fails because diff is undefined.
- `missing` — the JSONL registered a shot but the PNG isn't on disk.
  Indicates a capture / copy failure.
- `baseline-only` — the committed baseline has a PNG the current run
  never produced. Surfaces deleted / renamed / regressed tests.
- `corrupt` — the PNG didn't decode. Distinct from `new` so postmortems
  aren't misleading.
- `new` — a current shot with no committed baseline. Fails **unless**
  allowlisted in `tests-e2e-baselines/.new-allowed` (one canonical key
  per line, `#` comments allowed).

`tests-e2e-baselines/.new-allowed` is a pressure-release valve: add the
key of a legitimately new shot before `test:full-suite` runs, review it
in the HTML, promote with `baseline:design`, then delete the line.
Leaving stale allowlist entries rotates into "muted regressions" fast,
so treat this file as short-lived.

## Manifest + audit

Every `baseline:design` regenerates `tests-e2e-baselines/manifest.json`
listing every committed shot as `{ key, suite, slug, test, step,
width, height }`. `bun run test:design:audit` (invoked automatically by
`test:full-suite`) checks three invariants:

1. Every manifest entry has a corresponding PNG on disk.
2. Every PNG on disk has a manifest entry. Prevents a promote that
   forgot to re-save the manifest.
3. Every `snap()` call in the spec files has a baseline with the same
   step name. Catches tests that claim a shot the baseline doesn't
   have — the class of bug that put `dialog-rename-workspace` into
   the initial drop as a perpetual "new".

The auditor exits non-zero in `--strict` mode (the default for
`test:design:audit`) on any mismatch.

## Baseline workflow

`baseline:design` is a **promote-only** step: it copies whatever already
exists under `test-results/design-report/shots/` into
`tests-e2e-baselines/`. It does **not** re-run tests, so you always
baseline the shots you just reviewed.

Canonical loop:

1. `bun run test:full-suite` — generates the fresh report.
2. Open `test-results/design-report/index.html`, confirm everything
   looks right.
3. `bun run baseline:design` — freeze those shots as reference.
4. Next `bun run test:full-suite` pixel-diffs the new shots against the
   frozen baseline. Over-threshold shots (default: >0.5%) turn red in
   the card grid and expose a Current / Baseline / Diff tab group in
   the detail modal.

When a diff is intentional, promote again. When it's a regression, fix
the code and re-run until the cards are green.

## What each shot records

The `snap(name, opts)` helpers write one JSONL entry per shot to
`.design-artifacts/screenshots-index.jsonl`. Each entry carries:

- `suite` — `web` or `native`
- `spec` / `test` / `step` — grouping keys for the report
- `path` — absolute path to the PNG (copied into the stage dir so
  Playwright's `test-results/` wipe can't destroy it)
- `state` — arbitrary JSON supplied by the test (sidebar open? palette
  query? demo arguments?)
- `annotate` — for each CSS selector passed in, the bounding rect +
  twenty computed-style fields (color, font, padding, border-radius,
  box-shadow, z-index, …). The report renders this as a table with
  colour swatches.
- `terminal` — the visible PTY buffer for the focused surface,
  ANSI-stripped and capped at 4 KB. Rendered as a scrollable `<pre>` in
  the detail modal — useful for demos, where the panel rides on top of
  a real terminal line like `Clock widget active. Press Ctrl+C…`.
- `file` + `line` — source location, linked in the detail modal so you
  can jump to the test that produced a shot.

## Suite contents

### `tests-e2e/design/` (web mirror, Chromium)

- **`components.spec.ts`** — one test per DOM atom in
  `src/bun/web/page.ts` + `src/web-client/main.ts`: toolbar (default /
  hover / focus / each button), sidebar (collapsed / expanded), pane
  (default / fullscreen / populated / bar-only / bar-button-hover),
  layout variants.
- **`scenarios.spec.ts`** — composite flows: boot states, sidebar
  collapsed vs expanded, pty colour showcase, long scrollback, `ls -la
  /`, auth gate (open / missing token / correct token), narrow + wide
  viewports.
- **`demos.spec.ts`** — one test per entry in
  `tests-e2e/design/helpers/demos.ts` (`ACTIVE_DEMOS`). Each demo:
  - Runs via `commandFor(demo)` which `cd`s to the repo root, uses
    absolute interpreter paths, and shell-quotes args. File-arg demos
    pass real repo files (`./package.json`, `./README.md`,
    `./scripts/gravite terre.jpg`, `./src`, `./scripts`) so the panel
    renders against the user's actual content.
  - Waits `demo.settleMs` ms, snaps, then sends `Ctrl+C`.

The web fixture's shell is `/bin/zsh -l -f`. `/bin/sh -l` on macOS
closes fds ≥ 3 before exec, which kills the sideband pipe. `zsh -l`
preserves them; `-f` skips rc files so the prompt is ready in ~30 ms
(the user's oh-my-zsh would otherwise eat settle time and swallow the
command).

### `tests-e2e-native/specs/design-review.spec.ts` + `demos.spec.ts`

Drives the real Electrobun app via the JSON-RPC client in
`tests-e2e-native/client.ts`. Covers:

- Layout scenarios: boot-empty, horizontal / vertical split, 2×2,
  unbalanced, browser surface, pty activity, notification toast,
  secondary workspace.
- Tier-2 UI states (when `HYPERTERM_TEST_MODE=1` is active): palette
  open + filtered, settings panel, process manager, sidebar toggle,
  rename-workspace + rename-surface dialogs.
- The same demo catalog as the web suite, so each demo has a native
  twin in the report grid.

## Plumbing

```
src/design-report/                      ← pure TS module — unit-tested helpers
  types.ts                              · shared types + canonical key helpers
  index-io.ts                           · parseIndexLines, latestPerKey
  shot-classify.ts                      · classifyShot, tryDecodePng
  enumerate-baseline.ts                 · walks tests-e2e-baselines/
  manifest.ts                           · read/write/index manifest.json
  new-allowed.ts                        · parse .new-allowed
  gate.ts                               · evaluateGate — pure pass/fail decision
  render-html.ts                        · standalone HTML template
tests-e2e/design/helpers/snap.ts        ← web snap helper
tests-e2e-native/screenshot.ts          ← native snap helper
tests-e2e-native/fixtures.ts            ← wires snap() on the `app` fixture
tests-e2e/design/helpers/demos.ts       ← shared demo catalog used by both suites
scripts/build-design-report.ts          ← orchestrator (thin)
scripts/promote-design-baseline.ts      ← copy shots + (re)generate manifest.json
scripts/audit-design-baselines.ts       ← manifest/PNG/spec invariants
tests/design-report/                    ← bun test coverage for the module
tests-e2e-baselines/                    ← committed PNG references + manifest + .new-allowed
.design-artifacts/                      ← staged PNGs + JSONL, survives Playwright's test-results wipe (gitignored)
```

### Why a stage directory outside `test-results/`

Playwright wipes `test-results/` at the start of every run. Running
`test:e2e` then `test:native` in sequence used to drop the web shots
before the report builder could see them. `.design-artifacts/` sits
outside that wipe zone, so both suites append into the same JSONL and
both suites' PNGs survive to the final `build-design-report` step.

## Thresholds

- `FAIL_FRACTION = 0.005` — 0.5% of pixels. Below this, a shot is
  green; above, red.
- `PX_THRESHOLD = 0.1` — pixelmatch per-pixel colour tolerance. Raise
  to forgive anti-aliasing drift on cold/hot boots; lower for strict
  comparisons.

Edit both in `scripts/build-design-report.ts`. The report header shows
the active values.

## Adding a new shot

1. Pick a suite:
   - DOM / CSS state → `tests-e2e/design/components.spec.ts`.
   - Composite flow → `tests-e2e/design/scenarios.spec.ts`.
   - Demo script → append to `tests-e2e/design/helpers/demos.ts`
     (`ACTIVE_DEMOS` derives itself by filtering `skip !== true`).
   - Native-only (palette, settings, dialogs, splits, browser
     surface) → `tests-e2e-native/specs/design-review.spec.ts`.
2. Inside the test body call `snap(page, testInfo, "unique-step-name",
   { annotate, state })` (web) or `app.snap("unique-step-name",
   annotate)` (native).
3. Run `bun run report:design:web` (or `report:design` / `test:full-suite`).
4. Review, then `bun run baseline:design` when you're happy.

## Adding a demo with a file argument

Edit `tests-e2e/design/helpers/demos.ts`:

```ts
{
  file: "demo_json.ts",
  slug: "json",
  label: "JSON viewer",
  runner: "bun",        // or "python3"
  settleMs: 2000,
  args: ["./package.json"],   // repo-relative path — quoted automatically
  notes: "Loaded via Bun.resolveSync — path must be relative.",
},
```

`commandFor(demo)` prepends `cd <repo-root> && ` and single-quotes
every argument, so spaces in paths (`./scripts/gravite terre.jpg`)
survive intact. Demos that go through `Bun.resolveSync` must receive a
`./`-prefixed path or bun will treat it as a package name.
