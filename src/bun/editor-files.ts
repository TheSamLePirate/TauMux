import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { EditorFileSnapshot, EditorSaveResult } from "../shared/types";
import {
  contentKindForPath,
  imageMimeForPath,
  sniffImageMime,
} from "../shared/file-kind";

export const EDITOR_MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Images travel to the webview as a base64 data URI over the Electrobun
 * RPC bridge, which inflates them by 4/3. The cap is on the *file*, so
 * the worst-case message is ~16 MB — large but bounded, and a photo
 * bigger than 12 MB is a file you want an image editor for, not a
 * terminal pane.
 */
export const EDITOR_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * `~` is a shell affordance, not a filesystem one — `isAbsolute("~/x")`
 * is false, so without this a clicked `~/notes.md` resolved to
 * `<cwd>/~/notes.md` and reported "File does not exist". Expanded here
 * rather than at the call sites because every path entering the editor
 * (terminal link, `ht editor open`, the pane's own open form) can carry
 * one.
 *
 * Only a leading `~` or `~/` is expanded. `~user` is left alone: we
 * cannot resolve another account's home without a passwd lookup, and
 * silently mapping it to *this* user's home would open the wrong file.
 */
export function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function resolveEditorPath(path: string, cwd?: string): string {
  const expanded = expandTilde(path);
  const base = cwd && isAbsolute(cwd) ? expandTilde(cwd) : process.cwd();
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return true;
  let suspicious = 0;
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.08;
}

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  )
    return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (
    lower.endsWith(".css") ||
    lower.endsWith(".scss") ||
    lower.endsWith(".sass")
  )
    return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".svg")) return "html";
  return "text";
}

/** Longest magic-number prefix `sniffImageMime` inspects. */
const SNIFF_BYTES = 16;

/**
 * First `SNIFF_BYTES` of a file, without paying to read the rest.
 *
 * Needed because classification has to happen *before* the size check:
 * an extensionless 8 MB screenshot is a perfectly openable image, but
 * reading it whole to find that out would first trip the 5 MB text cap
 * and report "File is larger than 5 MB". `file-probe.ts` shares it so
 * the two modules cannot drift on how much they sniff.
 */
export function readFileMagic(path: string): Uint8Array {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(SNIFF_BYTES);
    const read = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return new Uint8Array(buf.subarray(0, read));
  } catch {
    return new Uint8Array(0);
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed — nothing to recover */
      }
    }
  }
}

/** An image snapshot: bytes as a data URI the pane can hand straight to
 *  an `<img>`. Dimensions are deliberately absent — the webview reads
 *  them off `naturalWidth`/`naturalHeight` for free, so decoding the
 *  header here would be duplicated work. */
function readImageSnapshot(
  surfaceId: string,
  path: string,
  mime: string,
  size: number,
  mtimeMs: number,
): EditorFileSnapshot {
  if (size > EDITOR_MAX_IMAGE_BYTES) {
    return {
      surfaceId,
      path,
      content: "",
      exists: true,
      size,
      mtimeMs,
      kind: "image",
      tooLarge: true,
      error: `Image is larger than ${Math.round(EDITOR_MAX_IMAGE_BYTES / 1024 / 1024)} MB`,
    };
  }
  const buf = readFileSync(path);
  return {
    surfaceId,
    path,
    content: "",
    exists: true,
    size,
    mtimeMs,
    kind: "image",
    imageMime: mime,
    imageDataUri: `data:${mime};base64,${buf.toString("base64")}`,
  };
}

