import { describe, test, expect } from "bun:test";
import { isUrl, normalizeUrl, buildSearchUrl } from "../src/views/terminal/browser-pane";

describe("URL helpers", () => {
  describe("isUrl", () => {
    test("http URLs", () => {
      expect(isUrl("http://example.com")).toBe(true);
      expect(isUrl("https://example.com")).toBe(true);
      expect(isUrl("https://example.com/path?q=1")).toBe(true);
    });

    test("localhost", () => {
      expect(isUrl("localhost")).toBe(true);
      expect(isUrl("localhost:3000")).toBe(true);
      expect(isUrl("localhost:3000/path")).toBe(true);
    });

    test("IP addresses", () => {
      expect(isUrl("127.0.0.1")).toBe(true);
      expect(isUrl("127.0.0.1:8080")).toBe(true);
      expect(isUrl("::1")).toBe(true);
    });

    test("domain-like strings", () => {
      expect(isUrl("example.com")).toBe(true);
      expect(isUrl("github.com/user/repo")).toBe(true);
      expect(isUrl("sub.domain.com")).toBe(true);
    });

    test("search queries (not URLs)", () => {
      expect(isUrl("hello world")).toBe(false);
      expect(isUrl("what is javascript")).toBe(false);
      expect(isUrl("singleword")).toBe(false);
    });
  });

  describe("normalizeUrl", () => {
    test("adds https to bare domains", () => {
      expect(normalizeUrl("example.com")).toBe("https://example.com");
    });

    test("keeps existing protocol", () => {
      expect(normalizeUrl("http://example.com")).toBe("http://example.com");
      expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    });

    test("adds http to localhost", () => {
      expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000");
      expect(normalizeUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    });
  });

  describe("buildSearchUrl", () => {
    test("builds google search URL", () => {
      const url = buildSearchUrl("test query", "google");
      expect(url).toStartWith("https://www.google.com/search?q=");
      expect(url).toContain("test%20query");
    });

    test("builds duckduckgo search URL", () => {
      const url = buildSearchUrl("test", "duckduckgo");
      expect(url).toStartWith("https://duckduckgo.com/?q=");
    });

    test("defaults to google for unknown engine", () => {
      const url = buildSearchUrl("test", "unknown");
      expect(url).toStartWith("https://www.google.com/search?q=");
    });

    test("encodes special characters", () => {
      const url = buildSearchUrl("hello & world", "google");
      expect(url).toContain("hello%20%26%20world");
    });
  });
});

describe("file:// URLs (local preview)", () => {
  test("isUrl recognises file://", () => {
    expect(isUrl("file:///tmp/report/index.html")).toBe(true);
  });

  test("normalizeUrl leaves file:// alone", () => {
    // Without the file:// branch this became `https://file:///…`, so a
    // local preview broke the moment the address bar round-tripped it.
    expect(normalizeUrl("file:///tmp/a.html")).toBe("file:///tmp/a.html");
  });

  test("http and https are still untouched", () => {
    expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });

  test("a bare hostname still gets https", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });
});
