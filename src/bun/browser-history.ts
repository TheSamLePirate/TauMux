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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

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

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // Remove trailing slash from pathname (unless it IS the pathname)
      if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.slice(0, -1);
      }
      // Remove www prefix from hostname
      u.hostname = u.hostname.replace(/^www\./, "");
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
      await Bun.write(this.filePath, JSON.stringify(arr));
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
