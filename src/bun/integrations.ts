/**
 * Host-level integration wiring, exposed to the Settings panel.
 *
 * `ht claude install` and `ht shell-integration install` edit files the
 * app itself never touched: `~/.claude/settings.json` and the user's
 * shell rc. That made them CLI-only config — you could not see, let
 * alone change, either one from inside τ-mux. This module is the app's
 * entry point to exactly the same operations.
 *
 * It deliberately owns no logic of its own. Every plan / merge / strip
 * decision comes from the pure functions in `src/cli/claude-settings-edit.ts`
 * and `src/cli/shell-integration.ts`, which are the authority and are
 * fixture-tested in `tests/claude-install.test.ts` +
 * `tests/shell-integration.test.ts`. Two code paths writing the same file
 * with two ideas of what "installed" means is exactly the bug this
 * arrangement avoids — the CLI and the panel agree because they run the
 * same planner.
 *
 * Everything here returns a result object; nothing throws. A settings
 * file we cannot parse, a read-only home, a missing bridge — each is a
 * message the panel renders, not an exception that takes down the main
 * process.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_FEATURES,
  DEFAULT_BRIDGE_DIR,
  DEFAULT_SETTINGS_PATH,
  HOOK_SPECS,
  type Feature,
  computeStatus,
  planInstall,
  planUninstall,
  readSettingsFile,
  writeSettingsFile,
} from "../cli/claude-settings-edit";
import {
  detectShell,
  installInto,
  isInstalledIn,
  rcPathFor,
  uninstallFrom,
  type ShellKind,
} from "../cli/shell-integration";
import type {
  ClaudeBridgeFeature,
  ClaudeBridgeFeatureStatus,
  ClaudeBridgeStatus,
  IntegrationsStatus,
  ShellIntegrationStatus,
} from "../shared/integrations";

export interface IntegrationPaths {
  settingsPath?: string;
  bridgeDir?: string;
  /** Override the shell whose rc file we read / write. Defaults to
   *  `$SHELL`. Tests pass this explicitly. */
  shell?: ShellKind;
  /** Home directory for rc resolution. Tests point this at a tmpdir. */
  home?: string;
}

export interface IntegrationActionResult {
  ok: boolean;
  message: string;
}

/** Which bridge events belong to a feature. `statusline` owns no hook
 *  events — it is the `statusLine` key — so it reports through the
 *  status field instead and lands here as an empty list. */
export function featureEvents(feature: ClaudeBridgeFeature): string[] {
  return HOOK_SPECS.filter((h) => h.feature === feature).map(
    (h) => h.bridgeEvent,
  );
}

/**
 * Per-feature install state from the set of wired bridge events.
 *
 * Pure so the "some hooks wired, some not" case — an interrupted
 * install, or an upgrade that introduced new hook events into a feature
 * the user installed months ago — is unit-testable. That case is the
 * whole reason the UI distinguishes `partial` from `installed`: a
 * partial install looks fine in the old `ht claude doctor` summary but
 * silently drops half the events.
 */
export function deriveFeatureStatuses(
  wiredEvents: readonly string[],
  statusline: "ours" | "other" | "none",
): ClaudeBridgeFeatureStatus[] {
  const wired = new Set(wiredEvents);
  return ALL_FEATURES.map((feature) => {
    if (feature === "statusline") {
      return {
        feature,
        state: statusline === "ours" ? "installed" : "missing",
        wired: statusline === "ours" ? 1 : 0,
        total: 1,
      } satisfies ClaudeBridgeFeatureStatus;
    }
    const events = featureEvents(feature);
    const hit = events.filter((e) => wired.has(e)).length;
    return {
      feature,
      state:
        hit === 0 ? "missing" : hit === events.length ? "installed" : "partial",
      wired: hit,
      total: events.length,
    } satisfies ClaudeBridgeFeatureStatus;
  });
}

function resolvePaths(p: IntegrationPaths = {}): {
  settingsPath: string;
  bridgeDir: string;
} {
  return {
    settingsPath: p.settingsPath ?? DEFAULT_SETTINGS_PATH,
    bridgeDir: p.bridgeDir ?? DEFAULT_BRIDGE_DIR,
  };
}

function resolveRc(p: IntegrationPaths = {}): {
  shell: ShellKind;
  rcPath: string;
} {
  const shell = p.shell ?? detectShell();
  return { shell, rcPath: rcPathFor(shell, p.home) };
}

