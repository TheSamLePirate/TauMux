// Phase 6 — gate `tests/regressions/README.md` against the live test
// suite. Every test name listed in the catalogue's "Regression test"
// column must appear in a real `*.test.ts` file under `tests/`.
//
// Catches three regression classes:
//   1. Removing a test without updating the catalogue.
//   2. Catalogue rows with typos or fabricated test names.
//   3. Renaming a test without sweeping the README.
//
// A new triple-A fix that lands without a catalogue row is NOT caught
// by this gate (intentional — humans review the PR), but the inverse
// (a row pointing at a non-existent test) IS caught.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const CATALOGUE = join(ROOT, "tests/regressions/README.md");
const TESTS_DIR = join(ROOT, "tests");

interface CatalogueRow {
  /** Triple-A id ("L1", "S2", etc.). Used in error messages. */
  id: string;
  /** Cell text from the "Regression test" column. */
  cell: string;
}

/** Walk `tests/` and concatenate every *.test.ts body into a single
 *  string. We don't try to parse — just substring-search. */
function loadAllTestBodies(): string {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) {
        walk(p);
      } else if (
        s.isFile() &&
        (p.endsWith(".test.ts") || p.endsWith(".test.tsx"))
      ) {
        out.push(readFileSync(p, "utf-8"));
      }
    }
  }
  walk(TESTS_DIR);
  return out.join("\n----TESTFILE----\n");
}

/** Parse the catalogue. Each table row is `| id | summary | fix | test |`.
 *  We pull rows whose id matches one of the documented prefixes and
 *  return the id + the raw test cell. */
function parseCatalogue(md: string): CatalogueRow[] {
  const rows: CatalogueRow[] = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // Header / separator rows.
    if (cells.length < 5) continue;
    const id = cells[1];
    const testCell = cells[4];
    // Skip the header row (id="Id") and the alignment row (id="---").
    if (!id || id === "Id" || /^-+$/.test(id)) continue;
    if (!testCell) continue;
    rows.push({ id, cell: testCell });
  }
  return rows;
}

/** Pull `test name strings` out of a catalogue cell. Markdown form:
 *  `"foo bar"` or just paths to a test file. We look for any
 *  double-quoted substrings. */
function extractQuotedNames(cell: string): string[] {
  return [...cell.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const TEST_BODIES = loadAllTestBodies();
const CATALOGUE_MD = readFileSync(CATALOGUE, "utf-8");

describe("[Phase 6] tests/regressions/README.md — catalogue gate", () => {
  it("the catalogue file exists and is non-empty", () => {
    expect(CATALOGUE_MD.length).toBeGreaterThan(1000);
    expect(CATALOGUE_MD).toContain("Lifecycle (L#)");
    expect(CATALOGUE_MD).toContain("Security (S#)");
  });

  it("every catalogued test name resolves to a real test", () => {
    const rows = parseCatalogue(CATALOGUE_MD);
    expect(rows.length).toBeGreaterThanOrEqual(20);
    const missing: { id: string; name: string }[] = [];
    for (const row of rows) {
      for (const name of extractQuotedNames(row.cell)) {
        if (!TEST_BODIES.includes(name)) {
          missing.push({ id: row.id, name });
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Catalogue rows referencing non-existent tests:\n` +
          missing.map((m) => `  ${m.id}: "${m.name}"`).join("\n"),
      );
    }
  });

  it("catalogue covers at least the core L/S/U/A ids documented in triple_a_analysis.md", () => {
    // Anchor the floor — these are the ids we've already addressed
    // through Phases 0–6. Catalogue rows are keyed by id in the first
    // column. A future drop of any of these IDs (e.g. someone removes
    // the L1 row to silence the gate) fails this test.
    const required = [
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
      "L6",
      "L7",
      "S1",
      "S2",
      "S4",
      "S5",
      "S6",
      "S11",
      "U1",
      "U2",
      "U12",
      "A1",
      "A2",
      "A13",
      "T1",
    ];
    const rows = parseCatalogue(CATALOGUE_MD);
    const ids = new Set(rows.map((r) => r.id));
    const missing = required.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });
});
