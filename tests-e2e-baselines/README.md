# tests-e2e-baselines/

Committed baseline PNGs that `scripts/build-design-report.ts` pixel-diffs
each new capture against. Populated via:

```
bun run report:design        # generate fresh shots
bun run baseline:design      # promote them into this directory
```

- `web/` — shots captured by the `tests-e2e/design/` Playwright suite
  (Chromium against the web mirror). Components, scenarios, and the
  sideband demo catalog from `demos.spec.ts`.
- `native/` — shots captured by the native suites
  (`tests-e2e-native/specs/design-review.spec.ts` +
  `tests-e2e-native/specs/demos.spec.ts`). Same demo catalog, plus
  native-only states (splits, palette, settings, dialogs, process
  manager).
- `manifest.json` — canonical list of every baselined shot key,
  regenerated on every `bun run baseline:design`. The auditor
  (`bun run test:design:audit`) reads this and compares it against
  committed PNGs + spec-declared step names, so a renamed / deleted /
  un-promoted shot fails CI instead of silently drifting.
- `.new-allowed` (optional) — one canonical key (`<suite>::<slug>`)
  per line, comments with `#`. Shots listed here are allowed to appear
  as status `new` in gated mode, so a legitimately new capture can
  land without flapping CI while its baseline is being reviewed.

Each PNG filename matches `<spec>-<test-slug>-<step>.png`. The report
looks them up by that exact path; renaming a test moves the shot out of
the baseline and the gate flags it as `baseline-only` on the next run.
