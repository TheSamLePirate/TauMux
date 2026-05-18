import type {
  SidebandContentMessage,
  SidebandMetaMessage,
} from "../shared/types";

export interface PanelDescriptor {
  id: string;
  /** Content type as sent by the script (e.g. "image", "svg", "html", "canvas2d", or a custom kind). */
  type: string;
  /** "inline" / "float" / "overlay" / "fixed", or undefined if unspecified. */
  position?: string;
  /** Width/height the script asked for (raw — "auto" or a number). */
  width?: number | "auto";
  height?: number | "auto";
  createdAt: number;
  updatedAt: number;
}

/** Default per-surface panel cap. A runaway script that emits a fresh
 *  panel id every tick can otherwise grow the registry without bound
 *  and leak memory across both the bun mirror and the webview. 256 is
 *  generous for legitimate dashboards (the design report renders ~80
 *  at peak) but kicks in well before the memory hit is visible. */
export const DEFAULT_MAX_PANELS_PER_SURFACE = 256;

/**
 * Bun-side mirror of the webview's per-surface active panel state. Kept by
 * tapping `onSidebandMeta`: every content message creates/updates a panel,
 * `clear` removes it. Exposed through the `panel.list` RPC so e2e tests and
 * external tools can observe sideband state without round-tripping through
 * the webview.
 *
 * Not a source of truth — the webview's PanelManager is — but the two are
 * driven by the same stream, so drift is bounded by "the sideband parser
 * is the arbiter of what's live."
 *
 * P9 — per-surface panel cap (default 256, override via constructor)
 * guards against runaway scripts that mint fresh panel ids forever.
 * When the cap is reached we evict the OLDEST entry (by createdAt)
 * before inserting the new one — same semantics as the webview's
 * PanelManager cap so the two mirrors drift the same way under load.
 */
export class PanelRegistry {
  private surfaces = new Map<string, Map<string, PanelDescriptor>>();
  private readonly maxPanelsPerSurface: number;

  constructor(maxPanelsPerSurface: number = DEFAULT_MAX_PANELS_PER_SURFACE) {
    this.maxPanelsPerSurface = Math.max(1, Math.floor(maxPanelsPerSurface));
  }

  handleMeta(surfaceId: string, msg: SidebandMetaMessage): void {
    if (msg.type === "flush") return;
    const content = msg as SidebandContentMessage;
    const now = Date.now();
    let panels = this.surfaces.get(surfaceId);
    if (content.type === "clear") {
      panels?.delete(content.id);
      return;
    }
    if (content.type === "update") {
      const existing = panels?.get(content.id);
      if (!existing) return;
      existing.updatedAt = now;
      if (content.position !== undefined) existing.position = content.position;
      if (content.width !== undefined) existing.width = content.width;
      if (content.height !== undefined) existing.height = content.height;
      return;
    }
    if (!panels) {
      panels = new Map();
      this.surfaces.set(surfaceId, panels);
    }
    // P9 cap — evict oldest before inserting if we'd otherwise exceed
    // the per-surface limit AND this id is genuinely new. Updates to
    // existing ids don't grow the map and skip the cap check entirely.
    if (!panels.has(content.id) && panels.size >= this.maxPanelsPerSurface) {
      let oldestId: string | null = null;
      let oldestAt = Infinity;
      for (const [id, p] of panels) {
        if (p.createdAt < oldestAt) {
          oldestAt = p.createdAt;
          oldestId = id;
        }
      }
      if (oldestId !== null) panels.delete(oldestId);
    }
    panels.set(content.id, {
      id: content.id,
      type: content.type,
      position: content.position,
      width: content.width,
      height: content.height,
      createdAt: now,
      updatedAt: now,
    });
  }

  clearSurface(surfaceId: string): void {
    this.surfaces.delete(surfaceId);
  }

  list(surfaceId: string): PanelDescriptor[] {
    const panels = this.surfaces.get(surfaceId);
    if (!panels) return [];
    return Array.from(panels.values());
  }
}
