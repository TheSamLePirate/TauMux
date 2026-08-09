/**
 * Wire types for the "Integrations" surface — the host-level wiring that
 * `ht` could configure but the app could not.
 *
 * Three things live here, and they have nothing in common except that
 * each one edits a file OUTSIDE `settings.json`:
 *
 *   - the Claude Code hook bridge  (`~/.claude/settings.json`)
 *   - shell integration / OSC 133  (`~/.zshrc` | `~/.bashrc`)
 *   - the extension registry's `enabled` flag
 *
 * Because they are external state rather than `AppSettings` fields, the
 * Settings panel cannot render them from the settings snapshot: it asks
 * bun for a status (`requestIntegrationsStatus`) and gets this shape back
 * on `integrationsStatus`. Keep this module free of node imports — the
 * webview bundle imports it.
 */

/** Install granularity for the Claude Code hook bridge. Mirrors
 *  `Feature` in `src/cli/claude-settings-edit.ts`, which is the
 *  authority; duplicated here so the webview doesn't import a module
 *  that reaches for `node:fs` at load time. */
export type ClaudeBridgeFeature =
  "lifecycle" | "tasks" | "approvals" | "statusline";

export const CLAUDE_BRIDGE_FEATURES: readonly ClaudeBridgeFeature[] = [
  "lifecycle",
  "tasks",
  "approvals",
  "statusline",
];

/** Per-feature wiring state. `partial` means some of the feature's hooks
 *  are present and some are not — the state an interrupted install or an
 *  upgrade that added new hook events leaves behind. */
export type IntegrationFeatureState = "installed" | "partial" | "missing";

export interface ClaudeBridgeFeatureStatus {
  feature: ClaudeBridgeFeature;
  state: IntegrationFeatureState;
  /** Wired / total hook events for this feature (statusline is 0/0 and
   *  reports through `state` alone). */
  wired: number;
  total: number;
}

export interface ClaudeBridgeStatus {
  /** Absolute path of the Claude Code settings file we manage. */
  settingsPath: string;
  /** Non-null when the file exists but could not be parsed. We refuse to
   *  rewrite a file we cannot read, so the UI must say so rather than
   *  offering an Install button that will fail. */
  settingsError: string | null;
  bridgeDir: string;
  /** `<bridgeDir>/src/index.ts` exists — without it an install writes
   *  hook commands that cannot run. */
  bridgePresent: boolean;
  features: ClaudeBridgeFeatureStatus[];
  wiredEvents: string[];
  missingEvents: string[];
  /** `ours` = `ht claude statusline`; `other` = the user has their own
   *  and we will not clobber it; `none` = unset. */
  /** `wrapped` = ours running the user's own command via `--exec`, so
   *  their line renders unchanged AND the data plane is live. */
  statusline: "ours" | "wrapped" | "other" | "none";
}

export interface ShellIntegrationStatus {
  shell: "zsh" | "bash";
  rcPath: string;
  /** The marker block is present in the rc file. Note this is about the
   *  FILE — a shell that has not re-read its rc since the install is not
   *  emitting marks yet. */
  installed: boolean;
}

export interface IntegrationsStatus {
  claude: ClaudeBridgeStatus;
  shell: ShellIntegrationStatus;
  /** Result banner for the most recent install / uninstall, so the panel
   *  can report what actually changed instead of silently re-rendering.
   *  Absent on a plain status refresh. */
  lastAction?: {
    kind:
      | "claude-install"
      | "claude-uninstall"
      | "shell-install"
      | "shell-uninstall";
    ok: boolean;
    message: string;
  };
}
