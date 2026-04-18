# tests-e2e-baselines/

Committed baseline PNGs that `scripts/build-design-report.ts` pixel-diffs
each new capture against. Populated via:

```
bun run report:design        # generate fresh shots
bun run baseline:design      # promote them into this directory
```

- `web/` — shots captured by the `tests-e2e/design/` Playwright suite
  (Chromium against the web mirror).
- `native/` — shots captured by the native `@design-review` suite
  (`tests-e2e-native/specs/design-review.spec.ts`).

Each file name matches `<spec>-<test-slug>-<step>.png`. The diff script
looks them up by that exact path; renaming a test moves the shot out of
the baseline, which the report flags as "new" on the next run.