export function readEditorFile(params: {
  surfaceId: string;
  path: string;
  cwd?: string;
  create?: boolean;
  maxBytes?: number;
  /** Position to put the cursor on once the document is mounted.
   *  Carried from a clicked `path:line:col` terminal link; the pane
   *  scrolls it to centre. Ignored for images. */
  line?: number | null;
  column?: number | null;
}): EditorFileSnapshot {
  const path = resolveEditorPath(params.path, params.cwd);
  const maxBytes = params.maxBytes ?? EDITOR_MAX_FILE_BYTES;
  const reveal = {
    revealLine: params.line ?? null,
    revealColumn: params.column ?? null,
  };
  try {
    if (!existsSync(path)) {
      if (!params.create) {
        return {
          surfaceId: params.surfaceId,
          path,
          content: "",
          exists: false,
          size: 0,
          mtimeMs: null,
          error: "File does not exist",
        };
      }
      return {
        surfaceId: params.surfaceId,
        path,
        content: "",
        exists: false,
        size: 0,
        mtimeMs: null,
        kind: "text",
        language: languageForPath(path),
        ...reveal,
      };
    }
    const st = statSync(path);
    if (!st.isFile()) {
      return {
        surfaceId: params.surfaceId,
        path,
        content: "",
        exists: true,
        size: st.size,
        mtimeMs: st.mtimeMs,
        error: "Path is not a file",
      };
    }

    // Classify BEFORE the size check: the text cap and the image cap
    // are different numbers, and a 8 MB PNG is not "too large" just
    // because a source file that size would be.
    const namedMime = imageMimeForPath(path);
    const mime = namedMime ?? sniffImageMime(readFileMagic(path));
    if (mime) {
      return {
        ...readImageSnapshot(params.surfaceId, path, mime, st.size, st.mtimeMs),
        ...reveal,
      };
    }

    if (st.size > maxBytes) {
      return {
        surfaceId: params.surfaceId,
        path,
        content: "",
        exists: true,
        size: st.size,
        mtimeMs: st.mtimeMs,
        tooLarge: true,
        error: `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`,
      };
    }
    const buf = readFileSync(path);
    if (looksBinary(buf)) {
      return {
        surfaceId: params.surfaceId,
        path,
        content: "",
        exists: true,
        size: st.size,
        mtimeMs: st.mtimeMs,
        binary: true,
        error: "Binary files cannot be edited",
      };
    }
    return {
      surfaceId: params.surfaceId,
      path,
      content: buf.toString("utf8"),
      exists: true,
      size: st.size,
      mtimeMs: st.mtimeMs,
      // SVG is source *and* picture. It reads as text — the pane
      // decides which of the two views to show first.
      kind: contentKindForPath(path) === "svg" ? "svg" : "text",
      language: languageForPath(path),
      ...reveal,
    };
  } catch (err) {
    return {
      surfaceId: params.surfaceId,
      path,
      content: "",
      exists: false,
      size: 0,
      mtimeMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** P7 S5 — mtime tolerance for conflict detection. macOS APFS reports
 *  nanosecond mtimes; HFS+ and some network filesystems round to
 *  1 s. The 2 ms slop absorbs Date.now() / statSync rounding drift
 *  on the same write. */
const MTIME_SLOP_MS = 2;

export function saveEditorFile(params: {
  surfaceId: string;
  path: string;
  content: string;
  expectedMtimeMs?: number | null;
  /** P7 S5 — caller is acknowledging a prior conflict and wants to
   *  overwrite anyway. Skips the mtime + new-file race checks but
   *  still goes through the atomic write path. */
  force?: boolean;
}): EditorSaveResult {
  const path = resolveEditorPath(params.path);
  try {
    if (existsSync(path)) {
      const st = statSync(path);
      if (!st.isFile())
        return {
          surfaceId: params.surfaceId,
          path,
          ok: false,
          mtimeMs: st.mtimeMs,
          size: st.size,
          error: "Path is not a file",
        };
      // P7 S5 — surface a structured conflict when the disk mtime
      // disagrees with what the editor had loaded. `force: true`
      // skips the check (user already acknowledged the conflict).
      const hasExpected =
        typeof params.expectedMtimeMs === "number" &&
        params.expectedMtimeMs > 0;
      if (
        !params.force &&
        hasExpected &&
        Math.abs(st.mtimeMs - (params.expectedMtimeMs ?? 0)) > MTIME_SLOP_MS
      ) {
        return {
          surfaceId: params.surfaceId,
          path,
          ok: false,
          mtimeMs: st.mtimeMs,
          size: st.size,
          conflict: true,
          error: "File changed on disk; reload before saving",
          conflictDetail: {
            expectedMtimeMs: params.expectedMtimeMs ?? null,
            actualMtimeMs: st.mtimeMs,
            actualSize: st.size,
          },
        };
      }
    } else if (
      !params.force &&
      params.expectedMtimeMs != null &&
      params.expectedMtimeMs > 0
    ) {
      // The editor loaded a real file with a non-null mtime; if the
      // file no longer exists on disk, that's an out-of-band delete.
      // Surface it instead of silently re-creating.
      return {
        surfaceId: params.surfaceId,
        path,
        ok: false,
        mtimeMs: null,
        size: 0,
        conflict: true,
        error: "File was deleted on disk; reload before saving",
        conflictDetail: {
          expectedMtimeMs: params.expectedMtimeMs,
          actualMtimeMs: 0,
          actualSize: 0,
        },
      };
    }
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(tmp, params.content, "utf8");
    renameSync(tmp, path);
    const next = statSync(path);
    return {
      surfaceId: params.surfaceId,
      path,
      ok: true,
      mtimeMs: next.mtimeMs,
      size: next.size,
    };
  } catch (err) {
    return {
      surfaceId: params.surfaceId,
      path,
      ok: false,
      mtimeMs: null,
      size: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
