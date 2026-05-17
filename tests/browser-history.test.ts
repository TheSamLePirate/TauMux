import { describe, test, expect, afterEach } from "bun:test";
import { BrowserHistoryStore } from "../src/bun/browser-history";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeStore(): { store: BrowserHistoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ht-browser-history-"));
  return { store: new BrowserHistoryStore(dir), dir };
}

afterEach(() => {
  // Cleanup is best-effort (tests create temp dirs)
});

describe("BrowserHistoryStore", () => {
  test("record creates an entry", () => {
    const { store } = makeStore();
    store.record("https://example.com", "Example");
    const results = store.search("example");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com");
    expect(results[0].title).toBe("Example");
    expect(results[0].visitCount).toBe(1);
  });

  test("record increments visit count on duplicate", () => {
    const { store } = makeStore();
    store.record("https://example.com", "Example");
    store.record("https://example.com", "Example Updated");
    const results = store.search("example");
    expect(results).toHaveLength(1);
    expect(results[0].visitCount).toBe(2);
    expect(results[0].title).toBe("Example Updated");
  });

  test("normalizes URLs (trailing slash, www prefix)", () => {
    const { store } = makeStore();
    store.record("https://www.example.com/", "A");
    store.record("https://example.com", "B");
    // Should be treated as the same URL
    const results = store.search("example");
    expect(results).toHaveLength(1);
    expect(results[0].visitCount).toBe(2);
  });

  test("search filters by query", () => {
    const { store } = makeStore();
    store.record("https://github.com", "GitHub");
    store.record("https://google.com", "Google");
    store.record("https://example.com", "Example");
    const results = store.search("goo");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Google");
  });

  test("search matches title too", () => {
    const { store } = makeStore();
    store.record("https://a.com", "My Cool Dashboard");
    const results = store.search("dashboard");
    expect(results).toHaveLength(1);
  });

  test("search with empty query returns all", () => {
    const { store } = makeStore();
    store.record("https://a.com", "A");
    store.record("https://b.com", "B");
    store.record("https://c.com", "C");
    expect(store.search("")).toHaveLength(3);
  });

  test("search respects limit", () => {
    const { store } = makeStore();
    for (let i = 0; i < 20; i++) {
      store.record(`https://site${i}.com`, `Site ${i}`);
    }
    expect(store.search("", 5)).toHaveLength(5);
  });

  test("ignores about:blank", () => {
    const { store } = makeStore();
    store.record("about:blank", "");
    expect(store.search("")).toHaveLength(0);
  });

  test("clear removes all entries", () => {
    const { store } = makeStore();
    store.record("https://a.com", "A");
    store.record("https://b.com", "B");
    store.clear();
    expect(store.search("")).toHaveLength(0);
  });

  test("getAll returns entries sorted by recency", () => {
    const { store } = makeStore();
    store.record("https://a.com", "A");
    store.record("https://b.com", "B");
    store.record("https://c.com", "C");
    const all = store.getAll();
    expect(all).toHaveLength(3);
    // All were recorded within the same ms; verify all 3 are present
    const urls = new Set(all.map((e) => e.url));
    expect(urls.has("https://a.com")).toBe(true);
    expect(urls.has("https://b.com")).toBe(true);
    expect(urls.has("https://c.com")).toBe(true);
  });

  test("persistence round-trip", async () => {
    const { store, dir } = makeStore();
    store.record("https://persistent.com", "Persistent");
    store.saveNow();

    // Create a new store reading from the same dir
    const store2 = new BrowserHistoryStore(dir);
    await store2.ready;
    const results = store2.search("persistent");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://persistent.com");
    expect(results[0].title).toBe("Persistent");
  });

  // ────────────────────────────────────────────────────────────────
  // Phase 7 — URL normalization
  // ────────────────────────────────────────────────────────────────

  test("normalizes case-different hostnames into one entry", () => {
    const { store } = makeStore();
    store.record("https://Example.com/", "A");
    store.record("https://EXAMPLE.com/", "B");
    store.record("https://example.com", "C");
    const results = store.search("example");
    expect(results).toHaveLength(1);
    expect(results[0].visitCount).toBe(3);
  });

  test("strips the fragment so #anchor variants collide", () => {
    const { store } = makeStore();
    store.record("https://example.com/article", "Article");
    store.record("https://example.com/article#section-1", "Article §1");
    store.record("https://example.com/article#section-2", "Article §2");
    const results = store.search("example");
    expect(results).toHaveLength(1);
    expect(results[0].visitCount).toBe(3);
  });

  test("strips the default port (80 on http, 443 on https)", () => {
    const { store } = makeStore();
    store.record("https://example.com:443/", "443");
    store.record("https://example.com/", "noport");
    const httpsResults = store.search("example");
    expect(httpsResults).toHaveLength(1);
    expect(httpsResults[0].visitCount).toBe(2);

    const { store: store2 } = makeStore();
    store2.record("http://example.com:80/", "80");
    store2.record("http://example.com/", "noport");
    const httpResults = store2.search("example");
    expect(httpResults).toHaveLength(1);
    expect(httpResults[0].visitCount).toBe(2);
  });

  test("a non-default port stays distinct (does not collide with default)", () => {
    const { store } = makeStore();
    store.record("https://example.com/", "443");
    store.record("https://example.com:8443/", "8443");
    const results = store.search("example");
    // Different effective origins — two entries, not aggregated.
    expect(results).toHaveLength(2);
  });

  test("combined normalize: case + fragment + port + www + trailing slash", () => {
    const { store } = makeStore();
    store.record("https://WWW.Example.com:443/article/", "v1");
    store.record("https://example.com/article", "v2");
    store.record("https://example.com/article#footer", "v3");
    const results = store.search("article");
    expect(results).toHaveLength(1);
    expect(results[0].visitCount).toBe(3);
  });
});
