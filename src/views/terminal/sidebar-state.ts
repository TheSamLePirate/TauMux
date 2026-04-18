/**
 * Pure transformer from SurfaceManager state → Sidebar WorkspaceInfo[].
 *
 * Before this module existed, `SurfaceManager.updateSidebar` inlined
 * ~110 lines of workspace-row construction: collect pane titles,
 * union listening ports, dedup cwds, honor a user-pinned cwd, resolve
 * package.json, detect running/errored scripts. All pure state
 * projection — moving it here means the sidebar layout logic can be
 * unit-tested without standing up a real SurfaceManager, and
 * updateSidebar itself is a 10-line wire-through.
 *
 * The one intentional side effect (pruning stale `selectedCwds` pins)
 * is preserved — we receive the Map by reference and delete entries
 * whose target cwd no longer exists in any pane.
 */

import type { PackageInfo, SurfaceMetadata } from "../../shared/types";
import type { WorkspaceInfo } from "./sidebar";
import type { Workspace } from "./surface-manager";

/** Minimal projection of `SurfaceView` that the sidebar needs — just
 *  the display title. Keeping the type narrow means callers don't
 *  need to hand over terminal/browser/agent handles. */
export interface SidebarSurfaceSummary {
  title: string;
}

export interface SidebarStateInput {
  workspaces: Workspace[];
  surfaces: Map<string, SidebarSurfaceSummary>;
  focusedSurfaceId: string | null;
  activeWorkspaceIndex: number;
  metadata: Map<string, SurfaceMetadata>;
  /** workspaceId → pinned cwd. Stale entries (cwd no longer hosted
   *  by any surface) are removed in place. */
  selectedCwds: Map<string, string>;
  /** "<workspaceId>:<scriptKey>" → epoch ms of last non-zero exit.
   *  Drives the red dot on a package.json script pill. */
  scriptErrors: Map<string, number>;
}

/** Build the `WorkspaceInfo[]` array that `Sidebar.setWorkspaces`
 *  consumes. See the module header for the side effect on
 *  `selectedCwds`. */
export function buildSidebarWorkspaces(
  input: SidebarStateInput,
): WorkspaceInfo[] {
  return input.workspaces.map((ws, i) => buildOneWorkspace(ws, i, input));
}

function buildOneWorkspace(
  ws: Workspace,
  index: number,
  input: SidebarStateInput,
): WorkspaceInfo {
  const {
    surfaces,
    focusedSurfaceId,
    activeWorkspaceIndex,
    metadata,
    selectedCwds,
    scriptErrors,
  } = input;

  const surfaceTitles = ws.layout
    .getAllSurfaceIds()
    .map((surfaceId) => surfaces.get(surfaceId)?.title ?? surfaceId);

  const focusedSurfaceTitle =
    focusedSurfaceId && ws.surfaceIds.has(focusedSurfaceId)
      ? (surfaces.get(focusedSurfaceId)?.title ?? focusedSurfaceId)
      : (surfaceTitles[0] ?? null);

  const portSet = new Set<number>();
  for (const surfaceId of ws.surfaceIds) {
    const meta = metadata.get(surfaceId);
    if (!meta) continue;
    for (const p of meta.listeningPorts) portSet.add(p.port);
  }
  const listeningPorts = [...portSet].sort((a, b) => a - b);

  const focusedMeta =
    focusedSurfaceId && ws.surfaceIds.has(focusedSurfaceId)
      ? (metadata.get(focusedSurfaceId) ?? null)
      : null;
  const focusedSurfaceCommand =
    focusedMeta && focusedMeta.foregroundPid !== focusedMeta.pid
      ? (focusedMeta.tree.find((n) => n.pid === focusedMeta.foregroundPid)
          ?.command ?? null)
      : null;

  // Collect the distinct cwds across this workspace's surfaces.
  const cwdSet: string[] = [];
  const seen = new Set<string>();
  for (const sid of ws.surfaceIds) {
    const m = metadata.get(sid);
    if (!m?.cwd) continue;
    if (seen.has(m.cwd)) continue;
    seen.add(m.cwd);
    cwdSet.push(m.cwd);
  }

  // The user may have pinned a cwd; if it's gone stale (no surface
  // still at that path), drop the pin and fall back to focused.
  const pinned = selectedCwds.get(ws.id);
  if (pinned && !seen.has(pinned)) selectedCwds.delete(ws.id);
  const effectivePin = selectedCwds.get(ws.id) ?? null;
  const selectedCwd = effectivePin ?? focusedMeta?.cwd ?? null;

  // Resolve packageJson by locating the surface whose cwd matches the
  // selected cwd — that surface's snapshot already has the right
  // PackageInfo computed upstream by the poller.
  let packageJson: PackageInfo | null = null;
  if (selectedCwd) {
    for (const sid of ws.surfaceIds) {
      const m = metadata.get(sid);
      if (m?.cwd === selectedCwd && m.packageJson) {
        packageJson = m.packageJson;
        break;
      }
    }
  }

  const runningScripts: string[] = [];
  const erroredScripts: string[] = [];
  if (packageJson?.scripts) {
    const knownScripts = Object.keys(packageJson.scripts);
    const running = new Set<string>();
    for (const sid of ws.surfaceIds) {
      const m = metadata.get(sid);
      if (!m) continue;
      for (const node of m.tree) {
        const name = extractScriptName(node.command);
        if (name && knownScripts.includes(name)) running.add(name);
      }
    }
    for (const s of knownScripts) {
      if (running.has(s)) runningScripts.push(s);
      else if (scriptErrors.has(`${ws.id}:${s}`)) erroredScripts.push(s);
    }
  }

  return {
    id: ws.id,
    name: ws.name,
    color: ws.color,
    active: index === activeWorkspaceIndex,
    surfaceTitles,
    focusedSurfaceTitle,
    focusedSurfaceCommand,
    statusPills: [...ws.status.entries()].map(([key, s]) => ({
      key,
      value: s.value,
      color: s.color,
      icon: s.icon,
    })),
    progress: ws.progress,
    listeningPorts,
    packageJson,
    runningScripts,
    erroredScripts,
    cwds: cwdSet,
    selectedCwd,
  };
}

/** Extract the script name from commands like "bun run build",
 *  "npm run dev", "pnpm test", "yarn run start". Returns null when
 *  no recognizable runner is at the head of the command. */
export function extractScriptName(command: string): string | null {
  const m = command.match(
    /^(?:bun|npm|pnpm|yarn)(?:\s+run(?:-script)?)?\s+(\S+)/,
  );
  return m?.[1] ?? null;
}

/** Set equality on port numbers only — used by the metadata differ
 *  to decide whether a port change is worth notifying the sidebar
 *  for (pid-level changes alone don't affect what's rendered). */
export function samePortSet(
  a: { port: number }[],
  b: { port: number }[],
): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a.map((x) => x.port));
  for (const x of b) if (!aSet.has(x.port)) return false;
  return true;
}
