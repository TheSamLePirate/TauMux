// Coverage for the smart status-key DSL parser. Table-driven so adding
// a renderer / suffix / edge case is one row, not a new test scaffold.
//
// The parser must NEVER throw — malformed input falls back to a text
// payload. Tests assert that fallback as much as the happy path.

import { describe, expect, test } from "bun:test";
import {
  parseStatusBody,
  parseStatusKey,
  type ParsedBody,
  type ParsedStatusKey,
} from "../src/shared/status-key";

describe("parseStatusKey — DSL parsing", () => {
  // [key, expected partial]
  const cases: [string, Partial<ParsedStatusKey>][] = [
    // Bare key — no suffix, default text renderer.
    [
      "status",
      {
        hidden: false,
        displayName: "status",
        renderers: ["text"],
        semantic: null,
        layout: "inline",
      },
    ],
    // Hidden flag (leading underscore).
    [
      "_internal",
      {
        hidden: true,
        displayName: "internal",
        renderers: ["text"],
        layout: "inline",
      },
    ],
    // Single renderer suffix.
    [
      "cpu_pct",
      {
        hidden: false,
        displayName: "cpu",
        renderers: ["pct"],
        semantic: null,
        layout: "inline",
      },
    ],
    // Multi-token label + renderer.
    [
      "build_step_pct",
      {
        displayName: "build step",
        renderers: ["pct"],
        layout: "inline",
      },
    ],
    // Renderer + semantic — semantic must be peeled first.
    [
      "cpu_pct_warn",
      {
        displayName: "cpu",
        renderers: ["pct"],
        semantic: "warn",
      },
    ],
    // Two renderer suffixes (chain). Primary is leftmost of the chain.
    [
      "cpu_hist_lineGraph",
      {
        displayName: "cpu hist",
        renderers: ["lineGraph"],
        layout: "block",
      },
    ],
    // Hidden + chain + semantic.
    [
      "_disk_io_lineGraph_err",
      {
        hidden: true,
        displayName: "disk io",
        renderers: ["lineGraph"],
        semantic: "err",
        layout: "block",
      },
    ],
    // Plan array — block layout.
    [
      "plan_array",
      {
        displayName: "plan",
        renderers: ["array"],
        layout: "block",
      },
    ],
    // Eta + ok semantic.
    [
      "deploy_eta_ok",
      {
        displayName: "deploy",
        renderers: ["eta"],
        semantic: "ok",
        layout: "inline",
      },
    ],
    // Unknown suffix folds back into the display label.
    [
      "foo_unknown_pct",
      {
        displayName: "foo unknown",
        renderers: ["pct"],
      },
    ],
    // Lone underscore — degenerate but mustn't crash.
    [
      "_",
      {
        hidden: true,
        displayName: "_",
        renderers: ["text"],
      },
    ],
    // Just a renderer name on its own — still keep label as the
    // renderer name; we never emit empty displayName.
    [
      "pct",
      {
        displayName: "pct",
        renderers: ["text"],
      },
    ],
    // Semantic-but-no-renderer: tail is "ok"; no renderer — semantic
    // is still pulled (it sits at the very tail), label is what
    // remains.
    [
      "build_ok",
      {
        displayName: "build",
        renderers: ["text"],
        semantic: "ok",
      },
    ],
    // Long key with multiple words. `ms` is a renderer in v2 so the
    // chain is `[ms, pct]`; `latency` is the rightmost label token.
    [
      "agent_response_latency_ms_pct_warn",
      {
        displayName: "agent response latency",
        renderers: ["ms", "pct"],
        semantic: "warn",
      },
    ],
    // longtext layout = block.
    [
      "summary_longtext",
      {
        displayName: "summary",
        renderers: ["longtext"],
        layout: "block",
      },
    ],
  ];

  for (const [key, expected] of cases) {
    test(`parseStatusKey(${JSON.stringify(key)})`, () => {
      const got = parseStatusKey(key);
      expect(got.rawKey).toBe(key);
      for (const [k, v] of Object.entries(expected)) {
        expect(got[k as keyof ParsedStatusKey]).toEqual(
          v as ParsedStatusKey[keyof ParsedStatusKey],
        );
      }
    });
  }
});

