import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  indexManifest,
  readManifest,
  writeManifest,
} from "../../src/design-report/manifest";
import {
  parseNewAllowed,
  readNewAllowed,
} from "../../src/design-report/new-allowed";
import type { Manifest } from "../../src/design-report/types";

function newTmp(): string {
  return mkdtempSync(join(tmpdir(), "design-report-test-"));
}

describe("manifest I/O", () => {
  test("round-trips", () => {
    const dir = newTmp();
    const path = join(dir, "manifest.json");
    const m: Manifest = {
      generatedAt: "2024-06-01T00:00:00Z",
      shots: [
        {
          key: "web::a-b-c",
          suite: "web",
          slug: "a-b-c",
          test: "t",
          step: "c",
          width: 10,
          height: 10,
        },
      ],
    };
    writeManifest(path, m);
    const read = readManifest(path)!;
    expect(read.shots).toHaveLength(1);
    expect(indexManifest(read).get("web::a-b-c")!.step).toBe("c");
  });

  test("missing file → null", () => {
    const dir = newTmp();
    expect(readManifest(join(dir, "nope.json"))).toBeNull();
  });

  test("malformed file → null", () => {
    const dir = newTmp();
    const p = join(dir, "m.json");
    writeFileSync(p, "{not valid json");
    expect(readManifest(p)).toBeNull();
  });
});

describe(".new-allowed parsing", () => {
  test("one key per line", () => {
    const s = parseNewAllowed("web::foo\nnative::bar\n");
    expect(s.has("web::foo")).toBe(true);
    expect(s.has("native::bar")).toBe(true);
    expect(s.size).toBe(2);
  });

  test("blank lines + comments stripped", () => {
    const s = parseNewAllowed(
      "# header comment\n" +
        "\n" +
        "web::foo   # inline comment\n" +
        "  native::bar  \n",
    );
    expect([...s].sort()).toEqual(["native::bar", "web::foo"]);
  });

  test("readNewAllowed: missing file → empty set", () => {
    const dir = newTmp();
    expect(readNewAllowed(join(dir, "nope")).size).toBe(0);
  });
});
