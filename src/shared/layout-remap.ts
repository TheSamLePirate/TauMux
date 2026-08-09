/**
 * Rewrite a persisted layout's surface ids to the ids of the surfaces
 * that were just re-spawned for it.
 *
 * A restore creates brand-new PTYs, so every id in `layout.json` is
 * stale. Every per-surface map has to be re-keyed in lockstep with the
 * pane tree or the restored workspace loses whichever facet was missed —
 * a title, a cwd, an editor's file, an extension binding.
 *
 * Pure, so the mapping can be tested without spawning anything.
 */
import type { PersistedLayout, PaneNode } from "./types";

/** Re-key one `oldId → value` map onto the new ids. Entries whose
 *  surface did not come back are dropped rather than carried as
 *  dangling keys. */
function remapRecord(
  source: Record<string, string> | undefined,
  mapping: Record<string, string>,
): Record<string, string> | undefined {
  if (!source) return undefined;
  const out: Record<string, string> = {};
  for (const [oldId, value] of Object.entries(source)) {
    const newId = mapping[oldId];
    if (newId) out[newId] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function remapIds(
  source: readonly string[] | undefined,
  mapping: Record<string, string>,
): string[] | undefined {
  if (!source) return undefined;
  const out = source
    .map((oldId) => mapping[oldId])
    .filter((id): id is string => !!id);
  return out.length > 0 ? out : undefined;
}

export function remapPersistedLayout(
  persisted: PersistedLayout,
  mapping: Record<string, string>,
  remapPaneNode: (node: PaneNode, m: Record<string, string>) => PaneNode,
): PersistedLayout {
  return {
    ...persisted,
    workspaces: persisted.workspaces.map((ws) => ({
      ...ws,
      layout: remapPaneNode(ws.layout, mapping),
      focusedSurfaceId: ws.focusedSurfaceId
        ? (mapping[ws.focusedSurfaceId] ?? null)
        : null,
      surfaceTitles: remapRecord(ws.surfaceTitles, mapping),
      surfaceTitlesLocked: remapIds(ws.surfaceTitlesLocked, mapping),
      surfaceCwds: remapRecord(ws.surfaceCwds, mapping),
      surfaceEditorFiles: remapRecord(ws.surfaceEditorFiles, mapping),
      surfaceExtensionIds: remapRecord(ws.surfaceExtensionIds, mapping),
      // `selectedCwd` is a path, not a surface id — it carries through
      // untouched via the spread above.
    })),
  };
}