describe("parseStatusBody — body grammar per renderer", () => {
  function expectShape(got: ParsedBody, kind: ParsedBody["kind"]): void {
    expect(got.kind).toBe(kind);
  }

  test("text returns the raw value verbatim", () => {
    const got = parseStatusBody("text", "hello world");
    expect(got).toEqual({ kind: "text", value: "hello world" });
  });

  test("longtext is a separate kind from text", () => {
    expectShape(parseStatusBody("longtext", "long body"), "longtext");
  });

  test("num parses integers and floats", () => {
    expect(parseStatusBody("num", "42")).toEqual({
      kind: "num",
      value: 42,
      raw: "42",
    });
    expect(parseStatusBody("num", "3.14")).toEqual({
      kind: "num",
      value: 3.14,
      raw: "3.14",
    });
  });

  test("num falls back to text on garbage", () => {
    expect(parseStatusBody("num", "not-a-number")).toEqual({
      kind: "text",
      value: "not-a-number",
    });
  });

  test("pct accepts 0..100 form", () => {
    const got = parseStatusBody("pct", "73");
    if (got.kind !== "pct") throw new Error("expected pct");
    expect(got.value).toBe(73);
  });

  test("pct accepts fractional 0..1 form and multiplies", () => {
    const got = parseStatusBody("pct", "0.42");
    if (got.kind !== "pct") throw new Error("expected pct");
    expect(got.value).toBeCloseTo(42, 5);
  });

  test("pct clamps out-of-range values", () => {
    const high = parseStatusBody("pct", "250");
    if (high.kind !== "pct") throw new Error("expected pct");
    expect(high.value).toBe(100);
    const low = parseStatusBody("pct", "-5");
    if (low.kind !== "pct") throw new Error("expected pct");
    expect(low.value).toBe(0);
  });

  test("lineGraph parses comma list and ignores garbage cells", () => {
    const got = parseStatusBody("lineGraph", "1,2,three,4");
    if (got.kind !== "lineGraph") throw new Error("expected lineGraph");
    expect(got.samples).toEqual([1, 2, 4]);
  });

  test("lineGraph caps at 256 samples", () => {
    const big = Array.from({ length: 500 }, (_, i) => i).join(",");
    const got = parseStatusBody("lineGraph", big);
    if (got.kind !== "lineGraph") throw new Error("expected lineGraph");
    expect(got.samples.length).toBe(256);
    // Should keep the most recent samples (tail).
    expect(got.samples[0]).toBe(244);
    expect(got.samples[255]).toBe(499);
  });

  test("lineGraph with no parseable samples falls back to text", () => {
    expect(parseStatusBody("lineGraph", "abc, def")).toEqual({
      kind: "text",
      value: "abc, def",
    });
  });

  test("array parses JSON of arrays", () => {
    const body = JSON.stringify([
      ["P1: explore", "done"],
      ["P2: edit", "active"],
      ["P3: commit", "waiting"],
    ]);
    const got = parseStatusBody("array", body);
    if (got.kind !== "array") throw new Error("expected array");
    expect(got.rows).toEqual([
      ["P1: explore", "done"],
      ["P2: edit", "active"],
      ["P3: commit", "waiting"],
    ]);
  });

  test("array stringifies non-string cells", () => {
    const body = JSON.stringify([[1, true, null]]);
    const got = parseStatusBody("array", body);
    if (got.kind !== "array") throw new Error("expected array");
    expect(got.rows[0]).toEqual(["1", "true", ""]);
  });

  test("array rejects non-array JSON", () => {
    expect(parseStatusBody("array", '{"a":1}')).toEqual({
      kind: "text",
      value: '{"a":1}',
    });
  });

  test("array rejects malformed JSON gracefully", () => {
    expect(parseStatusBody("array", "[[broken")).toEqual({
      kind: "text",
      value: "[[broken",
    });
  });

  test("link accepts `label|url`", () => {
    const got = parseStatusBody("link", "Dashboard|https://example.com/dash");
    expect(got).toEqual({
      kind: "link",
      label: "Dashboard",
      url: "https://example.com/dash",
    });
  });

  test("link accepts a bare URL", () => {
    const got = parseStatusBody("link", "https://x.example.com/");
    expect(got).toEqual({
      kind: "link",
      label: "https://x.example.com/",
      url: "https://x.example.com/",
    });
  });

  test("link rejects non-http schemes (XSS guard)", () => {
    expect(parseStatusBody("link", "javascript:alert(1)")).toEqual({
      kind: "text",
      value: "javascript:alert(1)",
    });
    expect(parseStatusBody("link", "click|file:///etc/passwd")).toEqual({
      kind: "text",
      value: "click|file:///etc/passwd",
    });
  });

  test("time accepts epoch ms", () => {
    const got = parseStatusBody("time", "1700000000000");
    if (got.kind !== "time") throw new Error("expected time");
    expect(got.ts).toBe(1700000000000);
  });

  test("time accepts epoch seconds and converts to ms", () => {
    const got = parseStatusBody("time", "1700000000");
    if (got.kind !== "time") throw new Error("expected time");
    expect(got.ts).toBe(1700000000 * 1000);
  });

  test("time accepts ISO 8601", () => {
    const got = parseStatusBody("time", "2026-04-26T12:00:00Z");
    if (got.kind !== "time") throw new Error("expected time");
    expect(got.ts).toBe(Date.parse("2026-04-26T12:00:00Z"));
  });

  test("time falls back to text on garbage", () => {
    expect(parseStatusBody("time", "tomorrow")).toEqual({
      kind: "text",
      value: "tomorrow",
    });
  });

  test("eta uses the same parser as time but is a distinct kind", () => {
    const got = parseStatusBody("eta", "1700000000000");
    if (got.kind !== "eta") throw new Error("expected eta");
    expect(got.ts).toBe(1700000000000);
  });
});

