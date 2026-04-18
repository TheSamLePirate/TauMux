import { describe, expect, test } from "bun:test";
import {
  latestPerKey,
  parseIndexLines,
} from "../../src/design-report/index-io";

describe("parseIndexLines", () => {
  test("parses one entry per non-empty line", () => {
    const body =
      `{"spec":"a","test":"t1","step":"s1","path":"/x.png"}\n` +
      `{"spec":"a","test":"t1","step":"s2","path":"/y.png"}\n`;
    const entries = parseIndexLines(body);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.step).toBe("s1");
  });

  test("skips malformed lines without throwing", () => {
    const body =
      `{"spec":"a","test":"t1","step":"s1","path":"/x.png"}\n` +
      `not-json\n` +
      `{"spec":"a","test":"t1","step":"s2","path":"/y.png"}\n`;
    const entries = parseIndexLines(body);
    expect(entries).toHaveLength(2);
  });

  test("empty input → empty array", () => {
    expect(parseIndexLines("")).toHaveLength(0);
  });
});

describe("latestPerKey", () => {
  test("keeps newest entry by timestamp", () => {
    const entries = [
      {
        spec: "a",
        test: "t",
        step: "s",
        path: "/old.png",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        spec: "a",
        test: "t",
        step: "s",
        path: "/new.png",
        timestamp: "2024-06-01T00:00:00Z",
      },
    ];
    const reduced = latestPerKey(entries);
    expect(reduced).toHaveLength(1);
    expect(reduced[0]!.path).toBe("/new.png");
  });

  test("respects suite as part of key", () => {
    const entries = [
      {
        suite: "web" as const,
        spec: "a",
        test: "t",
        step: "s",
        path: "/web.png",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        suite: "native" as const,
        spec: "a",
        test: "t",
        step: "s",
        path: "/native.png",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];
    const reduced = latestPerKey(entries);
    expect(reduced).toHaveLength(2);
  });

  test("missing timestamp → treated as zero-time (anything newer wins)", () => {
    const entries = [
      { spec: "a", test: "t", step: "s", path: "/no-ts.png" },
      {
        spec: "a",
        test: "t",
        step: "s",
        path: "/has-ts.png",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];
    const reduced = latestPerKey(entries);
    expect(reduced[0]!.path).toBe("/has-ts.png");
  });
});
