/**
 * Plan #10 commit B — bridge between the AskUserQueue and the
 * Telegram service.
 *
 * Layout:
 *   - `formatQuestionForTelegram` builds a MarkdownV2 prompt body
 *     with attribution (workspace · pane · agent) + kind-specific
 *     hint footer.
 *   - `buildButtonsForKind` returns the inline-keyboard rows for
 *     yesno / choice / confirm-command. Text uses force_reply.
 *   - `parseAskCallbackData` decodes the `ask|<id>|<value>` wire
 *     format the host receives via Plan #08's callback handler.
 *   - `formatResolutionFooter` produces the post-resolution edit
 *     text (struck-through prompt + "answered: yes" / cancelled /
 *     timed out marker).
 *
 * All pure — no transport, no service, no db. The host wires these
 * helpers to the live `AskUserQueue` + `TelegramService` +
 * `TelegramDatabase` in `src/bun/index.ts`.
 */

import type {
  AskUserKind,
  AskUserRequest,
  AskUserResponse,
} from "../shared/types";
import type {
  ForceReplyMarkup,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
} from "./telegram-service";

// ── attribution context ────────────────────────────────────────

export interface AskUserAttribution {
  /** Human-readable workspace name (e.g. "frontend"). */
  workspace?: string;
  /** Pane title (e.g. "vim", "bun run dev"). */
  pane?: string;
  /** Optional agent label — pi / claude / custom. */
  agent?: string;
}

// ── MarkdownV2 escape ─────────────────────────────────────────

/** Telegram MarkdownV2 reserved characters per the API docs.
 *  Every literal occurrence must be backslash-escaped or the API
 *  rejects the message. We don't try to *render* user-supplied
 *  markdown — we escape everything and rely on our own bold /
 *  monospace markers added by the formatter. */
