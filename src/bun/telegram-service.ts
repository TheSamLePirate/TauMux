import { TelegramDatabase, type TelegramMessage } from "./telegram-db";
import { parseAllowedTelegramIds } from "../shared/settings";

/** A single inline keyboard button — `text` shows on the bot's
 *  message; `callback_data` round-trips back to the bot when a user
 *  taps it. Stick to short ASCII identifiers (`ok|<surfaceId>`) for
 *  callback_data — Telegram caps it at 64 bytes. */
export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

/** Telegram's `reply_markup.inline_keyboard` — array of rows, each
 *  row an array of buttons. Two rows of two buttons render as a 2×2
 *  grid; one row of three buttons renders side-by-side. */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/** `force_reply` markup — instructs the user's client to open a
 *  reply box pre-targeted at this message. Plan #10 commit B uses
 *  it for `kind: text` questions: when the user types and sends,
 *  the inbound update carries `reply_to_message` matching the
 *  original prompt's tg_message_id, which we look up in
 *  text_reply_links to route the typed answer to the queue. */
export interface ForceReplyMarkup {
  force_reply: true;
  selective?: boolean;
  input_field_placeholder?: string;
}

export type ReplyMarkup = InlineKeyboardMarkup | ForceReplyMarkup;

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
    /** Optional inline keyboard markup OR force_reply hint.
     *  Inline keyboards: buttons; user tap arrives as
     *  `callback_query`. Force-reply: opens the user's reply box
     *  pre-targeted at this message; their typed answer arrives as
     *  a normal message with `reply_to_message` set. */
    replyMarkup?: ReplyMarkup;
    /** Optional Telegram parse mode (`MarkdownV2` or `HTML`).
     *  When set, the bot's text is rendered with formatting per
     *  the matching escape rules. Plan #10 uses MarkdownV2 for the
     *  ask-user prompt (bold title, monospace body fragments). */
    parseMode?: "MarkdownV2" | "HTML";
  }): Promise<{ ok: boolean; messageId?: number; description?: string }>;
  /** Edit a previously-sent message in place — used by Plan #10
   *  to stamp resolution footers ("answered: yes") on top of the
   *  original ask-user prompt and remove the now-stale buttons. */
  editMessageText(opts: {
    chatId: string;
    tgMessageId: number;
    text: string;
    replyMarkup?: ReplyMarkup;
    parseMode?: "MarkdownV2" | "HTML";
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; description?: string }>;
  /** Acknowledge a callback_query so Telegram stops nagging the user.
   *  Optional `text` shows a transient toast in their client. */
  answerCallbackQuery(opts: {
    callbackQueryId: string;
    text?: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean }>;
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
    /** Plan #10 — when the user uses Telegram's reply UI (force_reply
     *  or any reply), their inbound message carries the original
     *  message id. The host looks this up in `text_reply_links` to
     *  route a typed answer to the matching ask-user request. */
    replyToMessageId?: number;
  };
  /** Set when a user taps an inline keyboard button on one of the
   *  bot's outbound messages. `messageId` identifies which bot
   *  message bore the buttons (the host looks it up in the
   *  `notification_links` table to recover the originating
   *  surface / notification). */
  callbackQuery?: {
    id: string;
    fromUserId: string;
    fromName: string;
    chatId: string;
    messageId: number;
    data: string;
  };
}

/** Inbound callback event the host wires up. Emitted exactly once
 *  per allowed-list-passing user tap; the service has already
 *  acknowledged the query so the host doesn't have to. */
