/**
 * Expanding the sidebar file explorer down to a given path.
 *
 * This is where a clicked *directory* in terminal output lands. Opening
 * an editor pane for one would be pointless — it can only report "Path
 * is not a file" — but the sidebar already renders a tree, so the click
 * becomes "show me this folder" instead.
 *
 * Kept out of `sidebar.ts`, which is a baselined god module
 * (scripts/audit-module-size.ts). The path arithmetic here is also the
 * part worth unit-testing, and it is pure.
 */

/** True when `path` is `root` or lives under it. Anchored on the
 *  separator so `/foo` does not appear to contain `/foobar`. */
export function isWithin(path: string, root: string): boolean {
  const base = root.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Every directory from `root` down to `target`, inclusive of both.
 *
 * That is exactly the set which has to be expanded for `target`'s row
 * to exist in the DOM — the explorer renders a directory's children
 * only once that directory is open. Returns `[]` when `target` is not
 * under `root`, so callers can treat "nothing to expand" and "not our
 * tree" as the same non-answer.
 */
export function ancestorChain(target: string, root: string): string[] {
  const base = root.replace(/\/+$/, "");
  if (!isWithin(target, base)) return [];
  const chain = [base];
  let cursor = base;
  for (const segment of target.slice(base.length).split("/").filter(Boolean)) {
    cursor = `${cursor}/${segment}`;
    chain.push(cursor);
  }
  return chain;
}

/** `CSS.escape` with a fallback. The row lookup interpolates a
 *  filesystem path into an attribute selector, and a path may legally
 *  contain quotes and brackets. */
export function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS
    ?.escape;
  return fn ? fn(value) : value.replace(/["\\]/g, "\\$&");
}

export interface RevealPlan {
  /** Workspace whose explorer contains the target. */
  workspaceId: string;
  root: string;
  /** Directories to mark open, root-first. */
  expand: string[];
}

/**
 * Which workspace tree can show `path`, and what to expand to get
 * there. Null when no workspace root contains it — the caller turns
 * that into a toast rather than silently doing nothing, because an
 * unchanged sidebar is indistinguishable from a broken click.
 */
export function planReveal(
  path: string,
  workspaces: { id: string; root: string | null }[],
): RevealPlan | null {
  const target = path.replace(/\/+$/, "");
  for (const ws of workspaces) {
    if (!ws.root || !isWithin(target, ws.root)) continue;
    return {
      workspaceId: ws.id,
      root: ws.root,
      expand: ancestorChain(target, ws.root),
    };
  }
  return null;
}

/**
 * Scroll a revealed row into view and flash it.
 *
 * Retried as each directory listing arrives, because the row does not
 * exist until its parent has been listed. Returns true once the row was
 * found, which tells the caller to stop retrying.
 */
export function scrollRevealedRowIntoView(
  container: ParentNode,
  target: string,
): boolean {
  const row = container.querySelector<HTMLElement>(
    `.workspace-file-row[data-path="${cssEscape(target)}"]`,
  );
  if (!row) return false;
  row.scrollIntoView({ block: "center" });
  row.classList.add("revealed");
  setTimeout(() => row.classList.remove("revealed"), 1600);
  return true;
}
