import { TelegramDatabase, type TelegramMessage } from "./telegram-db";
import { parseAllowedTelegramIds } from "../shared/settings";

/** Telegram bot interface used by the service. Real impl is `fetch` against
 *  api.telegram.org; tests inject a stub so no real network calls happen.
 *  Keep it intentionally narrow — only the endpoints we actually use. */
export interface TelegramTransport {
  getUpdates(opts: {
    offset?: number;
    timeout: number;
    signal: AbortSignal;
  }): Promise<TelegramUpdate[]>;
  sendMessage(opts: {
    chatId: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; messageId?: number; description?: string }>;
  /** One-shot identity probe. Used at startup so the status pill can
   *  show "polling @MyBotName" and a malformed token surfaces before
   *  the first incoming message. */
  getMe(opts: {
    signal: AbortSignal;
  }): Promise<{ ok: boolean; username?: string; description?: string }>;
}

export interface TelegramUpdate {
  updateId: number;
  message?: {
    messageId: number;
    chatId: string;
    chatTitle: string;
    fromUserId: string;
    fromName: string;
    text: string;
    date: number;
  };
}

export type TelegramServiceState =
  | "disabled"
  | "starting"
  | "polling"
  | "conflict"
  | "error";

/** Thrown by the transport when Telegram returns HTTP 409 on getUpdates.
 *  The service catches this specifically to enter the `conflict` state
 *  and apply a long fixed backoff (instead of the exponential we use
 *  for transient errors like 5xx / network flakes). */
export class TelegramConflictError extends Error {
  constructor(detail: string = "getUpdates HTTP 409") {
    super(detail);
    this.name = "TelegramConflictError";
  }
}

export interface TelegramServiceStatus {
  state: TelegramServiceState;
  error?: string;
  /** Telegram username of the bot (returned by getMe). Empty until first
   *  successful poll. */
  botUsername?: string;
}

export interface TelegramServiceOptions {
  token: string;
  allowedUserIds: string;
  db: TelegramDatabase;
  transport?: TelegramTransport;
  /** Called when an inbound message lands (after persistence + allow-list). */
  onIncoming?: (message: TelegramMessage) => void;
  /** Called whenever the service state changes (UI status pill). */
  onStatus?: (status: TelegramServiceStatus) => void;
  /** Called for non-fatal logging the host wants to surface. */
  onLog?: (level: "info" | "warn" | "error", msg: string) => void;
}

const POLL_TIMEOUT_SEC = 25;
const ERROR_BACKOFF_MIN_MS = 2_000;
const ERROR_BACKOFF_MAX_MS = 60_000;
/** Backoff for HTTP 409 conflicts. Retrying faster is pointless —
 *  Telegram enforces single-consumer on getUpdates and the other
 *  consumer has to step aside before this bot can resume. 60 s lets
 *  the user stop the competing client without keeping us stuck in
 *  conflict for the full exponential-max window. */
const CONFLICT_BACKOFF_MS = 60_000;
const OFFSET_KV_KEY = "poll_offset";
const BOT_USERNAME_KV_KEY = "bot_username";

/** Per-chat outbound throttle. Telegram's documented limit is 30 messages/sec
 *  globally and 1 msg/sec per chat for sustained traffic — exceed it and
 *  the bot gets a 429 + retry-after, repeated offenses get permabanned.
 *  We enforce a 1 msg/sec/chat cap with a small burst (3) so a script
 *  spamming `notification.create` doesn't take the bot down. */
const RATE_BUCKET_CAPACITY = 3;
const RATE_REFILL_PER_SEC = 1;

/** Long-poll loop + send wrapper for a single Telegram bot. Owns no
 *  storage of its own — every message in/out is appended to the supplied
 *  TelegramDatabase. The host wires `onIncoming` / `onStatus` to push
 *  updates over RPC + WebSocket. */
export class TelegramService {
  private status: TelegramServiceStatus = { state: "disabled" };
  private abortController: AbortController | null = null;
  private offset: number | undefined = undefined;
  private allowed: Set<string>;
  private transport: TelegramTransport;
  private loopPromise: Promise<void> | null = null;
  private stopped = false;
  /** Per-chat rate buckets — `{tokens, lastRefillMs}`. Lazily created
   *  on first send to a given chat. */
  private rateBuckets = new Map<string, { tokens: number; ts: number }>();

