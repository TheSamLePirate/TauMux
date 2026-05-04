/**
 * Show a "Compacting…" pill while pi rolls a session into a summary,
 * clear it once the compact lands. Distinct status key so it never
 * fights with the active-label pill.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";

const COMPACT_KEY = "pi_compact";
const COMPACT_ICON = "spinner";
const COMPACT_COLOR = "#f9e2af"; // Catppuccin yellow

export function registerCompactionStatus(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
): void {
  pi.on("session_before_compact", () => {
    ht.callSoft("sidebar.set_status", {
      key: COMPACT_KEY,
      value: "Compacting…",
      icon: COMPACT_ICON,
      color: COMPACT_COLOR,
    });
    // Don't return anything — extension didn't cancel/customize.
  });

  pi.on("session_compact", () => {
    ht.callSoft("sidebar.clear_status", { key: COMPACT_KEY });
  });

  pi.on("session_shutdown", () => {
    ht.callSoft("sidebar.clear_status", { key: COMPACT_KEY });
  });
}
