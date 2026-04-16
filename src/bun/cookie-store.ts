/**
 * CookieStore — JSON-persisted cookie store for the in-app browser.
 *
 * Stores imported and captured cookies, auto-injects matching cookies
 * when browser panes navigate. Follows the BrowserHistoryStore pattern.
 *
 * Electrobun has no native cookie management API, so we track cookies
 * ourselves and inject them via `document.cookie` on each navigation.
 * HTTP-only cookies are stored for reference but cannot be injected.
 *
 * Performance: A secondary domain index (Map<domain, Set<key>>) avoids
 * O(n) linear scans on every navigation. getForUrl() is O(k) where
 * k = cookies for matching domains. File I/O is async (Bun.file/Bun.write)
 * except saveNow() which is synchronous for SIGINT/SIGTERM shutdown.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CookieEntry {
  name: string;
  value: string;
  domain: string; // ".example.com" or "example.com"
  path: string; // "/" by default
  expires: number; // epoch seconds (0 = session cookie)
  secure: boolean;
  httpOnly: boolean; // tracked but cannot be enforced via document.cookie
  sameSite: "Strict" | "Lax" | "None" | "";
  /** How this cookie was added: "imported" from file, "captured" from page. */
  source: "imported" | "captured";
  /** Epoch ms when this entry was added/updated in our store. */
  updatedAt: number;
}

const MAX_ENTRIES = 50_000;

export class CookieStore {
  private entries = new Map<string, CookieEntry>();
  /** Secondary index: normalized domain → set of cookie keys for O(k) lookups. */
  private domainIndex = new Map<string, Set<string>>();
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolves when the store has finished loading from disk. */
  readonly ready: Promise<void>;

  constructor(configDir: string) {
    this.filePath = join(configDir, "cookie-store.json");
    this.ready = this.loadAsync();
  }

  /** Unique key for a cookie (matches browser semantics). */
  private key(domain: string, path: string, name: string): string {
    return `${domain}|${path}|${name}`;
  }

  // ── Domain index helpers ──

  /** Strip leading dot and lowercase for index key. */
  private normalizeDomainKey(domain: string): string {
    const d = domain.startsWith(".") ? domain.slice(1) : domain;
    return d.toLowerCase();
  }

  /**
   * Return all domain suffixes for a hostname.
   * "a.b.example.com" → ["a.b.example.com", "b.example.com", "example.com"]
   */
  private domainSuffixes(hostname: string): string[] {
    const lower = hostname.toLowerCase();
    const suffixes: string[] = [lower];
    let idx = lower.indexOf(".");
    while (idx !== -1) {
      const suffix = lower.slice(idx + 1);
      if (suffix.includes(".")) {
        suffixes.push(suffix);
      }
      idx = lower.indexOf(".", idx + 1);
    }
    return suffixes;
  }

  private addToIndex(entryKey: string, domain: string): void {
    const dk = this.normalizeDomainKey(domain);
    let bucket = this.domainIndex.get(dk);
    if (!bucket) {
      bucket = new Set();
      this.domainIndex.set(dk, bucket);
    }
    bucket.add(entryKey);
  }

  private removeFromIndex(entryKey: string, domain: string): void {
    const dk = this.normalizeDomainKey(domain);
    const bucket = this.domainIndex.get(dk);
    if (!bucket) return;
    bucket.delete(entryKey);
    if (bucket.size === 0) this.domainIndex.delete(dk);
  }

  // ── Public API ──

  /** Add or update a single cookie. */
  set(cookie: CookieEntry): void {
    if (!cookie.name || !cookie.domain) return;
    const k = this.key(cookie.domain, cookie.path || "/", cookie.name);
    // Remove old index entry if domain changed
    const existing = this.entries.get(k);
    if (existing && existing.domain !== cookie.domain) {
      this.removeFromIndex(k, existing.domain);
    }
    this.entries.set(k, { ...cookie, updatedAt: Date.now() });
    this.addToIndex(k, cookie.domain);
    this.evictIfNeeded();
    this.scheduleSave();
  }

  /** Bulk import cookies. Returns count imported. */
  importBulk(cookies: CookieEntry[]): number {
    let count = 0;
    for (const c of cookies) {
      if (!c.name || !c.domain) continue;
      const k = this.key(c.domain, c.path || "/", c.name);
      this.entries.set(k, { ...c, updatedAt: Date.now() });
      this.addToIndex(k, c.domain);
      count++;
    }
    this.evictIfNeeded();
    this.scheduleSave();
    return count;
  }

