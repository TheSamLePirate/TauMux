/**
 * Webview-side plumbing for the integration surfaces.
 *
 * Two small things that would otherwise be inline in `index.ts`:
 *
 *   - `createIntegrationsActions` — the Settings → Integrations bridge.
 *     Every action is a one-way message; bun replies by pushing a fresh
 *     `integrationsStatus`, so nothing here tracks state.
 *   - `setAutoApprove` / `autoApproveCommand` — the single place that
 *     writes `claudeAutoApprove`. The sidebar pill, the command palette
 *     and Settings all route through it, which is what keeps them (and
 *     `ht claude auto-approve`) from drifting into disagreement.
 */

import { htEvents } from "../../shared/event-bus";
import { DEFAULT_SETTINGS, mergeSettings } from "../../shared/settings";
import type { AppSettings } from "../../shared/settings";
import type { ClaudeBridgeFeature } from "../../shared/integrations";
import type { IntegrationsActions } from "./settings-integrations";

export interface IntegrationsControlContext {
  /** Send a message to bun (the Electrobun `rpc.send` bridge). */
  send: (message: string, payload?: unknown) => void;
  /** Live settings, or null before the first `restoreSettings`. */
  getSettings: () => AppSettings | null;
  /** Apply a full settings object locally (the same function the
   *  settings echo uses), so the UI updates before bun answers. */
  apply: (settings: AppSettings) => void;
}

export interface IntegrationsControl {
  /** Bridge handed to the Settings panel. */
  actions: IntegrationsActions;
  /** Command-palette entry, rebuilt on every palette sync so its label
   *  matches the live state. */
  paletteCommand: () => ReturnType<typeof autoApproveCommand>;
}

/**
 * Wire every auto-approve / integration entry point at once, including
 * the sidebar pill subscription. One call site means the palette, the
 * pill and Settings cannot be wired to different pipelines.
 */
export function createIntegrationsControl(
  ctx: IntegrationsControlContext,
): IntegrationsControl {
  htEvents.on("ht-set-auto-approve", ({ enabled }) =>
    setAutoApprove(ctx, enabled),
  );
  return {
    actions: createIntegrationsActions(ctx),
    paletteCommand: () => autoApproveCommand(ctx),
  };
}

export function createIntegrationsActions(
  ctx: IntegrationsControlContext,
): IntegrationsActions {
  return {
    refresh: () => ctx.send("requestIntegrationsStatus", {}),
    installClaude: (features: ClaudeBridgeFeature[]) =>
      ctx.send("claudeIntegrationInstall", { features }),
    uninstallClaude: () => ctx.send("claudeIntegrationUninstall", {}),
    setShellIntegration: (install: boolean) =>
      ctx.send("shellIntegrationSet", { install }),
    setExtensionEnabled: (id: string, enabled: boolean) =>
      ctx.send("extensionSetEnabled", { id, enabled }),
  };
}

/** Write `claudeAutoApprove`, locally first then through to bun. */
export function setAutoApprove(
  ctx: IntegrationsControlContext,
  enabled: boolean,
): void {
  const base = ctx.getSettings() ?? DEFAULT_SETTINGS;
  if (base.claudeAutoApprove === enabled) return;
  ctx.apply(mergeSettings(base, { claudeAutoApprove: enabled }));
  ctx.send("updateSettings", { settings: { claudeAutoApprove: enabled } });
}

/** Command-palette entry, label reflecting the current state. */
export function autoApproveCommand(ctx: IntegrationsControlContext): {
  id: string;
  category: string;
  label: string;
  description: string;
  action: () => void;
} {
  const on = ctx.getSettings()?.claudeAutoApprove ?? false;
  return {
    id: "claude-toggle-auto-approve",
    category: "Claude Code",
    label: on
      ? "Disable Claude Code auto-approve"
      : "Enable Claude Code auto-approve",
    description: on
      ? "Stop auto-accepting permission prompts in terminal panes."
      : "Automatically press Enter on permission prompts Claude Code shows in terminal panes.",
    action: () => setAutoApprove(ctx, !on),
  };
}
