import {
  installClaudeBridge,
  readIntegrationsStatus,
  setShellIntegration,
  uninstallClaudeBridge,
} from "../integrations";
import {
  CLAUDE_BRIDGE_FEATURES,
  type ClaudeBridgeFeature,
  type IntegrationsStatus,
} from "../../shared/integrations";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "requestIntegrationsStatus"
  | "claudeIntegrationInstall"
  | "claudeIntegrationUninstall"
  | "shellIntegrationSet";

/**
 * Settings → Integrations: the Claude Code hook bridge + the OSC 133
 * shell integration, previously reachable only through `ht claude
 * install` / `ht shell-integration install`.
 *
 * These handlers are a thin shell over `src/bun/integrations.ts`, which
 * is itself a shell over the same pure planners the CLI uses. Nothing
 * here decides anything; it maps a message to a call and pushes the
 * resulting status back so the panel re-renders from freshly-read disk
 * state rather than from an optimistic guess. That matters because the
 * install can legitimately do less than asked (a user-defined statusline
 * is never clobbered) — the panel must show what happened, not what was
 * requested.
 */
export function registerIntegrationsWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    requestIntegrationsStatus: () => {
      pushStatus(ctx);
    },
    claudeIntegrationInstall: (payload) => {
      const features = sanitizeFeatures(payload.features);
      const result = installClaudeBridge(features);
      pushStatus(ctx, {
        kind: "claude-install",
        ok: result.ok,
        message: result.message,
      });
      ctx.sendWebviewAction("showToast", {
        message: result.message,
        level: result.ok ? "success" : "error",
      });
    },
    claudeIntegrationUninstall: () => {
      const result = uninstallClaudeBridge();
      pushStatus(ctx, {
        kind: "claude-uninstall",
        ok: result.ok,
        message: result.message,
      });
      ctx.sendWebviewAction("showToast", {
        message: result.message,
        level: result.ok ? "success" : "error",
      });
    },
    shellIntegrationSet: (payload) => {
      const result = setShellIntegration(payload.install === true);
      pushStatus(ctx, {
        kind: payload.install ? "shell-install" : "shell-uninstall",
        ok: result.ok,
        message: result.message,
      });
      ctx.sendWebviewAction("showToast", {
        message: result.message,
        level: result.ok ? "success" : "error",
      });
    },
  };
}

/** Drop anything that isn't a known feature id. The list arrives from
 *  the webview as `string[]`; an unknown value would otherwise reach
 *  `planInstall` and silently install nothing for that entry. */
export function sanitizeFeatures(
  raw: readonly string[],
): ClaudeBridgeFeature[] {
  const known = new Set<string>(CLAUDE_BRIDGE_FEATURES);
  return raw.filter((f): f is ClaudeBridgeFeature => known.has(f));
}

function pushStatus(
  ctx: WebviewHandlerContext,
  lastAction?: IntegrationsStatus["lastAction"],
): void {
  try {
    const status = readIntegrationsStatus();
    ctx.rpc.send("integrationsStatus", {
      ...status,
      ...(lastAction ? { lastAction } : {}),
    });
  } catch (err) {
    // Reading a status must never take the process down; the panel
    // keeps whatever it last rendered and the log carries the reason.
    console.error("[integrations] status read failed:", err);
  }
}
