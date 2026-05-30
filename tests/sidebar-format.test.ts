// H11 (full_app_review_2026-05.md §3.2) — the sidebar leaf formatters,
// unified into src/shared so the native sidebar and the web-mirror card
// can no longer drift. These pin the canonical (native) behavior the web
// surface now shares — including the cases where the old web impls were
// outright wrong (a 512 KB process rendered as "0M").

import { describe, test, expect } from "bun:test";
import { shortenCwd, formatRss } from "../src/shared/sidebar-format";

describe("shortenCwd", () => {
  test("empty string stays empty", () => {
    expect(shortenCwd("")).toBe("");
  });

  test("paths with <=2 segments are shown whole with leading slash", () => {
    expect(shortenCwd("/Users")).toBe("/Users");
    expect(shortenCwd("/Users/me")).toBe("/Users/me");
  });

  test("relative <=2-segment paths keep no leading slash", () => {
    expect(shortenCwd("a/b")).toBe("a/b");
  });

  test("longer paths collapse to ellipsis + last two segments", () => {
    expect(shortenCwd("/Users/me/dev/app/src")).toBe("…/app/src");
    expect(shortenCwd("/a/b/c")).toBe("…/b/c");
  });

  test("trailing slashes are ignored", () => {
    expect(shortenCwd("/Users/me/dev/app/src/")).toBe("…/app/src");
  });

  test("home paths collapse the same way (no ~ expansion — parity w/ native)", () => {
    // The old web impl produced "~/Documents/DEV/crazyShell"; native (now
    // canonical) produces the compact last-two form.
    expect(shortenCwd("/Users/olivier/Documents/DEV/crazyShell")).toBe(
      "…/DEV/crazyShell",
    );
  });
});

describe("formatRss", () => {
  test("sub-MB values render in K (not the old web '0M' bug)", () => {
    expect(formatRss(512)).toBe("512K");
    expect(formatRss(1)).toBe("1K");
    expect(formatRss(1023)).toBe("1023K");
  });

  test("MB values show one decimal under 10, rounded above", () => {
    expect(formatRss(2048)).toBe("2.0M");
    expect(formatRss(1024 * 9.5)).toBe("9.5M");
    expect(formatRss(1024 * 12)).toBe("12M");
    expect(formatRss(1024 * 512)).toBe("512M");
  });

  test("GB values show one decimal under 10, rounded above", () => {
    expect(formatRss(1024 * 1024 * 2.1)).toBe("2.1G");
    expect(formatRss(1024 * 1024 * 12)).toBe("12G");
  });

  test("the 1 MiB boundary crosses from K to M", () => {
    expect(formatRss(1023)).toBe("1023K");
    expect(formatRss(1024)).toBe("1.0M");
  });
});
