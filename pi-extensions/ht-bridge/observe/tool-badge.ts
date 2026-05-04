/**
 * Tool-execution badge — shows the live tool pi's currently running
 * (or the count of tools running in parallel mode) as a sidebar pill.
 *
 *   tool_execution_start → "pi_tool : bash {cmd preview}"
 *   tool_execution_end   → clear (or roll back to the previous tool
 *                          if more are still running)
 *   session_shutdown     → safety-net clear.
 *
 * Pi runs tool calls concurrently in parallel mode, so we maintain a
 * Map<toolCallId, label> and render the most-recent one. When no tool
 * is running, the badge is cleared.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import { truncate } from "../lib/messages";

const ARG_PREVIEW_MAX = 36;

/** Build a short "tool args" preview without any newlines. */
function previewArgs(toolName: string, args: any): string {
  if (!args || typeof args !== "object") return "";
  switch (toolName) {
    case "bash":
      return truncate(
        String(args.command ?? "").replace(/\s+/g, " "),
        ARG_PREVIEW_MAX,
      );
    case "read":
    case "write":
    case "edit":
      return truncate(String(args.path ?? ""), ARG_PREVIEW_MAX);
    default: {
      // Pull whichever scalar field looks most useful.
      for (const key of ["query", "url", "name", "path", "command"]) {
        if (typeof args[key] === "string") {
          return truncate(args[key].replace(/\s+/g, " "), ARG_PREVIEW_MAX);
        }
      }
      return "";
    }
  }
}

export function registerToolBadge(
  pi: ExtensionAPI,
  cfg: Config,
  ht: HtClient,
): void {
  // Insertion-ordered Map so "the most recent tool" is the last entry.
  const live = new Map<string, string>();

  const setBadge = (label: string) => {
    ht.callSoft("sidebar.set_status", {
      key: cfg.toolBadgeStatusKey,
      value: label,
      icon: cfg.toolBadgeStatusIcon,
      color: cfg.toolBadgeStatusColor,
    });
  };
  const clearBadge = () => {
    ht.callSoft("sidebar.clear_status", { key: cfg.toolBadgeStatusKey });
  };

  const refresh = () => {
    if (live.size === 0) {
      clearBadge();
      return;
    }
    const entries = [...live.values()];
    const newest = entries[entries.length - 1] ?? "";
    const label = live.size > 1 ? `${newest} (+${live.size - 1} more)` : newest;
    setBadge(label);
  };

  pi.on("tool_execution_start", (event: any) => {
    const id = String(event?.toolCallId ?? "");
    if (!id) return;
    const tool = String(event?.toolName ?? "tool");
    const preview = previewArgs(tool, event?.args);
    const label = preview ? `${tool} ${preview}` : tool;
    live.set(id, label);
    refresh();
  });

  pi.on("tool_execution_end", (event: any) => {
    const id = String(event?.toolCallId ?? "");
    if (!id) return;
    live.delete(id);
    refresh();
  });

  pi.on("session_shutdown", () => {
    live.clear();
    clearBadge();
  });
}
