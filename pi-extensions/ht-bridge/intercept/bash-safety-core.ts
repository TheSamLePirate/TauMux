/**
 * Pure logic for the bash-safety gate, with no pi-coding-agent
 * imports so the unit tests can exercise it without resolving pi
 * out of the repo's node_modules. The pi event-handler glue lives
 * in `bash-safety.ts` next door and re-exports these names.
 */

import { debugEnabled } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

export const DEFAULT_RISK_PATTERNS: RegExp[] = [
  /\brm\s+-[rR]?[fF]+[a-zA-Z]*\b/,
  /\brm\s+-[fF]+[rR][a-zA-Z]*\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\b[^|;]*\bof=/,
  />\s*\/dev\/(?:sd|disk|nvme|hd)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\bgit\s+push\s+(?:--force\b|-[a-zA-Z]*f[a-zA-Z]*\b)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*[fdx][a-zA-Z]*\b/,
  /\bchmod\s+(?:-R\s+)?(?:777|0?777)\b/,
];

export interface BashSafetyConfig {
  mode: "off" | "confirmRisky" | "confirmAll";
  patterns?: RegExp[];
  timeoutMs?: number;
}

export function isRisky(
  command: string,
  patterns: RegExp[] = DEFAULT_RISK_PATTERNS,
): boolean {
  if (!command) return false;
  return patterns.some((re) => re.test(command));
}

/** Returns the block decision for a bash command, or undefined when
 *  the command should be allowed through.
 *
 *  Fail-open is intentional: τ-mux unreachable, ask-user errored, or
 *  pi running outside a τ-mux pane all skip the gate. Blocking pi's
 *  tool loop on a τ-mux outage would be worse than the safety
 *  regression. */
export async function decideBashBlock(
  cmd: string,
  cfg: BashSafetyConfig,
  ht: HtClient,
  surface: SurfaceContext,
  agentId: string,
): Promise<{ block: true; reason: string } | undefined> {
  if (cfg.mode === "off") return undefined;
  if (cfg.mode === "confirmRisky" && !isRisky(cmd, cfg.patterns))
    return undefined;

  if (!surface.surfaceId) return undefined;

  try {
    const resp = await ht.call<{ action: string; value?: string }>(
      "agent.ask_user",
      {
        surface_id: surface.surfaceId,
        agent_id: agentId,
        kind: "confirm-command",
        title: "Pi wants to run a command",
        body: cmd,
        timeout_ms: cfg.timeoutMs ?? 60_000,
      },
      { timeoutMs: 0 },
    );

    if (resp.action === "ok" && resp.value === "run") return undefined;

    const why =
      resp.action === "timeout"
        ? "User did not confirm in time."
        : resp.action === "cancel"
          ? "User cancelled the run."
          : "User declined the run.";
    return { block: true, reason: why };
  } catch (err) {
    if (debugEnabled()) {
      console.error(
        `[ht-bridge] bash-safety ask_user failed: ${(err as Error).message}`,
      );
    }
    return undefined;
  }
}
