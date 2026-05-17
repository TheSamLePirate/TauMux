/**
 * BrowserHistoryStore — JSON-persisted browser navigation history.
 *
 * Stores URL, title, visit count, and last-visited timestamp.
 * Powers address bar autocomplete and the `ht browser-history` command.
 * Automatically deduplicates URLs (strips trailing slash, www prefix).
 *
 * File I/O is async (Bun.file/Bun.write) except saveNow() which is
 * synchronous for SIGINT/SIGTERM shutdown.
 */

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write";

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  lastVisited: number; // epoch ms
}

const MAX_ENTRIES = 10_000;

export class BrowserHistoryStore {
  private entries = new Map<string, BrowserHistoryEntry>();
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolves when the store has finished loading from disk. */
  readonly ready: Promise<void>;

  constructor(configDir: string) {
    this.filePath = join(configDir, "browser-history.json");
    this.ready = this.loadAsync();
  }

  /** Record a page visit. Creates or updates the entry. */
  record(url: string, title: string): void {
    if (!url || url === "about:blank") return;
    const key = this.normalizeUrl(url);
    const existing = this.entries.get(key);
    if (existing) {
      existing.visitCount++;
      existing.lastVisited = Date.now();
      if (title) existing.title = title;
    } else {
      this.entries.set(key, {
        url,
        title: title || url,
        visitCount: 1,
        lastVisited: Date.now(),
      });
    }
    // Evict oldest entries if over limit
    if (this.entries.size > MAX_ENTRIES) {
      const sorted = [...this.entries.entries()].sort(
        (a, b) => a[1].lastVisited - b[1].lastVisited,
      );
      const toDelete = sorted.slice(0, sorted.length - MAX_ENTRIES);
      for (const [k] of toDelete) this.entries.delete(k);
    }
    this.scheduleSave();
  }

  /**
   * Search entries matching query, sorted by relevance.
   * Relevance = visitCount * recency_boost.
   */
  search(query: string, limit = 10): BrowserHistoryEntry[] {
    const q = query.toLowerCase();
    const now = Date.now();
    const results: { entry: BrowserHistoryEntry; score: number }[] = [];

    for (const entry of this.entries.values()) {
      const haystack = `${entry.url} ${entry.title}`.toLowerCase();
      if (q && !haystack.includes(q)) continue;
      // Recency boost: entries visited in the last hour score higher
      const ageMs = now - entry.lastVisited;
      const recency = 1 / (1 + ageMs / (3600 * 1000)); // 0..1
      const score = entry.visitCount * (0.3 + 0.7 * recency);
      results.push({ entry, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => r.entry);
  }

  /** Return all entries, most recent first. */
  getAll(limit = 100): BrowserHistoryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.lastVisited - a.lastVisited)
      .slice(0, limit);
  }

  clear(): void {
    this.entries.clear();
    this.scheduleSave();
  }

  /** Immediately flush to disk synchronously (call on shutdown). */
  saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveSync();
  }

  // ── Internals ──

  /** Phase 7 — collapse the common dupe sources into a single
   *  canonical form so the visit-count for one logical page actually
   *  aggregates instead of fanning out across protocol-relative,
   *  cased-host, fragment-only, and default-port variants. Order
   *  matters: lowercase the host before stripping the www prefix
   *  (the regex is anchored), and drop the fragment before slicing
   *  the trailing slash (so `/foo/#bar` and `/foo/` collide). */
  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // Hostnames are case-insensitive per RFC 3986; `Example.com`
      // and `example.com` are the same site.
      u.hostname = u.hostname.toLowerCase();
      // Strip the `www.` prefix — sites that serve both bare apex
      // and www subdomain should aggregate in history.
      u.hostname = u.hostname.replace(/^www\./, "");
      // Drop the fragment — `#anchor` doesn't change the page
      // identity for history-aggregation purposes.
      u.hash = "";
      // Strip the default port for the protocol — `:80` on http and
      // `:443` on https are noise.
      if (
        (u.protocol === "http:" && u.port === "80") ||
        (u.protocol === "https:" && u.port === "443")
      ) {
        u.port = "";
      }
      // Remove trailing slash from the pathname (unless it IS the
      // pathname). Must run AFTER fragment strip so a URL like
      // `https://x.com/#a` ends up as `https://x.com` not
      // `https://x.com/`.
      if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  private async loadAsync(): Promise<void> {
    try {
      const file = Bun.file(this.filePath);
      if (!(await file.exists())) return;
      const raw = await file.text();
      const arr = JSON.parse(raw) as BrowserHistoryEntry[];
      if (!Array.isArray(arr)) return;
      for (const entry of arr) {
        if (entry.url) {
          this.entries.set(this.normalizeUrl(entry.url), entry);
        }
      }
    } catch (err) {
      // Corrupt history file used to silently reset — user lost every
      // visited URL with no warning. Log + back up the bad file so they
      // can recover manually; `.bak` sits next to the live file.
      console.warn(
        `[browser-history] ${this.filePath} is corrupt:`,
        err instanceof Error ? err.message : err,
      );
      try {
        const { renameSync } = await import("node:fs");
        renameSync(this.filePath, `${this.filePath}.bak`);
        console.warn(
          `[browser-history] saved corrupt copy to ${this.filePath}.bak`,
        );
      } catch {
        /* best-effort backup */
      }
    }
  }

  private saveWarned = false;

  private async save(): Promise<void> {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const arr = [...this.entries.values()];
      // Write-then-rename — atomic on POSIX (G.4 / L7) so a crash
      // mid-write never leaves a truncated browser-history.json.
      await Bun.write(`${this.filePath}.tmp`, JSON.stringify(arr));
      renameSync(`${this.filePath}.tmp`, this.filePath);
      this.saveWarned = false;
    } catch (err) {
      if (!this.saveWarned) {
        this.saveWarned = true;
        console.error(
          `[browser-history] failed to write ${this.filePath}:`,
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
      // History isn't quite "secrets" but URLs visited can be
      // sensitive — owner-only matches the cookies/settings policy
      // (H.1 / S1).
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
