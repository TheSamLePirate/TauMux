/**
 * CookieStore — JSON-persisted cookie store for the in-app browser.
 *
 * Stores imported and captured cookies, auto-injects matching cookies
 * when browser panes navigate. Follows the BrowserHistoryStore pattern.
 *
 * Electrobun has no native cookie management API, so we track cookies
 * ourselves and inject them via `document.cookie` on each navigation.
 * HTTP-only cookies are stored for reference but cannot be injected.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configDir: string) {
    this.filePath = join(configDir, "cookie-store.json");
    this.load();
  }

  /** Unique key for a cookie (matches browser semantics). */
  private key(domain: string, path: string, name: string): string {
    return `${domain}|${path}|${name}`;
  }

  /** Add or update a single cookie. */
  set(cookie: CookieEntry): void {
    if (!cookie.name || !cookie.domain) return;
    const k = this.key(cookie.domain, cookie.path || "/", cookie.name);
    this.entries.set(k, { ...cookie, updatedAt: Date.now() });
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
      count++;
    }
    this.evictIfNeeded();
    this.scheduleSave();
    return count;
  }

  /**
   * Get cookies matching a domain. Standard domain matching:
   * ".example.com" matches "sub.example.com" and "example.com".
   */
  getForDomain(domain: string): CookieEntry[] {
    const results: CookieEntry[] = [];
    for (const entry of this.entries.values()) {
      if (this.domainMatches(entry.domain, domain)) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Get cookies matching a full URL (domain + path + secure check).
   * Filters out secure cookies for non-HTTPS URLs.
   * Filters out httpOnly cookies (cannot be injected via document.cookie).
   */
  getForUrl(url: string): CookieEntry[] {
    try {
      const u = new URL(url);
      const isSecure = u.protocol === "https:";
      const results: CookieEntry[] = [];
      for (const entry of this.entries.values()) {
        if (!this.domainMatches(entry.domain, u.hostname)) continue;
        if (!u.pathname.startsWith(entry.path)) continue;
        if (entry.secure && !isSecure) continue;
        if (entry.httpOnly) continue; // can't inject via document.cookie
        // Skip expired cookies
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
    const deleted = this.entries.delete(k);
    if (deleted) this.scheduleSave();
    return deleted;
  }

  /** Delete all cookies for a domain. Returns count deleted. */
  deleteForDomain(domain: string): number {
    let count = 0;
    for (const [k, entry] of this.entries) {
      if (this.domainMatches(entry.domain, domain) || entry.domain === domain) {
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
    this.scheduleSave();
  }

  /** Export all cookies as an array. */
  exportAll(): CookieEntry[] {
    return [...this.entries.values()];
  }

  /** Immediately flush to disk (call on shutdown). */
  saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.save();
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
    for (const [k] of toDelete) this.entries.delete(k);
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, "utf-8");
      const arr = JSON.parse(raw) as CookieEntry[];
      if (!Array.isArray(arr)) return;
      for (const entry of arr) {
        if (entry.name && entry.domain) {
          const k = this.key(entry.domain, entry.path || "/", entry.name);
          this.entries.set(k, entry);
        }
      }
    } catch {
      /* ignore corrupt files */
    }
  }

  private save(): void {
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
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }
}
