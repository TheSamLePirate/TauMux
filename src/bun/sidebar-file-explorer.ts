import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import type {
  SidebarFileExplorerEntry,
  SidebarFileExplorerListing,
} from "../shared/types";

const DEFAULT_IGNORED = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);

export interface SidebarFileExplorerRequest {
  requestId: string;
  path: string;
  showHidden: boolean;
  maxEntries: number;
}

function entryRank(kind: SidebarFileExplorerEntry["kind"]): number {
  if (kind === "directory") return 0;
  if (kind === "symlink") return 1;
  if (kind === "file") return 2;
  return 3;
}

/** P9 — true if `candidate` is the same as `root` OR an ancestor of
 *  it on the resolved filesystem. Used to flag symlinks that would
 *  send the user back up the tree. Compares fully-resolved paths so a
 *  symlink chain still gets caught. */
export function isAncestorOrSelf(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  // Make sure we don't match `/foo` against `/foobar` by anchoring on
  // the path separator.
  const candWithSep = candidate.endsWith(sep) ? candidate : candidate + sep;
  return root.startsWith(candWithSep);
}

function toEntry(parent: string, name: string): SidebarFileExplorerEntry {
  const path = resolve(parent, name);
  try {
    const st = lstatSync(path);
    const kind: SidebarFileExplorerEntry["kind"] = st.isDirectory()
      ? "directory"
      : st.isSymbolicLink()
        ? "symlink"
        : st.isFile()
          ? "file"
          : "other";
    let linkTarget: string | null | undefined;
    let cycle: boolean | undefined;
    if (kind === "symlink") {
      // P9 — resolve the link to its realpath so consumers can show
      // "→ /real/target" and refuse to navigate into a cycle.
      try {
        linkTarget = realpathSync(path);
      } catch {
        // Dangling symlink — target doesn't exist. linkTarget = null
        // tells the webview to show a broken-link affordance instead
        // of trying to navigate.
        linkTarget = null;
      }
      if (linkTarget !== null && isAncestorOrSelf(linkTarget, parent)) {
        cycle = true;
      }
    }
    return {
      name,
      path,
      kind,
      hidden: name.startsWith("."),
      size: st.isFile() ? st.size : undefined,
      mtimeMs: st.mtimeMs,
      ...(linkTarget !== undefined ? { linkTarget } : {}),
      ...(cycle ? { cycle: true } : {}),
    };
  } catch (err) {
    return {
      name,
      path,
      kind: "other",
      hidden: name.startsWith("."),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function listSidebarFileExplorerDirectory(
  request: SidebarFileExplorerRequest,
): SidebarFileExplorerListing {
  const root = resolve(request.path || ".");
  const maxEntries = Math.max(
    20,
    Math.min(1000, Math.round(request.maxEntries)),
  );
  try {
    const st = lstatSync(root);
    if (!st.isDirectory()) {
      return {
        requestId: request.requestId,
        path: root,
        entries: [],
        truncated: false,
        error: `${basename(root) || root} is not a directory`,
      };
    }

    const allNames = readdirSync(root);
    let hiddenExcluded = 0;
    let ignoredExcluded = 0;
    const names = allNames.filter((name) => {
      if (!request.showHidden && name.startsWith(".")) {
        hiddenExcluded++;
        return false;
      }
      if (DEFAULT_IGNORED.has(name)) {
        ignoredExcluded++;
        return false;
      }
      return true;
    });
    const entries = names
      .map((name) => toEntry(root, name))
      .sort((a, b) => {
        const rank = entryRank(a.kind) - entryRank(b.kind);
        if (rank !== 0) return rank;
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
    const truncated = entries.length > maxEntries;
    return {
      requestId: request.requestId,
      path: root,
      entries: truncated ? entries.slice(0, maxEntries) : entries,
      truncated,
      totalEntries: allNames.length,
      hiddenExcluded,
      ignoredExcluded,
    };
  } catch (err) {
    return {
      requestId: request.requestId,
      path: root,
      entries: [],
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
