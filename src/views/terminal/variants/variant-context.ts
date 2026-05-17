// P7 S9 — A7 typed VariantContext.
//
// Atlas and Cockpit variants used to reach back into `window` for a
// handful of cross-cutting handles:
//
//   __tauSurfaceManager     — SurfaceManager instance the host owns
//   __tauFocusedSurfaceId   — id of the currently-focused surface
//   __tauNotifyWorkspaces   — set of workspace ids with pending notifs
//
// Each variant file did its own `(window as unknown as { __tau… })`
// cast at every read; each producer (index.ts) did the symmetric
// assignment. The result: implicit globals with no compile-time
// guarantee that producer + consumer agree on the shape.
//
// This module collapses the three globals into a single typed
// `VariantContext` singleton with `get*` / `set*` accessors and a
// `VariantHostShape` interface that documents what the host provides.
// The variants stop casting through `unknown`; the host stops touching
// `window` for these.
//
// Back-compat: we still write the same `window.__tau*` properties as
// a courtesy for any straggling reader (legacy tests, dev-only
// instrumentation, the design-review harness). Future sessions can
// drop the shim once those readers migrate.

// We deliberately keep the surface manager typed via a structural
// "*-like" interface so this module doesn't depend on the concrete
// SurfaceManager (which would create an import cycle). The variants
// only call the methods listed here.
export interface VariantSurfaceManagerLike {
  getWorkspaceState?: () => unknown;
  getProcessManagerData?: () => unknown;
  focusWorkspaceByIndex?: (index: number) => void;
  focusSurface?: (surfaceId: string) => void;
}

/** Singleton accessor for the variant cross-cutting handles. The host
 *  calls the `set*` methods at boot / on workspace change; variants
 *  call the `get*` methods on every render. Internal class name is
 *  `VariantContextStore` to avoid collision with the existing
 *  `VariantContext` lifecycle interface in `./types`; consumers only
 *  reach this via the `variantContext` singleton. */
class VariantContextStore {
  private surfaceManager: VariantSurfaceManagerLike | null = null;
  private focusedSurfaceId: string | null = null;
  private notifyWorkspaces: Set<string> = new Set();

  setSurfaceManager(sm: VariantSurfaceManagerLike | null): void {
    this.surfaceManager = sm;
    // Legacy shim — drop in a future session once the design-review
    // harness no longer reads window.__tauSurfaceManager directly.
    (window as unknown as Record<string, unknown>)["__tauSurfaceManager"] =
      sm ?? undefined;
  }

  getSurfaceManager(): VariantSurfaceManagerLike | null {
    return this.surfaceManager;
  }

  setFocusedSurfaceId(id: string | null): void {
    this.focusedSurfaceId = id;
    (window as unknown as Record<string, unknown>)["__tauFocusedSurfaceId"] =
      id ?? undefined;
  }

  getFocusedSurfaceId(): string | null {
    return this.focusedSurfaceId;
  }

  setNotifyWorkspaces(set: ReadonlySet<string>): void {
    this.notifyWorkspaces = new Set(set);
    (window as unknown as Record<string, unknown>)["__tauNotifyWorkspaces"] =
      this.notifyWorkspaces;
  }

  getNotifyWorkspaces(): ReadonlySet<string> {
    return this.notifyWorkspaces;
  }

  /** For tests / shutdown: drop every cached handle. */
  reset(): void {
    this.setSurfaceManager(null);
    this.setFocusedSurfaceId(null);
    this.setNotifyWorkspaces(new Set());
  }
}

/** Singleton instance used by the host (index.ts) and the variants
 *  (atlas.ts, cockpit.ts). Importers do not construct their own; this
 *  is the shared state. */
export const variantContext = new VariantContextStore();