  constructor(private opts: TelegramServiceOptions) {
    this.allowed = parseAllowedTelegramIds(opts.allowedUserIds);
    this.transport = opts.transport ?? createFetchTransport(opts.token);
    // Resume the polling offset persisted by the previous run. Without
    // this, every restart re-pulls the trailing batch of unconfirmed
    // updates and re-broadcasts them — the partial-unique index in
    // TelegramDatabase prevents duplicate inserts but the spurious
    // onIncoming calls still pulse the UI.
    const persistedOffset = this.opts.db.getKv(OFFSET_KV_KEY);
    if (persistedOffset) {
      const n = parseInt(persistedOffset, 10);
      if (Number.isFinite(n) && n > 0) this.offset = n;
    }
    const cachedUsername = this.opts.db.getKv(BOT_USERNAME_KV_KEY);
    if (cachedUsername) this.status.botUsername = cachedUsername;
  }

  getStatus(): TelegramServiceStatus {
    return this.status;
  }

  /** Begin long-polling. Idempotent — starting an already-running service
   *  is a no-op. Errors propagate to `onStatus(error)` rather than throwing. */
  start(): void {
    if (this.loopPromise) return;
    if (!this.opts.token) {
      this.setStatus({ state: "error", error: "no token configured" });
      return;
    }
    this.stopped = false;
    this.abortController = new AbortController();
    this.setStatus({ state: "starting" });
    // Fire identity probe in parallel with the long-poll loop. Failures
    // are swallowed inside probeIdentity — they don't block polling.
    void this.probeIdentity(this.abortController.signal);
    this.loopPromise = this.runLoop().catch((err) => {
      this.opts.onLog?.("error", `telegram loop crashed: ${String(err)}`);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortController?.abort();
    this.abortController = null;
    const p = this.loopPromise;
    this.loopPromise = null;
    if (p) {
      await p;
    }
    this.setStatus({ state: "disabled" });
  }

  /** Send an outbound message and persist it. Returns the persisted row.
   *  When the API call fails (rate-limited, network, bad chat id), the
   *  row is still persisted with `tgMessageId === null` so the UI can
   *  render a "failed" badge with a retry handle. */
  async sendMessage(chatId: string, text: string): Promise<TelegramMessage> {
    const ts = Date.now();
    let tgMessageId: number | null = null;
    let sendError: string | null = null;

    if (!this.allowOutbound(chatId)) {
      sendError = "rate limited (1 msg/sec/chat)";
    } else {
      try {
        const result = await this.transport.sendMessage({ chatId, text });
        if (result.ok && typeof result.messageId === "number") {
          tgMessageId = result.messageId;
        } else {
          sendError = result.description ?? "sendMessage failed";
        }
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err);
      }
    }

    const { message: persisted } = this.opts.db.insertMessage({
      chatId,
      direction: "out",
      text,
      ts,
      tgMessageId,
    });
    // Bump last_seen without overwriting the friendly name — sends know
    // chat id only, but inbound messages have already populated a real
    // contact label that we don't want to clobber.
    this.opts.db.touchChat(chatId, ts);
    if (sendError) {
      this.opts.onLog?.("warn", `telegram send failed: ${sendError}`);
    }
    return persisted;
  }

  /** Check whether the current bot can be reached and which @username
   *  it owns. Cached in db so reconnects don't re-probe. Updates status. */
  private async probeIdentity(signal: AbortSignal): Promise<void> {
    try {
      const res = await this.transport.getMe({ signal });
      if (res.ok && res.username) {
        this.status = { ...this.status, botUsername: res.username };
        this.opts.db.setKv(BOT_USERNAME_KV_KEY, res.username);
        this.opts.onStatus?.(this.status);
      } else if (!res.ok) {
        // Token-rejection failure mode: getMe returns ok=false with a
        // descriptive error. Surface it on the status pill before the
        // poll loop gets a chance to show the same thing.
        this.setStatus({
          state: "error",
          error: res.description ?? "getMe failed",
        });
      }
    } catch {
      // Network errors during probe are non-fatal — the poll loop will
      // surface them properly with backoff.
    }
  }

  /** Token-bucket rate limiter — refill `RATE_REFILL_PER_SEC` tokens/sec
   *  up to `RATE_BUCKET_CAPACITY`. Returns true and consumes one token
   *  on success; returns false (no consume) when the bucket is empty. */
  private allowOutbound(chatId: string): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(chatId) ?? {
      tokens: RATE_BUCKET_CAPACITY,
      ts: now,
    };
    const elapsed = (now - bucket.ts) / 1000;
    const refilled = Math.min(
      RATE_BUCKET_CAPACITY,
      bucket.tokens + elapsed * RATE_REFILL_PER_SEC,
    );
    if (refilled < 1) {
      this.rateBuckets.set(chatId, { tokens: refilled, ts: now });
      return false;
    }
    this.rateBuckets.set(chatId, { tokens: refilled - 1, ts: now });
    return true;
  }

  private setStatus(next: TelegramServiceStatus): void {
    this.status = next;
    this.opts.onStatus?.(next);
  }

