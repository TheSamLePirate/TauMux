/**
 * Variant layout shortcuts (§10) — the bodies behind ⌘\ and ⌘G.
 *
 * Kept out of `views/terminal/index.ts` (module-size ratchet: that file
 * holds wiring, not behaviour). Each function is total and safe to call
 * under any variant, so the bindings stay one line.
 */
import type { VariantId } from "./types";
import { toggleAtlasTopology } from "./atlas";
import { afterTransition } from "../after-transition";

export interface LayoutShortcutDeps {
  variant: () => VariantId;
  /** Bridge's fallback — §9.1 calls its sidebar "never collapsible", so
   *  ⌘\ there falls through to the ordinary sidebar toggle rather than
   *  doing nothing. */
  toggleSidebar: () => void;
  /** Run after the column's width transition settles, so xterm reflows
   *  against the width it actually ended up with. */
  afterColumnResize: () => void;
}

/** ⌘\ — collapse the sidebar / icon rail / Atlas column. */
export function toggleRail(deps: LayoutShortcutDeps): void {
  if (deps.variant() === "bridge") {
    deps.toggleSidebar();
    return;
  }
  document.body.classList.toggle("tau-rail-collapsed");
  deps.afterColumnResize();
}

/**
 * ⌘G — the full-window topology overlay.
 *
 * Falls back to hiding the Atlas column only if the panel has not
 * mounted yet (a settings change mid-boot); once Atlas is live, the
 * overlay is what this key is for.
 */
export function toggleTopology(deps: LayoutShortcutDeps): void {
  if (toggleAtlasTopology()) return;
  document.body.classList.toggle("tau-atlas-graph-hidden");
  deps.afterColumnResize();
}

/**
 * Build the dependency bundle for the two shortcuts. Takes the pieces
 * the host owns and supplies the transition-settling behaviour itself,
 * so the call site stays a single expression.
 */
export function makeLayoutShortcutDeps(host: {
  variant: () => VariantId;
  toggleSidebar: () => void;
  resizeAll: () => void;
  columnEl: HTMLElement;
}): LayoutShortcutDeps {
  return {
    variant: host.variant,
    toggleSidebar: host.toggleSidebar,
    afterColumnResize: () =>
      afterTransition(host.columnEl, "left", 240, host.resizeAll),
  };
}
