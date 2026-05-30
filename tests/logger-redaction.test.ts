// W1-5 (full_app_review_2026-05.md §16.1) — the logger tees every console.*
// line into a 14-day on-disk log via Bun.inspect, which prints the
// token-bearing telegram URL when a raw fetch error is logged. redactSecrets
// scrubs secret-shaped substrings before they reach disk, defending every
// call site centrally (including a future `catch (err) { console.warn(p, err) }`).

import { describe, test, expect } from "bun:test";
import { redactSecrets } from "../src/bun/logger";

describe("redactSecrets", () => {
  test("redacts a telegram bot token in an api.telegram.org URL", () => {
    const line =
      'fetch failed: { path: "https://api.telegram.org/bot8446656662:AAEhc-SomeReal_LookingToken12345/getUpdates" }';
    const out = redactSecrets(line);
    expect(out).not.toContain("AAEhc-SomeReal_LookingToken12345");
    expect(out).toContain("bot8446656662:<redacted>");
  });

  test("redacts a bare token:secret shape", () => {
    const out = redactSecrets(
      "token=123456789:AAFopaqueSecretValue_thatIsLongEnough12",
    );
    // The query-param rule fires first; either way the secret is gone.
    expect(out).not.toContain("AAFopaqueSecretValue_thatIsLongEnough12");
    expect(out).toContain("<redacted>");
  });

  test("redacts token / auth / access_token query params", () => {
    expect(redactSecrets("GET /?token=supersecretvalue&x=1")).toBe(
      "GET /?token=<redacted>&x=1",
    );
    expect(redactSecrets("ws://h/?auth=abc.def-ghi")).toBe(
      "ws://h/?auth=<redacted>",
    );
    expect(redactSecrets("url?access_token=zzz")).toBe(
      "url?access_token=<redacted>",
    );
  });

  test("redacts an Authorization: Bearer header", () => {
    expect(redactSecrets("authorization: Bearer abc123.DEF-456")).toBe(
      "authorization: Bearer <redacted>",
    );
  });

  test("leaves ordinary log text untouched", () => {
    const ordinary =
      "[session] created surface:1 — pid: 71640, 80x24 at 12:30:00";
    expect(redactSecrets(ordinary)).toBe(ordinary);
    // Short numeric pairs like a time or ratio must not be mangled.
    expect(redactSecrets("ratio 16:9, time 12:30")).toBe(
      "ratio 16:9, time 12:30",
    );
  });
});
