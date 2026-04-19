import { describe, test, expect } from "bun:test";
import {
  DEFAULT_SETTINGS,
  parseAllowedTelegramIds,
  validateSettings,
  type AppSettings,
} from "../src/shared/settings";

function withAllowed(input: string): string {
  const next: AppSettings = {
    ...DEFAULT_SETTINGS,
    telegramAllowedUserIds: input,
  };
  return validateSettings(next).telegramAllowedUserIds;
}

describe("Telegram settings — allow-list normalization", () => {
  test("empty string stays empty (allow-all)", () => {
    expect(withAllowed("")).toBe("");
  });

  test("trims whitespace around entries", () => {
    expect(withAllowed("  123 ,  456  ")).toBe("123,456");
  });

  test("dedupes duplicates while preserving order", () => {
    expect(withAllowed("123,456,123,789,456")).toBe("123,456,789");
  });

  test("drops non-numeric entries", () => {
    expect(withAllowed("123,abc,456,12.5,def")).toBe("123,456");
  });

  test("survives a round-trip through validate", () => {
    const a = withAllowed("123, 456 ,789");
    const b = withAllowed(a);
    expect(b).toBe(a);
  });
});

describe("Telegram settings — runtime parser", () => {
  test("parseAllowedTelegramIds returns a Set for fast lookup", () => {
    const set = parseAllowedTelegramIds("123,456,789");
    expect(set.has("123")).toBe(true);
    expect(set.has("456")).toBe(true);
    expect(set.has("789")).toBe(true);
    expect(set.has("000")).toBe(false);
    expect(set.size).toBe(3);
  });

  test("parseAllowedTelegramIds handles whitespace", () => {
    const set = parseAllowedTelegramIds(" 123 , 456 ");
    expect(set.has("123")).toBe(true);
    expect(set.has("456")).toBe(true);
  });

  test("empty input → empty set (allow-all sentinel)", () => {
    expect(parseAllowedTelegramIds("").size).toBe(0);
  });

  test("normalize and parse stay in lockstep", () => {
    const messy = "  123 , 456,123, abc ,789 ";
    const normalized = withAllowed(messy);
    const set = parseAllowedTelegramIds(normalized);
    const directSet = parseAllowedTelegramIds(messy);
    expect([...set].sort()).toEqual([...directSet].sort());
  });
});
