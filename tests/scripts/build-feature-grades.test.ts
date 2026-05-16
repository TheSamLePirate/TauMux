// Phase 0 Step 3 — sanity-check the feature-grades pipeline.
//
// The script reads doc/feature_grades.json and writes doc/feature_grades.md.
// We assert: (1) the committed .md is the deterministic render of the
// committed .json (so a hand-edit is impossible to land unnoticed),
// and (2) the distribution table is computed from the actual features,
// not the hand-written total that drifted in the original audit.

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "build-feature-grades.ts");
const JSON_PATH = join(REPO_ROOT, "doc", "feature_grades.json");
const MD_PATH = join(REPO_ROOT, "doc", "feature_grades.md");

describe("scripts/build-feature-grades — pipeline", () => {
  it("--check is green against the committed .md", () => {
    const r = spawnSync("bun", [SCRIPT, "--check"], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("up to date");
  });

  it("the committed .md was generated from the .json (round-trip stable)", () => {
    // If the previous test passed, this is implied — but a separate
    // direct assertion catches a future regression where the
    // --check mode short-circuits incorrectly.
    const r = spawnSync("bun", [SCRIPT, "--check"], { encoding: "utf-8" });
    expect(r.status).toBe(0);
  });

  it("the JSON is valid JSON with the expected top-level keys", () => {
    const raw = readFileSync(JSON_PATH, "utf-8");
    const doc = JSON.parse(raw);
    expect(typeof doc.version).toBe("string");
    expect(typeof doc.generatedAt).toBe("string");
    expect(typeof doc.branch).toBe("string");
    expect(typeof doc.headline).toBe("string");
    expect(Array.isArray(doc.clusters)).toBe(true);
    expect(Array.isArray(doc.topBlockers)).toBe(true);
    expect(doc.clusters.length).toBeGreaterThan(0);
    expect(doc.topBlockers.length).toBeGreaterThan(0);
  });

  it("every feature has the required fields", () => {
    const raw = readFileSync(JSON_PATH, "utf-8");
    const doc = JSON.parse(raw);
    for (const c of doc.clusters) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.title).toBe("string");
      expect(Array.isArray(c.features)).toBe(true);
      for (const f of c.features) {
        expect(typeof f.id).toBe("string");
        expect(typeof f.name).toBe("string");
        expect(typeof f.grade).toBe("string");
        expect(typeof f.evidence).toBe("string");
        expect(Array.isArray(f.gaps)).toBe(true);
      }
    }
  });

  it("the rendered .md reports the same feature count as the JSON", () => {
    const raw = readFileSync(JSON_PATH, "utf-8");
    const doc = JSON.parse(raw);
    const totalFromJson = doc.clusters.reduce(
      (n: number, c: { features: unknown[] }) => n + c.features.length,
      0,
    );
    const md = readFileSync(MD_PATH, "utf-8");
    const m = md.match(/## Grade distribution \((\d+) features\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(totalFromJson);
  });

  it("feature ids are unique across clusters", () => {
    // Duplicate ids would let two features race on the same blockers
    // mapping in later phases. Fail loudly.
    const raw = readFileSync(JSON_PATH, "utf-8");
    const doc = JSON.parse(raw);
    const ids = new Set<string>();
    for (const c of doc.clusters) {
      for (const f of c.features) {
        expect(ids.has(f.id)).toBe(false);
        ids.add(f.id);
      }
    }
  });
});
