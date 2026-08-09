/**
 * Atlas filtering — pure, and deliberately not in `panel.ts`.
 *
 * A node survives a filter when it matches, or when any descendant
 * matches. Both halves are necessary: keeping only exact matches would
 * orphan every row from its spine, and dropping a workspace whose pane
 * matched would hide the very thing the filter was asked to find.
 */
import type { AtlasFilterTag, AtlasNode, AtlasSnapshot } from "./types";

export type AtlasFilter = "all" | AtlasFilterTag;

export function applyFilter(
  snapshot: AtlasSnapshot,
  filter: AtlasFilter,
): AtlasSnapshot {
  if (filter === "all") return snapshot;

  const keep = new Set<string>();
  const matches = (id: string): boolean =>
    snapshot.nodes.get(id)?.tags.includes(filter) ?? false;

  const visit = (id: string): boolean => {
    const node = snapshot.nodes.get(id);
    if (!node) return false;
    let kept = matches(id);
    for (const child of node.children) {
      if (visit(child)) kept = true;
    }
    if (kept) keep.add(id);
    return kept;
  };
  for (const rootId of snapshot.roots) {
    visit(rootId);
    keep.add(rootId); // the spine head always survives
  }

  const nodes = new Map<string, AtlasNode>();
  for (const [id, node] of snapshot.nodes) {
    if (!keep.has(id)) continue;
    nodes.set(id, {
      ...node,
      children: node.children.filter((c) => keep.has(c)),
    });
  }
  return {
    nodes,
    roots: snapshot.roots,
    totals: snapshot.totals,
    river: snapshot.river,
  };
}
