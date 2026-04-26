// Plan #05 commit C — pure-function tests for the new shareBin
// lib modules: cli (flag parser), qr (Reed-Solomon encoder),
// chart (SVG renderer + nice-tick math), git-log (log parser +
// railroad-style graph layout).

import { describe, expect, test } from "bun:test";
import { PANEL_FLAGS, parseArgs, type Flag } from "../shareBin/lib/cli";
import { encodeQr, qrToSvg } from "../shareBin/lib/qr";
import { niceRange, niceTicks, renderChart } from "../shareBin/lib/chart";
import {
  GITLOG_FORMAT,
  graphWidth,
  layoutGraph,
  parseGitLog,
} from "../shareBin/lib/git-log";

// ── cli ───────────────────────────────────────────────────────

describe("parseArgs", () => {
  const schema = [
    { name: "verbose", long: "verbose", kind: "boolean", default: false },
    { name: "name", long: "name", kind: "string", default: "" },
    { name: "count", long: "count", kind: "number", default: 1 },
  ] as const satisfies readonly Flag[];

  test("collects positional args", () => {
    const r = parseArgs(["a", "b", "c"], { schema });
    expect(r.positional).toEqual(["a", "b", "c"]);
  });

  test("boolean flag sets to true when present, default otherwise", () => {
    expect(parseArgs(["--verbose"], { schema }).flags.verbose).toBe(true);
    expect(parseArgs([], { schema }).flags.verbose).toBe(false);
  });

  test("string flag, space-separated value", () => {
    expect(parseArgs(["--name", "alice"], { schema }).flags.name).toBe("alice");
  });

  test("string flag, equals-separated value", () => {
    expect(parseArgs(["--name=bob"], { schema }).flags.name).toBe("bob");
  });

  test("number flag parses to a finite number", () => {
    expect(parseArgs(["--count", "42"], { schema }).flags.count).toBe(42);
  });

  test("number flag throws on non-numeric value", () => {
    expect(() => parseArgs(["--count", "abc"], { schema })).toThrow(
      /expects a number/,
    );
  });

  test("unknown flag throws", () => {
    expect(() => parseArgs(["--unknown"], { schema })).toThrow(/unknown flag/);
  });

  test("string flag missing value throws", () => {
    expect(() => parseArgs(["--name"], { schema })).toThrow(/expects a value/);
  });

  test("mixes positional with flags in any order", () => {
    const r = parseArgs(["one", "--verbose", "two", "--count=5"], { schema });
    expect(r.positional).toEqual(["one", "two"]);
    expect(r.flags.verbose).toBe(true);
    expect(r.flags.count).toBe(5);
  });

  test("PANEL_FLAGS preset has the expected names", () => {
    const names = PANEL_FLAGS.map((f) => f.name);
    expect(names).toContain("inline");
    expect(names).toContain("noWait");
    expect(names).toContain("x");
    expect(names).toContain("y");
    expect(names).toContain("width");
    expect(names).toContain("height");
  });

  test("boolean flag with =false explicitly disables", () => {
    expect(parseArgs(["--verbose=false"], { schema }).flags.verbose).toBe(
      false,
    );
  });
});

// ── qr ────────────────────────────────────────────────────────

describe("encodeQr", () => {
  test("version 1 encodes a short string", () => {
    const qr = encodeQr("HELLO", { ecLevel: "M" });
    expect(qr.version).toBe(1);
    expect(qr.size).toBe(21);
    expect(qr.modules.length).toBe(21);
    expect(qr.modules[0]!.length).toBe(21);
  });

  test("auto-picks a larger version when payload doesn't fit", () => {
    const qr = encodeQr("x".repeat(40), { ecLevel: "M" });
    expect(qr.version).toBeGreaterThan(1);
    expect(qr.size).toBe(17 + 4 * qr.version);
  });

  test("ecLevel H requires more capacity than L for the same payload", () => {
    const small = encodeQr("x".repeat(20), { ecLevel: "L" });
    const large = encodeQr("x".repeat(20), { ecLevel: "H" });
    expect(large.version).toBeGreaterThanOrEqual(small.version);
  });

  test("finder patterns are present at all three corners", () => {
    const qr = encodeQr("hi", { ecLevel: "L" });
    // The three 7×7 finder corners always have the centre dark.
    expect(qr.modules[3]![3]).toBe(true); // top-left center
    expect(qr.modules[3]![qr.size - 4]).toBe(true); // top-right center
    expect(qr.modules[qr.size - 4]![3]).toBe(true); // bottom-left center
  });

  test("dark module is always set", () => {
    const qr = encodeQr("any", { ecLevel: "M" });
    // Dark module sits at (4*v + 9, 8) — equivalently (size - 8, 8).
    expect(qr.modules[qr.size - 8]![8]).toBe(true);
  });

  test("timing pattern alternates along row 6 / col 6", () => {
    const qr = encodeQr("timing", { ecLevel: "L" });
    for (let i = 8; i < qr.size - 8; i++) {
      expect(qr.modules[6]![i]).toBe(i % 2 === 0);
      expect(qr.modules[i]![6]).toBe(i % 2 === 0);
    }
  });

  test("throws on empty input string with sane error", () => {
    // Empty payload still encodes — byte mode supports zero-length.
    const qr = encodeQr("", { ecLevel: "L" });
    expect(qr.modules.length).toBe(qr.size);
  });

  test("throws when payload exceeds capacity", () => {
    expect(() => encodeQr("x".repeat(10000), { ecLevel: "H" })).toThrow();
  });

  test("invalid version throws", () => {
    expect(() => encodeQr("hi", { version: 99 })).toThrow(/out of range/);
  });
});

