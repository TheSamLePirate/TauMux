// Triple-A G.9 / L14 — verify the telegram-db opens with a non-zero
// PRAGMA busy_timeout so a concurrent reader doesn't get SQLITE_BUSY
// immediately when the long-poll loop writes. Backfill from Phase 0
// audit (PR 18).
//
// A live concurrent-read/write test would require opening two
// Database instances against the same file and timing a forced
// contention window — flaky and slow. The fix is a single PRAGMA
// call; pin it via source inspection.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "telegram-db.ts"),
  "utf-8",
);

describe("[L14] telegram-db PRAGMA busy_timeout", () => {
  it("sets PRAGMA busy_timeout to 5000ms on open", () => {
    expect(SRC).toMatch(/PRAGMA busy_timeout\s*=\s*5000/);
  });

  it("sets the PRAGMA via db.exec inside the constructor", () => {
    // The PRAGMA must run on the same Database instance that the rest
    // of the class uses — a future refactor that moves the PRAGMA into
    // a helper called only sometimes would silently regress.
    const ctorBody = SRC.match(
      /constructor\(filePath: string\)\s*\{[\s\S]*?\n\s{2}\}/,
    );
    expect(ctorBody).not.toBeNull();
    expect(ctorBody![0]).toMatch(/db\.exec\(["']PRAGMA busy_timeout/);
  });

  it("also enables WAL journal mode (concurrent reader prereq)", () => {
    // busy_timeout alone is not enough; WAL is what lets readers and
    // writers proceed in parallel under SQLite. The fix relies on
    // both — pinning WAL here prevents a future "let's go back to
    // DELETE journal mode" regression that would re-create the
    // serialization stall.
    expect(SRC).toMatch(/PRAGMA journal_mode\s*=\s*WAL/);
  });
});
