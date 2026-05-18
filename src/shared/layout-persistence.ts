// P9 — strict validator for `PersistedLayout` shape on read.
//
// `loadLayout` previously did `JSON.parse(...) as PersistedLayout` with
// only the surface check `workspaces.length > 0`. A truncated layout.json
// (fsync interrupted, disk full, kernel panic mid-write, rsync of a
// partial backup, etc.) could fall through with a malformed `PaneNode`
// tree and crash the boot path at `collectLeafIds` / `remapPaneNode`
// instead of cleanly starting from scratch.
//
// `parsePersistedLayout(raw)` parses + validates in one step and
// returns `null` on ANY structural problem. Strict validators are
// pure (no FS access) so they're trivially testable.

import type {
  PaneNode,
  PersistedLayout,
  PersistedWorkspace,
  SurfaceKind,
} from "./types";

const VALID_SURFACE_KINDS: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>([
  "terminal",
  "browser",
  "agent",
  "telegram",
  "editor",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validatePaneNode(node: unknown): node is PaneNode {
  if (!isPlainObject(node)) return false;
  const type = node["type"];
  if (type === "leaf") {
    const surfaceId = node["surfaceId"];
    if (typeof surfaceId !== "string" || surfaceId.length === 0) return false;
    const surfaceType = node["surfaceType"];
    if (
      surfaceType !== undefined &&
      !(
        typeof surfaceType === "string" &&
        VALID_SURFACE_KINDS.has(surfaceType as SurfaceKind)
      )
    ) {
      return false;
    }
    return true;
  }
  if (type === "split") {
    const direction = node["direction"];
    if (direction !== "horizontal" && direction !== "vertical") return false;
    const ratio = node["ratio"];
    if (
      typeof ratio !== "number" ||
      !Number.isFinite(ratio) ||
      ratio < 0 ||
      ratio > 1
    ) {
      return false;
    }
    const children = node["children"];
    if (!Array.isArray(children) || children.length !== 2) return false;
    return validatePaneNode(children[0]) && validatePaneNode(children[1]);
  }
  return false;
}

function validateStringRecord(v: unknown): v is Record<string, string> {
  if (!isPlainObject(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val !== "string") return false;
  }
  return true;
}

function validateSurfaceTypeRecord(
  v: unknown,
): v is Record<string, SurfaceKind> {
  if (!isPlainObject(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val !== "string") return false;
    if (!VALID_SURFACE_KINDS.has(val as SurfaceKind)) return false;
  }
  return true;
}

function validateWorkspace(ws: unknown): ws is PersistedWorkspace {
  if (!isPlainObject(ws)) return false;
  if (typeof ws["name"] !== "string") return false;
  if (typeof ws["color"] !== "string") return false;
  if (!validatePaneNode(ws["layout"])) return false;
  const focused = ws["focusedSurfaceId"];
  if (focused !== null && typeof focused !== "string") return false;
  // Optional record fields — when present must be string-valued records.
  if (
    ws["surfaceTitles"] !== undefined &&
    !validateStringRecord(ws["surfaceTitles"])
  )
    return false;
  if (
    ws["surfaceCwds"] !== undefined &&
    !validateStringRecord(ws["surfaceCwds"])
  )
    return false;
  if (ws["selectedCwd"] !== undefined && typeof ws["selectedCwd"] !== "string")
    return false;
  if (
    ws["surfaceUrls"] !== undefined &&
    !validateStringRecord(ws["surfaceUrls"])
  )
    return false;
  if (
    ws["surfaceEditorFiles"] !== undefined &&
    !validateStringRecord(ws["surfaceEditorFiles"])
  )
    return false;
  if (
    ws["surfaceTypes"] !== undefined &&
    !validateSurfaceTypeRecord(ws["surfaceTypes"])
  )
    return false;
  return true;
}

/** Validate that `raw` matches the `PersistedLayout` shape. Returns
 *  `true` only when every workspace inside `workspaces` is structurally
 *  sound. A single malformed workspace fails the whole layout — partial
 *  recovery would leave the user in a half-restored state that's
 *  harder to reason about than a clean slate. */
export function validatePersistedLayout(raw: unknown): raw is PersistedLayout {
  if (!isPlainObject(raw)) return false;
  const idx = raw["activeWorkspaceIndex"];
  if (typeof idx !== "number") return false;
  if (typeof raw["sidebarVisible"] !== "boolean") return false;
  const workspaces = raw["workspaces"];
  if (!Array.isArray(workspaces) || workspaces.length === 0) return false;
  for (const ws of workspaces) {
    if (!validateWorkspace(ws)) return false;
  }
  // activeWorkspaceIndex must point at a valid slot (or -1 for no-active).
  if (idx < -1 || idx >= workspaces.length || !Number.isInteger(idx)) {
    return false;
  }
  return true;
}

/** Parse + validate in one step. Returns `null` on any JSON parse
 *  error, shape mismatch, or out-of-range field. Callers can treat
 *  null as "start from scratch". */
export function parsePersistedLayout(json: string): PersistedLayout | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!validatePersistedLayout(parsed)) return null;
  return parsed;
}
