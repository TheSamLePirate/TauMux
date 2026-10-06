import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TelegramDatabase,
  openTelegramDatabaseSafe,
} from "../src/bun/telegram-db";

/**
 * Regression tests for the boot-crash finding: a corrupt telegram.db
 * constructed at module top level used to abort the whole bootstrap
 * (no socket, no window). `openTelegramDatabaseSafe` must instead
 * move the corrupt file aside, retry, and worst-case fall back to an
 * in-memory DB — the app boots, the log for one session is the only
 * acceptable loss.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ht-tg-safe-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openTelegramDatabaseSafe", () => {
  test("opens a healthy DB without reporting degradation", () => {
    const reports: string[] = [];
    const db = openTelegramDatabaseSafe(join(dir, "telegram.db"), (m) =>
      reports.push(m),
    );
    expect(reports).toHaveLength(0);
    // Fully functional: write + read round-trip.
    db.insertMessage({
      chatId: "c1",
      direction: "in",
      text: "hello",
      ts: Date.now(),
      tgMessageId: null,
      fromUserId: null,
      fromName: null,
    });
    expect(db.getHistory("c1")).toHaveLength(1);
    db.close();
  });

  test("a garbage file is moved aside and recreated — never throws", () => {
    const dbPath = join(dir, "telegram.db");
    // Simulate corruption: a truncated/garbage file where SQLite
    // expects a valid header ("SQLite format 3\0").
    writeFileSync(dbPath, "this is definitely not a sqlite database");
    writeFileSync(`${dbPath}-wal`, "garbage wal");

    const reports: string[] = [];
    let db: TelegramDatabase | null = null;
    expect(() => {
      db = openTelegramDatabaseSafe(dbPath, (m) => reports.push(m));
    }).not.toThrow();

    expect(db).not.toBeNull();
    // Degradation was reported (health row + log line upstream).
    expect(reports.length).toBeGreaterThan(0);
    // The corrupt file was preserved for forensics, not deleted.
    const moved = Array.from(
      { length: 1 },
      () => existsSync(join(dir, "telegram.db")),
    );
    expect(moved[0]).toBe(true);
    // The recreated DB actually works.
    db!.insertMessage({
      chatId: "c1",
      direction: "out",
      text: "recovered",
      ts: Date.now(),
      tgMessageId: null,
      fromUserId: null,
      fromName: null,
    });
    expect(db!.getHistory("c1")).toHaveLength(1);
    db!.close();
  });

  test("falls back to in-memory when the path can never work", () => {
    // Point the DB at a path whose parent is a regular FILE: rename
    // can't move it aside, mkdir can't fix it, SQLite can't open it.
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "file");
    const impossible = join(blocker, "telegram.db");

    const reports: string[] = [];
    let db: TelegramDatabase | null = null;
    expect(() => {
      db = openTelegramDatabaseSafe(impossible, (m) => reports.push(m));
    }).not.toThrow();

    expect(db).not.toBeNull();
    expect(
      reports.some((m) => m.includes("in-memory")),
      `expected an in-memory fallback report, got: ${reports}`,
    ).toBe(true);
    // In-memory fallback still honours the full API surface.
    db!.insertMessage({
      chatId: "c1",
      direction: "in",
      text: "ephemeral",
      ts: Date.now(),
      tgMessageId: null,
      fromUserId: null,
      fromName: null,
    });
    expect(db!.getHistory("c1")).toHaveLength(1);
    db!.close();
  });
});
