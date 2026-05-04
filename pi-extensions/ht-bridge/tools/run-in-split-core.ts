/**
 * Pure execution logic for the `ht_run_in_split` tool. Lives in its
 * own module (no pi-coding-agent / typebox imports) so the unit test
 * can exercise the full RPC sequence without resolving pi.
 */

import {
  DEFAULT_RISK_PATTERNS,
  decideBashBlock,
  type BashSafetyConfig,
} from "../intercept/bash-safety-core";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

export interface RunInSplitParams {
  command: string;
  direction?: "right" | "left" | "up" | "down";
  cwd?: string;
  shell?: string;
  ratio?: number;
  label?: string;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export async function executeRunInSplit(
  params: RunInSplitParams,
  cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): Promise<ToolResult> {
  if (!surface.surfaceId) {
    return {
      content: [
        {
          type: "text",
          text: "ht_run_in_split is unavailable: pi is not running inside a τ-mux pane (no $HT_SURFACE).",
        },
      ],
      isError: true,
    };
  }

  const command = String(params.command ?? "").trim();
  if (!command) {
    return {
      content: [{ type: "text", text: "ht_run_in_split: command is empty." }],
      isError: true,
    };
  }

  const safety: BashSafetyConfig = {
    mode: cfg.bashSafetyMode,
    patterns: DEFAULT_RISK_PATTERNS,
    timeoutMs: cfg.bashSafetyTimeoutMs,
  };
  const decision = await decideBashBlock(
    command,
    safety,
    ht,
    surface,
    surface.agentId,
  );
  if (decision) {
    return {
      content: [
        { type: "text", text: `ht_run_in_split blocked: ${decision.reason}` },
      ],
      isError: true,
    };
  }

  let newSurfaceId: string;
  try {
    const split = await ht.call<{ id?: string } | string>("surface.split", {
      surface_id: surface.surfaceId,
      direction: params.direction ?? "right",
      cwd: params.cwd,
      shell: params.shell,
      ratio: params.ratio,
    });
    newSurfaceId =
      typeof split === "string"
        ? split
        : typeof split?.id === "string"
          ? split.id
          : "";
    if (!newSurfaceId) {
      return {
        content: [
          {
            type: "text",
            text: "ht_run_in_split: surface.split returned no id.",
          },
        ],
        isError: true,
      };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ht_run_in_split: surface.split failed: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  // Wait up to 5s for the metadata poller to catch the new pane.
  // If it never lands we still try the send_text — worst case the
  // shell isn't fully up and the keystroke is lost (rare; the
  // shell prints its prompt almost immediately).
  await ht
    .call("surface.wait_ready", {
      surface_id: newSurfaceId,
      timeout_ms: 5000,
    })
    .catch(() => {
      /* best effort */
    });

  try {
    await ht.call("surface.send_text", {
      surface_id: newSurfaceId,
      text: `${command}\r`,
    });
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ht_run_in_split: spawned ${newSurfaceId} but failed to send command: ${(err as Error).message}`,
        },
      ],
      details: { surfaceId: newSurfaceId, command },
      isError: true,
    };
  }

  const labelPart = params.label ? ` (${params.label})` : "";
  return {
    content: [
      {
        type: "text",
        text: `Spawned ${newSurfaceId} ${params.direction ?? "right"} of ${surface.surfaceId}${labelPart}; running: ${command}`,
      },
    ],
    details: {
      surfaceId: newSurfaceId,
      command,
      direction: params.direction ?? "right",
      label: params.label ?? null,
    },
  };
}
