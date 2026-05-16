import { dirname, isAbsolute, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { EditorFileSnapshot, EditorSaveResult } from "../shared/types";

export const EDITOR_MAX_FILE_BYTES = 5 * 1024 * 1024;

export function resolveEditorPath(path: string, cwd?: string): string {
  const base = cwd && isAbsolute(cwd) ? cwd : process.cwd();
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
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
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".sass")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  return "text";
}

export function readEditorFile(params: {
  surfaceId: string;
  path: string;
  cwd?: string;
  create?: boolean;
  maxBytes?: number;
}): EditorFileSnapshot {
  const path = resolveEditorPath(params.path, params.cwd);
  const maxBytes = params.maxBytes ?? EDITOR_MAX_FILE_BYTES;
  try {
    if (!existsSync(path)) {
      if (!params.create) {
        return { surfaceId: params.surfaceId, path, content: "", exists: false, size: 0, mtimeMs: null, error: "File does not exist" };
      }
      return { surfaceId: params.surfaceId, path, content: "", exists: false, size: 0, mtimeMs: null, language: languageForPath(path) };
    }
    const st = statSync(path);
    if (!st.isFile()) {
      return { surfaceId: params.surfaceId, path, content: "", exists: true, size: st.size, mtimeMs: st.mtimeMs, error: "Path is not a file" };
    }
    if (st.size > maxBytes) {
      return { surfaceId: params.surfaceId, path, content: "", exists: true, size: st.size, mtimeMs: st.mtimeMs, tooLarge: true, error: `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB` };
    }
    const buf = readFileSync(path);
    if (looksBinary(buf)) {
      return { surfaceId: params.surfaceId, path, content: "", exists: true, size: st.size, mtimeMs: st.mtimeMs, binary: true, error: "Binary files cannot be edited" };
    }
    return { surfaceId: params.surfaceId, path, content: buf.toString("utf8"), exists: true, size: st.size, mtimeMs: st.mtimeMs, language: languageForPath(path) };
  } catch (err) {
    return { surfaceId: params.surfaceId, path, content: "", exists: false, size: 0, mtimeMs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export function saveEditorFile(params: {
  surfaceId: string;
  path: string;
  content: string;
  expectedMtimeMs?: number | null;
}): EditorSaveResult {
  const path = resolveEditorPath(params.path);
  try {
    if (existsSync(path)) {
      const st = statSync(path);
      if (!st.isFile()) return { surfaceId: params.surfaceId, path, ok: false, mtimeMs: st.mtimeMs, size: st.size, error: "Path is not a file" };
      if (params.expectedMtimeMs != null && Math.abs(st.mtimeMs - params.expectedMtimeMs) > 2) {
        return { surfaceId: params.surfaceId, path, ok: false, mtimeMs: st.mtimeMs, size: st.size, conflict: true, error: "File changed on disk; reload before saving" };
      }
    }
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(tmp, params.content, "utf8");
    renameSync(tmp, path);
    const next = statSync(path);
    return { surfaceId: params.surfaceId, path, ok: true, mtimeMs: next.mtimeMs, size: next.size };
  } catch (err) {
    return { surfaceId: params.surfaceId, path, ok: false, mtimeMs: null, size: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
