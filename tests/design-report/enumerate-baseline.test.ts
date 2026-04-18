import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  enumerateBaselineShots,
  parseBaselineFilename,
} from "../../src/design-report/enumerate-baseline";

function tinyPng(): Buffer {
  return PNG.sync.write(new PNG({ width: 1, height: 1 }));
}

describe("enumerateBaselineShots", () => {
  test("missing root → empty array", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-"));
    const res = enumerateBaselineShots(join(dir, "nope"));
    expect(res).toEqual([]);
  });

  test("lists PNGs under web/ and native/, ignores foo/", () => {
    const root = mkdtempSync(join(tmpdir(), "baseline-"));
    mkdirSync(join(root, "web"), { recursive: true });
    mkdirSync(join(root, "native"), { recursive: true });
    mkdirSync(join(root, "foo"), { recursive: true });
    const buf = tinyPng();
    writeFileSync(join(root, "web", "a-b-c.png"), buf);
    writeFileSync(join(root, "native", "x-y-z.png"), buf);
    writeFileSync(join(root, "foo", "ignored.png"), buf);
    writeFileSync(join(root, "web", "not-a-png.txt"), "x");
    const res = enumerateBaselineShots(root)
      .map((r) => r.key)
      .sort();
    expect(res).toEqual(["native::x-y-z", "web::a-b-c"]);
  });
});

describe("parseBaselineFilename", () => {
  test("extracts key + display fields", () => {
    const p = parseBaselineFilename("web", "components-toolbar-default.png")!;
    expect(p.key).toBe("web::components-toolbar-default");
    expect(p.shot.slug).toBe("components-toolbar-default");
  });

  test("rejects non-PNG", () => {
    expect(parseBaselineFilename("web", "foo.txt")).toBeNull();
  });
});
