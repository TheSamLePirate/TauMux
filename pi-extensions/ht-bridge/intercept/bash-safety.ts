/**
 * Bash safety gate — pi event glue. Pattern matching and the actual
 * decision logic live in `bash-safety-core.ts` (no pi-coding-agent
 * imports) so the unit tests can exercise them without resolving pi.
 *
 * Modes:
 *   - `confirmRisky`  — only matched commands are gated (default).
 *   - `confirmAll`    — every `bash` call asks for confirmation.
 *   - `off`           — module not registered (handled by index.ts).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";
import {
  DEFAULT_RISK_PATTERNS,
  decideBashBlock,
  type BashSafetyConfig,
} from "./bash-safety-core";

interface BashCallEvent {
  toolCallId?: string;
  input: { command?: string };
}

export {
  DEFAULT_RISK_PATTERNS,
  decideBashBlock,
  isRisky,
  type BashSafetyConfig,
} from "./bash-safety-core";

export function registerBashSafety(
  pi: ExtensionAPI,
  cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  if (cfg.bashSafetyMode === "off") return;
  const safety: BashSafetyConfig = {
    mode: cfg.bashSafetyMode,
    patterns: DEFAULT_RISK_PATTERNS,
    timeoutMs: cfg.bashSafetyTimeoutMs,
  };

  pi.on("tool_call", async (event: any) => {
    if (!isToolCallEventType("bash", event as BashCallEvent)) return;
    const cmd = String((event as BashCallEvent).input?.command ?? "");
    if (!cmd) return;
    const decision = await decideBashBlock(
      cmd,
      safety,
      ht,
      surface,
      surface.agentId,
    );
    if (decision) return decision;
    return undefined;
  });
}
