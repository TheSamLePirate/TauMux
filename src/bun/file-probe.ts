/**
 * "Is this string actually a file, and what is it?"
 *
 * The terminal link provider needs an answer before it draws an
 * underline. Underlining a path that does not exist is the failure mode
 * that makes clickable paths feel unreliable: the user clicks, a pane
 * opens, and the pane says "File does not exist" — which is strictly
 * worse than never having offered the link. So the provider asks here
 * first and simply does not underline what it cannot open.
 *
 * That puts this function on the hover path, which sets the budget: one
 * `lstat` per candidate, at most `MAX_PROBE_PATHS` per request, and a
 * 16-byte magic-number read only when the extension is inconclusive.
 * Thumbnails are opt-in and separately capped, because they are the one
 * part that reads whole files.
 */

import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { ProbedPath } from "../shared/types";
import {
  contentKindForPath,
  imageMimeForPath,
  sniffImageMime,
} from "../shared/file-kind";
import { readFileMagic, resolveEditorPath } from "./editor-files";

/** One terminal row cannot plausibly hold more references than this, and
 *  the bound keeps a malformed request from turning into a stat storm. */
export const MAX_PROBE_PATHS = 32;

/**
 * Images at or under this size get inlined into the hover tooltip.
 *
 * There is no image-resizing dependency in this project, so a
 * "thumbnail" is the whole file with CSS scaling it down. 2 MB covers
 * essentially every icon, diagram and UI screenshot; past that the
 * tooltip degrades to metadata only rather than pushing megabytes over
 * the RPC bridge on a mouse-over.
 */
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const SNIFF_BYTES = 16;

function magicOf(bytes: Buffer): Uint8Array {
  return new Uint8Array(bytes.subarray(0, SNIFF_BYTES));
}

/**
 * Classify a regular file. `bytes` is passed in when the caller already
 * read the file for a thumbnail, so the common case does not read twice.
 */
function classifyFile(
  path: string,
  size: number,
  bytes: Buffer | null,
): { contentKind: ProbedPath["contentKind"]; imageMime?: string } {
  const named = imageMimeForPath(path);
  if (named) return { contentKind: "image", imageMime: named };
  if (contentKindForPath(path) === "svg") return { contentKind: "svg" };

  // Inconclusive name. Sniffing needs bytes; skip it for empty files
  // (nothing to sniff) and let anything unrecognised fall through to
  // "text" — the editor's own binary check is the backstop, and it has
  // the whole buffer to work with.
  if (size === 0) return { contentKind: "text" };
  const head = bytes ? magicOf(bytes) : readFileMagic(path);
  const sniffed = sniffImageMime(head);
  if (sniffed) return { contentKind: "image", imageMime: sniffed };
  return { contentKind: "text" };
}

export interface ProbeFilePathsParams {
  paths: string[];
  /** The terminal surface's cwd, for resolving relative references.
   *  Absent for absolute-only callers. */
  cwd?: string;
  /** Read image bytes into `thumbnailDataUri`. Off by default — the
   *  underline path never needs them, only the hover tooltip does. */
  thumbnails?: boolean;
}

/**
 * Resolve, stat and classify each path. Never throws: an entry that
 * cannot be stat'd comes back as `type: "missing"`, which the caller
 * renders as "no link" rather than as an error.
 */
export function probeFilePaths(params: ProbeFilePathsParams): ProbedPath[] {
  const paths = params.paths.slice(0, MAX_PROBE_PATHS);
  return paths.map((input) => probeOne(input, params.cwd, params.thumbnails));
}

function probeOne(
  input: string,
  cwd: string | undefined,
  thumbnails: boolean | undefined,
): ProbedPath {
  const missing: ProbedPath = {
    input,
    resolved: input,
    type: "missing",
    contentKind: "text",
    size: 0,
    mtimeMs: null,
  };
  let resolved: string;
  try {
    resolved = resolveEditorPath(input, cwd);
  } catch {
    return missing;
  }

  try {
    // lstat first so a dangling symlink reports as missing rather than
    // as a file we then fail to open.
    const link = lstatSync(resolved);
    const st = link.isSymbolicLink() ? statSync(resolved) : link;

    if (st.isDirectory()) {
      return {
        input,
        resolved: link.isSymbolicLink() ? safeRealpath(resolved) : resolved,
        type: "directory",
        contentKind: "text",
        size: 0,
        mtimeMs: st.mtimeMs,
      };
    }
    if (!st.isFile()) {
      // FIFOs, sockets, devices. They exist, but opening one in an
      // editor can block forever — never offer a link.
      return { ...missing, resolved, type: "other", mtimeMs: st.mtimeMs };
    }

    let bytes: Buffer | null = null;
    if (thumbnails && st.size > 0 && st.size <= MAX_THUMBNAIL_BYTES) {
      try {
        bytes = readFileSync(resolved);
      } catch {
        bytes = null;
      }
    }

    const { contentKind, imageMime } = classifyFile(resolved, st.size, bytes);
    const probed: ProbedPath = {
      input,
      resolved,
      type: "file",
      contentKind,
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
    if (imageMime) probed.imageMime = imageMime;
    if (bytes && contentKind === "image" && imageMime) {
      probed.thumbnailDataUri = `data:${imageMime};base64,${bytes.toString("base64")}`;
    }
    return probed;
  } catch {
    return { ...missing, resolved };
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
