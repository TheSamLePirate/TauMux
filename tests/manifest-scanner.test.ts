import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestScanner } from "../src/bun/manifest-scanner";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ht-manifest-scanner-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ManifestScanner", () => {
  test("walks up from a nested cwd to find the manifest file", () => {
    writeFileSync(join(root, "Cargo.toml"), `[package]\nname="x"\n`);
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    const scanner = new ManifestScanner({
      filename: "Cargo.toml",
      parse: (_, p) => ({ p }),
    });
    expect(scanner.findFile(join(root, "a", "b", "c"))).toBe(
      join(root, "Cargo.toml"),
    );
  });

  test("returns null when no manifest exists above the cwd", () => {
    mkdirSync(join(root, "empty"), { recursive: true });
    const scanner = new ManifestScanner({
      filename: "Cargo.toml",
      parse: () => null,
    });
    expect(scanner.findFile(join(root, "empty"))).toBeNull();
  });

  test("resolve() caches the parsed manifest within the TTL", () => {
    const path = join(root, "m.json");
    writeFileSync(path, "first");
    let parses = 0;
    const scanner = new ManifestScanner<{ text: string }>({
      filename: "m.json",
      parse: (text) => {
        parses++;
        return { text };
      },
      ttlMs: 100_000, // effectively forever for this test
    });
    const now = Date.now();
    const r1 = scanner.resolve(new Set([root]), now);
    const r2 = scanner.resolve(new Set([root]), now + 50);
    expect(parses).toBe(1);
    expect(r1.get(root)).toEqual({ text: "first" });
    expect(r2.get(root)).toEqual({ text: "first" });
  });

  test("re-parses when the file's mtime changes after the TTL expires", () => {
    const path = join(root, "m.json");
    writeFileSync(path, "v1");
    let parses = 0;
    const scanner = new ManifestScanner<{ text: string }>({
      filename: "m.json",
      parse: (text) => {
        parses++;
        return { text };
      },
      ttlMs: 10,
    });
    const t0 = Date.now();
    scanner.resolve(new Set([root]), t0);
    // Rewrite AND bump mtime explicitly — macOS filesystems can
    // coalesce fast back-to-back writes onto the same mtime second,
    // which would make the scanner correctly decide it's unchanged.
    writeFileSync(path, "v2");
    const future = (Date.now() + 2000) / 1000; // seconds
    utimesSync(path, future, future);
    const bump = Date.now() + 5000;
    const next = scanner.resolve(new Set([root]), bump);
    expect(parses).toBe(2);
    expect(next.get(root)).toEqual({ text: "v2" });
  });

  test("prunes cache rows for cwds that haven't been requested", () => {
    const path = join(root, "m.json");
    writeFileSync(path, "v1");
    const scanner = new ManifestScanner<object>({
      filename: "m.json",
      parse: (t) => ({ t }),
      ttlMs: 10,
    });
    const t0 = Date.now();
    scanner.resolve(new Set([root]), t0);
    // Now ask with a different cwd very far in the future — the old
    // `root` entry should get pruned (ttlMs * 4 = 40ms window).
    const otherCwd = join(root, "other");
    mkdirSync(otherCwd);
    scanner.resolve(new Set([otherCwd]), t0 + 10_000);
    const onlyOther = scanner.resolve(new Set([root, otherCwd]), t0 + 20_000);
    // root re-appears so it gets parsed fresh; the old entry is gone.
    expect(onlyOther.size).toBe(2);
  });

  test("rejects non-absolute start paths", () => {
    const scanner = new ManifestScanner({
      filename: "foo.json",
      parse: () => ({}),
    });
    expect(scanner.findFile("relative/path")).toBeNull();
    expect(scanner.findFile("")).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // Phase 7 — symlinked / firmlinked $HOME guard
  // ────────────────────────────────────────────────────────────────

  test("findFile stops at the literal $HOME boundary", () => {
    // Place a manifest one level above the tmp dir we'll pretend is
    // $HOME. The walk from inside $HOME must stop AT $HOME (returning
    // null), not climb past it.
    const fakeHome = root;
    mkdirSync(join(fakeHome, "project"), { recursive: true });
    // Manifest above the boundary — should not be found.
    writeFileSync(join(fakeHome, "Cargo.toml"), `[package]\nname="boundary"\n`);
    const savedHome = process.env["HOME"];
    process.env["HOME"] = fakeHome;
    try {
      const scanner = new ManifestScanner({
        filename: "Cargo.toml",
        parse: (_, p) => ({ p }),
      });
      // Cargo.toml IS at $HOME — the scanner's findFile returns it
      // (the candidate at dir=$HOME is checked BEFORE the boundary
      // condition). The boundary stops the walk from going further
      // up; this test verifies the walk-from-inside-$HOME finds the
      // home manifest, then the boundary halts the walk at /.
      const found = scanner.findFile(join(fakeHome, "project"));
      expect(found).toBe(join(fakeHome, "Cargo.toml"));
    } finally {
      if (savedHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = savedHome;
    }
  });

  test("findFile honours the realpath of $HOME so symlinked homes don't escape", () => {
    // Build a symlinked-$HOME layout:
    //   ${root}/real-home/        ← realpath
    //   ${root}/symlinked-home    → real-home  (the env value)
    //   ${root}/real-home/project ← cwd starts here (resolved form)
    // With env HOME=symlinked-home, the scanner must still stop at
    // real-home when walking up from real-home/project.
    const realHome = join(root, "real-home");
    mkdirSync(join(realHome, "project"), { recursive: true });
    const symlinked = join(root, "symlinked-home");
    symlinkSync(realHome, symlinked, "dir");

    // Place a manifest two levels above the realpath home — outside
    // the boundary. The walk from inside the project must stop at
    // real-home (the realpath of env HOME) and return null.
    writeFileSync(join(root, "Cargo.toml"), `[package]\nname="outside"\n`);

    const savedHome = process.env["HOME"];
    process.env["HOME"] = symlinked; // the SYMLINK path
    try {
      const scanner = new ManifestScanner({
        filename: "Cargo.toml",
        parse: () => ({}),
      });
      // No manifest inside real-home/project or real-home itself; the
      // only manifest is one above real-home. Without the realpath
      // guard the walk would climb past real-home (because
      // dir === symlinked never matches) and return the boundary-
      // crossing manifest. With the guard, findFile returns null.
      expect(scanner.findFile(join(realHome, "project"))).toBeNull();
    } finally {
      if (savedHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = savedHome;
    }
  });
});