  private async runLoop(): Promise<void> {
    let backoff = ERROR_BACKOFF_MIN_MS;
    // Tracks whether we've already logged the current conflict window
    // so the user sees "another consumer owns this bot" exactly once,
    // not every 60 s for hours. Cleared the moment we successfully
    // poll again.
    let conflictLogged = false;
    while (!this.stopped) {
      const signal = this.abortController?.signal;
      if (!signal) return;
      try {
        const updates = await this.transport.getUpdates({
          offset: this.offset,
          timeout: POLL_TIMEOUT_SEC,
          signal,
        });
        if (this.status.state !== "polling") {
          // Recovery from `conflict` / `error` / `starting`. When
          // resuming specifically from a conflict, emit a one-line
          // info log so the user sees the other consumer has stepped
          // aside without having to tail the sidebar pill.
          if (this.status.state === "conflict" && conflictLogged) {
            this.opts.onLog?.(
              "info",
              "telegram poll conflict cleared — resuming",
            );
          }
          this.setStatus({ state: "polling" });
        }
        backoff = ERROR_BACKOFF_MIN_MS;
        conflictLogged = false;
        for (const update of updates) {
          this.offset = Math.max(this.offset ?? 0, update.updateId + 1);
          this.handleUpdate(update);
        }
        // Persist after the batch (not per-update) — Telegram already
        // ack'd the whole window, so we can resume from any point in the
        // batch without re-pulling. Saving once per batch keeps the kv
        // table from churning on quiet polls.
        if (typeof this.offset === "number" && updates.length > 0) {
          try {
            this.opts.db.setKv(OFFSET_KV_KEY, String(this.offset));
          } catch {
            /* persistent storage hiccup — next batch will retry */
          }
        }
      } catch (err) {
        if (this.stopped || (err as { name?: string })?.name === "AbortError") {
          return;
        }
        if (err instanceof TelegramConflictError) {
          // Another consumer owns this bot. Fixed long backoff +
          // deduplicated logging. Structural fix (separate bot
          // token per consumer) is documented in
          // doc/system-telegram.md §Troubleshooting.
          const detail =
            "another client is polling this bot — stop it or use a separate bot token per consumer";
          this.setStatus({ state: "conflict", error: detail });
          if (!conflictLogged) {
            this.opts.onLog?.(
              "warn",
              `telegram poll conflict (HTTP 409): ${detail}`,
            );
            conflictLogged = true;
          }
          await delay(CONFLICT_BACKOFF_MS, signal);
          // Don't touch `backoff` — conflict is orthogonal to the
          // exponential window used for transient errors.
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.setStatus({ state: "error", error: msg });
        this.opts.onLog?.("warn", `telegram poll error: ${msg}`);
        await delay(backoff, signal);
        backoff = Math.min(backoff * 2, ERROR_BACKOFF_MAX_MS);
      }
    }
  }

  private handleUpdate(update: TelegramUpdate): void {
    const msg = update.message;
    if (!msg) return;
    if (this.allowed.size > 0 && !this.allowed.has(msg.fromUserId)) {
      this.opts.onLog?.(
        "info",
        `telegram: dropped message from non-allowed user ${msg.fromUserId}`,
      );
      return;
    }
    const { message: persisted, inserted } = this.opts.db.insertMessage({
      chatId: msg.chatId,
      direction: "in",
      text: msg.text,
      ts: msg.date * 1000,
      tgMessageId: msg.messageId,
      fromUserId: msg.fromUserId,
      fromName: msg.fromName,
    });
    if (!inserted) {
      // Duplicate — Telegram replayed an unconfirmed batch (typically
      // after a restart that lost the in-memory offset before
      // persisting). Skip the broadcast so the UI doesn't pulse twice.
      return;
    }
    this.opts.db.upsertChat({
      id: msg.chatId,
      name: msg.chatTitle || msg.fromName || msg.chatId,
      ts: persisted.ts,
    });
    this.opts.onIncoming?.(persisted);
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** Real HTTP transport against api.telegram.org. Kept private — callers
 *  shouldn't need to construct it; the service builds one when no test
 *  transport is supplied. */
function createFetchTransport(token: string): TelegramTransport {
  const base = `https://api.telegram.org/bot${token}`;
  return {
    async getUpdates({ offset, timeout, signal }) {
      const params = new URLSearchParams({
        timeout: String(timeout),
      });
      if (typeof offset === "number") params.set("offset", String(offset));
      // `allowed_updates=["message"]` keeps us off edited_message /
      // channel_post / inline_query / etc. — phase 1 only handles direct
      // messages, the rest are noise on the wire.
      params.set("allowed_updates", '["message"]');
      const res = await fetch(`${base}/getUpdates?${params.toString()}`, {
        signal,
      });
      if (!res.ok) {
        // 409 = Conflict. Telegram enforces single-consumer on
        // getUpdates; this response means another getUpdates call or
        // a configured webhook owns the bot. The service treats it
        // distinctly from generic HTTP errors (long fixed backoff +
        // deduplicated logging + dedicated UI state).
        if (res.status === 409) {
          let desc: string | undefined;
          try {
            const body = (await res.json()) as { description?: string };
            desc = body.description;
          } catch {
            /* body unreadable — fall back to generic message */
          }
          throw new TelegramConflictError(
            desc ? `getUpdates HTTP 409: ${desc}` : "getUpdates HTTP 409",
          );
        }
        throw new Error(`getUpdates HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        ok: boolean;
        result?: Array<Record<string, unknown>>;
        description?: string;
      };
      if (!body.ok) {
        throw new Error(body.description ?? "getUpdates returned ok=false");
      }
      return (body.result ?? []).map(parseRawUpdate).filter(isUpdate);
    },
    async sendMessage({ chatId, text, signal }) {
      const res = await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { message_id?: number };
        description?: string;
      };
      return {
        ok: !!body.ok,
        messageId: body.result?.message_id,
        description: body.description,
      };
    },
    async getMe({ signal }) {
      const res = await fetch(`${base}/getMe`, { signal });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { username?: string };
        description?: string;
      };
      return {
        ok: !!body.ok,
        username: body.result?.username,
        description: body.description,
      };
    },
  };
}

function parseRawUpdate(raw: Record<string, unknown>): TelegramUpdate | null {
  const updateId = raw["update_id"];
  if (typeof updateId !== "number") return null;
  const message = raw["message"] as Record<string, unknown> | undefined;
  if (!message) return { updateId };
  const chat = message["chat"] as Record<string, unknown> | undefined;
  const from = message["from"] as Record<string, unknown> | undefined;
  const text = message["text"];
  const messageId = message["message_id"];
  const date = message["date"];
  if (
    !chat ||
    !from ||
    typeof text !== "string" ||
    typeof messageId !== "number" ||
    typeof date !== "number"
  ) {
    return { updateId };
  }
  const chatId = chat["id"];
  const fromId = from["id"];
  if (
    (typeof chatId !== "number" && typeof chatId !== "string") ||
    (typeof fromId !== "number" && typeof fromId !== "string")
  ) {
    return { updateId };
  }
  const firstName = (from["first_name"] as string | undefined) ?? "";
  const lastName = (from["last_name"] as string | undefined) ?? "";
  const username = (from["username"] as string | undefined) ?? "";
  const fromName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    username ||
    String(fromId);
  return {
    updateId,
    message: {
      messageId,
      chatId: String(chatId),
      chatTitle: (chat["title"] as string | undefined) ?? fromName,
      fromUserId: String(fromId),
      fromName,
      text,
      date,
    },
  };
}

function isUpdate(u: TelegramUpdate | null): u is TelegramUpdate {
  return u !== null;
}

/** Format a sidebar notification for delivery via Telegram. Plain text
 *  (no Markdown parse_mode) so user-supplied titles/bodies can't break
 *  the message. Workspace + pane labels are appended on a third line
 *  when supplied. */
export function formatNotificationForTelegram(input: {
  title: string;
  body: string;
  workspace?: string;
  pane?: string;
}): string {
  const parts: string[] = [];
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title) parts.push(title);
  if (body) parts.push(body);
  const ctxBits: string[] = [];
  if (input.workspace) ctxBits.push(input.workspace);
  if (input.pane) ctxBits.push(input.pane);
  if (ctxBits.length > 0) parts.push(`(${ctxBits.join(" / ")})`);
  return parts.join("\n");
}

/** Decide who (if anyone) gets a Telegram DM for this notification.
 *  Pure function — takes everything it needs as args, returns the list
 *  of `{chatId, text}` deliveries to perform. The host is responsible
 *  for actually invoking sendMessage (so this stays unit-testable
 *  without a live service). Returns an empty array when the user has
 *  the toggle off, the allow-list is empty, or settings disable forward. */
export function planNotificationForwarding(input: {
  enabled: boolean;
  allowedUserIds: string;
  title: string;
  body: string;
  workspace?: string;
  pane?: string;
}): Array<{ chatId: string; text: string }> {
  if (!input.enabled) return [];
  const recipients = parseAllowedTelegramIds(input.allowedUserIds);
  if (recipients.size === 0) return [];
  const text = formatNotificationForTelegram({
    title: input.title,
    body: input.body,
    workspace: input.workspace,
    pane: input.pane,
  });
  return [...recipients].map((chatId) => ({ chatId, text }));
}
