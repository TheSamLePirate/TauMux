// Plan #13 — pure-function tests for the web-mirror process
// aggregator. The DOM-bound process-manager view is a thin wrapper
// over these helpers; testing them hermetically pins the load-
// bearing behaviour (sort, filter, totals, formatting) without
// JSDOM.

import { describe, expect, test } from "bun:test";
import {
  aggregateProcesses,
  filterRows,
  formatCpu,
  formatRss,
  totalsForRows,
} from "../src/web-client/process-aggregator";
import type { SurfaceMetadata } from "../src/shared/types";

function meta(
  pid: number,
  fg: number,
  tree: { pid: number; cpu: number; rssKb: number; command: string }[],
): SurfaceMetadata {
  return {
    pid,
    foregroundPid: fg,
    cwd: "/tmp",
    tree: tree.map((p) => ({ ...p, ppid: pid })),
    listeningPorts: [],
    git: null,
    packageJson: null,
    cargoToml: null,
    updatedAt: 0,
  };
}

describe("aggregateProcesses", () => {
  test("sort by CPU descending across surfaces", () => {
    const rows = aggregateProcesses({
      surfaces: {
        s1: {
          id: "s1",
          title: "shell-1",
          metadata: meta(100, 200, [
            { pid: 100, cpu: 0.1, rssKb: 1024, command: "zsh" },
            { pid: 200, cpu: 12.5, rssKb: 4096, command: "node build" },
          ]),
        },
        s2: {
          id: "s2",
          title: "shell-2",
          metadata: meta(300, 300, [
            { pid: 300, cpu: 4.2, rssKb: 2048, command: "bash" },
          ]),
        },
      },
    });
    expect(rows.map((r) => r.pid)).toEqual([200, 300, 100]);
  });

  test("ties on CPU break by pid ascending (stable sort)", () => {
    const rows = aggregateProcesses({
      surfaces: {
        s1: {
          id: "s1",
          title: "x",
          metadata: meta(10, 10, [
            { pid: 60, cpu: 0, rssKb: 0, command: "a" },
            { pid: 10, cpu: 0, rssKb: 0, command: "b" },
            { pid: 30, cpu: 0, rssKb: 0, command: "c" },
          ]),
        },
      },
    });
    expect(rows.map((r) => r.pid)).toEqual([10, 30, 60]);
  });

  test("isShell + isForeground flags propagate", () => {
    const rows = aggregateProcesses({
      surfaces: {
        s1: {
          id: "s1",
          title: "x",
          metadata: meta(100, 200, [
            { pid: 100, cpu: 0, rssKb: 0, command: "shell" },
            { pid: 200, cpu: 0, rssKb: 0, command: "fg" },
            { pid: 300, cpu: 0, rssKb: 0, command: "bg" },
          ]),
        },
      },
    });
    const byPid = (pid: number) => rows.find((r) => r.pid === pid)!;
    expect(byPid(100).isShell).toBe(true);
    expect(byPid(100).isForeground).toBe(false);
    expect(byPid(200).isForeground).toBe(true);
    expect(byPid(200).isShell).toBe(false);
    expect(byPid(300).isShell).toBe(false);
    expect(byPid(300).isForeground).toBe(false);
  });

  test("surfaces with no metadata are skipped, not crashed", () => {
    const rows = aggregateProcesses({
      surfaces: {
        empty: { id: "empty", title: "no meta", metadata: null },
      },
    });
    expect(rows).toEqual([]);
  });

  test("title falls back to id when missing", () => {
    const rows = aggregateProcesses({
      surfaces: {
        anon: {
          id: "anon",
          title: "",
          metadata: meta(1, 1, [{ pid: 1, cpu: 0, rssKb: 0, command: "x" }]),
        },
      },
    });
    expect(rows[0]!.surfaceTitle).toBe("anon");
  });
});

describe("totalsForRows", () => {
  test("sums cpu, rssKb, and count", () => {
    const rows = aggregateProcesses({
      surfaces: {
        s1: {
          id: "s1",
          title: "x",
          metadata: meta(1, 1, [
            { pid: 1, cpu: 1.2, rssKb: 100, command: "a" },
            { pid: 2, cpu: 3.4, rssKb: 200, command: "b" },
          ]),
        },
      },
    });
    const t = totalsForRows(rows);
    expect(t.count).toBe(2);
    expect(t.rssKb).toBe(300);
    // cpu rounded to 1 decimal — guard against float drift.
    expect(t.cpu).toBeCloseTo(4.6, 1);
  });

  test("empty rows = zeroes", () => {
    expect(totalsForRows([])).toEqual({ cpu: 0, rssKb: 0, count: 0 });
  });
});

describe("filterRows", () => {
  const rows = aggregateProcesses({
    surfaces: {
      s1: {
        id: "s1",
        title: "build-server",
        metadata: meta(100, 100, [
          { pid: 100, cpu: 0, rssKb: 0, command: "node build.ts" },
          { pid: 101, cpu: 0, rssKb: 0, command: "rg --json" },
        ]),
      },
      s2: {
        id: "s2",
        title: "tail-logs",
        metadata: meta(200, 200, [
          { pid: 200, cpu: 0, rssKb: 0, command: "tail -F app.log" },
        ]),
      },
    },
  });

  test("empty needle returns all rows", () => {
    expect(filterRows(rows, "")).toHaveLength(3);
    expect(filterRows(rows, "   ")).toHaveLength(3);
  });

  test("matches command (case-insensitive)", () => {
    const out = filterRows(rows, "NODE");
    expect(out).toHaveLength(1);
    expect(out[0]!.command).toContain("node");
  });

  test("matches surface title", () => {
    const out = filterRows(rows, "tail-logs");
    expect(out).toHaveLength(1);
    expect(out[0]!.surfaceId).toBe("s2");
  });

  test("matches pid (substring numeric)", () => {
    const out = filterRows(rows, "10");
    // 100 + 101 + 200 → "10" matches 100 and 101, not 200.
    expect(out.map((r) => r.pid).sort()).toEqual([100, 101]);
  });
});

describe("formatRss / formatCpu", () => {
  test("formatRss < 1024 KB stays in KB", () => {
    expect(formatRss(0)).toBe("0 KB");
    expect(formatRss(512)).toBe("512 KB");
  });

  test("formatRss promotes to MB then GB", () => {
    expect(formatRss(2048)).toBe("2.0 MB");
    expect(formatRss(1024 * 1024 * 3)).toBe("3.00 GB");
  });

  test("formatCpu drops trailing zero", () => {
    expect(formatCpu(0)).toBe("0");
    expect(formatCpu(0.05)).toBe("0.1");
    expect(formatCpu(7)).toBe("7");
    expect(formatCpu(7.4)).toBe("7.4");
  });

  test("formatCpu handles non-finite gracefully", () => {
    expect(formatCpu(Number.NaN)).toBe("0");
    expect(formatCpu(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