export interface TelegramCallbackInfo {
  callbackQueryId: string;
  fromUserId: string;
  fromName: string;
  chatId: string;
  messageId: number;
  /** The raw `<action>|<payload>` string the bot's button carried.
   *  Hosts parse this to dispatch — keeping the wire format opaque
   *  here lets future button sets evolve without service changes. */
  data: string;
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
  /** Called when an inbound message lands (after persistence +
   *  allow-list). Plan #10 commit B threads `replyToMessageId`
   *  through so the host can match a typed force_reply answer to a
   *  pending ask-user request. */
  onIncoming?: (
    message: TelegramMessage,
    extra?: { replyToMessageId?: number },
  ) => void;
  /** Called when an inline-keyboard button tap survives the
   *  allow-list. The service has already acknowledged the
   *  callback_query so Telegram stops the loading spinner; the host
   *  is responsible for the actual action (sending text into a
   *  surface, dismissing a notification, …). */
  onCallback?: (info: TelegramCallbackInfo) => void;
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
   *  it owns. Cached in db so reconnects don't re-probe. Updates status.
   *
   *  Issue I5 in doc/full_analysis.md: this used to await `getMe()` with
   *  no application-side timeout. If the host was reachable but the
   *  response stalled, the probe could hang indefinitely (only the
   *  external `stop()` would abort it via the signal). Now we race
   *  against a 5 s timeout so the status pill gets a real answer one
   *  way or the other. */
  private async probeIdentity(signal: AbortSignal): Promise<void> {
    const PROBE_TIMEOUT_MS = 5000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<{ ok: false; description: string }>(
      (resolveOnce) => {
        timer = setTimeout(() => {
          resolveOnce({
            ok: false,
            description: `getMe timed out after ${PROBE_TIMEOUT_MS}ms`,
          });
        }, PROBE_TIMEOUT_MS);
      },
    );
    try {
      const res = await Promise.race([
        this.transport.getMe({ signal }),
        timeout,
      ]);
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
    } finally {
      if (timer) clearTimeout(timer);
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
          if (update.callbackQuery) {
            void this.handleCallbackQuery(update.callbackQuery);
          }
        }
        // Persist after the batch (not per-update) — Telegram already
        // ack'd the whole window, so we can resume from any point in the
        // batch without re-pulling. Saving once per batch keeps the kv
        // table from churning on quiet polls.
        if (typeof this.offset === "number" && updates.length > 0) {
          try {
            this.opts.db.setKv(OFFSET_KV_KEY, String(this.offset));
          } catch (persistErr) {
            // Persistent storage hiccup — next batch will retry. We do
            // NOT swallow silently: a corrupted db means every batch
            // re-fetches the same updates, dedup absorbs them, and the
            // operator never sees why offset persistence is broken.
            // Issue I4 in doc/full_analysis.md.
            this.opts.onLog?.(
              "warn",
              `telegram offset persist failed: ${
                persistErr instanceof Error
                  ? persistErr.message
                  : String(persistErr)
              }`,
            );
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

  /** Send `text` to `chatId` with an inline keyboard attached. The
   *  buttons render as tappable rows under the message; user taps
   *  arrive on the next `getUpdates` batch as `callback_query`
   *  payloads (handled by `handleCallbackQuery`). Returns the
   *  persisted outbound row so callers can correlate the bot's
   *  message id with their own state (e.g. notification id). */
  async sendMessageWithButtons(
    chatId: string,
    text: string,
    buttons: InlineKeyboardButton[][],
  ): Promise<TelegramMessage> {
    return this.sendRich(chatId, text, {
      inline_keyboard: buttons,
    });
  }

  /** Plan #10 commit B — generic rich send. Accepts any
   *  `ReplyMarkup` (inline keyboard or force-reply) plus an
   *  optional MarkdownV2 / HTML parse mode for the bot's text.
   *  Same persistence + rate limiting as `sendMessage` so callers
   *  get a uniform `TelegramMessage` row regardless of which UX
   *  shape they invoked. */
  async sendRich(
    chatId: string,
    text: string,
    replyMarkup: ReplyMarkup | undefined,
    parseMode?: "MarkdownV2" | "HTML",
  ): Promise<TelegramMessage> {
    const ts = Date.now();
    let tgMessageId: number | null = null;
    let sendError: string | null = null;

    if (!this.allowOutbound(chatId)) {
      sendError = "rate limited (1 msg/sec/chat)";
    } else {
      try {
        const result = await this.transport.sendMessage({
          chatId,
          text,
          replyMarkup,
          parseMode,
        });
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
    this.opts.db.touchChat(chatId, ts);
    if (sendError) {
      this.opts.onLog?.("warn", `telegram send failed: ${sendError}`);
    }
    return persisted;
  }

  /** Edit a previously-sent bot message. Used by Plan #10 commit B
   *  to stamp resolution footers ("answered: yes" etc.) on top of
   *  ask-user prompts when they resolve. Best-effort — swallows
   *  transport errors with a warn log so a transient Telegram
   *  failure doesn't crash the queue's event loop. */
  async editMessage(
    chatId: string,
    tgMessageId: number,
    text: string,
    replyMarkup?: ReplyMarkup,
    parseMode?: "MarkdownV2" | "HTML",
  ): Promise<boolean> {
    try {
      const result = await this.transport.editMessageText({
        chatId,
        tgMessageId,
        text,
        replyMarkup,
        parseMode,
      });
      if (!result.ok) {
        this.opts.onLog?.(
          "warn",
          `telegram editMessageText failed: ${result.description ?? "unknown"}`,
        );
      }
      return result.ok;
    } catch (err) {
      this.opts.onLog?.(
        "warn",
        `telegram editMessageText threw: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Validate + dispatch a single callback_query. The service ACKs
   *  the query (so Telegram stops the loading spinner) regardless of
   *  whether the host accepts the action — silent rejection of an
   *  off-allow-list user would leave their button stuck spinning. */
  private async handleCallbackQuery(
    cq: NonNullable<TelegramUpdate["callbackQuery"]>,
  ): Promise<void> {
    if (this.allowed.size > 0 && !this.allowed.has(cq.fromUserId)) {
      this.opts.onLog?.(
        "info",
        `telegram: dropped callback from non-allowed user ${cq.fromUserId}`,
      );
      // ACK with a polite "not authorised" toast so the user knows
      // their tap was seen but rejected — better UX than a hung
      // spinner.
      try {
        await this.transport.answerCallbackQuery({
          callbackQueryId: cq.id,
          text: "Not authorised",
        });
      } catch {
        /* swallow — log already noted the rejection */
      }
      return;
    }
    try {
      await this.transport.answerCallbackQuery({ callbackQueryId: cq.id });
    } catch (err) {
      this.opts.onLog?.(
        "warn",
        `telegram: answerCallbackQuery failed: ${(err as Error).message}`,
      );
    }
    this.opts.onCallback?.({
      callbackQueryId: cq.id,
      fromUserId: cq.fromUserId,
      fromName: cq.fromName,
      chatId: cq.chatId,
      messageId: cq.messageId,
      data: cq.data,
    });
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
    this.opts.onIncoming?.(persisted, {
      replyToMessageId: msg.replyToMessageId,
    });
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
      // Subscribe to direct messages and inline-keyboard callback
      // queries. Phase 2 (Plan #08) adds the callback subscription so
      // tapped buttons on bot messages round-trip back. Other update
      // kinds (edited_message, channel_post, inline_query) stay
      // filtered out — they're noise on this wire.
      params.set("allowed_updates", '["message","callback_query"]');
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
    async sendMessage({ chatId, text, signal, replyMarkup, parseMode }) {
      const payload: Record<string, unknown> = { chat_id: chatId, text };
      if (replyMarkup) payload["reply_markup"] = replyMarkup;
      if (parseMode) payload["parse_mode"] = parseMode;
      const res = await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
    async editMessageText({
      chatId,
      tgMessageId,
      text,
      replyMarkup,
      parseMode,
      signal,
    }) {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        message_id: tgMessageId,
        text,
      };
      if (replyMarkup) payload["reply_markup"] = replyMarkup;
      if (parseMode) payload["parse_mode"] = parseMode;
      const res = await fetch(`${base}/editMessageText`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
      };
      return { ok: !!body.ok, description: body.description };
    },
    async answerCallbackQuery({ callbackQueryId, text, signal }) {
      const payload: Record<string, unknown> = {
        callback_query_id: callbackQueryId,
      };
      if (text) payload["text"] = text;
      const res = await fetch(`${base}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      return { ok: !!body.ok };
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

export function parseRawUpdate(
  raw: Record<string, unknown>,
): TelegramUpdate | null {
  const updateId = raw["update_id"];
  if (typeof updateId !== "number") return null;
  const out: TelegramUpdate = { updateId };

  const message = raw["message"] as Record<string, unknown> | undefined;
  if (message) {
    const parsed = parseMessage(message);
    if (parsed) out.message = parsed;
  }

  const cq = raw["callback_query"] as Record<string, unknown> | undefined;
  if (cq) {
    const parsed = parseCallbackQuery(cq);
    if (parsed) out.callbackQuery = parsed;
  }

  return out;
}

function parseMessage(
  message: Record<string, unknown>,
): TelegramUpdate["message"] {
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
    return undefined;
  }
  const chatId = chat["id"];
  const fromId = from["id"];
  if (
    (typeof chatId !== "number" && typeof chatId !== "string") ||
    (typeof fromId !== "number" && typeof fromId !== "string")
  ) {
    return undefined;
  }
  const fromName = composeFromName(from, fromId);
  // Plan #10 — capture reply_to_message.message_id when present so
  // the host can route typed answers from `force_reply` prompts.
  const replyTo = message["reply_to_message"] as
    | Record<string, unknown>
    | undefined;
  const replyToMessageId =
    replyTo && typeof replyTo["message_id"] === "number"
      ? (replyTo["message_id"] as number)
      : undefined;
  return {
    messageId,
    chatId: String(chatId),
    chatTitle: (chat["title"] as string | undefined) ?? fromName,
    fromUserId: String(fromId),
    fromName,
    text,
    date,
    replyToMessageId,
  };
}

/** Decode a `callback_query` payload. Telegram nests the bot's
 *  message under `.message` (so we can correlate to which message
 *  bore the buttons) — we strictly require it; a callback_query
 *  without a parent message can't round-trip to a notification link
 *  anyway. */
function parseCallbackQuery(
  cq: Record<string, unknown>,
): TelegramUpdate["callbackQuery"] {
  const id = cq["id"];
  const data = cq["data"];
  const from = cq["from"] as Record<string, unknown> | undefined;
  const parentMessage = cq["message"] as Record<string, unknown> | undefined;
  if (typeof id !== "string" || typeof data !== "string" || !from) {
    return undefined;
  }
  const fromId = from["id"];
  if (typeof fromId !== "number" && typeof fromId !== "string") {
    return undefined;
  }
  const parentChat = parentMessage?.["chat"] as
    | Record<string, unknown>
    | undefined;
  const parentMessageId = parentMessage?.["message_id"];
  const chatId = parentChat?.["id"];
  if (
    typeof parentMessageId !== "number" ||
    (typeof chatId !== "number" && typeof chatId !== "string")
  ) {
    return undefined;
  }
  return {
    id,
    fromUserId: String(fromId),
    fromName: composeFromName(from, fromId),
    chatId: String(chatId),
    messageId: parentMessageId,
    data,
  };
}

function composeFromName(
  from: Record<string, unknown>,
  fromId: number | string,
): string {
  const firstName = (from["first_name"] as string | undefined) ?? "";
  const lastName = (from["last_name"] as string | undefined) ?? "";
  const username = (from["username"] as string | undefined) ?? "";
  return (
    [firstName, lastName].filter(Boolean).join(" ") ||
    username ||
    String(fromId)
  );
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