  /**
   * Get cookies matching a domain. Uses the domain index for O(k) lookup.
   * ".example.com" matches "sub.example.com" and "example.com".
   */
  getForDomain(domain: string): CookieEntry[] {
    const candidateKeys = new Set<string>();
    for (const suffix of this.domainSuffixes(domain)) {
      const bucket = this.domainIndex.get(suffix);
      if (bucket) {
        for (const k of bucket) candidateKeys.add(k);
      }
    }
    // Also check the exact domain key (for cookies set on the domain itself)
    const exactBucket = this.domainIndex.get(this.normalizeDomainKey(domain));
    if (exactBucket) {
      for (const k of exactBucket) candidateKeys.add(k);
    }

    const results: CookieEntry[] = [];
    for (const k of candidateKeys) {
      const entry = this.entries.get(k);
      if (entry && this.domainMatches(entry.domain, domain)) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Get cookies matching a full URL (domain + path + secure check).
   * Uses the domain index for O(k) lookup instead of O(n) linear scan.
   * Filters out secure cookies for non-HTTPS URLs.
   * Filters out httpOnly cookies (cannot be injected via document.cookie).
   */
  getForUrl(url: string): CookieEntry[] {
    try {
      const u = new URL(url);
      const isSecure = u.protocol === "https:";

      // Collect candidate keys from domain index
      const candidateKeys = new Set<string>();
      for (const suffix of this.domainSuffixes(u.hostname)) {
        const bucket = this.domainIndex.get(suffix);
        if (bucket) {
          for (const k of bucket) candidateKeys.add(k);
        }
      }

      // Filter candidates by path, secure, httpOnly, expiry
      const results: CookieEntry[] = [];
      for (const k of candidateKeys) {
        const entry = this.entries.get(k);
        if (!entry) continue;
        if (!this.domainMatches(entry.domain, u.hostname)) continue;
        if (!u.pathname.startsWith(entry.path)) continue;
        if (entry.secure && !isSecure) continue;
        if (entry.httpOnly) continue;
        if (entry.expires > 0 && entry.expires < Date.now() / 1000) continue;
        results.push(entry);
      }
      return results;
    } catch {
      return [];
    }
  }

  /** Get all cookies in the store. */
  getAll(limit = 500): CookieEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /** Search cookies by domain substring. */
  search(query: string, limit = 100): CookieEntry[] {
    const q = query.toLowerCase();
    const results: CookieEntry[] = [];
    for (const entry of this.entries.values()) {
      const haystack = `${entry.domain} ${entry.name}`.toLowerCase();
      if (q && !haystack.includes(q)) continue;
      results.push(entry);
      if (results.length >= limit) break;
    }
    return results;
  }

  /** Delete a specific cookie by domain/path/name. */
  delete(domain: string, path: string, name: string): boolean {
    const k = this.key(domain, path, name);
    const entry = this.entries.get(k);
    if (!entry) return false;
    this.removeFromIndex(k, entry.domain);
    this.entries.delete(k);
    this.scheduleSave();
    return true;
  }

  /** Delete all cookies for a domain. Returns count deleted. */
  deleteForDomain(domain: string): number {
    let count = 0;
    for (const [k, entry] of this.entries) {
      if (this.domainMatches(entry.domain, domain) || entry.domain === domain) {
        this.removeFromIndex(k, entry.domain);
        this.entries.delete(k);
        count++;
      }
    }
    if (count > 0) this.scheduleSave();
    return count;
  }

  /** Clear all cookies. */
  clear(): void {
    this.entries.clear();
    this.domainIndex.clear();
    this.scheduleSave();
  }

  /** Export all cookies as an array. */
  exportAll(): CookieEntry[] {
    return [...this.entries.values()];
  }

  /** Immediately flush to disk synchronously (call on shutdown). */
  saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveSync();
  }

  get size(): number {
    return this.entries.size;
  }

  // ── Internals ──

  private domainMatches(cookieDomain: string, hostname: string): boolean {
    const cd = cookieDomain.startsWith(".")
      ? cookieDomain.slice(1)
      : cookieDomain;
    return hostname === cd || hostname.endsWith("." + cd);
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    const sorted = [...this.entries.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    const toDelete = sorted.slice(0, sorted.length - MAX_ENTRIES);
    for (const [k, entry] of toDelete) {
      this.removeFromIndex(k, entry.domain);
      this.entries.delete(k);
    }
  }

  private async loadAsync(): Promise<void> {
    try {
      const file = Bun.file(this.filePath);
      if (!(await file.exists())) return;
      const raw = await file.text();
      const arr = JSON.parse(raw) as CookieEntry[];
      if (!Array.isArray(arr)) return;
      for (const entry of arr) {
        if (entry.name && entry.domain) {
          const k = this.key(entry.domain, entry.path || "/", entry.name);
          this.entries.set(k, entry);
          this.addToIndex(k, entry.domain);
        }
      }
    } catch {
      /* ignore corrupt files */
    }
  }

  private async save(): Promise<void> {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const arr = [...this.entries.values()];
      await Bun.write(this.filePath, JSON.stringify(arr));
    } catch {
      /* ignore write failures */
    }
  }

  /** Synchronous save for shutdown (SIGINT/SIGTERM can't await). */
  private saveSync(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const arr = [...this.entries.values()];
      writeFileSync(this.filePath, JSON.stringify(arr));
    } catch {
      /* ignore write failures */
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 2000);
  }
}
