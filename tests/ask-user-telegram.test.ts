// Plan #10 commit B — pure-function coverage for the ask-user ↔
// Telegram bridge helpers. Every helper is testable in isolation;
// the live wiring (subscribe → send → persist link → callback
// dispatch → edit) is verified separately by the live transport
// fixture in tests/telegram-callback.test.ts when we extend it.

import { describe, expect, test } from "bun:test";
import {
  buildButtonsForKind,
  formatQuestionForTelegram,
  formatResolutionFooter,
  parseAskCallbackData,
} from "../src/bun/ask-user-telegram";
import type { AskUserKind, AskUserRequest } from "../src/shared/types";

function mkRequest(
  kind: AskUserKind,
  overrides: Partial<AskUserRequest> = {},
): AskUserRequest {
  return {
    request_id: "req:1",
    surface_id: "surface:1",
    kind,
    title: "Question?",
    created_at: 0,
    ...overrides,
  };
}

// ── formatQuestionForTelegram ─────────────────────────────────

describe("formatQuestionForTelegram", () => {
  test("title goes bold (asterisks)", () => {
    // `?` is NOT a MarkdownV2 reserved char per Telegram's spec
    // (the list is `_*[]()~\`>#+-=|{}.!`), so it passes through.
    const out = formatQuestionForTelegram(mkRequest("yesno"));
    expect(out.startsWith("*Question?*")).toBe(true);
  });

  test("escapes MarkdownV2 reserved characters", () => {
    const out = formatQuestionForTelegram(
      mkRequest("text", { title: "Pick a name (with chars!)" }),
    );
    // ( ) ! all need backslash-escape per Telegram MDv2.
    expect(out).toContain("Pick a name \\(with chars\\!\\)");
  });

  test("body is escaped + appears under the title", () => {
    const out = formatQuestionForTelegram(
      mkRequest("yesno", {
        title: "ok?",
        body: "context: the tests passed.",
      }),
    );
    expect(out).toContain("context: the tests passed\\.");
  });

  test("attribution renders in italic with middle-dots", () => {
    const out = formatQuestionForTelegram(mkRequest("yesno"), {
      workspace: "frontend",
      pane: "bun dev",
      agent: "claude:1",
    });
    expect(out).toContain("_frontend · bun dev · claude:1_");
  });

  test("kind hint is appended for every kind", () => {
    expect(formatQuestionForTelegram(mkRequest("yesno"))).toContain(
      "Tap Yes or No",
    );
    expect(formatQuestionForTelegram(mkRequest("choice"))).toContain(
      "Tap one of the choices",
    );
    expect(formatQuestionForTelegram(mkRequest("text"))).toContain(
      "Reply to this message",
    );
    expect(formatQuestionForTelegram(mkRequest("confirm-command"))).toContain(
      "I understand",
    );
  });

  test("no body / no attribution still produces a valid prompt", () => {
    const out = formatQuestionForTelegram(mkRequest("yesno"));
    // Title + blank + hint italic — should be 3 lines + 1 blank = 4 lines.
    expect(out.split("\n").length).toBeGreaterThanOrEqual(2);
  });
});

// ── buildButtonsForKind ───────────────────────────────────────

describe("buildButtonsForKind — yesno", () => {
  test("returns Yes / No / Cancel rows", () => {
    const markup = buildButtonsForKind(mkRequest("yesno"));
    if (!markup || !("inline_keyboard" in markup)) {
      throw new Error("expected inline_keyboard");
    }
    const labels = markup.inline_keyboard.map((row) => row.map((b) => b.text));
    expect(labels).toEqual([["Yes", "No"], ["Cancel"]]);
  });

  test("data carries the request id and value", () => {
    const markup = buildButtonsForKind(
      mkRequest("yesno", { request_id: "r:7" }),
    );
    if (!markup || !("inline_keyboard" in markup)) throw new Error();
    const datas = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toEqual(["ask|r:7|yes", "ask|r:7|no", "ask|r:7|cancel"]);
  });
});

