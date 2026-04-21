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
});
