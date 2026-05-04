/**
 * Activity log — surfaces pi's per-turn activity into τ-mux's
 * per-workspace log via `sidebar.log`. Useful for catching what
 * happened on a long agent run without reading the whole transcript.
 *
 *   tool_call         → info: "$ <bash command>" / "read <path>" / etc.
 *   tool_result(err)  → error: tool name + first line of the failure.
 *   turn_end          → info: "turn N done · <tools> tools".
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import { debugEnabled } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import { extractText, truncate } from "../lib/messages";
import type { SurfaceContext } from "../lib/surface-context";

const MSG_MAX = 240;

function describeToolCall(toolName: string, input: any): string {
  if (!input || typeof input !== "object") return toolName;
  switch (toolName) {
    case "bash":
      return `$ ${truncate(String(input.command ?? "").replace(/\s+/g, " "), MSG_MAX - 4)}`;
    case "read":
      return `read ${truncate(String(input.path ?? ""), MSG_MAX - 6)}`;
    case "write":
      return `write ${truncate(String(input.path ?? ""), MSG_MAX - 7)}`;
    case "edit":
      return `edit ${truncate(String(input.path ?? ""), MSG_MAX - 6)}`;
    default: {
      for (const key of ["query", "url", "name", "path", "command"]) {
        if (typeof input[key] === "string") {
          return `${toolName} ${truncate(input[key].replace(/\s+/g, " "), MSG_MAX - toolName.length - 1)}`;
        }
      }
      return toolName;
    }
  }
}

function firstLine(s: string): string {
  const idx = s.indexOf("\n");
  return idx < 0 ? s : s.slice(0, idx);
}

export function registerActivityLog(
  pi: ExtensionAPI,
  cfg: Config,
  ht: HtClient,
  ctx: SurfaceContext,
): void {
  let toolCount = 0;
  let turnStartMs = 0;

  const log = (level: "info" | "warn" | "error", message: string) => {
    ht.callSoft("sidebar.log", {
      level,
      message,
      source: cfg.activityLogSource,
      surface_id: ctx.surfaceId || undefined,
    });
  };

  pi.on("turn_start", () => {
    turnStartMs = Date.now();
    toolCount = 0;
  });

  pi.on("tool_call", (event: any) => {
    try {
      toolCount++;
      const tool = String(event?.toolName ?? "tool");
      log("info", truncate(describeToolCall(tool, event?.input), MSG_MAX));
    } catch (err) {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] activity-log tool_call failed: ${(err as Error).message}`,
        );
      }
    }
  });

  pi.on("tool_result", (event: any) => {
    try {
      if (!event?.isError) return;
      const tool = String(event?.toolName ?? "tool");
      const text = firstLine(extractText(event?.content) || "");
      log("error", truncate(`${tool}: ${text || "failed"}`, MSG_MAX));
    } catch (err) {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] activity-log tool_result failed: ${(err as Error).message}`,
        );
      }
    }
  });

  pi.on("turn_end", (event: any) => {
    try {
      const elapsedMs = turnStartMs > 0 ? Date.now() - turnStartMs : 0;
      turnStartMs = 0;
      const turnIndex =
        typeof event?.turnIndex === "number" ? event.turnIndex : 0;
      const sec = elapsedMs > 0 ? `${(elapsedMs / 1000).toFixed(1)}s` : "?s";
      log("info", `turn ${turnIndex + 1} done · ${toolCount} tools · ${sec}`);
    } catch (err) {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] activity-log turn_end failed: ${(err as Error).message}`,
        );
      }
    }
  });
}
