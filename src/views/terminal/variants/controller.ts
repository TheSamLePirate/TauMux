/**
 * τ-mux variant controller.
 *
 * Single entry-point that owns the active layout variant. Subscribes
 * to settings changes and transitions between variants by calling
 * `exit()` on the previous then `enter()` on the next. Idempotent —
 * re-applying the same variant is a no-op.
 *
 * Design guideline §9 — "Users pick one; the choice persists in
 * localStorage" — we use AppSettings instead so the choice is
 * deterministic across sessions and visible to the bun process
 * (useful for variant-aware sideband defaults later).
 */
import type { AppSettings } from "../../../shared/settings";
import { BridgeVariant } from "./bridge";
import { CockpitVariant } from "./cockpit";
import { AtlasVariant } from "./atlas";
import type { VariantContext, VariantHandle, VariantId } from "./types";

const REGISTRY: Record<VariantId, VariantHandle> = {
  bridge: BridgeVariant,
  cockpit: CockpitVariant,
  atlas: AtlasVariant,
};

export interface VariantControllerOptions {
  settings: AppSettings;
  /** Persists the `layoutVariant` change through the settings RPC so
   *  it survives restart + is observable from bun. */
  updateSettings: (partial: Partial<AppSettings>) => void;
}

export class VariantController {
  private current: VariantHandle;
  private readonly ctx: VariantContext;
  private readonly updateSettings: (p: Partial<AppSettings>) => void;

  constructor(opts: VariantControllerOptions) {
    const body = document.body as HTMLBodyElement;
    const statusBar = document.getElementById(
      "tau-status-bar",
    ) as HTMLDivElement;
    if (!statusBar) {
      throw new Error(
        "[τ-mux] #tau-status-bar not found — variant controller needs it mounted (Phase 3).",
      );
    }
    this.ctx = { settings: opts.settings, body, statusBar };
    this.updateSettings = opts.updateSettings;
    const initial = this.resolve(opts.settings.layoutVariant);
    this.current = initial;
    initial.enter(this.ctx);
  }

  /** Re-run the active variant's `enter()` — used when settings
   *  change in a way the variant cares about (paneGap, sidebarWidth). */
  refresh(settings: AppSettings): void {
    Object.assign(this.ctx as { settings: AppSettings }, { settings });
    // If the variant id itself changed, transition; otherwise re-enter
    // so the variant can pick up the new settings snapshot.
    if (this.current.id !== settings.layoutVariant) {
      this.setVariant(settings.layoutVariant);
    } else {
      this.current.enter(this.ctx);
    }
  }

  /** Switch to a specific variant. Persists via updateSettings. */
  setVariant(id: VariantId): void {
    if (this.current.id === id) return;
    this.current.exit(this.ctx);
    const next = this.resolve(id);
    this.current = next;
    next.enter(this.ctx);
    this.updateSettings({ layoutVariant: id });
  }

  get activeId(): VariantId {
    return this.current.id;
  }

  private resolve(id: VariantId): VariantHandle {
    return REGISTRY[id] ?? REGISTRY.bridge;
  }
}
