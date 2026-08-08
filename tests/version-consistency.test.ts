/**
 * The version string is hard-coded in several files that `bun run bump:*`
 * stamps together. Nothing stopped them drifting apart if a bump was
 * interrupted, a merge resolved one side, or a new copy was added without
 * teaching the script about it — and a wrong `TERM_PROGRAM_VERSION` is
 * the kind of lie a program only notices when it decides we are too old
 * for a feature.
 *
 * Pin the copies to each other so a partial bump fails CI.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "../src/shared/brand";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("version consistency", () => {
  test("APP_VERSION matches package.json", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  test("APP_VERSION matches the system.version RPC constant", () => {
    const m = read("src/bun/rpc-handlers/system.ts").match(
      /const VERSION\s*=\s*"([^"]+)"/,
    );
    expect(m?.[1]).toBe(APP_VERSION);
  });

  test("APP_VERSION matches the packaged bundle version", () => {
    const m = read("electrobun.config.ts").match(/\n\s+version:\s*"([^"]+)"/);
    expect(m?.[1]).toBe(APP_VERSION);
  });

  test("looks like a semver", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("bump-version.ts still knows how to stamp brand.ts", () => {
    // The stamper matches by regex; if the declaration is reshaped
    // (e.g. `export const APP_VERSION: string = …`) the script throws at
    // release time. Fail here instead, where it is cheap to fix.
    const bump = read("scripts/bump-version.ts");
    expect(bump).toContain("updateBrand");
    const decl = read("src/shared/brand.ts");
    expect(decl).toMatch(/export const APP_VERSION\s*=\s*"[^"]+"/);
  });
});
