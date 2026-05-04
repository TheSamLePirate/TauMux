/**
 * System-prompt primer — injects a τ-mux orientation block at the
 * top of every `before_agent_start` so the LLM knows about the
 * registered ht_* tools, the current surface, and behavioural
 * nudges for when to use them.
 *
 * The chained `event.systemPrompt` already includes any earlier
 * extension's mutations, so we append rather than replace. Each
 * registered ht_* tool is enumerated dynamically — when a tool is
 * disabled in config, it doesn't appear in the primer.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import type { SurfaceContext } from "../lib/surface-context";

interface ToolDoc {
  name: string;
  hint: string;
}

function buildPrimer(cfg: Config, surface: SurfaceContext): string {
  const tools: ToolDoc[] = [];
  if (cfg.toolsEnabled && cfg.toolAskUserEnabled) {
    tools.push({
      name: "ht_ask_user",
      hint: "ask the human a structured question (yesno/choice/text) via a τ-mux modal — preferred over freeform 'should I…?' in your reply.",
    });
  }
  if (cfg.toolsEnabled && cfg.toolPlanEnabled) {
    tools.push({
      name: "ht_plan_set / ht_plan_update / ht_plan_complete",
      hint: "propose a multi-step plan for τ-mux's sidebar. ht_plan_set writes a detailed markdown plan to .pi/plans/<planName>.md, shows that file path to the user, and publishes sidebar steps only if they accept; they may decline or ask to discuss/revise it.",
    });
  }
  if (cfg.toolsEnabled && cfg.toolBrowserEnabled) {
    tools.push({
      name: "ht_browser_open / ht_browser_navigate / ht_browser_close",
      hint: "drive a τ-mux built-in browser pane to inspect docs or the running app under test.",
    });
  }
  if (cfg.toolsEnabled && cfg.toolNotifyEnabled) {
    tools.push({
      name: "ht_notify",
      hint: "fire a Mac notification (and Telegram forward when configured) at task milestones.",
    });
  }
  if (cfg.toolsEnabled && cfg.toolScreenshotEnabled) {
    tools.push({
      name: "ht_screenshot",
      hint: "screenshot a τ-mux pane to a PNG you can `read` next (macOS only).",
    });
  }
  if (cfg.toolsEnabled && cfg.toolRunInSplitEnabled) {
    tools.push({
      name: "ht_run_in_split",
      hint: "spawn a NEW terminal pane next to yours and run a command there — for long-running things the user should watch live (dev servers, log tails, watchers, builds). Use the `bash` tool when you need the output back; use ht_run_in_split when the user just needs to see it run.",
    });
  }

  // Surface-attribution line. Workspace lands lazily once
  // system.identify has resolved; cwd / fg are advisory.
  const surfaceLine = surface.surfaceId
    ? `Surface id: \`${surface.surfaceId}\`${
        surface.workspaceId ? ` (workspace \`${surface.workspaceId}\`)` : ""
      }`
    : "Surface id: (none — outside τ-mux)";
  const cwdLine = surface.cwd ? `Pane cwd: \`${surface.cwd}\`.` : "";

  const lines: string[] = [
    "",
    "# τ-mux integration",
    "",
    `You are running inside τ-mux (a hybrid terminal emulator). ${surfaceLine}.`,
  ];
  if (cwdLine) lines.push(cwdLine);

  if (!surface.surfaceId) {
    // Outside τ-mux there's no point bragging about ht_* tools — the
    // transport will fail. Skip the primer body entirely.
    return "";
  }

  if (tools.length > 0) {
    lines.push("", "Available τ-mux tools:");
    for (const t of tools) lines.push(`- \`${t.name}\` — ${t.hint}`);
  }

  if (cfg.bashSafetyMode !== "off") {
    lines.push(
      "",
      cfg.bashSafetyMode === "confirmAll"
        ? "Every `bash` call is gated by a τ-mux confirmation modal — keep commands short and atomic so the user can read them."
        : "Risky `bash` commands (rm -rf, sudo, mkfs, dd, force-push, etc.) are gated by a τ-mux confirmation modal. Don't try to evade the gate; if the user declines, work around it.",
    );
  }

  // Behaviour nudges — only mention a tool by name when that tool
  // is actually registered, so a user who's disabled e.g. ht_notify
  // doesn't see contradicting guidance.
  if (tools.length > 0) {
    lines.push("", "Use these tools sparingly:");
    if (cfg.toolsEnabled && cfg.toolNotifyEnabled)
      lines.push("- Don't ht_notify on every step — once or twice per task.");
    if (cfg.toolsEnabled && cfg.toolAskUserEnabled)
      lines.push(
        "- Don't ht_ask_user for trivial choices you can decide yourself.",
      );
    if (cfg.toolsEnabled && cfg.toolPlanEnabled)
      lines.push(
        "- Do propose a plan when the work has 3+ discrete steps. Include a full detailed markdown plan in ht_plan_set, derive concise sidebar steps from it, then respect the user's accept/decline/discuss response.",
      );
    if (cfg.toolsEnabled && cfg.toolRunInSplitEnabled)
      lines.push(
        "- Use ht_run_in_split (not the bash tool) when starting a long-running process the user should watch — dev servers, watchers, tails.",
      );
    lines.push("");
  }

  return lines.join("\n");
}

export function registerSystemPromptPrimer(
  pi: ExtensionAPI,
  cfg: Config,
  surface: SurfaceContext,
): void {
  pi.on("before_agent_start", (event: any, _ctx: ExtensionContext) => {
    const block = buildPrimer(cfg, surface);
    if (!block) return;
    const current =
      typeof event?.systemPrompt === "string" ? event.systemPrompt : "";
    return { systemPrompt: current + block };
  });
}

// Exported for unit tests so we can pin the primer text without
// constructing a fake pi runtime.
export { buildPrimer };
