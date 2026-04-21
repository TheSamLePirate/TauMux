import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
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
});