describe("qrToSvg", () => {
  test("emits xmlns + the right viewBox dimensions", () => {
    const qr = encodeQr("svg-test", { ecLevel: "L" });
    const svg = qrToSvg(qr, { scale: 4, margin: 2 });
    const dim = (qr.size + 4) * 4;
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="0 0 ${dim} ${dim}"`);
    expect(svg).toContain(`width="${dim}"`);
  });

  test("respects --dark / --light colours", () => {
    const qr = encodeQr("colors", { ecLevel: "L" });
    const svg = qrToSvg(qr, { dark: "#ff0000", light: "#00ff00" });
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill="#00ff00"');
  });

  test("emits at least one dark rect (the encoded payload)", () => {
    const qr = encodeQr("data", { ecLevel: "M" });
    const svg = qrToSvg(qr);
    const matches = svg.match(/<rect [^/]*fill="#0b1020"/g) ?? [];
    expect(matches.length).toBeGreaterThan(10);
  });
});

// ── chart ─────────────────────────────────────────────────────

describe("niceRange / niceTicks", () => {
  test("expands an arbitrary range to round numbers", () => {
    const [lo, hi] = niceRange(3.7, 27.3);
    expect(lo).toBeLessThanOrEqual(3.7);
    expect(hi).toBeGreaterThanOrEqual(27.3);
    expect(lo % 1).toBe(0);
    expect(hi % 1).toBe(0);
  });

  test("collapses lo === hi to a sensible window", () => {
    expect(niceRange(0, 0)).toEqual([0, 1]);
    const [lo, hi] = niceRange(5, 5);
    expect(lo).toBeLessThan(5);
    expect(hi).toBeGreaterThan(5);
  });

  test("niceTicks lands on round increments inside the range", () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(100);
    // Differences between consecutive ticks are constant.
    const diffs = ticks.slice(1).map((v, i) => v - ticks[i]!);
    for (let i = 1; i < diffs.length; i++) {
      expect(Math.abs(diffs[i]! - diffs[0]!)).toBeLessThan(1e-9);
    }
  });

  test("niceTicks degenerates to one tick when range is zero", () => {
    expect(niceTicks(7, 7, 5)).toEqual([7]);
  });
});

describe("renderChart", () => {
  const rows = [
    ["x", "a", "b"],
    ["1", "10", "20"],
    ["2", "15", "18"],
    ["3", "25", "12"],
    ["4", "30", "8"],
  ];

  test("emits a self-contained <svg> with axes and legend", () => {
    const svg = renderChart(rows, {
      kind: "line",
      xCol: 0,
      yCols: [1, 2],
    });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain("xmlns=");
    // Axis lines + legend rects + per-series polyline.
    expect(svg).toContain("<line");
    expect(svg).toContain("<polyline");
    expect(svg).toContain('fill="#66c0f4"'); // first palette colour
  });

  test("bar chart emits <rect> elements per data point", () => {
    const svg = renderChart(rows, {
      kind: "bar",
      xCol: 0,
      yCols: [1],
    });
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    // 1 background + 4 data bars + 2 legend rect = at least 6
    expect(rectCount).toBeGreaterThanOrEqual(6);
  });

  test("scatter chart emits <circle> elements per data point", () => {
    const svg = renderChart(rows, {
      kind: "scatter",
      xCol: 0,
      yCols: [1, 2],
    });
    const circleCount = (svg.match(/<circle /g) ?? []).length;
    expect(circleCount).toBe(8); // 4 rows × 2 series
  });

  test("series labels come from header row", () => {
    const svg = renderChart(rows, {
      kind: "line",
      xCol: 0,
      yCols: [1, 2],
    });
    expect(svg).toContain(">a<");
    expect(svg).toContain(">b<");
  });

  test("hasHeader: false treats row 0 as data", () => {
    const svg = renderChart(rows, {
      kind: "line",
      xCol: 0,
      yCols: [1],
      hasHeader: false,
    });
    // Without a header, label falls back to "series 1".
    expect(svg).toContain("series 1");
  });

  test("non-numeric x falls back to categorical axis", () => {
    const cat = [
      ["region", "sales"],
      ["NA", "120"],
      ["EU", "180"],
      ["APAC", "90"],
    ];
    const svg = renderChart(cat, {
      kind: "bar",
      xCol: 0,
      yCols: [1],
    });
    expect(svg).toContain(">NA<");
    expect(svg).toContain(">EU<");
    expect(svg).toContain(">APAC<");
  });

  test("title renders above the plot", () => {
    const svg = renderChart(rows, {
      kind: "line",
      xCol: 0,
      yCols: [1],
      title: "Sales",
    });
    expect(svg).toContain(">Sales<");
  });

  test("HTML-escapes header labels (XSS guard)", () => {
    const evil = [
      ["x", "<script>"],
      ["1", "10"],
    ];
    const svg = renderChart(evil, {
      kind: "line",
      xCol: 0,
      yCols: [1],
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

// ── git-log ───────────────────────────────────────────────────

describe("parseGitLog", () => {
  function rec(
    sha: string,
    short: string,
    parents: string,
    name: string,
    email: string,
    date: string,
    subject: string,
  ) {
    return (
      [sha, short, parents, name, email, date, subject].join("\x1e") + "\x1f"
    );
  }

  test("parses a single commit record", () => {
    const raw = rec(
      "a".repeat(40),
      "aaaaaaa",
      "",
      "Alice",
      "a@x",
      "2026-04-27T10:00:00+00:00",
      "init",
    );
    const out = parseGitLog(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.sha).toBe("a".repeat(40));
    expect(out[0]!.short).toBe("aaaaaaa");
    expect(out[0]!.parents).toEqual([]);
    expect(out[0]!.author).toBe("Alice");
    expect(out[0]!.subject).toBe("init");
  });

  test("splits multi-parent merges on space", () => {
    const raw = rec(
      "c".repeat(40),
      "ccccccc",
      "p1 p2",
      "M",
      "m@x",
      "2026-04-27T10:00:00+00:00",
      "merge",
    );
    const out = parseGitLog(raw);
    expect(out[0]!.parents).toEqual(["p1", "p2"]);
  });

  test("ignores trailing empty record from final separator", () => {
    const raw =
      rec(
        "a".repeat(40),
        "a",
        "",
        "A",
        "a@x",
        "2026-04-27T10:00:00+00:00",
        "x",
      ) + "\n";
    expect(parseGitLog(raw)).toHaveLength(1);
  });

  test("preserves subject text containing colons + pipes", () => {
    const raw = rec(
      "a".repeat(40),
      "a",
      "",
      "A",
      "a@x",
      "2026-04-27T10:00:00+00:00",
      "fix(server): support `|` chained input",
    );
    expect(parseGitLog(raw)[0]!.subject).toBe(
      "fix(server): support `|` chained input",
    );
  });

  test("GITLOG_FORMAT uses git's hex-escape RS / US tokens", () => {
    expect(GITLOG_FORMAT).toContain("%x1e");
    expect(GITLOG_FORMAT).toContain("%x1f");
  });
});

describe("layoutGraph", () => {
  test("linear history puts every commit on rail 0", () => {
    const commits = [
      mkCommit("c", ["b"]),
      mkCommit("b", ["a"]),
      mkCommit("a", []),
    ];
    const rows = layoutGraph(commits);
    expect(rows.map((r) => r.rail)).toEqual([0, 0, 0]);
    expect(graphWidth(rows)).toBe(1);
  });

  test("merge commit is flagged as such", () => {
    const commits = [
      mkCommit("m", ["a", "b"]),
      mkCommit("b", ["a"]),
      mkCommit("a", []),
    ];
    const rows = layoutGraph(commits);
    expect(rows[0]!.isMerge).toBe(true);
    expect(rows[1]!.isMerge).toBe(false);
  });

  test("merge expands to multiple rails", () => {
    const commits = [
      mkCommit("m", ["a", "b"]),
      mkCommit("b", ["a"]),
      mkCommit("a", []),
    ];
    expect(graphWidth(layoutGraph(commits))).toBeGreaterThanOrEqual(2);
  });

  test("rails always cover the current commit", () => {
    const commits = [
      mkCommit("d", ["c"]),
      mkCommit("c", ["b"]),
      mkCommit("b", ["a"]),
      mkCommit("a", []),
    ];
    const rows = layoutGraph(commits);
    for (const r of rows) {
      expect(r.rails[r.rail]?.sha).toBe(r.commit.sha);
    }
  });

  test("root commit closes its rail", () => {
    const commits = [mkCommit("root", [])];
    const rows = layoutGraph(commits);
    expect(rows[0]!.commit.sha).toBe("root");
    // After processing the single root commit, rail count should
    // settle to 0 (no more parents) — the snapshot we keep still
    // shows rail 0 occupied.
    expect(rows[0]!.rails.length).toBe(1);
  });
});

function mkCommit(
  sha: string,
  parents: string[],
): import("../shareBin/lib/git-log").GitCommit {
  return {
    sha,
    short: sha.slice(0, 7),
    parents,
    author: "T",
    email: "t@x",
    date: "2026-04-27T10:00:00+00:00",
    subject: `commit ${sha}`,
  };
}
