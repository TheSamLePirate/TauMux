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
 *
 * Resilience note (issue M9 in doc/full_analysis.md): the controller
 * is constructed during the first `applySettings` call. If
 * `#tau-status-bar` hasn't mounted yet (boot-order race with
 * `mountStatusBar()`), the controller stays *inert* — it logs a warn
 * and re-checks the DOM on every subsequent `refresh()`. As soon as
 * the bar appears, the active variant is entered for real. This
 * replaces the previous hard `throw`, which crashed the entire
 * webview boot.
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
  /** Set once the status bar is found and the first variant has been
   *  entered. While false, every public method queues the latest
   *  desired variant id and re-attempts wiring on the next call. */
  private ready = false;
  private current: VariantHandle | null = null;
  private ctx: VariantContext | null = null;
  private settings: AppSettings;
  private readonly updateSettings: (p: Partial<AppSettings>) => void;

  constructor(opts: VariantControllerOptions) {
    this.settings = opts.settings;
    this.updateSettings = opts.updateSettings;
    this.tryInit();
  }

  /** Re-run the active variant's `enter()` — used when settings
   *  change in a way the variant cares about (paneGap, sidebarWidth). */
  refresh(settings: AppSettings): void {
    this.settings = settings;
    if (!this.ready) {
      // Still waiting for #tau-status-bar — try again now. The user
      // may have just dismissed a slow-rendering overlay or the
      // status bar's mount point may have finished initializing.
      this.tryInit();
      return;
    }
    if (this.ctx) {
      Object.assign(this.ctx as { settings: AppSettings }, { settings });
    }
    if (this.current && this.current.id !== settings.layoutVariant) {
      this.setVariant(settings.layoutVariant);
    } else if (this.current && this.ctx) {
      this.current.enter(this.ctx);
    }
  }

  /** Switch to a specific variant. Persists via updateSettings. */
  setVariant(id: VariantId): void {
    if (!this.ready || !this.ctx) {
      // Defer: persist the user's choice so the next refresh picks
      // it up, but skip the visual transition until we can actually
      // mount the variant.
      this.settings = { ...this.settings, layoutVariant: id };
      this.updateSettings({ layoutVariant: id });
      this.tryInit();
      return;
    }
    if (this.current?.id === id) return;
    this.current?.exit(this.ctx);
    const next = this.resolve(id);
    this.current = next;
    next.enter(this.ctx);
    this.updateSettings({ layoutVariant: id });
  }

  get activeId(): VariantId {
    return this.current?.id ?? this.settings.layoutVariant;
  }

  /** True iff the status bar has been found and a variant is mounted. */
  isReady(): boolean {
    return this.ready;
  }

  private tryInit(): void {
    if (this.ready) return;
    const body = document.body as HTMLBodyElement | null;
    const statusBar = document.getElementById(
      "tau-status-bar",
    ) as HTMLDivElement | null;
    if (!body || !statusBar) {
      // Not yet — stay inert. Don't spam: only warn the first time.
      if (!warnedOnce) {
        console.warn(
          "[τ-mux] variant controller deferred — #tau-status-bar not yet mounted; will retry on next applySettings.",
        );
        warnedOnce = true;
      }
      return;
    }
    this.ctx = { settings: this.settings, body, statusBar };
    const initial = this.resolve(this.settings.layoutVariant);
    this.current = initial;
    initial.enter(this.ctx);
    this.ready = true;
  }

  private resolve(id: VariantId): VariantHandle {
    return REGISTRY[id] ?? REGISTRY.bridge;
  }
}

let warnedOnce = false;