describe("parseStatusBody — v2 numeric renderers", () => {
  test("bytes parses int and rejects garbage", () => {
    expect(parseStatusBody("bytes", "1048576")).toEqual({
      kind: "bytes",
      value: 1048576,
      raw: "1048576",
    });
    expect(parseStatusBody("bytes", "huge")).toEqual({
      kind: "text",
      value: "huge",
    });
  });

  test("ms parses int", () => {
    const got = parseStatusBody("ms", "4321");
    if (got.kind !== "ms") throw new Error("expected ms");
    expect(got.value).toBe(4321);
  });

  test("duration parses seconds", () => {
    const got = parseStatusBody("duration", "65");
    if (got.kind !== "duration") throw new Error("expected duration");
    expect(got.seconds).toBe(65);
  });

  test("currency parses value|unit and defaults to USD", () => {
    expect(parseStatusBody("currency", "42.5|EUR")).toEqual({
      kind: "currency",
      value: 42.5,
      unit: "EUR",
      raw: "42.5|EUR",
    });
    expect(parseStatusBody("currency", "100")).toEqual({
      kind: "currency",
      value: 100,
      unit: "USD",
      raw: "100",
    });
  });

  test("count rounds to integer", () => {
    expect(parseStatusBody("count", "12345.7")).toEqual({
      kind: "count",
      value: 12346,
      raw: "12345.7",
    });
  });

  test("rating clamps and defaults max to 5", () => {
    expect(parseStatusBody("rating", "4")).toEqual({
      kind: "rating",
      value: 4,
      max: 5,
      raw: "4",
    });
    expect(parseStatusBody("rating", "12|10")).toEqual({
      kind: "rating",
      value: 10,
      max: 10,
      raw: "12|10",
    });
  });

  test("code returns raw value verbatim", () => {
    expect(parseStatusBody("code", "TS2304")).toEqual({
      kind: "code",
      value: "TS2304",
    });
  });
});

describe("parseStatusBody — v2 time renderers", () => {
  test("date and clock parse like time", () => {
    const d = parseStatusBody("date", "1700000000");
    if (d.kind !== "date") throw new Error("expected date");
    expect(d.ts).toBe(1700000000 * 1000);
    const c = parseStatusBody("clock", "2026-04-26T12:34:56Z");
    if (c.kind !== "clock") throw new Error("expected clock");
    expect(c.ts).toBe(Date.parse("2026-04-26T12:34:56Z"));
  });
});

