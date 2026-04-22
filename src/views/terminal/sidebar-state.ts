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

import type {
  CargoInfo,
  PackageInfo,
  SurfaceMetadata,
} from "../../shared/types";
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
  const out = input.workspaces.map((ws, i) => buildOneWorkspace(ws, i, input));
  pruneCpuHistories(new Set(input.workspaces.map((w) => w.id)));
  return out;
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

  // Resolve package.json / Cargo.toml by locating the surface whose
  // cwd matches the selected cwd — that surface's snapshot already
  // has both manifests computed upstream by the poller. The poller
  // walks up from cwd, so a project with BOTH manifests (wasm-pack,
  // Tauri, napi-rs) surfaces both cards.
  let packageJson: PackageInfo | null = null;
  let cargoToml: CargoInfo | null = null;
  if (selectedCwd) {
    for (const sid of ws.surfaceIds) {
      const m = metadata.get(sid);
      if (m?.cwd !== selectedCwd) continue;
      if (!packageJson && m.packageJson) packageJson = m.packageJson;
      if (!cargoToml && m.cargoToml) cargoToml = m.cargoToml;
      if (packageJson && cargoToml) break;
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

  // Cargo subcommands aren't declared anywhere — we surface a fixed
  // set of common ones at render time. Running detection looks at
  // every command in the process tree and pulls the cargo subcommand
  // word ("cargo build --release" → "build"); the sidebar renderer
  // matches it against the same fixed list.
  // Aggregate live process metrics across every surface in the
  // workspace. These feed the mini sparkline + RAM chip in the active
  // workspace header. We sum across all descendants of every surface
  // so a 2-pane workspace reflects the combined load.
  let cpuPercent = 0;
  let memRssKb = 0;
  let procCount = 0;
  for (const sid of ws.surfaceIds) {
    const m = metadata.get(sid);
    if (!m) continue;
    for (const node of m.tree) {
      cpuPercent += node.cpu;
      memRssKb += node.rssKb;
      procCount++;
    }
  }
  const cpuHistory = pushCpuSample(ws.id, cpuPercent);

  const runningCargoActions: string[] = [];
  const erroredCargoActions: string[] = [];
  if (cargoToml) {
    const found = new Set<string>();
    for (const sid of ws.surfaceIds) {
      const m = metadata.get(sid);
      if (!m) continue;
      for (const node of m.tree) {
        const sub = extractCargoSubcommand(node.command);
        if (sub) found.add(sub);
      }
    }
    for (const sub of found) runningCargoActions.push(sub);
    // Errored-action set mirrors the npm path — it uses the shared
    // scriptErrors map keyed "<workspaceId>:cargo:<subcommand>".
    for (const [key] of scriptErrors) {
      const prefix = `${ws.id}:cargo:`;
      if (key.startsWith(prefix)) {
        const sub = key.slice(prefix.length);
        if (!found.has(sub)) erroredCargoActions.push(sub);
      }
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
    cargoToml,
    runningCargoActions,
    erroredCargoActions,
    cwds: cwdSet,
    selectedCwd,
    cpuPercent,
    memRssKb,
    processCount: procCount,
    cpuHistory,
  };
}

/** Rolling CPU% history per workspace — fed to the mini sparkline in
 *  the sidebar card header. Keyed by workspaceId. The map is pruned
 *  lazily by `buildSidebarWorkspaces` (any id not seen in the current
 *  pass is dropped). */
const CPU_HISTORY_LIMIT = 32;
const cpuHistories = new Map<string, number[]>();

function pushCpuSample(wsId: string, sample: number): number[] {
  const existing = cpuHistories.get(wsId) ?? [];
  const next =
    existing.length >= CPU_HISTORY_LIMIT
      ? [...existing.slice(1), sample]
      : [...existing, sample];
  cpuHistories.set(wsId, next);
  return next;
}

/** Drop CPU-history entries for workspaces that no longer exist. Called
 *  from `buildSidebarWorkspaces` each pass so the map can't grow
 *  unbounded across a long session with many short-lived workspaces. */
function pruneCpuHistories(keep: Set<string>): void {
  for (const id of [...cpuHistories.keys()]) {
    if (!keep.has(id)) cpuHistories.delete(id);
  }
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

/** Extract the cargo subcommand from a process command line. Matches
 *  `cargo build`, `cargo build --release`, `cargo run --bin foo`,
 *  `cargo test --workspace`, `cargo clippy --all-targets`, etc.
 *  Returns the subcommand token (first non-flag argument after
 *  `cargo`) or null when the command isn't a cargo invocation. */
export function extractCargoSubcommand(command: string): string | null {
  const m = command.match(/^(?:\S*\/)?cargo(?:\s+\+\S+)?\s+([a-z][a-z0-9-]*)/);
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
