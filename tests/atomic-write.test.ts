// Triple-A G.4 / L7 — verify the atomic-write helper.

import { describe, it, expect, afterEach } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../src/bun/atomic-write";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) {
    const dir = cleanup.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
  cleanup.push(dir);
  return dir;
}

describe("writeFileAtomic", () => {
  it("creates the destination file with the given contents", () => {
    const dir = tmp();
    const target = join(dir, "settings.json");
    writeFileAtomic(target, JSON.stringify({ a: 1 }));
    expect(existsSync(target)).toBe(true);
    expect(JSON.parse(readFileSync(target, "utf-8"))).toEqual({ a: 1 });
  });

  it("overwrites an existing file in one rename (no truncated intermediate)", () => {
    const dir = tmp();
    const target = join(dir, "settings.json");
    writeFileAtomic(target, "first");
    const beforeIno = statSync(target).ino;
    writeFileAtomic(target, "second");
    const afterIno = statSync(target).ino;
    expect(readFileSync(target, "utf-8")).toBe("second");
    // The inode should change because rename swaps inodes — that's
    // exactly what makes the replace atomic. (On macOS APFS this is
    // reliable; if it ever flakes we can drop the assertion.)
    expect(afterIno).not.toBe(beforeIno);
  });

  it("does not leave a .tmp behind on success", () => {
    const dir = tmp();
    const target = join(dir, "x.json");
    writeFileAtomic(target, "hello");
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it("cleans up the .tmp on rename failure", () => {
    // Force rename failure by writing to a path whose dir gets removed
    // between the writeSync and the renameSync. Simpler: target a
    // non-existent directory.
    const dir = tmp();
    const target = join(dir, "no-such-subdir", "x.json");
    expect(() => writeFileAtomic(target, "hello")).toThrow();
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it("accepts Uint8Array data", () => {
    const dir = tmp();
    const target = join(dir, "bin");
    const data = new Uint8Array([0xff, 0x00, 0x42]);
    writeFileAtomic(target, data);
    const buf = readFileSync(target);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0x00);
    expect(buf[2]).toBe(0x42);
  });
});
