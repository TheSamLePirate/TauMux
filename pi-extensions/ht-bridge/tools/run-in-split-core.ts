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

interface SurfaceListEntry {
  id?: string;
}

function extractSurfaceId(
  split: { id?: string } | string | null | undefined,
): string {
  if (typeof split !== "string") {
    return typeof split?.id === "string" ? split.id : "";
  }
  return split.startsWith("surface:") ? split : "";
}

async function listSurfaceIds(ht: HtClient): Promise<Set<string>> {
  const list = await ht.call<SurfaceListEntry[]>("surface.list");
  return new Set(
    (Array.isArray(list) ? list : [])
      .map((entry) => entry?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

async function waitForNewSurfaceId(
  ht: HtClient,
  before: Set<string>,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastUnknown = "";
  while (Date.now() < deadline) {
    const current = await listSurfaceIds(ht);
    const created = [...current].filter((id) => !before.has(id));
    if (created.length > 0) return created.at(-1) ?? created[0] ?? "";
    lastUnknown = [...current].at(-1) ?? lastUnknown;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return lastUnknown && !before.has(lastUnknown) ? lastUnknown : "";
}

async function waitForSurfaceReady(
  ht: HtClient,
  surfaceId: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const result = await ht
    .call("surface.wait_ready", {
      surface_id: surfaceId,
      timeout_ms: timeoutMs,
    })
    .catch(() => null);
  return Boolean(result);
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
    // Older τ-mux builds return just "OK" from surface.split, before the
    // webview has mounted the newly-created pane. Snapshot first, then poll
    // surface.list so command injection targets the actual new surface rather
    // than racing the split action.
    const before = await listSurfaceIds(ht).catch(() => new Set<string>());
    const split = await ht.call<{ id?: string } | string>("surface.split", {
      surface_id: surface.surfaceId,
      direction: params.direction ?? "right",
      cwd: params.cwd,
      shell: params.shell,
      ratio: params.ratio,
    });
    newSurfaceId = extractSurfaceId(split);
    if (!newSurfaceId && typeof split === "string") {
      newSurfaceId = await waitForNewSurfaceId(ht, before, 5000);
    }
    if (!newSurfaceId) {
      return {
        content: [
          {
            type: "text",
            text:
              typeof split === "string"
                ? "ht_run_in_split: split was requested but the new pane did not appear within 5s."
                : "ht_run_in_split: surface.split returned no id.",
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

  // Synchronize with τ-mux before typing. This avoids losing the command
  // when split creation wins the RPC round-trip but the pane/session is not
  // observable yet.
  const ready = await waitForSurfaceReady(ht, newSurfaceId, 8000);
  if (!ready) {
    return {
      content: [
        {
          type: "text",
          text: `ht_run_in_split: spawned ${newSurfaceId} but it was not ready within 8s; command was not sent.`,
        },
      ],
      details: { surfaceId: newSurfaceId, command },
      isError: true,
    };
  }

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
