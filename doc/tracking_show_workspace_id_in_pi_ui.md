# Tracking — show_workspace_id_in_pi_ui

- Start commit: `2831ada3`
- Date: 2026-05-19
- Release bump: `bun run bump:patch` → `0.3.155`
- Implementation commit: `d24404ee`

## Progress

- W1 — Inspected status/enrichment path.
  - `pi-extensions/ht-bridge/observe/tui-status.ts` already formats both workspace id and surface id when `SurfaceContext.workspaceId` is populated.
  - `pi-extensions/ht-bridge/index.ts` already calls `enrichContext(surface, ht)` and refreshes the status handle afterwards.
  - Root cause found in `surface-context.ts`: enrichment expected camelCase `system.identify` fields (`workspaceId`, `surfaceId`), but the current τ-mux handler returns snake_case fields (`active_workspace`, `focused_surface`). Result: `workspaceId` stayed null, so the footer displayed only the surface id.
- W2 — Implemented workspace id display reliability.
  - `enrichContext()` now accepts both current snake_case and camelCase identify payloads.
  - If the focused surface is not the pi pane, `enrichContext()` calls `system.tree` to map `HT_SURFACE` to its owning workspace, avoiding a stale active/focused workspace id.
  - Falls back to the active workspace if tree lookup fails.
- W3 — Added ht-bridge tests.
  - Added `tests/pi-extensions/ht-bridge/surface-context.test.ts` for snake_case identify, camelCase aliases, tree fallback, and active-workspace fallback.
  - Existing `tui-status` tests still confirm formatter output includes both ids when workspace is known.

## Deviations

- No direct change was needed in `pi-extensions/ht-bridge/index.ts`; the entrypoint already refreshes the UI after enrichment. The bug was that enrichment did not populate `workspaceId` from the live RPC shape.

## Issues / Risks

- `system.tree` is a best-effort fallback and may be unavailable in very old τ-mux builds; in that case the status falls back to `active_workspace` rather than hiding the workspace forever.

## Validation

- Passed: `bun test tests/pi-extensions/ht-bridge/tui-status.test.ts tests/pi-extensions/ht-bridge/surface-context.test.ts`
- Passed: `bun test` (2949 pass)
- Passed: `bun run typecheck`
- Passed: `bun start` launch check (app built, launcher started, session spawned; terminated with SIGTERM after verification)
