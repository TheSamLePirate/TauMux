/**
 * `ht claude install|uninstall|status` — safe surgery on
 * ~/.claude/settings.json (august-plan M2 / WS7).
 *
 * Design rules (plan §4.6):
 *   - additive merge — never touch keys we don't own;
 *   - our entries are identified by their command string (contains
 *     "/ht-bridge/" or ends with "claude statusline") — no side files;
 *   - timestamped backup beside the file before every write;
 *   - refuse on parse failure (never "fix" a user's settings);
 *   - idempotent — installing twice changes nothing the second time.
 *
 * Everything except the fs shell is pure and fixture-tested in
 * tests/claude-install.test.ts.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Shapes (structural — we only model what we touch)
// ---------------------------------------------------------------------------

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
  [k: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookCommand[];
  [k: string]: unknown;
}

export type ClaudeSettings = Record<string, unknown> & {
  hooks?: Record<string, HookGroup[]>;
  statusLine?: { type?: string; command?: string; [k: string]: unknown };
};

/** Bridge event → Claude Code hook event (+ matcher / per-hook timeout). */
export interface HookSpec {
  bridgeEvent: string;
  ccEvent: string;
  matcher?: string;
  timeout?: number;
  /** Feature bucket for install granularity. */
  feature: "lifecycle" | "tasks" | "approvals";
}

export const HOOK_SPECS: readonly HookSpec[] = [
  { bridgeEvent: "prompt", ccEvent: "UserPromptSubmit", feature: "lifecycle" },
  { bridgeEvent: "stop", ccEvent: "Stop", feature: "lifecycle" },
  { bridgeEvent: "stop-failure", ccEvent: "StopFailure", feature: "lifecycle" },
  {
    bridgeEvent: "session-start",
    ccEvent: "SessionStart",
    feature: "lifecycle",
  },
  { bridgeEvent: "session-end", ccEvent: "SessionEnd", feature: "lifecycle" },
  {
    bridgeEvent: "subagent-start",
    ccEvent: "SubagentStart",
    feature: "lifecycle",
  },
  {
    bridgeEvent: "subagent-stop",
    ccEvent: "SubagentStop",
    feature: "lifecycle",
  },
  { bridgeEvent: "pre-compact", ccEvent: "PreCompact", feature: "lifecycle" },
  { bridgeEvent: "post-compact", ccEvent: "PostCompact", feature: "lifecycle" },
  { bridgeEvent: "cwd-changed", ccEvent: "CwdChanged", feature: "lifecycle" },
  {
    bridgeEvent: "notify-idle",
    ccEvent: "Notification",
    matcher: "idle_prompt",
    feature: "lifecycle",
  },
  {
    bridgeEvent: "notify-permission",
    ccEvent: "Notification",
    matcher: "permission_prompt",
    feature: "lifecycle",
  },
  { bridgeEvent: "task-created", ccEvent: "TaskCreated", feature: "tasks" },
  { bridgeEvent: "task-completed", ccEvent: "TaskCompleted", feature: "tasks" },
  {
    bridgeEvent: "permission-request",
    ccEvent: "PermissionRequest",
    timeout: 600,
    feature: "approvals",
  },
];

export type Feature = "lifecycle" | "tasks" | "approvals" | "statusline";
export const ALL_FEATURES: readonly Feature[] = [
  "lifecycle",
  "tasks",
  "approvals",
  "statusline",
];
/** Default install set — approvals stay opt-in (plan WS3). */
export const DEFAULT_FEATURES: readonly Feature[] = [
  "lifecycle",
  "tasks",
  "statusline",
];

export const DEFAULT_BRIDGE_DIR = join(
  homedir(),
  ".claude",
  "scripts",
  "ht-bridge",
);
export const DEFAULT_SETTINGS_PATH = join(
  homedir(),
  ".claude",
  "settings.json",
);

export function bridgeCommand(bridgeDir: string, event: string): string {
  return `bun ${join(bridgeDir, "src", "index.ts")} ${event}`;
}

export const STATUSLINE_COMMAND = "ht claude statusline";

/** Is this command one of ours? Matched loosely so path variations
 *  (symlink targets, old installs) are still recognized as managed. */
export function isManagedHookCommand(command: string): boolean {
  return command.includes("/ht-bridge/");
}

export function isManagedStatusline(command: string | undefined): boolean {
  return !!command && /\bht claude statusline\b/.test(command);
}

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

export interface InstallPlanResult {
  next: ClaudeSettings;
  added: string[];
  removed: string[];
  unchanged: string[];
}

/** Merge the requested features into a parsed settings object.
 *  Returns the new object (input is not mutated) + a human diff. */
