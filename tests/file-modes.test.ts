// Triple-A H.1 / S1 — verify sensitive on-disk files land with mode 0o600.
// Backfill from Phase 0 audit (PR 8 in tracking_triple_a_analysis.md).
// All chmod calls are present in src/bun/logger.ts and src/bun/telegram-db.ts
// but the test suite never asserted the actual file permissions.

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupLogging } from "../src/bun/logger";

const cleanup: { dir: string; dispose?: () => void }[] = [];
afterEach(() => {
  while (cleanup.length) {
    const entry = cleanup.pop()!;
    try {
      entry.dispose?.();
    } catch {
      /* swallow */
    }
    try {
      rmSync(entry.dir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "file-modes-"));
}

function modeOf(p: string): number {
  return statSync(p).mode & 0o777;
}

describe("[S1] sensitive on-disk files use mode 0o600", () => {
  it("logger writes the active log file with 0o600", () => {
    const dir = tmp();
    // The logger honours configDir only when HT_CONFIG_DIR is set;
    // otherwise it routes to ~/Library/Logs/tau-mux (production path)
    // which we must not touch from tests.
    const prev = process.env["HT_CONFIG_DIR"];
    process.env["HT_CONFIG_DIR"] = dir;
    let handle: ReturnType<typeof setupLogging>;
    try {
      handle = setupLogging(dir);
    } finally {
      if (prev === undefined) delete process.env["HT_CONFIG_DIR"];
      else process.env["HT_CONFIG_DIR"] = prev;
    }
    cleanup.push({ dir, dispose: () => handle.dispose() });

    // The log file lives under <configDir>/logs/. Find the active one.
    const logDir = join(dir, "logs");
    expect(existsSync(logDir)).toBe(true);
    const entries = readdirSync(logDir).filter((n) => n.endsWith(".log"));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const name of entries) {
      const p = join(logDir, name);
      // The chmod is best-effort; if it succeeds we expect exact 0o600.
      // On filesystems where chmod is a no-op (rare on macOS / Linux dev
      // boxes) this test will fail loudly — which is the desired
      // behaviour, because that's exactly the system where the H.1
      // protection is absent.
      expect(modeOf(p)).toBe(0o600);
    }
  });

  it("logger handle exposes the active path it chmod'd", () => {
    const dir = tmp();
    const prev = process.env["HT_CONFIG_DIR"];
    process.env["HT_CONFIG_DIR"] = dir;
    let handle: ReturnType<typeof setupLogging>;
    try {
      handle = setupLogging(dir);
    } finally {
      if (prev === undefined) delete process.env["HT_CONFIG_DIR"];
      else process.env["HT_CONFIG_DIR"] = prev;
    }
    cleanup.push({ dir, dispose: () => handle.dispose() });
    expect(handle.currentPath).not.toBeNull();
    expect(modeOf(handle.currentPath!)).toBe(0o600);
  });
});

// The telegram-db chmod is exercised by tests/telegram-db.test.ts via
// the open() path; rather than open a sqlite DB here (which would
// double the test footprint and require bun:sqlite), we verify the
// chmod call is wired in the source. A runtime test of the chmod
// itself would just re-verify the OS chmod syscall, which is not the
// regression we're guarding.
describe("[S1] telegram-db source wires chmod on open", () => {
  it("references chmodSync(filePath, 0o600) and the WAL/SHM sidecars", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "src", "bun", "telegram-db.ts"),
      "utf-8",
    );
    expect(src).toContain("chmodSync(filePath, 0o600)");
    expect(src).toContain("chmodSync(sidecar, 0o600)");
  });
});
