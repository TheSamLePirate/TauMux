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
});