const MDV2_ESCAPE_RE = /([_*[\]()~`>#+\-=|{}.!\\])/g;
function mdv2Escape(s: string): string {
  return s.replace(MDV2_ESCAPE_RE, "\\$1");
}

// ── prompt formatter ──────────────────────────────────────────

/** Build the MarkdownV2 message body for an ask-user prompt.
 *  Title goes bold; attribution lines render in monospace; body
 *  follows verbatim with the same escaping. The kind-specific
 *  footer hint helps the user understand *how* to answer (e.g.
 *  "type your reply in chat" for kind=text). */
export function formatQuestionForTelegram(
  request: AskUserRequest,
  attribution: AskUserAttribution = {},
): string {
  const lines: string[] = [];
  lines.push(`*${mdv2Escape(request.title)}*`);
  if (request.body && request.body.trim().length > 0) {
    lines.push(""); // blank line between title and body
    lines.push(mdv2Escape(request.body));
  }

  const ctxBits: string[] = [];
  if (attribution.workspace) ctxBits.push(attribution.workspace);
  if (attribution.pane) ctxBits.push(attribution.pane);
  if (attribution.agent) ctxBits.push(attribution.agent);
  if (ctxBits.length > 0) {
    lines.push(""); // blank
    lines.push(`_${mdv2Escape(ctxBits.join(" · "))}_`);
  }

  const hint = kindHint(request.kind);
  if (hint) {
    lines.push("");
    lines.push(`_${mdv2Escape(hint)}_`);
  }

  return lines.join("\n");
}

function kindHint(kind: AskUserKind): string | null {
  switch (kind) {
    case "yesno":
      return "Tap Yes or No to answer.";
    case "choice":
      return "Tap one of the choices.";
    case "text":
      return "Reply to this message with your answer.";
    case "confirm-command":
      return "Tap I understand to reveal the run gate.";
  }
}

// ── inline keyboards ──────────────────────────────────────────

/** Build the initial inline keyboard for a request. `confirmRevealed`
 *  controls the second-step shape for `confirm-command`: false (the
 *  default) shows [I understand] [Cancel]; true shows the
 *  [Run (destructive)] [Cancel] gate — the dangerous action stays
 *  out of reach until the user explicitly acknowledges. */
export function buildButtonsForKind(
  request: AskUserRequest,
  opts: { confirmRevealed?: boolean } = {},
): InlineKeyboardMarkup | ForceReplyMarkup | undefined {
  const id = request.request_id;
  switch (request.kind) {
    case "yesno":
      return {
        inline_keyboard: [
          [
            { text: "Yes", callback_data: `ask|${id}|yes` },
            { text: "No", callback_data: `ask|${id}|no` },
          ],
          [{ text: "Cancel", callback_data: `ask|${id}|cancel` }],
        ],
      };
    case "choice": {
      const choices = request.choices ?? [];
      const rows: InlineKeyboardButton[][] = [];
      // Two columns when there are >2 choices to keep the keyboard
      // compact on phone screens.
      const perRow = choices.length > 2 ? 2 : 1;
      for (let i = 0; i < choices.length; i += perRow) {
        const slice = choices.slice(i, i + perRow);
        rows.push(
          slice.map((c) => ({
            text: c.label || c.id,
            callback_data: `ask|${id}|${c.id}`,
          })),
        );
      }
      rows.push([{ text: "Cancel", callback_data: `ask|${id}|cancel` }]);
      return { inline_keyboard: rows };
    }
    case "confirm-command":
      if (opts.confirmRevealed) {
        return {
          inline_keyboard: [
            [
              { text: "Run (destructive)", callback_data: `ask|${id}|run` },
              { text: "Cancel", callback_data: `ask|${id}|cancel` },
            ],
          ],
        };
      }
      return {
        inline_keyboard: [
          [
            {
              text: "I understand",
              callback_data: `ask|${id}|ack`,
            },
            { text: "Cancel", callback_data: `ask|${id}|cancel` },
          ],
        ],
      };
    case "text":
      return {
        force_reply: true,
        input_field_placeholder: request.default ?? "Your answer",
      };
  }
}

// ── callback wire format ──────────────────────────────────────

export interface AskCallback {
  requestId: string;
  /** Raw value: "yes" / "no" / "cancel" / "<choiceId>" / "ack" / "run" */
  value: string;
}

/** Decode the `ask|<id>|<value>` wire format. Returns null when
 *  the data string isn't an ask-callback so the host can fall
 *  through to other dispatch branches (notification callbacks, etc). */
export function parseAskCallbackData(data: string): AskCallback | null {
  if (!data.startsWith("ask|")) return null;
  const rest = data.slice(4);
  const sep = rest.indexOf("|");
  if (sep === -1) return null;
  const requestId = rest.slice(0, sep);
  const value = rest.slice(sep + 1);
  if (!requestId || !value) return null;
  return { requestId, value };
}

// ── resolution feedback ───────────────────────────────────────

/** The post-resolution body text that replaces the original
 *  prompt. Strikes the title through (MarkdownV2 `~text~`),
 *  appends a footer line stamped with the action + value. The
 *  caller passes this to `editMessageText` with no `replyMarkup`
 *  so the buttons disappear. */
export function formatResolutionFooter(
  request: AskUserRequest,
  response: AskUserResponse,
  attribution: AskUserAttribution = {},
): string {
  const lines: string[] = [];
  lines.push(`~${mdv2Escape(request.title)}~`);

  const ctxBits: string[] = [];
  if (attribution.workspace) ctxBits.push(attribution.workspace);
  if (attribution.pane) ctxBits.push(attribution.pane);
  if (attribution.agent) ctxBits.push(attribution.agent);
  if (ctxBits.length > 0) {
    lines.push(`_${mdv2Escape(ctxBits.join(" · "))}_`);
  }
  lines.push("");
  lines.push(`*${mdv2Escape(resolutionMarker(response))}*`);
  return lines.join("\n");
}

function resolutionMarker(response: AskUserResponse): string {
  switch (response.action) {
    case "ok":
      return response.value !== undefined
        ? `Answered: ${response.value}`
        : "Answered.";
    case "cancel":
      return response.reason ? `Cancelled — ${response.reason}` : "Cancelled.";
    case "timeout":
      return "Timed out.";
  }
}
