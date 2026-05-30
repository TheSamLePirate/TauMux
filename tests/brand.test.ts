// W (full_app_review_2026-05.md §20.1 / H0j) — brand-string consolidation.
// Locks the LOAD-BEARING identifiers so a careless rename trips here instead
// of silently orphaning user state / OS registrations, and pins the
// user-facing rename fixes.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISPLAY_NAME,
  CONFIG_DIR_NAME,
  LOG_DIR_NAME,
  SOCKET_BASENAME,
  BUNDLE_IDENTIFIER,
  RPC_PROTOCOL,
} from "../src/shared/brand";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("brand identifiers", () => {
  test("load-bearing values are pinned (rename needs a migration)", () => {
    // Changing any of these without a migration orphans existing user state
    // / OS registrations — see src/shared/brand.ts. The pin makes that a
    // deliberate, test-breaking decision.
    expect(CONFIG_DIR_NAME).toBe("hyperterm-canvas");
    expect(SOCKET_BASENAME).toBe("hyperterm.sock");
    expect(BUNDLE_IDENTIFIER).toBe("dev.hyperterm.canvas");
    expect(RPC_PROTOCOL).toBe("hyperterm-socket");
    expect(LOG_DIR_NAME).toBe("tau-mux");
    expect(DISPLAY_NAME).toBe("τ-mux");
  });

  test("electrobun bundle identifier stays in sync with brand.ts", () => {
    expect(read("electrobun.config.ts")).toContain(
      `identifier: "${BUNDLE_IDENTIFIER}"`,
    );
  });

  test("the ht CLI no longer prints the old product name to users", () => {
    const ht = read("bin/ht");
    expect(ht).not.toContain("HyperTerm Canvas");
    expect(ht).toContain("τ-mux is not running.");
  });

  test("config dir + socket are wired from brand constants, not literals", () => {
    const index = read("src/bun/index.ts");
    expect(index).toContain("CONFIG_DIR_NAME");
    expect(index).toContain("SOCKET_BASENAME");
    // No stray inline literal for the config dir name in index.ts.
    expect(index).not.toContain('"hyperterm-canvas")');
  });
});