describe("buildButtonsForKind — choice", () => {
  test("renders one button per choice + a Cancel row", () => {
    const markup = buildButtonsForKind(
      mkRequest("choice", {
        choices: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ],
      }),
    );
    if (!markup || !("inline_keyboard" in markup)) throw new Error();
    // 3 choices → 2-per-row layout = 2 rows of choices + 1 cancel row.
    expect(markup.inline_keyboard.length).toBe(3);
    expect(markup.inline_keyboard.flat().map((b) => b.text)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Cancel",
    ]);
  });

  test("uses 1-per-row layout when there are 2 or fewer choices", () => {
    const markup = buildButtonsForKind(
      mkRequest("choice", {
        choices: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    );
    if (!markup || !("inline_keyboard" in markup)) throw new Error();
    expect(markup.inline_keyboard.length).toBe(3); // 2 choice rows + cancel
  });

  test("falls back to choice id when label is empty", () => {
    const markup = buildButtonsForKind(
      mkRequest("choice", {
        choices: [{ id: "main", label: "" }],
      }),
    );
    if (!markup || !("inline_keyboard" in markup)) throw new Error();
    expect(markup.inline_keyboard[0]![0]!.text).toBe("main");
  });
});

describe("buildButtonsForKind — confirm-command", () => {
  test("first step shows [I understand] [Cancel]", () => {
    const markup = buildButtonsForKind(mkRequest("confirm-command"));
    if (!markup || !("inline_keyboard" in markup)) throw new Error();
    const labels = markup.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(["I understand", "Cancel"]);
  });

  test("revealed step shows [Run] [Cancel] with the run callback", () => {
    const markup = buildButtonsForKind(mkRequest("confirm-command"), {
      confirmRevealed: true,
    });
    if (!markup || !("inline_keyboard" in markup)) throw new Error();
    const datas = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toEqual(["ask|req:1|run", "ask|req:1|cancel"]);
  });
});

describe("buildButtonsForKind — text", () => {
  test("returns a force_reply markup", () => {
    const markup = buildButtonsForKind(mkRequest("text"));
    expect(markup).toEqual({
      force_reply: true,
      input_field_placeholder: "Your answer",
    });
  });

  test("default value seeds the input placeholder", () => {
    const markup = buildButtonsForKind(mkRequest("text", { default: "main" }));
    expect(markup).toEqual({
      force_reply: true,
      input_field_placeholder: "main",
    });
  });
});

// ── parseAskCallbackData ──────────────────────────────────────

describe("parseAskCallbackData", () => {
  test("decodes a well-formed ask|<id>|<value> string", () => {
    expect(parseAskCallbackData("ask|req:7|yes")).toEqual({
      requestId: "req:7",
      value: "yes",
    });
  });

  test("decodes values with hyphens / underscores / digits", () => {
    expect(parseAskCallbackData("ask|req:1|main_branch-1")).toEqual({
      requestId: "req:1",
      value: "main_branch-1",
    });
  });

  test("returns null for non-ask prefix (so other handlers run)", () => {
    expect(parseAskCallbackData("ok|notif:1")).toBeNull();
    expect(parseAskCallbackData("continue|notif:1")).toBeNull();
    expect(parseAskCallbackData("stop|notif:1")).toBeNull();
  });

  test("returns null when value is missing", () => {
    expect(parseAskCallbackData("ask|req:1|")).toBeNull();
    expect(parseAskCallbackData("ask|req:1")).toBeNull();
  });

  test("returns null when id is missing", () => {
    expect(parseAskCallbackData("ask||yes")).toBeNull();
  });
});

// ── formatResolutionFooter ────────────────────────────────────

describe("formatResolutionFooter", () => {
  test("strikes the title and stamps the chosen value", () => {
    // `?` isn't a MarkdownV2 reserved char so it passes through;
    // the title is wrapped in `~…~` (strike-through) per MDv2.
    const out = formatResolutionFooter(
      mkRequest("yesno", { title: "Delete?" }),
      { request_id: "req:1", action: "ok", value: "yes" },
    );
    expect(out).toContain("~Delete?~");
    expect(out).toContain("Answered: yes");
  });

  test("cancel renders the optional reason", () => {
    const out = formatResolutionFooter(mkRequest("yesno"), {
      request_id: "req:1",
      action: "cancel",
      reason: "user said no",
    });
    expect(out).toContain("Cancelled");
    expect(out).toContain("user said no");
  });

  test("timeout renders a clean Timed out marker", () => {
    const out = formatResolutionFooter(mkRequest("yesno"), {
      request_id: "req:1",
      action: "timeout",
    });
    expect(out).toContain("Timed out");
  });

  test("attribution carries through into the footer", () => {
    const out = formatResolutionFooter(
      mkRequest("yesno"),
      { request_id: "req:1", action: "ok", value: "yes" },
      { workspace: "frontend", pane: "vim" },
    );
    expect(out).toContain("frontend · vim");
  });
});
