// Plan #05 commit B — pure-function tests for the new shareBin
// lib modules: csv (RFC 4180-ish parser), table (sortable HTML),
// yaml (minimal indentation-based parser).

import { describe, expect, test } from "bun:test";
import { parseCsv } from "../shareBin/lib/csv";
import { renderTable } from "../shareBin/lib/table";
import { parseYaml, type YamlValue } from "../shareBin/lib/yaml";

// ── csv ───────────────────────────────────────────────────────

describe("parseCsv", () => {
  test("simple comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("auto-sniffs tabs over commas", () => {
    expect(parseCsv("a\tb\tc\n1\t2\t3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("explicit comma overrides auto-sniff even on tab-heavy input", () => {
    expect(parseCsv("a\tb,c", { sep: "," })).toEqual([["a\tb", "c"]]);
  });

  test("quoted field with embedded comma", () => {
    expect(parseCsv(`a,"b,c",d`)).toEqual([["a", "b,c", "d"]]);
  });

  test("doubled-quote escape inside quoted field", () => {
    expect(parseCsv(`"he said ""hi""",2`)).toEqual([['he said "hi"', "2"]]);
  });

  test("quoted field with embedded newline", () => {
    expect(parseCsv(`"line1\nline2",x`)).toEqual([["line1\nline2", "x"]]);
  });

  test("CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("trailing newline does not produce a stray empty row", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("empty trailing field is preserved", () => {
    expect(parseCsv("a,b,\n1,2,3")).toEqual([
      ["a", "b", ""],
      ["1", "2", "3"],
    ]);
  });

  test("empty input yields one empty row (callers don't special-case)", () => {
    expect(parseCsv("")).toEqual([[""]]);
  });
});

// ── table ─────────────────────────────────────────────────────

describe("renderTable", () => {
  test("renders header row + body rows", () => {
    const out = renderTable([
      ["name", "qty"],
      ["apples", "3"],
      ["bananas", "2"],
    ]);
    expect(out).toContain("<thead>");
    expect(out).toContain("<tbody>");
    expect(out).toContain('<th data-col="0"');
    expect(out).toContain("apples");
    expect(out).toContain("bananas");
  });

  test("title + row count appear above the table when supplied", () => {
    const out = renderTable([["a"], ["1"], ["2"]], { title: "Things" });
    expect(out).toContain("Things");
    expect(out).toContain("2 rows");
  });

  test("singular row count uses 'row' (not 'rows')", () => {
    const out = renderTable([["a"], ["1"]], { title: "x" });
    expect(out).toContain("1 row");
    expect(out).not.toContain("1 rows");
  });

  test("hasHeader=false treats every row as body", () => {
    const out = renderTable(
      [
        ["a", "b"],
        ["1", "2"],
      ],
      { hasHeader: false },
    );
    expect(out).not.toContain("<thead>");
    expect(out).toContain("<tbody>");
  });

  test("ragged input is padded to the widest row", () => {
    const out = renderTable([["h1", "h2", "h3"], ["a"], ["b", "c"]]);
    // Three <td>s expected on each body row; the missing cells
    // render as empty <td></td>.
    const tds = out.match(/<td>/g);
    expect(tds).not.toBeNull();
    expect(tds!.length).toBe(6);
  });

  test("HTML in cells is escaped", () => {
    const out = renderTable([["x"], ["<script>alert(1)</script>"]]);
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>alert");
  });

  test("empty input renders the empty-state placeholder", () => {
    expect(renderTable([])).toContain("(empty table)");
  });

  test("emits the click-to-sort script (so the panel is interactive)", () => {
    const out = renderTable([["a"], ["1"]]);
    expect(out).toContain("<script>");
    expect(out).toContain("table.tbl");
  });
});

// ── yaml ──────────────────────────────────────────────────────

describe("parseYaml", () => {
  function expectShape<T>(v: YamlValue, expected: T): void {
    expect(v).toEqual(expected as YamlValue);
  }

  test("flat mapping with scalar values", () => {
    expectShape(parseYaml("name: olivier\nage: 33\nactive: true"), {
      name: "olivier",
      age: 33,
      active: true,
    });
  });

  test("nested mapping", () => {
    expectShape(parseYaml("server:\n  host: localhost\n  port: 8080"), {
      server: { host: "localhost", port: 8080 },
    });
  });

  test("deeply nested mapping", () => {
    expectShape(parseYaml("a:\n  b:\n    c:\n      d: 1"), {
      a: { b: { c: { d: 1 } } },
    });
  });

  test("simple sequence", () => {
    expectShape(parseYaml("- apples\n- bananas\n- 3"), [
      "apples",
      "bananas",
      3,
    ]);
  });

  test("sequence inside mapping", () => {
    expectShape(parseYaml("fruits:\n  - apple\n  - banana"), {
      fruits: ["apple", "banana"],
    });
  });

  test("sequence of mappings", () => {
    expectShape(parseYaml("- name: a\n  count: 1\n- name: b\n  count: 2"), [
      { name: "a", count: 1 },
      { name: "b", count: 2 },
    ]);
  });

  test("scalar inference: numbers", () => {
    expectShape(parseYaml("a: 1\nb: -1\nc: 1.5\nd: -2.5e3"), {
      a: 1,
      b: -1,
      c: 1.5,
      d: -2500,
    });
  });

  test("scalar inference: booleans + null", () => {
    expectShape(parseYaml("a: true\nb: false\nc: null\nd: ~\ne: yes\nf: no"), {
      a: true,
      b: false,
      c: null,
      d: null,
      e: true,
      f: false,
    });
  });

  test("scalar inference: quoted strings", () => {
    expectShape(parseYaml(`name: "Olivier V."\nbio: 'tau-mux author'`), {
      name: "Olivier V.",
      bio: "tau-mux author",
    });
  });

  test("double-quote escape sequences", () => {
    expectShape(parseYaml(String.raw`msg: "He said \"hi\""`), {
      msg: 'He said "hi"',
    });
  });

  test("comments are stripped (when preceded by whitespace)", () => {
    expectShape(parseYaml("a: 1 # this is a comment\nb: 2"), { a: 1, b: 2 });
  });

  test("empty input returns null", () => {
    expectShape(parseYaml(""), null);
  });

  test("blank lines between entries are ignored", () => {
    expectShape(parseYaml("a: 1\n\n\nb: 2"), { a: 1, b: 2 });
  });

  test("string values with colons in them survive the parser", () => {
    expectShape(parseYaml(`url: "https://example.com/x"`), {
      url: "https://example.com/x",
    });
  });

  test("rejects tab-indented input cleanly", () => {
    expect(() => parseYaml("a:\n\tb: 1")).toThrow(/tab/);
  });

  test("rejects unrecognised line shape", () => {
    expect(() => parseYaml("just a sentence with no colon")).toThrow();
  });

  test("CRLF line endings normalise", () => {
    expectShape(parseYaml("a: 1\r\nb: 2\r\n"), { a: 1, b: 2 });
  });
});
