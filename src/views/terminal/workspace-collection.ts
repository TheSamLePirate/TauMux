/**
 * P7 S11 — F.11 WorkspaceCollection seam.
 *
 * τ-mux's `SurfaceManager` (1500+ LOC) owns the workspace array
 * alongside everything else — pane layout, focus tracking, status
 * pills, metadata, sidebar plumbing, every keyboard shortcut. The
 * workspace ordering / lookup helpers were inlined as `.find()` /
 * `.findIndex()` calls scattered through ~30 methods.
 *
 * This module starts the F.11 extraction: a thin facade over the
 * `Workspace[]` array that exposes typed, intent-bearing read
 * helpers (no mutation API yet — that's the next slice). The
 * `SurfaceManager` constructs one and delegates lookups through it;
 * the array itself still lives on `SurfaceManager.workspaces` to
 * avoid a churning refactor until every consumer is ported.
 *
 * Future sessions migrate:
 *   1. The mutation methods (push, splice, switchTo) onto the
 *      collection.
 *   2. Then `SurfaceManager.workspaces` becomes the collection's
 *      `.list` accessor; the external API stays stable.
 *   3. Then the test seam gets isolated tests that don't need a
 *      full SurfaceManager mock.
 */

import type { Workspace } from "./surface-manager";

/** Thin facade over a `Workspace[]` array. Pure read helpers only —
 *  no mutation API. The owner (SurfaceManager) still holds the array
 *  and pushes / splices it directly; this module exists so the lookup
 *  intent shows in call sites and so future extractions can land
 *  without rewriting every consumer. */
export class WorkspaceCollection {
  constructor(private readonly source: { workspaces: Workspace[] }) {}

  /** Current workspace list, in display order. Returns the live
   *  array — callers must not mutate it. (Future migration: this
   *  becomes a defensive copy once mutations all flow through the
   *  collection's own methods.) */
  get list(): readonly Workspace[] {
    return this.source.workspaces;
  }

  /** Number of workspaces. Faster than `.list.length` at call sites
   *  that only need the count — preserves the intent visibly. */
  get count(): number {
    return this.source.workspaces.length;
  }

  /** Look up a workspace by id. Returns null when nothing matches. */
  findById(id: string): Workspace | null {
    return this.source.workspaces.find((w) => w.id === id) ?? null;
  }

  /** Look up a workspace's index by id. Returns -1 when not found —
   *  matches `Array.prototype.findIndex` so call sites that need the
   *  sentinel value keep working. */
  findIndexById(id: string): number {
    return this.source.workspaces.findIndex((w) => w.id === id);
  }

  /** First workspace whose name matches (case-insensitive). Useful
   *  for the command palette / ht workspace.select-by-name path. */
  findByName(name: string): Workspace | null {
    const target = name.trim().toLowerCase();
    if (target.length === 0) return null;
    return (
      this.source.workspaces.find(
        (w) => w.name.trim().toLowerCase() === target,
      ) ?? null
    );
  }

  /** Workspace containing the given surface id, or null when the
   *  surface is unknown. Wraps the `.surfaceIds.has(sid)` lookup so
   *  the intent shows. */
  findContainingSurface(surfaceId: string): Workspace | null {
    return (
      this.source.workspaces.find((w) => w.surfaceIds.has(surfaceId)) ?? null
    );
  }

  /** Predicate: does any workspace contain the surface? */
  hasSurface(surfaceId: string): boolean {
    return this.findContainingSurface(surfaceId) !== null;
  }

  /** Map every workspace through `fn` and collect the results. Same
   *  shape as `Array.prototype.map` but read-only on the input. */
  map<T>(fn: (ws: Workspace, index: number) => T): T[] {
    return this.source.workspaces.map(fn);
  }
}
