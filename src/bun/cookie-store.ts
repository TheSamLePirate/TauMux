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

import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write";

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

/** Phase 7 — per-domain cap so a single hostile site can't dominate
 *  the global LRU. 500 cookies per normalized domain is generous —
 *  the worst-case real-world site ships ~30. Domains exceeding the
 *  cap evict their own oldest entries (LRU within the domain bucket). */
const MAX_PER_DOMAIN = 500;

/** Phase 7 — normalize a domain string at the entry boundary.
 *  Lowercases + strips a single leading dot. Cookies set on
 *  `.example.com` and `example.com` collide in browsers; matching
 *  that semantics here means a caller can't accidentally create two
 *  entries for the same site. */
function normalizeDomain(domain: string): string {
  const d = domain.startsWith(".") ? domain.slice(1) : domain;
  return d.toLowerCase();
}

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

  /** Add or update a single cookie. Phase 7: domain is normalized
   *  on insert (lowercase + leading-dot strip) so `EXAMPLE.com` and
   *  `example.com` collide as the browser does. Per-domain cap (500)
   *  evicts the oldest entries in the bucket before adding to keep
   *  a hostile site from dominating the global 50k cap. */
  set(cookie: CookieEntry): void {
    if (!cookie.name || !cookie.domain) return;
    const normalized = normalizeDomain(cookie.domain);
    const k = this.key(normalized, cookie.path || "/", cookie.name);
    const existing = this.entries.get(k);
    if (existing && existing.domain !== normalized) {
      this.removeFromIndex(k, existing.domain);
    }
    this.entries.set(k, {
      ...cookie,
      domain: normalized,
      updatedAt: Date.now(),
    });
    this.addToIndex(k, normalized);
    this.evictPerDomainIfNeeded(normalized);
    this.evictIfNeeded();
    this.scheduleSave();
  }

  /** Bulk import cookies. Returns count imported. Same normalization
   *  + per-domain cap as `set()`. */
  importBulk(cookies: CookieEntry[]): number {
    let count = 0;
    const touchedDomains = new Set<string>();
    for (const c of cookies) {
      if (!c.name || !c.domain) continue;
      const normalized = normalizeDomain(c.domain);
      const k = this.key(normalized, c.path || "/", c.name);
      this.entries.set(k, {
        ...c,
        domain: normalized,
        updatedAt: Date.now(),
      });
      this.addToIndex(k, normalized);
      touchedDomains.add(normalized);
      count++;
    }
    for (const d of touchedDomains) this.evictPerDomainIfNeeded(d);
    this.evictIfNeeded();
    this.scheduleSave();
    return count;
  }

  /** Phase 7 — enforce the per-domain cap by evicting the oldest
   *  entries in the bucket. Called after every insert touching the
   *  bucket. Cheap: bucket sizes are tiny for legitimate sites. */
  private evictPerDomainIfNeeded(normalized: string): void {
    const bucket = this.domainIndex.get(normalized);
    if (!bucket || bucket.size <= MAX_PER_DOMAIN) return;
    // Sort the bucket's entries by updatedAt asc and evict from the
    // head until we're at the cap.
    const candidates: { key: string; updatedAt: number }[] = [];
    for (const k of bucket) {
      const e = this.entries.get(k);
      if (e) candidates.push({ key: k, updatedAt: e.updatedAt });
    }
    candidates.sort((a, b) => a.updatedAt - b.updatedAt);
    const toEvict = candidates.length - MAX_PER_DOMAIN;
    for (let i = 0; i < toEvict; i++) {
      const { key } = candidates[i];
      this.entries.delete(key);
      bucket.delete(key);
    }
    if (bucket.size === 0) this.domainIndex.delete(normalized);
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

  /** Delete a specific cookie by domain/path/name. Phase 7: the
   *  caller's `domain` is normalized to match the storage key shape,
   *  so callers can pass either `.example.com` or `example.com`. */
  delete(domain: string, path: string, name: string): boolean {
    const normalized = normalizeDomain(domain);
    const k = this.key(normalized, path, name);
    const entry = this.entries.get(k);
    if (!entry) return false;
    this.removeFromIndex(k, entry.domain);
    this.entries.delete(k);
    this.scheduleSave();
    return true;
  }

  /** Delete all cookies for a domain. Returns count deleted. Phase 7:
   *  the caller's `domain` is normalized; the stored entries are
   *  already normalized (insert path), so this is a single
   *  comparison rather than the previous OR-with-raw fallback. */
  deleteForDomain(domain: string): number {
    const normalized = normalizeDomain(domain);
    let count = 0;
    for (const [k, entry] of this.entries) {
      if (
        this.domainMatches(entry.domain, normalized) ||
        entry.domain === normalized
      ) {
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
    } catch (err) {
      // Corrupt cookies.json used to silently log the user out of every
      // site. Log + back up so they can recover manually.
      console.warn(
        `[cookies] ${this.filePath} is corrupt:`,
        err instanceof Error ? err.message : err,
      );
      try {
        const { renameSync } = await import("node:fs");
        renameSync(this.filePath, `${this.filePath}.bak`);
        console.warn(`[cookies] saved corrupt copy to ${this.filePath}.bak`);
      } catch {
        /* best-effort */
      }
    }
  }

  private saveWarned = false;

  private async save(): Promise<void> {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const arr = [...this.entries.values()];
      // Write to a `.tmp` neighbor first, then rename — atomic on
      // POSIX, so a crash mid-write never leaves a truncated
      // cookies.json (G.4 / L7). Owner-only — cookies are sensitive
      // session material (H.1 / S1).
      await Bun.write(`${this.filePath}.tmp`, JSON.stringify(arr));
      renameSync(`${this.filePath}.tmp`, this.filePath);
      try {
        chmodSync(this.filePath, 0o600);
      } catch {
        /* best-effort — non-POSIX FS may reject chmod */
      }
      this.saveWarned = false;
    } catch (err) {
      if (!this.saveWarned) {
        this.saveWarned = true;
        console.error(
          `[cookies] failed to write ${this.filePath}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  /** Synchronous save for shutdown (SIGINT/SIGTERM can't await). */
  private saveSync(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const arr = [...this.entries.values()];
      writeFileAtomic(this.filePath, JSON.stringify(arr), { mode: 0o600 });
    } catch {
      /* ignore write failures */
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 2000);
  }
}
