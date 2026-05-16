# Tracking — fix_ht_bridge_pane_readiness

## Progress

- Inspected `pi-extensions/ht-bridge/tools/run-in-split-core.ts` and the `surface.split` RPC path.
- Found two race/compatibility issues:
  - `surface.split` historically returns `"OK"`, so `ht_run_in_split` could not reliably know the new target surface id.
  - Command injection proceeded even when `surface.wait_ready` timed out/null-returned, making it possible to lose input during pane startup.
- Updated `ht_run_in_split` to snapshot `surface.list`, request the split, poll for the new surface id when legacy `"OK"` is returned, then require `surface.wait_ready` before sending text.
- Updated the bun-side `surface.split` handler to return `{ id }` when the dispatch synchronously creates a pane, and to pass `surfaceId`/`cwd` through the internal split dispatch.

## Deviations / issues

- No plan deviation. The fix touched both the extension and the RPC surface because the extension needs to work with legacy `"OK"` responses, while newer τ-mux should return the created id directly.

## Validation

- `bun test tests/pi-extensions/ht-bridge/run-in-split.test.ts tests/rpc-handler.test.ts` — passed.
- `bun run typecheck` — passed.
- `bun test` — ran; 1718 tests passed, 1 existing design audit failed (`tests/audit-guideline-do-donts.test.ts` / `no-third-accent`, 35 off-palette chromatic hexes). This appears unrelated to the split/readiness change.
- Re-ran `bun test tests/pi-extensions/ht-bridge/run-in-split.test.ts && bun run typecheck` after formatting edits — passed.

## Commit

- Commit: `a80cca2` (`fix ht run-in-split pane readiness`).
- Version bump: requested `bun run bum:patch`, but the repository has no `bum:*` scripts; ran the available `bun run bump:patch` instead (`0.3.4` → `0.3.5`).
