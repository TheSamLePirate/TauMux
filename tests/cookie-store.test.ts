import { describe, test, expect } from "bun:test";
import { CookieStore, type CookieEntry } from "../src/bun/cookie-store";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeStore(): { store: CookieStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ht-cookie-store-"));
  return { store: new CookieStore(dir), dir };
}

function makeCookie(overrides: Partial<CookieEntry> = {}): CookieEntry {
  return {
    name: "session",
    value: "abc123",
    domain: ".example.com",
    path: "/",
    expires: 0,
    secure: false,
    httpOnly: false,
    sameSite: "",
    source: "imported",
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("CookieStore", () => {
  test("set and getAll", () => {
    const { store } = makeStore();
    store.set(makeCookie());
    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("session");
    expect(all[0].value).toBe("abc123");
  });

  test("set updates existing cookie with same key", () => {
    const { store } = makeStore();
    store.set(makeCookie({ value: "old" }));
    store.set(makeCookie({ value: "new" }));
    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].value).toBe("new");
  });

  test("different name/path/domain = different cookies", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".foo.com" }));
    store.set(makeCookie({ name: "b", domain: ".foo.com" }));
    store.set(makeCookie({ name: "a", domain: ".bar.com" }));
    store.set(makeCookie({ name: "a", domain: ".foo.com", path: "/api" }));
    expect(store.getAll()).toHaveLength(4);
  });

  test("importBulk", () => {
    const { store } = makeStore();
    const cookies = [
      makeCookie({ name: "a", domain: ".one.com" }),
      makeCookie({ name: "b", domain: ".two.com" }),
      makeCookie({ name: "", domain: ".skip.com" }), // invalid
    ];
    const count = store.importBulk(cookies);
    expect(count).toBe(2);
    expect(store.getAll()).toHaveLength(2);
  });

  test("getForDomain matches subdomains", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".example.com" }));
    store.set(makeCookie({ name: "b", domain: ".other.com" }));

    const result = store.getForDomain("sub.example.com");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("a");
  });

  test("getForDomain matches exact domain", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".example.com" }));

    const result = store.getForDomain("example.com");
    expect(result).toHaveLength(1);
  });

  test("getForUrl filters by path", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "root", path: "/" }));
    store.set(makeCookie({ name: "api", path: "/api" }));

    const rootResult = store.getForUrl("https://example.com/");
    expect(rootResult).toHaveLength(1);
    expect(rootResult[0].name).toBe("root");

    const apiResult = store.getForUrl("https://example.com/api/test");
    expect(apiResult).toHaveLength(2);
  });

  test("getForUrl filters out secure cookies on http", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "sec", secure: true }));
    store.set(makeCookie({ name: "plain", secure: false }));

    const httpResult = store.getForUrl("http://example.com/");
    expect(httpResult).toHaveLength(1);
    expect(httpResult[0].name).toBe("plain");

    const httpsResult = store.getForUrl("https://example.com/");
    expect(httpsResult).toHaveLength(2);
  });

  test("getForUrl filters out httpOnly cookies", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "js", httpOnly: false }));
    store.set(makeCookie({ name: "http", httpOnly: true }));

    const result = store.getForUrl("https://example.com/");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("js");
  });

  test("getForUrl filters out expired cookies", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "valid", expires: 0 })); // session
    store.set(
      makeCookie({
        name: "future",
        expires: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    store.set(makeCookie({ name: "expired", expires: 1000 })); // long ago

    const result = store.getForUrl("https://example.com/");
    expect(result).toHaveLength(2);
    const names = result.map((c) => c.name).sort();
    expect(names).toEqual(["future", "valid"]);
  });

  test("search by domain", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".github.com" }));
    store.set(makeCookie({ name: "b", domain: ".google.com" }));
    store.set(makeCookie({ name: "c", domain: ".example.com" }));

    const result = store.search("goo");
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe(".google.com");
  });

  test("search by name", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "session_id", domain: ".a.com" }));
    store.set(makeCookie({ name: "csrf_token", domain: ".b.com" }));

    const result = store.search("csrf");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("csrf_token");
  });

  test("delete specific cookie", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".x.com" }));
    store.set(makeCookie({ name: "b", domain: ".x.com" }));

    expect(store.delete(".x.com", "/", "a")).toBe(true);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].name).toBe("b");
  });

  test("delete returns false for nonexistent", () => {
    const { store } = makeStore();
    expect(store.delete(".nope.com", "/", "nope")).toBe(false);
  });

  test("deleteForDomain", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".example.com" }));
    store.set(makeCookie({ name: "b", domain: ".example.com" }));
    store.set(makeCookie({ name: "c", domain: ".other.com" }));

    const count = store.deleteForDomain(".example.com");
    expect(count).toBe(2);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].domain).toBe(".other.com");
  });

  test("clear", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".a.com" }));
    store.set(makeCookie({ name: "b", domain: ".b.com" }));
    store.clear();
    expect(store.size).toBe(0);
  });

  test("persistence round-trip", () => {
    const { store, dir } = makeStore();
    store.set(makeCookie({ name: "persist", value: "test", domain: ".p.com" }));
    store.saveNow();

    const store2 = new CookieStore(dir);
    const all = store2.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("persist");
    expect(all[0].value).toBe("test");
  });

  test("exportAll returns all entries", () => {
    const { store } = makeStore();
    store.set(makeCookie({ name: "a", domain: ".a.com" }));
    store.set(makeCookie({ name: "b", domain: ".b.com" }));
    const exported = store.exportAll();
    expect(exported).toHaveLength(2);
  });
});