describe("parseStatusBody — v2 state renderers", () => {
  test("bool accepts common truthy/falsy strings", () => {
    expect(parseStatusBody("bool", "true")).toEqual({
      kind: "bool",
      value: true,
      raw: "true",
    });
    expect(parseStatusBody("bool", "no")).toEqual({
      kind: "bool",
      value: false,
      raw: "no",
    });
    expect(parseStatusBody("bool", "1")).toEqual({
      kind: "bool",
      value: true,
      raw: "1",
    });
    expect(parseStatusBody("bool", "off")).toEqual({
      kind: "bool",
      value: false,
      raw: "off",
    });
    expect(parseStatusBody("bool", "maybe")).toEqual({
      kind: "text",
      value: "maybe",
    });
  });

  test("status splits state:message", () => {
    expect(parseStatusBody("status", "ok:All passed")).toEqual({
      kind: "status",
      state: "ok",
      message: "All passed",
      raw: "ok:All passed",
    });
    expect(parseStatusBody("status", "active")).toEqual({
      kind: "status",
      state: "active",
      message: "",
      raw: "active",
    });
  });

  test("dot stores raw state", () => {
    expect(parseStatusBody("dot", "running")).toEqual({
      kind: "dot",
      state: "running",
      raw: "running",
    });
  });

  test("badge captures the raw value", () => {
    expect(parseStatusBody("badge", "v0.2.4")).toEqual({
      kind: "badge",
      value: "v0.2.4",
      raw: "v0.2.4",
    });
  });
});

describe("parseStatusBody — v2 chart renderers", () => {
  test("bar parses value|max|unit", () => {
    expect(parseStatusBody("bar", "30|60|MB")).toEqual({
      kind: "bar",
      value: 30,
      max: 60,
      unit: "MB",
      raw: "30|60|MB",
    });
    expect(parseStatusBody("bar", "75")).toEqual({
      kind: "bar",
      value: 75,
      max: 100,
      unit: undefined,
      raw: "75",
    });
  });

  test("vbar parses comma list", () => {
    const got = parseStatusBody("vbar", "1,3,2,5,8,3");
    if (got.kind !== "vbar") throw new Error("expected vbar");
    expect(got.samples).toEqual([1, 3, 2, 5, 8, 3]);
  });

  test("vbar caps at 64 samples", () => {
    const big = Array.from({ length: 200 }, (_, i) => i).join(",");
    const got = parseStatusBody("vbar", big);
    if (got.kind !== "vbar") throw new Error("expected vbar");
    expect(got.samples.length).toBe(64);
  });

  test("gauge parses value|max|unit and clamps", () => {
    const got = parseStatusBody("gauge", "150|200|MB");
    if (got.kind !== "gauge") throw new Error("expected gauge");
    expect(got.value).toBe(150);
    expect(got.max).toBe(200);
    expect(got.unit).toBe("MB");
  });

  test("sparkline parses comma list (cap=128)", () => {
    const got = parseStatusBody("sparkline", "1,2,3,4");
    if (got.kind !== "sparkline") throw new Error("expected sparkline");
    expect(got.samples).toEqual([1, 2, 3, 4]);
  });

  test("area parses comma list (cap=256)", () => {
    const got = parseStatusBody("area", "0,5,3,9");
    if (got.kind !== "area") throw new Error("expected area");
    expect(got.samples).toEqual([0, 5, 3, 9]);
  });

  test("histogram parses comma list", () => {
    const got = parseStatusBody("histogram", "1,2,3");
    if (got.kind !== "histogram") throw new Error("expected histogram");
    expect(got.samples).toEqual([1, 2, 3]);
  });

  test("heatmap parses comma list", () => {
    const got = parseStatusBody("heatmap", "0.1,0.5,0.9");
    if (got.kind !== "heatmap") throw new Error("expected heatmap");
    expect(got.samples).toEqual([0.1, 0.5, 0.9]);
  });

  test("dotGraph parses 0/1 sequence", () => {
    const got = parseStatusBody("dotGraph", "1,0,1,1,0");
    if (got.kind !== "dotGraph") throw new Error("expected dotGraph");
    expect(got.samples).toEqual([1, 0, 1, 1, 0]);
  });

  test("pie parses {label:value} object", () => {
    const got = parseStatusBody("pie", JSON.stringify({ a: 3, b: 7 }));
    if (got.kind !== "pie") throw new Error("expected pie");
    expect(got.slices).toEqual([
      { label: "a", value: 3 },
      { label: "b", value: 7 },
    ]);
  });

  test("pie parses a:3,b:7 syntax", () => {
    const got = parseStatusBody("pie", "a:3,b:7,c:5");
    if (got.kind !== "pie") throw new Error("expected pie");
    expect(got.slices).toEqual([
      { label: "a", value: 3 },
      { label: "b", value: 7 },
      { label: "c", value: 5 },
    ]);
  });

  test("donut shares pie parser", () => {
    const got = parseStatusBody("donut", "x:10,y:20");
    if (got.kind !== "donut") throw new Error("expected donut");
    expect(got.slices.length).toBe(2);
  });

  test("pie rejects non-numeric body", () => {
    expect(parseStatusBody("pie", "garbage")).toEqual({
      kind: "text",
      value: "garbage",
    });
  });
});

