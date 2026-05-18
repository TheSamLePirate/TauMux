// Logger tee: verify stdout/stderr wrapping, daily filename format,
// boot banner, and retention pruning. Uses HT_CONFIG_DIR so all writes
// land in a throwaway tmp dir — never touches ~/Library/Logs.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setupLogging } from "../src/bun/logger";

let tmpRoot: string;
let origConfigDir: string | undefined;

beforeEach(() => {
  tmpRoot = join(
    tmpdir(),
    `taumux-logger-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpRoot, { recursive: true });
  origConfigDir = process.env["HT_CONFIG_DIR"];
  process.env["HT_CONFIG_DIR"] = tmpRoot;
});

afterEach(() => {
  if (origConfigDir === undefined) delete process.env["HT_CONFIG_DIR"];
  else process.env["HT_CONFIG_DIR"] = origConfigDir;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("setupLogging", () => {
  test("creates `$HT_CONFIG_DIR/logs/app-YYYY-MM-DD.log` when HT_CONFIG_DIR is set", () => {
    const h = setupLogging(tmpRoot);
    try {
      expect(h.currentPath).not.toBeNull();
      expect(h.currentPath!.startsWith(join(tmpRoot, "logs"))).toBe(true);
      expect(/app-\d{4}-\d{2}-\d{2}\.log$/.test(h.currentPath!)).toBe(true);
      expect(existsSync(h.currentPath!)).toBe(true);
    } finally {
      h.dispose();
    }
  });

  test("writes a boot banner synchronously", () => {
    const h = setupLogging(tmpRoot);
    try {
      const contents = readFileSync(h.currentPath!, "utf8");
      expect(contents).toContain("[boot]");
      expect(contents).toContain(`pid=${process.pid}`);
    } finally {
      h.dispose();
    }
  });

  test("console.log output is teed into the file", () => {
    const h = setupLogging(tmpRoot);
    try {
      console.log("tee-probe-42");
      const contents = readFileSync(h.currentPath!, "utf8");
      expect(contents).toContain("tee-probe-42");
    } finally {
      h.dispose();
    }
  });

  test("console.error output is teed into the file", () => {
    const h = setupLogging(tmpRoot);
    try {
      console.error("err-probe-99");
      const contents = readFileSync(h.currentPath!, "utf8");
      expect(contents).toContain("err-probe-99");
    } finally {
      h.dispose();
    }
  });

  test("dispose() restores the original writers so later writes don't hit the file", () => {
    const h = setupLogging(tmpRoot);
    const path = h.currentPath!;
    h.dispose();
    console.log("after-dispose-should-not-appear");
    const contents = readFileSync(path, "utf8");
    expect(contents).not.toContain("after-dispose-should-not-appear");
  });

  test("prunes files older than RETENTION_DAYS, keeps recent ones", () => {
    const logsDir = join(tmpRoot, "logs");
    mkdirSync(logsDir, { recursive: true });
    // Seed three stamped files: ancient, borderline, today.
    const now = new Date();
    const ancient = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const borderline = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    writeFileSync(join(logsDir, `app-${ancient}.log`), "old\n");
    writeFileSync(join(logsDir, `app-${borderline}.log`), "stale\n");
    writeFileSync(join(logsDir, `app-${today}.log`), "today\n");

    const h = setupLogging(tmpRoot);
    try {
      const remaining = readdirSync(logsDir).sort();
      expect(remaining).toContain(`app-${today}.log`);
      expect(remaining).not.toContain(`app-${ancient}.log`);
      expect(remaining).not.toContain(`app-${borderline}.log`);
    } finally {
      h.dispose();
    }
  });

  test("ignores non-matching files during pruning", () => {
    const logsDir = join(tmpRoot, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, "readme.txt"), "keep me");
    writeFileSync(join(logsDir, "app-2020-01-01.log"), "prune me");
    const h = setupLogging(tmpRoot);
    try {
      expect(existsSync(join(logsDir, "readme.txt"))).toBe(true);
      expect(existsSync(join(logsDir, "app-2020-01-01.log"))).toBe(false);
    } finally {
      h.dispose();
    }
  });

  // ---------------------------------------------------------------------
  // P9 — size-based rotation
  // ---------------------------------------------------------------------

  test("prunes numbered rotated chunks (app-DATE.<n>.log) along with the active one", () => {
    const logsDir = join(tmpRoot, "logs");
    mkdirSync(logsDir, { recursive: true });
    const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    writeFileSync(join(logsDir, `app-${ancient}.log`), "old\n");
    writeFileSync(join(logsDir, `app-${ancient}.1.log`), "old chunk 1\n");
    writeFileSync(join(logsDir, `app-${ancient}.2.log`), "old chunk 2\n");
    const h = setupLogging(tmpRoot);
    try {
      const remaining = readdirSync(logsDir);
      expect(remaining).not.toContain(`app-${ancient}.log`);
      expect(remaining).not.toContain(`app-${ancient}.1.log`);
      expect(remaining).not.toContain(`app-${ancient}.2.log`);
    } finally {
      h.dispose();
    }
  });

  test("size-rotates the active file once HT_LOG_MAX_BYTES is exceeded", () => {
    const origMax = process.env["HT_LOG_MAX_BYTES"];
    process.env["HT_LOG_MAX_BYTES"] = "256"; // tiny, easy to overshoot
    try {
      const h = setupLogging(tmpRoot);
      try {
        // Write a chunk well over the threshold via console.log so the
        // tee + size-check path is exercised end-to-end.
        const big = "x".repeat(400);
        console.log(big);
        // A second write triggers another rotation if the first one
        // already exceeded threshold (it should have).
        console.log(big);
        console.log(big);

        const logsDir = join(tmpRoot, "logs");
        const today = new Date().toISOString().slice(0, 10);
        const all = readdirSync(logsDir).filter((n) =>
          n.startsWith(`app-${today}`),
        );
        // Active chunk + at least one rotated chunk.
        expect(all).toContain(`app-${today}.log`);
        const rotated = all.filter((n) => /\.\d+\.log$/.test(n));
        expect(rotated.length).toBeGreaterThanOrEqual(1);
      } finally {
        h.dispose();
      }
    } finally {
      if (origMax === undefined) delete process.env["HT_LOG_MAX_BYTES"];
      else process.env["HT_LOG_MAX_BYTES"] = origMax;
    }
  });

  test("HT_LOG_MAX_BYTES=0 disables size rotation (date rotation still applies)", () => {
    const origMax = process.env["HT_LOG_MAX_BYTES"];
    process.env["HT_LOG_MAX_BYTES"] = "0";
    try {
      const h = setupLogging(tmpRoot);
      try {
        // Even with a multi-kB write, no rotation should happen.
        console.log("y".repeat(8192));
        console.log("z".repeat(8192));

        const logsDir = join(tmpRoot, "logs");
        const today = new Date().toISOString().slice(0, 10);
        const rotated = readdirSync(logsDir).filter(
          (n) => n.startsWith(`app-${today}`) && /\.\d+\.log$/.test(n),
        );
        expect(rotated.length).toBe(0);
      } finally {
        h.dispose();
      }
    } finally {
      if (origMax === undefined) delete process.env["HT_LOG_MAX_BYTES"];
      else process.env["HT_LOG_MAX_BYTES"] = origMax;
    }
  });

  test("re-opening a same-day file picks up its existing size (no double-rotate)", () => {
    const logsDir = join(tmpRoot, "logs");
    mkdirSync(logsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    // Pre-seed today's file with content just under the threshold.
    writeFileSync(join(logsDir, `app-${today}.log`), "x".repeat(200));

    const origMax = process.env["HT_LOG_MAX_BYTES"];
    process.env["HT_LOG_MAX_BYTES"] = "256";
    try {
      const h = setupLogging(tmpRoot);
      try {
        // A small write that — combined with the seeded 200 bytes —
        // crosses the 256 threshold and rotates once.
        console.log("y".repeat(80));
        const rotated = readdirSync(logsDir).filter(
          (n) => n.startsWith(`app-${today}`) && /\.\d+\.log$/.test(n),
        );
        expect(rotated.length).toBe(1);
      } finally {
        h.dispose();
      }
    } finally {
      if (origMax === undefined) delete process.env["HT_LOG_MAX_BYTES"];
      else process.env["HT_LOG_MAX_BYTES"] = origMax;
    }
  });
});
