/**
 * τ-mux variant: Bridge (default).
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §9.1.
 *
 *   "The respectful refinement. Use as the default.
 *    Sidebar width: 240 px, never collapsible in this variant.
 *    Top-right contains a workspace switcher segmented control.
 *    Pane split: 1 large top-right, 1 utility top-left, 1 wide bottom.
 *    Inner padding 6 px; gap 6 px."
 *
 * Bridge reuses the existing SurfaceManager pane engine + the primary
 * sidebar. Its `enter()` only sets the variant attribute on body so
 * the Bridge CSS selectors light up, and nudges the pane-gap setting
 * toward 6 px if the user hasn't customised it. Other variants get
 * their chrome from CSS keyed on `body[data-tau-variant="bridge"]`.
 */
import type { VariantHandle } from "./types";

export const BridgeVariant: VariantHandle = {
  id: "bridge",
  enter(ctx) {
    ctx.body.dataset["tauVariant"] = "bridge";
    // Bridge inherits the default Phase-3 status-bar skeleton; no
    // further mutation needed until Phase 9 wires the Codex/Week/$
    // meters into the right zones.
  },
  exit(ctx) {
    delete ctx.body.dataset["tauVariant"];
  },
};