export function planInstall(
  settings: ClaudeSettings,
  features: readonly Feature[],
  bridgeDir: string,
): InstallPlanResult {
  const next: ClaudeSettings = structuredClone(settings);
  const added: string[] = [];
  const unchanged: string[] = [];

  const wantedHooks = HOOK_SPECS.filter((h) => features.includes(h.feature));
  if (wantedHooks.length > 0 && !next.hooks) next.hooks = {};

  for (const spec of wantedHooks) {
    const groups: HookGroup[] = next.hooks![spec.ccEvent] ?? [];
    const already = groups.some((g) =>
      (g.hooks ?? []).some(
        (h) =>
          isManagedHookCommand(h.command ?? "") &&
          (h.command ?? "").endsWith(` ${spec.bridgeEvent}`),
      ),
    );
    const label = `hooks.${spec.ccEvent}${spec.matcher ? `[${spec.matcher}]` : ""} → ${spec.bridgeEvent}`;
    if (already) {
      unchanged.push(label);
      continue;
    }
    const cmd: HookCommand = {
      type: "command",
      command: bridgeCommand(bridgeDir, spec.bridgeEvent),
    };
    if (spec.timeout) cmd.timeout = spec.timeout;
    const group: HookGroup =
      spec.matcher !== undefined
        ? { matcher: spec.matcher, hooks: [cmd] }
        : { hooks: [cmd] };
    next.hooks![spec.ccEvent] = [...groups, group];
    added.push(label);
  }

  if (features.includes("statusline")) {
    const cur = next.statusLine;
    if (cur && isManagedStatusline(cur.command)) {
      unchanged.push("statusLine");
    } else if (cur && cur.command) {
      // A user statusline exists — do not clobber silently; callers
      // surface this as a skipped item.
      unchanged.push(`statusLine (kept yours: ${cur.command})`);
    } else {
      next.statusLine = { type: "command", command: STATUSLINE_COMMAND };
      added.push("statusLine");
    }
  }

  return { next, added, removed: [], unchanged };
}

/** Remove every managed entry. Leaves user hooks byte-identical; drops
 *  groups/events that end up empty; removes the statusline only when it
 *  is ours. */
export function planUninstall(settings: ClaudeSettings): InstallPlanResult {
  const next: ClaudeSettings = structuredClone(settings);
  const removed: string[] = [];

  if (next.hooks) {
    for (const [event, groups] of Object.entries(next.hooks)) {
      const kept: HookGroup[] = [];
      for (const g of groups) {
        const ours = (g.hooks ?? []).filter((h) =>
          isManagedHookCommand(h.command ?? ""),
        );
        if (ours.length === 0) {
          kept.push(g);
          continue;
        }
        removed.push(`hooks.${event} (${ours.length})`);
        const rest = (g.hooks ?? []).filter(
          (h) => !isManagedHookCommand(h.command ?? ""),
        );
        if (rest.length > 0) kept.push({ ...g, hooks: rest });
      }
      if (kept.length > 0) next.hooks[event] = kept;
      else delete next.hooks[event];
    }
    if (Object.keys(next.hooks).length === 0) delete next.hooks;
  }

  if (next.statusLine && isManagedStatusline(next.statusLine.command)) {
    delete next.statusLine;
    removed.push("statusLine");
  }

  return { next, added: [], removed, unchanged: [] };
}

export interface InstallStatus {
  settingsPath: string;
  settingsExists: boolean;
  settingsParses: boolean;
  bridgeDir: string;
  bridgePresent: boolean;
  /** bridge events currently wired (managed entries only). */
  wiredEvents: string[];
  missingEvents: string[];
  approvalsWired: boolean;
  statusline: "ours" | "other" | "none";
}

export function computeStatus(
  settings: ClaudeSettings | null,
  settingsPath: string,
  bridgeDir: string,
): InstallStatus {
  const wired = new Set<string>();
  if (settings?.hooks) {
    for (const groups of Object.values(settings.hooks)) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (!isManagedHookCommand(h.command ?? "")) continue;
          const ev = (h.command ?? "").trim().split(/\s+/).pop();
          if (ev) wired.add(ev);
        }
      }
    }
  }
  const allEvents = HOOK_SPECS.map((h) => h.bridgeEvent);
  const statuslineCmd = settings?.statusLine?.command;
  return {
    settingsPath,
    settingsExists: settings !== null,
    settingsParses: settings !== null,
    bridgeDir,
    bridgePresent: existsSync(join(bridgeDir, "src", "index.ts")),
    wiredEvents: allEvents.filter((e) => wired.has(e)),
    missingEvents: allEvents.filter((e) => !wired.has(e)),
    approvalsWired: wired.has("permission-request"),
    statusline: isManagedStatusline(statuslineCmd)
      ? "ours"
      : statuslineCmd
        ? "other"
        : "none",
  };
}

// ---------------------------------------------------------------------------
// fs shell
// ---------------------------------------------------------------------------

export function readSettingsFile(path: string): {
  settings: ClaudeSettings | null;
  error?: string;
} {
  if (!existsSync(path)) return { settings: {} };
  try {
    const raw = readFileSync(path, "utf-8");
    if (!raw.trim()) return { settings: {} };
    return { settings: JSON.parse(raw) as ClaudeSettings };
  } catch (err) {
    return {
      settings: null,
      error: `cannot parse ${path}: ${err instanceof Error ? err.message : String(err)} — fix it by hand; ht will not rewrite a file it cannot parse`,
    };
  }
}

/** Timestamped backup beside the file, then an atomic-ish write. */
export function writeSettingsFile(
  path: string,
  settings: ClaudeSettings,
): string | null {
  let backup: string | null = null;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  return backup;
}
