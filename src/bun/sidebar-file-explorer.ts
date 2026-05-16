import { lstatSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
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
    return {
      name,
      path,
      kind,
      hidden: name.startsWith("."),
      size: st.isFile() ? st.size : undefined,
      mtimeMs: st.mtimeMs,
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
  const maxEntries = Math.max(20, Math.min(1000, Math.round(request.maxEntries)));
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