export function readClaudeBridgeStatus(
  p: IntegrationPaths = {},
): ClaudeBridgeStatus {
  const { settingsPath, bridgeDir } = resolvePaths(p);
  const { settings, error } = readSettingsFile(settingsPath);
  const st = computeStatus(settings, settingsPath, bridgeDir);
  return {
    settingsPath,
    settingsError: error ?? null,
    bridgeDir,
    bridgePresent: st.bridgePresent,
    features: deriveFeatureStatuses(st.wiredEvents, st.statusline),
    wiredEvents: st.wiredEvents,
    missingEvents: st.missingEvents,
    statusline: st.statusline,
  };
}

export function readShellIntegrationStatus(
  p: IntegrationPaths = {},
): ShellIntegrationStatus {
  const { shell, rcPath } = resolveRc(p);
  let contents = "";
  try {
    if (existsSync(rcPath)) contents = readFileSync(rcPath, "utf-8");
  } catch {
    /* unreadable rc — report "not installed" rather than failing the panel */
  }
  return { shell, rcPath, installed: isInstalledIn(contents) };
}

export function readIntegrationsStatus(
  p: IntegrationPaths = {},
): IntegrationsStatus {
  return {
    claude: readClaudeBridgeStatus(p),
    shell: readShellIntegrationStatus(p),
  };
}

/**
 * Merge the requested features into `~/.claude/settings.json`.
 *
 * Refuses in exactly the two cases `ht claude install` refuses: an
 * unparseable settings file (we never "fix" a user's JSON) and a missing
 * bridge checkout (the hook commands would point at nothing). Passing an
 * empty feature list is a no-op rather than an implicit "install
 * everything" — the panel sends what the user ticked, and "nothing
 * ticked" must not mean "all of it".
 */
export function installClaudeBridge(
  features: readonly ClaudeBridgeFeature[],
  p: IntegrationPaths = {},
): IntegrationActionResult {
  const { settingsPath, bridgeDir } = resolvePaths(p);
  if (features.length === 0) {
    return { ok: false, message: "Pick at least one feature to install." };
  }
  const { settings, error } = readSettingsFile(settingsPath);
  if (!settings) {
    return { ok: false, message: error ?? `cannot read ${settingsPath}` };
  }
  if (!existsSync(join(bridgeDir, "src", "index.ts"))) {
    return {
      ok: false,
      message: `Bridge not found at ${bridgeDir} — run claude-integration/install.sh from the τ-mux repo first.`,
    };
  }
  const plan = planInstall(settings, features as readonly Feature[], bridgeDir);
  if (plan.added.length === 0) {
    return { ok: true, message: "Already installed — nothing to change." };
  }
  try {
    writeSettingsFile(settingsPath, plan.next);
  } catch (err) {
    return {
      ok: false,
      message: `Could not write ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return {
    ok: true,
    message: `Wired ${plan.added.length} entr${plan.added.length === 1 ? "y" : "ies"}. Restart running Claude Code sessions to pick them up.`,
  };
}

/** Remove every managed entry. User hooks and a user-defined statusline
 *  are left byte-identical — `planUninstall` only drops what we wrote. */
export function uninstallClaudeBridge(
  p: IntegrationPaths = {},
): IntegrationActionResult {
  const { settingsPath } = resolvePaths(p);
  const { settings, error } = readSettingsFile(settingsPath);
  if (!settings) {
    return { ok: false, message: error ?? `cannot read ${settingsPath}` };
  }
  const plan = planUninstall(settings);
  if (plan.removed.length === 0) {
    return { ok: true, message: "Nothing managed to remove." };
  }
  try {
    writeSettingsFile(settingsPath, plan.next);
  } catch (err) {
    return {
      ok: false,
      message: `Could not write ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return {
    ok: true,
    message: `Removed ${plan.removed.length} managed entr${plan.removed.length === 1 ? "y" : "ies"} (backup kept beside the file).`,
  };
}

/**
 * Add / remove the OSC 133 block in the user's rc file.
 *
 * The "installed but not active" caveat matters enough to be in the
 * success message: the shells already running have not re-read their rc,
 * so `ht blocks` stays empty in every open pane until they do, and a
 * user who is not told that concludes the feature is broken.
 */
export function setShellIntegration(
  install: boolean,
  p: IntegrationPaths = {},
): IntegrationActionResult {
  const { rcPath } = resolveRc(p);
  try {
    if (install) {
      const r = installInto(rcPath);
      return {
        ok: true,
        message:
          r === "already"
            ? `Already installed in ${rcPath}.`
            : `Installed in ${rcPath}. Open a new pane (or run \`exec $SHELL -l\`) for it to take effect.`,
      };
    }
    const r = uninstallFrom(rcPath);
    return {
      ok: true,
      message:
        r === "absent"
          ? `Not present in ${rcPath}.`
          : `Removed from ${rcPath} (backup: ${rcPath}.tau-mux.bak).`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Could not edit ${rcPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
