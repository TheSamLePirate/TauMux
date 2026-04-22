/**
 * τ-mux variant: Cockpit — icon rail + HUD.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §9.2.
 *
 *   "Denser. Sidebar becomes a 52 px icon rail. Every pane gets a 22 px
 *    HUD strip between header and body showing
 *    KIND · model · state · tok/s · $ · Δ.
 *    Up to 4 panes (2×2 or 2+2)."
 *
 * Phase-6 scaffold: enter() sets the variant attribute so Cockpit-
 * specific CSS lights up. Phase 7 will mount the per-pane HUD strip
 * and the 52 px rail chrome. Until then the variant degrades to the
 * default shell with a distinct body attribute so it's visible in
 * DevTools that the switcher is wiring correctly.
 */
import type { VariantHandle } from "./types";

export const CockpitVariant: VariantHandle = {
  id: "cockpit",
  enter(ctx) {
    ctx.body.dataset["tauVariant"] = "cockpit";
  },
  exit(ctx) {
    delete ctx.body.dataset["tauVariant"];
  },
};
