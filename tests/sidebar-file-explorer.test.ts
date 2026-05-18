import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isAncestorOrSelf,
  listSidebarFileExplorerDirectory,
} from "../src/bun/sidebar-file-explorer";

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

  // ─── P9 — symlink-cycle protection ────────────────────────────────
  describe("symlink-cycle protection", () => {
    test("symlink to a directory exposes the resolved linkTarget", () => {
      const dir = realpathSync(tempDir());
      mkdirSync(join(dir, "real"));
      writeFileSync(join(dir, "real", "x.txt"), "x");
      symlinkSync(join(dir, "real"), join(dir, "link-to-real"));

      const out = listSidebarFileExplorerDirectory({
        requestId: "r-sym",
        path: dir,
        showHidden: false,
        maxEntries: 50,
      });

      expect(out.error).toBeUndefined();
      const link = out.entries.find((e) => e.name === "link-to-real");
      expect(link).toBeDefined();
      expect(link?.kind).toBe("symlink");
      expect(link?.linkTarget).toBe(realpathSync(join(dir, "real")));
      expect(link?.cycle).toBeUndefined();
    });

    test("symlink pointing back to its own parent dir is flagged cycle=true", () => {
      const dir = realpathSync(tempDir());
      mkdirSync(join(dir, "deep"));
      // deep/loop -> .. (= dir itself)
      symlinkSync(dir, join(dir, "deep", "loop"));

      const out = listSidebarFileExplorerDirectory({
        requestId: "r-cyc-parent",
        path: join(dir, "deep"),
        showHidden: false,
        maxEntries: 50,
      });

      const loop = out.entries.find((e) => e.name === "loop");
      expect(loop?.kind).toBe("symlink");
      expect(loop?.cycle).toBe(true);
    });

    test("symlink pointing to a strict ancestor (grandparent) is also flagged", () => {
      const root = realpathSync(tempDir());
      mkdirSync(join(root, "a"));
      mkdirSync(join(root, "a", "b"));
      // a/b/up -> root  (grandparent of `a/b`)
      symlinkSync(root, join(root, "a", "b", "up"));

      const out = listSidebarFileExplorerDirectory({
        requestId: "r-cyc-anc",
        path: join(root, "a", "b"),
        showHidden: false,
        maxEntries: 50,
      });
      const up = out.entries.find((e) => e.name === "up");
      expect(up?.cycle).toBe(true);
    });

    test("symlink to a sibling (NOT an ancestor) is NOT a cycle", () => {
      const dir = realpathSync(tempDir());
      mkdirSync(join(dir, "a"));
      mkdirSync(join(dir, "b"));
      // a -> b (sibling, no cycle through a's ancestors)
      symlinkSync(join(dir, "b"), join(dir, "a-link-to-b"));

      const out = listSidebarFileExplorerDirectory({
        requestId: "r-sib",
        path: dir,
        showHidden: false,
        maxEntries: 50,
      });
      const link = out.entries.find((e) => e.name === "a-link-to-b");
      expect(link?.kind).toBe("symlink");
      expect(link?.cycle).toBeUndefined();
    });

    test("dangling symlink (target missing) reports linkTarget=null and no cycle", () => {
      const dir = realpathSync(tempDir());
      symlinkSync(join(dir, "does-not-exist"), join(dir, "dangling"));

      const out = listSidebarFileExplorerDirectory({
        requestId: "r-dangle",
        path: dir,
        showHidden: false,
        maxEntries: 50,
      });
      const d = out.entries.find((e) => e.name === "dangling");
      expect(d?.kind).toBe("symlink");
      expect(d?.linkTarget).toBeNull();
      expect(d?.cycle).toBeUndefined();
    });
  });

  describe("isAncestorOrSelf helper", () => {
    test("equal paths count as ancestor-or-self", () => {
      expect(isAncestorOrSelf("/a/b", "/a/b")).toBe(true);
    });

    test("strict ancestor matches", () => {
      expect(isAncestorOrSelf("/a", "/a/b/c")).toBe(true);
    });

    test("prefix-but-not-ancestor does NOT match (path-boundary check)", () => {
      // /foo is NOT an ancestor of /foobar even though one is a string
      // prefix of the other.
      expect(isAncestorOrSelf("/foo", "/foobar")).toBe(false);
    });

    test("sibling paths do not match", () => {
      expect(isAncestorOrSelf("/a/b", "/a/c")).toBe(false);
    });
  });
});
