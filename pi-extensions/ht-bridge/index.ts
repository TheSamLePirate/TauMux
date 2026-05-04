/**
 * ht-bridge — pi ↔ τ-mux integration extension.
 *
 * Phase 1 — active-label + cost-ticker pills.
 * Phase 2 — Unix-socket JSON-RPC client + tool-execution badge,
 *           plan-shaped-JSON mirror, per-turn activity log.
 * Phase 3 — bash-safety interception, custom LLM-callable tools
 *           (`ht_ask_user`, approval-gated `ht_plan_*`, `ht_browser_*`,
 *           `ht_notify`, `ht_screenshot`, `ht_run_in_split`), and
 *           a system-prompt primer.
 * Phase 4 — `/ht-plan` / `/ht-ask` slash commands, "Compacting…"
 *           pill on session_before_compact, plan replay on
 *           session_start{reason:"resume"|"fork"}.
 *
 * Outside τ-mux (no `HT_SURFACE` / `HYPERTERM_PROTOCOL_VERSION`) the
 * extension short-circuits after registering the red footer
 * indicator — every observer/tool/intercept depends on a τ-mux
 * socket and would otherwise spew noise.
 *
 * Configuration:
 *   - `config.json` next to this file
 *   - Env overrides (PI_HT_NOTIFY_*, PI_HT_BRIDGE_*) — see `lib/config.ts`
 *   - Debug: `PI_HT_NOTIFY_DEBUG=1`
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAskCommand } from "./commands/ask-cmd";
import { registerPlanCommand } from "./commands/plan-cmd";
import { registerBashSafety } from "./intercept/bash-safety";
import { loadConfig } from "./lib/config";
import { createHtClient } from "./lib/ht-client";
import { enrichContext, readSurfaceContext } from "./lib/surface-context";
import { registerCompactionStatus } from "./lifecycle/compaction";
import { registerResumeRestoration } from "./lifecycle/resume";
import { registerActiveLabel } from "./observe/active-label";
import { registerActivityLog } from "./observe/activity-log";
import { registerCostTicker } from "./observe/cost-ticker";
import { registerPlanMirror } from "./observe/plan-mirror";
import { registerToolBadge } from "./observe/tool-badge";
import { registerTuiHeartbeat } from "./observe/tui-heartbeat";
import { registerTuiStatus } from "./observe/tui-status";
import { registerSystemPromptPrimer } from "./system-prompt/primer";
import { registerAskUserTool } from "./tools/ask-user";
import { registerBrowserTools } from "./tools/browser";
import { registerNotifyTool } from "./tools/notify";
import { registerPlanTools } from "./tools/plan";
import { registerRunInSplitTool } from "./tools/run-in-split";
import { registerScreenshotTool } from "./tools/screenshot";

export default function (pi: ExtensionAPI) {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const surface = readSurfaceContext();

  // Footer pill — green inside τ-mux, red outside. Always
  // registered first so the user sees ht-bridge's load state even
  // if every other capability is gated off.
  const statusHandle = cfg.tuiStatusEnabled
    ? registerTuiStatus(pi, surface)
    : null;

  // Outside τ-mux there's no socket to talk to. Skip every
  // observer / intercept / tool — they'd all log transport
  // failures and pollute pi's footer for no benefit.
  if (!surface.inTauMux) return;

  const ht = createHtClient(cfg);

  // Resolve the workspace + cwd asynchronously via system.identify;
  // sub-modules see workspaceId / cwd populate as soon as it lands,
  // and the τ-mux footer pill upgrades from "τ-mux surface:7" to
  // "τ-mux ws:2 surface:7" via the refresh handle.
  enrichContext(surface, ht)
    .then(() => statusHandle?.refresh())
    .catch(() => {
      /* swallowed — debug logged inside enrichContext */
    });

  // Observation
  registerActiveLabel(pi, cfg, ht);
  if (cfg.tickerEnabled) registerCostTicker(pi, cfg, ht);
  if (cfg.toolBadgeEnabled) registerToolBadge(pi, cfg, ht);
  if (cfg.planMirrorEnabled) registerPlanMirror(pi, cfg, ht, surface);
  if (cfg.activityLogEnabled) registerActivityLog(pi, cfg, ht, surface);
  if (cfg.tuiHeartbeatEnabled) registerTuiHeartbeat(pi, cfg);

  // Interception
  registerBashSafety(pi, cfg, ht, surface);

  // Custom LLM-callable tools
  if (cfg.toolsEnabled) {
    if (cfg.toolAskUserEnabled) registerAskUserTool(pi, cfg, ht, surface);
    if (cfg.toolPlanEnabled) registerPlanTools(pi, cfg, ht, surface);
    if (cfg.toolBrowserEnabled) registerBrowserTools(pi, cfg, ht);
    if (cfg.toolNotifyEnabled) registerNotifyTool(pi, cfg, ht, surface);
    if (cfg.toolScreenshotEnabled) registerScreenshotTool(pi, cfg, ht, surface);
    if (cfg.toolRunInSplitEnabled) registerRunInSplitTool(pi, cfg, ht, surface);
  }

  // System-prompt primer (chains into before_agent_start)
  if (cfg.systemPromptPrimerEnabled)
    registerSystemPromptPrimer(pi, cfg, surface);

  // Slash commands (/ht-plan, /ht-ask)
  if (cfg.commandsEnabled) {
    registerPlanCommand(pi, cfg, ht, surface);
    registerAskCommand(pi, cfg, ht, surface);
  }

  // Lifecycle integrations
  if (cfg.lifecycleCompactionEnabled) registerCompactionStatus(pi, cfg, ht);
  if (cfg.lifecycleResumeEnabled)
    registerResumeRestoration(pi, cfg, ht, surface);
}
