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
    // Long key with multiple words.
    [
      "agent_response_latency_ms_pct_warn",
      {
        displayName: "agent response latency ms",
        renderers: ["pct"],
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
