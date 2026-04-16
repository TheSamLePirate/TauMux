import { describe, test, expect } from "bun:test";
import {
  parseJsonCookies,
  parseNetscapeCookies,
  exportAsJson,
  exportAsNetscape,
} from "../src/bun/cookie-parsers";

describe("parseJsonCookies", () => {
  test("parses EditThisCookie format", () => {
    const input = JSON.stringify([
      {
        name: "session_id",
        value: "abc123",
        domain: "example.com",
        path: "/",
        expirationDate: 1735689600,
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      },
    ]);
    const result = parseJsonCookies(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("session_id");
    expect(result[0].value).toBe("abc123");
    expect(result[0].domain).toBe(".example.com");
    expect(result[0].path).toBe("/");
    expect(result[0].expires).toBe(1735689600);
    expect(result[0].secure).toBe(true);
    expect(result[0].httpOnly).toBe(false);
    expect(result[0].sameSite).toBe("Lax");
    expect(result[0].source).toBe("imported");
  });

  test("handles 'expires' field name", () => {
    const input = JSON.stringify([
      { name: "tok", value: "v", domain: "a.com", expires: 9999999 },
    ]);
    const result = parseJsonCookies(input);
    expect(result[0].expires).toBe(9999999);
  });

  test("handles single object (not array)", () => {
    const input = JSON.stringify({
      name: "single",
      value: "val",
      domain: "s.com",
    });
    const result = parseJsonCookies(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("single");
  });

  test("skips entries without name or domain", () => {
    const input = JSON.stringify([
      { name: "", value: "v", domain: "a.com" },
      { name: "ok", value: "v", domain: "b.com" },
      { name: "no-domain", value: "v" },
    ]);
    const result = parseJsonCookies(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ok");
  });

  test("normalizes domain with leading dot", () => {
    const input = JSON.stringify([
      { name: "a", value: "v", domain: "example.com" },
    ]);
    const result = parseJsonCookies(input);
    expect(result[0].domain).toBe(".example.com");
  });

  test("preserves existing leading dot", () => {
    const input = JSON.stringify([
      { name: "a", value: "v", domain: ".example.com" },
    ]);
    const result = parseJsonCookies(input);
    expect(result[0].domain).toBe(".example.com");
  });

  test("does not add dot to IP addresses", () => {
    const input = JSON.stringify([
      { name: "a", value: "v", domain: "127.0.0.1" },
    ]);
    const result = parseJsonCookies(input);
    expect(result[0].domain).toBe("127.0.0.1");
  });

  test("normalizes sameSite values", () => {
    const input = JSON.stringify([
      { name: "a", value: "v", domain: "a.com", sameSite: "strict" },
      { name: "b", value: "v", domain: "b.com", sameSite: "LAX" },
      { name: "c", value: "v", domain: "c.com", sameSite: "none" },
      { name: "d", value: "v", domain: "d.com", sameSite: "garbage" },
      { name: "e", value: "v", domain: "e.com" },
    ]);
    const result = parseJsonCookies(input);
    expect(result[0].sameSite).toBe("Strict");
    expect(result[1].sameSite).toBe("Lax");
    expect(result[2].sameSite).toBe("None");
    expect(result[3].sameSite).toBe("");
    expect(result[4].sameSite).toBe("");
  });

  test("returns empty for invalid JSON", () => {
    expect(parseJsonCookies("not json")).toEqual([]);
    expect(parseJsonCookies("")).toEqual([]);
  });
});

describe("parseNetscapeCookies", () => {
  test("parses standard format", () => {
    const input = [
      "# Netscape HTTP Cookie File",
      ".example.com\tTRUE\t/\tFALSE\t1735689600\tsession_id\tabc123",
    ].join("\n");
    const result = parseNetscapeCookies(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("session_id");
    expect(result[0].value).toBe("abc123");
    expect(result[0].domain).toBe(".example.com");
    expect(result[0].path).toBe("/");
    expect(result[0].expires).toBe(1735689600);
    expect(result[0].secure).toBe(false);
    expect(result[0].source).toBe("imported");
  });

  test("parses secure cookies", () => {
    const input = ".secure.com\tTRUE\t/\tTRUE\t0\ttoken\tsecret";
    const result = parseNetscapeCookies(input);
    expect(result[0].secure).toBe(true);
  });

  test("skips comment and blank lines", () => {
    const input = [
      "# Comment",
      "",
      "  ",
      ".a.com\tTRUE\t/\tFALSE\t0\tname\tvalue",
      "# Another comment",
    ].join("\n");
    const result = parseNetscapeCookies(input);
    expect(result).toHaveLength(1);
  });

  test("skips lines with too few fields", () => {
    const input = [
      ".a.com\tTRUE\t/\tFALSE\t0\tname\tvalue",
      ".b.com\tTRUE\t/",
    ].join("\n");
    const result = parseNetscapeCookies(input);
    expect(result).toHaveLength(1);
  });

  test("handles value with tabs", () => {
    const input = ".a.com\tTRUE\t/\tFALSE\t0\tname\tval\twith\ttabs";
    const result = parseNetscapeCookies(input);
    expect(result[0].value).toBe("val\twith\ttabs");
  });

  test("returns empty for empty input", () => {
    expect(parseNetscapeCookies("")).toEqual([]);
  });
});

describe("exportAsJson", () => {
  test("exports to EditThisCookie-compatible format", () => {
    const cookies = [
      {
        name: "test",
        value: "val",
        domain: ".example.com",
        path: "/",
        expires: 1735689600,
        secure: true,
        httpOnly: false,
        sameSite: "Lax" as const,
        source: "imported" as const,
        updatedAt: Date.now(),
      },
    ];
    const json = exportAsJson(cookies);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("test");
    expect(parsed[0].expirationDate).toBe(1735689600);
    expect(parsed[0].session).toBe(false);
  });

  test("session cookies have session: true", () => {
    const cookies = [
      {
        name: "s",
        value: "v",
        domain: ".a.com",
        path: "/",
        expires: 0,
        secure: false,
        httpOnly: false,
        sameSite: "" as const,
        source: "imported" as const,
        updatedAt: Date.now(),
      },
    ];
    const parsed = JSON.parse(exportAsJson(cookies));
    expect(parsed[0].session).toBe(true);
  });
});

describe("exportAsNetscape", () => {
  test("exports to Netscape format", () => {
    const cookies = [
      {
        name: "token",
        value: "secret",
        domain: ".secure.com",
        path: "/api",
        expires: 1735689600,
        secure: true,
        httpOnly: false,
        sameSite: "" as const,
        source: "imported" as const,
        updatedAt: Date.now(),
      },
    ];
    const output = exportAsNetscape(cookies);
    expect(output).toContain("# Netscape HTTP Cookie File");
    expect(output).toContain(
      ".secure.com\tTRUE\t/api\tTRUE\t1735689600\ttoken\tsecret",
    );
  });

  test("non-dot domain uses FALSE flag", () => {
    const cookies = [
      {
        name: "a",
        value: "v",
        domain: "exact.com",
        path: "/",
        expires: 0,
        secure: false,
        httpOnly: false,
        sameSite: "" as const,
        source: "imported" as const,
        updatedAt: Date.now(),
      },
    ];
    const output = exportAsNetscape(cookies);
    expect(output).toContain("exact.com\tFALSE\t/\tFALSE\t0\ta\tv");
  });
});

describe("round-trip", () => {
  test("JSON export → import preserves data", () => {
    const original = [
      {
        name: "rt",
        value: "test",
        domain: ".rt.com",
        path: "/",
        expires: 1735689600,
        secure: true,
        httpOnly: false,
        sameSite: "Strict" as const,
        source: "imported" as const,
        updatedAt: Date.now(),
      },
    ];
    const exported = exportAsJson(original);
    const reimported = parseJsonCookies(exported);
    expect(reimported).toHaveLength(1);
    expect(reimported[0].name).toBe("rt");
    expect(reimported[0].value).toBe("test");
    expect(reimported[0].domain).toBe(".rt.com");
    expect(reimported[0].expires).toBe(1735689600);
    expect(reimported[0].secure).toBe(true);
  });

  test("Netscape export → import preserves data", () => {
    const original = [
      {
        name: "ns",
        value: "data",
        domain: ".ns.com",
        path: "/path",
        expires: 9999999,
        secure: false,
        httpOnly: false,
        sameSite: "" as const,
        source: "imported" as const,
        updatedAt: Date.now(),
      },
    ];
    const exported = exportAsNetscape(original);
    const reimported = parseNetscapeCookies(exported);
    expect(reimported).toHaveLength(1);
    expect(reimported[0].name).toBe("ns");
    expect(reimported[0].value).toBe("data");
    expect(reimported[0].domain).toBe(".ns.com");
    expect(reimported[0].path).toBe("/path");
    expect(reimported[0].expires).toBe(9999999);
  });
});
