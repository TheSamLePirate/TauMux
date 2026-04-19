import { Database } from "bun:sqlite";

/** A single message persisted to the local Telegram log. `direction` is
 *  "in" for messages received from Telegram and "out" for messages this
 *  app sent. `tgMessageId` is the Telegram-side id (null for out-bound
 *  before the API call returns; populated when sendMessage succeeds). */
export interface TelegramMessage {
  id: number;
  chatId: string;
  direction: "in" | "out";
  text: string;
  ts: number;
  tgMessageId: number | null;
  fromUserId: string | null;
  fromName: string | null;
}

export interface TelegramChatRow {
  id: string;
  name: string;
  lastSeen: number;
}

interface RawMessageRow {
  id: number;
  chat_id: string;
  direction: "in" | "out";
  text: string;
  ts: number;
  tg_message_id: number | null;
  from_user_id: string | null;
  from_name: string | null;
}

interface RawChatRow {
  id: string;
  name: string;
  last_seen: number;
}

/** Upper bound on persisted messages per chat. Older rows are pruned
 *  after every insert. 10k matches the user-requested cap. */
export const MAX_MESSAGES_PER_CHAT = 10_000;

/** Local SQLite log for the Telegram bot integration. Owns its own
 *  connection; thread-safe within a single Bun process. Open one
 *  instance per app run; call `close()` on shutdown. */
export class TelegramDatabase {
  private db: Database;

