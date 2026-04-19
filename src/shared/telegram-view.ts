/**
 * Pure helpers shared between the native webview's TelegramPaneView,
 * the web-mirror createTelegramPane, and the web-mirror reducer. No DOM
 * imports — strictly data + formatting so it can run anywhere (bun
 * tests included).
 *
 * Anything view-side that's stylable should NOT live here (CSS class
 * names, DOM templates) — those are intentionally per-context.
 */

import type { TelegramWireMessage } from "./types";

/** How many messages a Telegram pane keeps in memory at once. The
 *  SQLite log on bun owns the real history; this is just the active
 *  render window per chat. Doubled in storage so paginated scroll-up
 *  doesn't immediately bump the oldest in-memory row out. */
export const TELEGRAM_RENDER_WINDOW = 200;

/** Format a Unix-millis timestamp as "HH:MM" using the local timezone.
 *  Compact + locale-friendly enough for chat bubbles. */
export function formatTelegramTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Display label for a message's author. "You" for outbound, falls
 *  back through fromName → "Them". Centralized so both panes show the
 *  same label rules. */
export function telegramAuthorLabel(message: TelegramWireMessage): string {
  if (message.direction === "out") return "You";
  return message.fromName ?? "Them";
}

/** True when an outbound message failed to reach Telegram (rate-limit,
 *  network, bad chat id). The wire shape leaves `tgMessageId === null`
 *  in that case; the UI uses this to render a "failed" badge + retry. */
export function telegramSendFailed(message: TelegramWireMessage): boolean {
  return message.direction === "out" && message.tgMessageId === null;
}

/** Merge an incoming page into an existing in-memory list, dedup by id,
 *  keep newest-last, and cap to `2 * TELEGRAM_RENDER_WINDOW`. Used by:
 *    - native webview pane on history fetch + new message arrival
 *    - web-mirror reducer on telegram/history + telegram/message
 *    - web-mirror DOM render hook indirectly (via reducer state)
 *
 *  Returns the input array unchanged when there's nothing to merge —
 *  reducers can use referential equality to skip re-renders. */
export function mergeTelegramMessages(
  current: TelegramWireMessage[],
  incoming: TelegramWireMessage[],
): TelegramWireMessage[] {
  if (incoming.length === 0) return current;
  const seen = new Set<number>(current.map((m) => m.id));
  const merged: TelegramWireMessage[] = current.slice();
  let added = 0;
  for (const m of incoming) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      merged.push(m);
      added++;
    }
  }
  if (added === 0) return current;
  merged.sort((a, b) => a.id - b.id);
  const cap = TELEGRAM_RENDER_WINDOW * 2;
  if (merged.length > cap) {
    return merged.slice(merged.length - cap);
  }
  return merged;
}
