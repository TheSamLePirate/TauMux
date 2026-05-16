// Phase 4 / S11 / H.11 — Telegram parse_mode allow-list.
//
// Telegram's parse_mode field selects how the message body is rendered.
// The valid runtime values are "MarkdownV2", "HTML", and the deprecated
// "Markdown" (v1). HTML mode lets the bot render <a href="…"> which is
// an injection vector if the message body comes from a user-controlled
// notification or forwarded log line. Markdown v1 is deprecated and
// less strict about escaping.
//
// The sanitizer narrows the runtime to "MarkdownV2" only — everything
// else (undefined, HTML, Markdown, typos, attacker payloads) returns
// undefined which makes Telegram fall back to plain text.

import { describe, expect, it } from "bun:test";
import { sanitizeParseMode } from "../src/bun/telegram-service";

describe("[S11/H.11] sanitizeParseMode", () => {
  it("passes MarkdownV2 through", () => {
    expect(sanitizeParseMode("MarkdownV2")).toBe("MarkdownV2");
  });

  it("rejects HTML (the injection vector)", () => {
    expect(sanitizeParseMode("HTML")).toBeUndefined();
  });

  it("rejects the deprecated Markdown (v1)", () => {
    expect(sanitizeParseMode("Markdown")).toBeUndefined();
  });

  it("rejects undefined / null / empty string", () => {
    expect(sanitizeParseMode(undefined)).toBeUndefined();
    expect(sanitizeParseMode(null)).toBeUndefined();
    expect(sanitizeParseMode("")).toBeUndefined();
  });

  it("rejects typos / case variants", () => {
    expect(sanitizeParseMode("markdownv2")).toBeUndefined();
    expect(sanitizeParseMode("MARKDOWNV2")).toBeUndefined();
    expect(sanitizeParseMode("Markdown_V2")).toBeUndefined();
    expect(sanitizeParseMode("html")).toBeUndefined();
  });

  it("rejects non-string types", () => {
    expect(sanitizeParseMode(42)).toBeUndefined();
    expect(sanitizeParseMode(true)).toBeUndefined();
    expect(sanitizeParseMode({ mode: "MarkdownV2" })).toBeUndefined();
    expect(sanitizeParseMode(["MarkdownV2"])).toBeUndefined();
  });

  it("rejects attacker-style payloads", () => {
    // A LAN peer with the auth token who can reach the telegram RPC
    // can't bypass this — every parse_mode they supply lands here
    // first.
    expect(sanitizeParseMode('<a href="javascript:alert(1)">')).toBeUndefined();
    expect(
      sanitizeParseMode("MarkdownV2; html=true; ignore-rest"),
    ).toBeUndefined();
    expect(sanitizeParseMode("MarkdownV2\nHTML")).toBeUndefined();
    // Any string that *contains* MarkdownV2 but isn't exactly it.
    expect(sanitizeParseMode(" MarkdownV2")).toBeUndefined();
    expect(sanitizeParseMode("MarkdownV2 ")).toBeUndefined();
  });
});