  constructor(filePath: string) {
    this.db = new Database(filePath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        text TEXT NOT NULL,
        ts INTEGER NOT NULL,
        tg_message_id INTEGER,
        from_user_id TEXT,
        from_name TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat_ts
        ON messages (chat_id, ts);
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    `);
    // Dedupe any pre-existing duplicates from older app versions before
    // we add the partial UNIQUE index — index creation would otherwise
    // fail on conflict and the next insert would crash.
    this.db.exec(`
      DELETE FROM messages
       WHERE tg_message_id IS NOT NULL
         AND id NOT IN (
           SELECT MIN(id) FROM messages
            WHERE tg_message_id IS NOT NULL
            GROUP BY chat_id, tg_message_id
         );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_chat_tg
        ON messages (chat_id, tg_message_id)
        WHERE tg_message_id IS NOT NULL;
    `);
  }

  /** Counter of inserts since the last trim per chat. Keeping trims
   *  out of the hot path (once every 256 rows) vs. running a DELETE-
   *  with-subquery per insert which turned 10k-row inserts into >5 s
   *  in tests. The cap may transiently exceed MAX_MESSAGES_PER_CHAT by
   *  up to 255 rows — fine, the eventual trim catches it. */
  private insertsSinceTrim = new Map<string, number>();
  private static TRIM_INTERVAL = 256;

  /** Persist a message. Returns `{ message, inserted }` so callers can
   *  branch on whether the row is new — duplicate inbound messages
   *  (same chat_id + tg_message_id) come back with `inserted: false` so
   *  the host doesn't double-broadcast on a poll-offset replay. */
  insertMessage(input: {
    chatId: string;
    direction: "in" | "out";
    text: string;
    ts: number;
    tgMessageId?: number | null;
    fromUserId?: string | null;
    fromName?: string | null;
  }): { message: TelegramMessage; inserted: boolean } {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO messages
         (chat_id, direction, text, ts, tg_message_id, from_user_id, from_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    );
    const row = stmt.get(
      input.chatId,
      input.direction,
      input.text,
      input.ts,
      input.tgMessageId ?? null,
      input.fromUserId ?? null,
      input.fromName ?? null,
    ) as { id: number } | undefined;

    if (!row) {
      // Dup hit — fetch the existing row so callers still get a valid id
      // for UI keying. Only reachable for inbound messages with a
      // tg_message_id (out-bound rows always have null and skip the
      // partial unique index).
      const existing = this.db
        .prepare(
          `SELECT id, chat_id, direction, text, ts, tg_message_id, from_user_id, from_name
             FROM messages
            WHERE chat_id = ? AND tg_message_id = ?
            LIMIT 1`,
        )
        .get(input.chatId, input.tgMessageId ?? null) as
        | RawMessageRow
        | undefined;
      if (existing) {
        return { message: rowToMessage(existing), inserted: false };
      }
      // Shouldn't happen — fall through and return the input optimistically.
    }

    const pending = (this.insertsSinceTrim.get(input.chatId) ?? 0) + 1;
    if (pending >= TelegramDatabase.TRIM_INTERVAL) {
      this.trimChat(input.chatId);
      this.insertsSinceTrim.set(input.chatId, 0);
    } else {
      this.insertsSinceTrim.set(input.chatId, pending);
    }
    return {
      message: {
        id: row?.id ?? 0,
        chatId: input.chatId,
        direction: input.direction,
        text: input.text,
        ts: input.ts,
        tgMessageId: input.tgMessageId ?? null,
        fromUserId: input.fromUserId ?? null,
        fromName: input.fromName ?? null,
      },
      inserted: !!row,
    };
  }

  /** Drop oldest rows for the chat once it crosses the cap. Keeps the
   *  newest MAX_MESSAGES_PER_CHAT by `id` (monotonic). Cheaper than a
   *  COUNT/DELETE pair because the subquery is an index scan. */
  private trimChat(chatId: string): void {
    this.db
      .prepare(
        `DELETE FROM messages
         WHERE chat_id = ?
           AND id NOT IN (
             SELECT id FROM messages
              WHERE chat_id = ?
              ORDER BY id DESC
              LIMIT ?
           )`,
      )
      .run(chatId, chatId, MAX_MESSAGES_PER_CHAT);
  }

  /** Return the most recent `limit` messages for a chat in chronological
   *  order. When `before` is provided, return messages with `id < before`
   *  (used for backwards pagination on scroll-up). */
  getHistory(chatId: string, limit = 50, before?: number): TelegramMessage[] {
    const rows = before
      ? (this.db
          .prepare(
            `SELECT id, chat_id, direction, text, ts, tg_message_id, from_user_id, from_name
               FROM messages
              WHERE chat_id = ? AND id < ?
              ORDER BY id DESC
              LIMIT ?`,
          )
          .all(chatId, before, limit) as RawMessageRow[])
      : (this.db
          .prepare(
            `SELECT id, chat_id, direction, text, ts, tg_message_id, from_user_id, from_name
               FROM messages
              WHERE chat_id = ?
              ORDER BY id DESC
              LIMIT ?`,
          )
          .all(chatId, limit) as RawMessageRow[]);
    return rows.reverse().map(rowToMessage);
  }

  upsertChat(chat: { id: string; name: string; ts: number }): void {
    this.db
      .prepare(
        `INSERT INTO chats (id, name, last_seen)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           last_seen = MAX(chats.last_seen, excluded.last_seen)`,
      )
      .run(chat.id, chat.name, chat.ts);
  }

  /** Bump `last_seen` without touching `name`. Used by outbound sends —
   *  the send caller has the chat id but typically not a friendly
   *  display name, and overwriting the name with the id would clobber
   *  the contact label seeded by the first inbound message. No-op when
   *  the chat row doesn't exist yet (incoming side will create it). */
  touchChat(chatId: string, ts: number): void {
    this.db
      .prepare(`UPDATE chats SET last_seen = MAX(last_seen, ?) WHERE id = ?`)
      .run(ts, chatId);
  }

  listChats(): TelegramChatRow[] {
    const rows = this.db
      .prepare(`SELECT id, name, last_seen FROM chats ORDER BY last_seen DESC`)
      .all() as RawChatRow[];
    return rows.map((r) => ({ id: r.id, name: r.name, lastSeen: r.last_seen }));
  }

  /** Run the deferred trim immediately for every chat with pending
   *  inserts. Called on shutdown and exposed for tests that assert on
   *  the exact cap. */
  flushPendingTrims(): void {
    for (const [chatId, pending] of this.insertsSinceTrim) {
      if (pending > 0) {
        this.trimChat(chatId);
        this.insertsSinceTrim.set(chatId, 0);
      }
    }
  }

  /** Read a small string value from the on-disk kv table. Used to
   *  persist things that aren't message rows — chiefly the polling
   *  offset, so a restart resumes mid-stream instead of re-pulling. */
  getKv(key: string): string | null {
    const row = this.db.prepare(`SELECT v FROM kv WHERE k = ?`).get(key) as
      | { v: string }
      | undefined;
    return row?.v ?? null;
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv (k, v) VALUES (?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      )
      .run(key, value);
  }

  countMessages(chatId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?`)
      .get(chatId) as { n: number };
    return row.n;
  }

  close(): void {
    try {
      this.flushPendingTrims();
    } catch {
      /* ignore */
    }
    this.db.close();
  }
}

function rowToMessage(r: RawMessageRow): TelegramMessage {
  return {
    id: r.id,
    chatId: r.chat_id,
    direction: r.direction,
    text: r.text,
    ts: r.ts,
    tgMessageId: r.tg_message_id,
    fromUserId: r.from_user_id,
    fromName: r.from_name,
  };
}
