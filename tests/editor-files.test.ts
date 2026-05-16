import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEditorFile, resolveEditorPath, saveEditorFile } from "../src/bun/editor-files";

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
    const ok = saveEditorFile({ surfaceId: "editor:1", path, content: "two", expectedMtimeMs: snap.mtimeMs });
    expect(ok.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("two");
    const conflict = saveEditorFile({ surfaceId: "editor:1", path, content: "three", expectedMtimeMs: 1 });
    expect(conflict.ok).toBe(false);
    expect(conflict.conflict).toBe(true);

    const forced = saveEditorFile({ surfaceId: "editor:1", path, content: "three", expectedMtimeMs: null });
    expect(forced.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("three");
  });
});
