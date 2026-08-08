/**
 * Should a metadata tick repaint anything?
 *
 * `SurfaceMetadataPoller` produces a fresh `SurfaceMetadata` for every
 * pane once a second whether or not a single number moved. Repainting on
 * all of them would put the sidebar, the chip row and the Atlas graph on
 * a 1 Hz treadmill forever, which is exactly the idle cost the project's
 * first priority forbids.
 *
 * So the manager gates on this predicate: a *truly* idle workspace —
 * every process at 0.0 % CPU, stable RSS, same ports, same cwd, same
 * package — produces no repaint at all, and any real movement produces
 * one immediately. Extracted from `SurfaceManager.setSurfaceMetadata` so
 * the rule is pure, testable, and stated in one place rather than
 * inline in a method that does four other things.
 */
import type { ListeningPort, SurfaceMetadata } from "../../shared/types";

export function samePortSet(a: ListeningPort[], b: ListeningPort[]): boolean {
  if (a.length !== b.length) return false;
  const key = (p: ListeningPort) =>
    `${p.pid}:${p.proto}:${p.address}:${p.port}`;
  const seen = new Set(a.map(key));
  return b.every((p) => seen.has(key(p)));
}

/**
 * True when `next` differs from `prev` in any field a view displays.
 *
 * `focused` matters because the foreground command is only rendered for
 * the focused pane — a background pane changing what it runs moves
 * nothing on screen until you look at it.
 */
export function metadataNeedsRepaint(
  prev: SurfaceMetadata | undefined,
  next: SurfaceMetadata,
  focused: boolean,
): boolean {
  if (!prev) return true;
  if (!samePortSet(prev.listeningPorts, next.listeningPorts)) return true;
  if (focused && prev.foregroundPid !== next.foregroundPid) return true;
  if ((prev.cwd ?? "") !== next.cwd) return true;
  if ((prev.packageJson?.path ?? null) !== (next.packageJson?.path ?? null)) {
    return true;
  }
  if (prev.tree.length !== next.tree.length) return true;

  // Live CPU / RSS movement, so stat rows and load arcs track activity at
  // ~1 Hz instead of only when the tree's shape happens to change. Safe
  // to fire often: `updateSidebar()` is rAF-coalesced and every consumer
  // reconciles in place.
  let prevCpu = 0;
  let prevRss = 0;
  for (const n of prev.tree) {
    prevCpu += n.cpu;
    prevRss += n.rssKb;
  }
  let nextCpu = 0;
  let nextRss = 0;
  for (const n of next.tree) {
    nextCpu += n.cpu;
    nextRss += n.rssKb;
  }
  return prevCpu !== nextCpu || prevRss !== nextRss;
}
