/**
 * τ-mux variant: Atlas — graph + ticker.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §9.3.
 *
 *   "Radical. Replace the list sidebar with a workspace graph and add
 *    a bottom activity ticker."
 *
 * Phase-6 scaffold: sets body[data-tau-variant="atlas"] so Atlas CSS
 * selectors engage. Phase 8 mounts the 220 px graph column (nodes +
 * dashed cyan edges) and the 32 px activity ticker that replaces the
 * normal status bar.
 */
import type { VariantHandle } from "./types";

export const AtlasVariant: VariantHandle = {
  id: "atlas",
  enter(ctx) {
    ctx.body.dataset["tauVariant"] = "atlas";
  },
  exit(ctx) {
    delete ctx.body.dataset["tauVariant"];
  },
};