describe("parseStatusBody — v2 data renderers", () => {
  test("kv parses JSON object", () => {
    const got = parseStatusBody(
      "kv",
      JSON.stringify({ branch: "main", ahead: 3, dirty: false }),
    );
    if (got.kind !== "kv") throw new Error("expected kv");
    expect(got.pairs).toEqual([
      { key: "branch", value: "main" },
      { key: "ahead", value: "3" },
      { key: "dirty", value: "false" },
    ]);
  });

  test("kv rejects array bodies", () => {
    expect(parseStatusBody("kv", "[1,2,3]")).toEqual({
      kind: "text",
      value: "[1,2,3]",
    });
  });

  test("json captures any valid JSON", () => {
    const got = parseStatusBody("json", '{"a":[1,2]}');
    if (got.kind !== "json") throw new Error("expected json");
    expect(got.value).toEqual({ a: [1, 2] });
  });

  test("json falls back to text on parse error", () => {
    expect(parseStatusBody("json", "not json")).toEqual({
      kind: "text",
      value: "not json",
    });
  });

  test("list splits comma/newline separated", () => {
    const got = parseStatusBody("list", "alpha, beta, gamma");
    if (got.kind !== "list") throw new Error("expected list");
    expect(got.items).toEqual(["alpha", "beta", "gamma"]);
  });

  test("tags splits whitespace + comma", () => {
    const got = parseStatusBody("tags", "ts bun electron");
    if (got.kind !== "tags") throw new Error("expected tags");
    expect(got.items).toEqual(["ts", "bun", "electron"]);
  });

  test("array tolerates a flat array", () => {
    const got = parseStatusBody("array", JSON.stringify(["a", "b", "c"]));
    if (got.kind !== "array") throw new Error("expected array");
    expect(got.rows).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("parseStatusBody — v2 rich renderers", () => {
  test("image accepts data URI and http(s)", () => {
    expect(parseStatusBody("image", "https://x.com/a.png")).toEqual({
      kind: "image",
      src: "https://x.com/a.png",
      alt: "",
    });
    expect(parseStatusBody("image", "alt|data:image/png;base64,abc")).toEqual({
      kind: "image",
      src: "data:image/png;base64,abc",
      alt: "alt",
    });
  });

  test("image rejects unsafe schemes", () => {
    expect(parseStatusBody("image", "javascript:alert(1)")).toEqual({
      kind: "text",
      value: "javascript:alert(1)",
    });
    expect(parseStatusBody("image", "file:///etc/passwd")).toEqual({
      kind: "text",
      value: "file:///etc/passwd",
    });
  });

  test("md captures markdown verbatim", () => {
    expect(parseStatusBody("md", "**hi**")).toEqual({
      kind: "md",
      value: "**hi**",
    });
  });

  test("color accepts hex + keywords + rgb/hsl", () => {
    expect(parseStatusBody("color", "#abcdef")).toEqual({
      kind: "color",
      hex: "#abcdef",
      raw: "#abcdef",
    });
    const k = parseStatusBody("color", "cyan");
    if (k.kind !== "color") throw new Error("expected color");
    expect(k.hex).toBe("#6fe9ff");
    const rgb = parseStatusBody("color", "rgb(10, 20, 30)");
    if (rgb.kind !== "color") throw new Error("expected color");
    expect(rgb.hex).toBe("rgb(10, 20, 30)");
  });

  test("color rejects unknowns", () => {
    expect(parseStatusBody("color", "puce")).toEqual({
      kind: "text",
      value: "puce",
    });
  });

  test("kbd splits on +/whitespace", () => {
    const got = parseStatusBody("kbd", "Cmd+Shift+P");
    if (got.kind !== "kbd") throw new Error("expected kbd");
    expect(got.keys).toEqual(["Cmd", "Shift", "P"]);
  });

  test("file extracts basename from POSIX and Windows paths", () => {
    const a = parseStatusBody("file", "/Users/o/repo/main.ts");
    if (a.kind !== "file") throw new Error("expected file");
    expect(a.basename).toBe("main.ts");
    const b = parseStatusBody("file", "C:\\Users\\o\\file.txt");
    if (b.kind !== "file") throw new Error("expected file");
    expect(b.basename).toBe("file.txt");
  });
});
