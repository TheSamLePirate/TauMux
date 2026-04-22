/**
 * τ-mux variant contract — shared types for the three layouts.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §9.
 *
 * Each variant owns its CSS (scoped via `body[data-tau-variant="..."]`
 * attribute selectors) and a small `configure()` function that runs
 * on entry + on every settings change that might affect the layout.
 * Variants NEVER reach into SurfaceManager's pane-layout engine — they
 * reshape the window shell (sidebar width, gaps, status-bar
 * composition, extra chrome like Cockpit HUD / Atlas ticker) and let
 * the engine keep driving pane geometry.
 *
 * This keeps the blast radius small: a broken variant degrades back
 * to the default look by removing the attribute selector from body.
 */
import type { AppSettings } from "../../../shared/settings";

export type VariantId = AppSettings["layoutVariant"];

export interface VariantContext {
  /** Current settings snapshot at the time configure runs. */
  readonly settings: AppSettings;
  /** `<body>` element — attribute selectors hook here. */
  readonly body: HTMLBodyElement;
  /** #tau-status-bar mount point (seeded in index.ts Phase 3). */
  readonly statusBar: HTMLDivElement;
}

export interface VariantHandle {
  readonly id: VariantId;
  /** Called on entry + on any later settings change. Idempotent. */
  enter(ctx: VariantContext): void;
  /** Called when the variant is being replaced. Must reverse everything
   *  `enter()` mutated so the next variant starts from a clean shell. */
  exit(ctx: VariantContext): void;
}
