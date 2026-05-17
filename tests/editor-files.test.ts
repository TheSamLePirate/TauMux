import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readEditorFile,
  resolveEditorPath,
  saveEditorFile,
} from "../src/bun/editor-files";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tau-editor-"));
}

describe("editor file helpers", () => {
  test("resolves relative paths against cwd", () => {
    const dir = tempDir();
    expect(resolveEditorPath("src/a.ts", dir)).toBe(join(dir, "src/a.ts"));
  });

  test("reads text files with language hint", () => {
    const dir = tempDir();
    const path = join(dir, "hello.ts");
    writeFileSync(path, "const x = 1;\n");
    const snap = readEditorFile({ surfaceId: "editor:1", path });
    expect(snap.error).toBeUndefined();
    expect(snap.content).toBe("const x = 1;\n");
    expect(snap.language).toBe("typescript");
    expect(snap.exists).toBe(true);
  });

  test("returns create snapshot for missing files when requested", () => {
    const dir = tempDir();
    const path = join(dir, "new.md");
    const snap = readEditorFile({ surfaceId: "editor:1", path, create: true });
    expect(snap.error).toBeUndefined();
    expect(snap.exists).toBe(false);
    expect(snap.content).toBe("");
    expect(snap.language).toBe("markdown");
  });

  test("detects binary files", () => {
    const dir = tempDir();
    const path = join(dir, "blob.bin");
    writeFileSync(path, Buffer.from([0, 1, 2, 3, 4]));
    const snap = readEditorFile({ surfaceId: "editor:1", path });
    expect(snap.binary).toBe(true);
    expect(snap.error).toContain("Binary");
  });

  test("saves atomically and reports conflicts", () => {
    const dir = tempDir();
    const path = join(dir, "file.txt");
    writeFileSync(path, "one");
    const snap = readEditorFile({ surfaceId: "editor:1", path });
    const ok = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "two",
      expectedMtimeMs: snap.mtimeMs,
    });
    expect(ok.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("two");
    const conflict = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "three",
      expectedMtimeMs: 1,
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.conflict).toBe(true);

    const forced = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "three",
      expectedMtimeMs: null,
    });
    expect(forced.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("three");
  });

  // ──────────────────────────────────────────────────────────────────
  // P7 S5 — save-race UX
  // ──────────────────────────────────────────────────────────────────

  test("conflictDetail carries expected vs actual mtime + actual size", () => {
    const dir = tempDir();
    const path = join(dir, "raced.txt");
    writeFileSync(
      path,
      "disk version that's longer than the editor knew about",
    );
    const res = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "stale editor content",
      // Mtime far in the past — definitely outside the slop window.
      expectedMtimeMs: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.conflictDetail).toBeDefined();
    expect(res.conflictDetail!.expectedMtimeMs).toBe(1000);
    expect(res.conflictDetail!.actualMtimeMs).toBeGreaterThan(1000);
    expect(res.conflictDetail!.actualSize).toBeGreaterThan(0);
  });

  test("force: true bypasses the mtime check and overwrites the disk file", () => {
    const dir = tempDir();
    const path = join(dir, "forced.txt");
    writeFileSync(path, "disk version");
    const res = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "user override",
      expectedMtimeMs: 1, // would normally conflict
      force: true,
    });
    expect(res.ok).toBe(true);
    expect(res.conflict).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe("user override");
  });

  test("save into a deleted file with a non-null expectedMtimeMs surfaces a conflict (not a silent re-create)", () => {
    const dir = tempDir();
    const path = join(dir, "vanished.txt");
    // We never write the file — simulate an out-of-band delete by
    // passing an expectedMtimeMs as if the editor had loaded one.
    const res = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "would clobber",
      expectedMtimeMs: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.error).toContain("deleted on disk");
    expect(res.conflictDetail).toBeDefined();
    expect(res.conflictDetail!.actualMtimeMs).toBe(0);
  });

  test("save into a brand-new file with no expectedMtimeMs is NOT a conflict", () => {
    const dir = tempDir();
    const path = join(dir, "new.txt");
    const res = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "first content",
      expectedMtimeMs: null,
    });
    expect(res.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("first content");
  });

  test("force: true on a deleted file re-creates without complaining", () => {
    const dir = tempDir();
    const path = join(dir, "recreate.txt");
    const res = saveEditorFile({
      surfaceId: "editor:1",
      path,
      content: "back from the dead",
      expectedMtimeMs: 1000,
      force: true,
    });
    expect(res.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("back from the dead");
  });
});
