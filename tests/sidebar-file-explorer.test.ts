import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSidebarFileExplorerDirectory } from "../src/bun/sidebar-file-explorer";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tau-sidebar-files-"));
}

describe("sidebar file explorer listing", () => {
  test("sorts directories before files and hides noisy folders", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "README.md"), "hello");
    writeFileSync(join(dir, ".env"), "secret");

    const out = listSidebarFileExplorerDirectory({
      requestId: "r1",
      path: dir,
      showHidden: false,
      maxEntries: 50,
    });

    expect(out.error).toBeUndefined();
    expect(out.entries.map((e) => e.name)).toEqual(["src", "README.md"]);
    expect(out.entries[0]?.kind).toBe("directory");
    expect(out.entries[1]?.kind).toBe("file");
    expect(out.totalEntries).toBe(4);
    expect(out.hiddenExcluded).toBe(1);
    expect(out.ignoredExcluded).toBe(1);
  });

  test("can show dotfiles and caps entries", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".env"), "secret");
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(dir, `file-${i}.txt`), "x");
    }

    const out = listSidebarFileExplorerDirectory({
      requestId: "r2",
      path: dir,
      showHidden: true,
      maxEntries: 20,
    });

    expect(out.truncated).toBe(true);
    expect(out.entries).toHaveLength(20);
    expect(out.entries.some((e) => e.name === ".env")).toBe(true);
    expect(out.hiddenExcluded).toBe(0);
    expect(out.totalEntries).toBe(26);
  });

  test("returns structured errors for non-directories", () => {
    const dir = tempDir();
    const file = join(dir, "file.txt");
    writeFileSync(file, "x");

    const out = listSidebarFileExplorerDirectory({
      requestId: "r3",
      path: file,
      showHidden: false,
      maxEntries: 50,
    });

    expect(out.entries).toEqual([]);
    expect(out.error).toContain("not a directory");
  });
});
