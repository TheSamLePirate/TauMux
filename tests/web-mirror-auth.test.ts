import { describe, test, expect } from "bun:test";
import {
  MIN_MIRROR_TOKEN_LEN,
  defaultTokenGenerator,
  isLoopbackBind,
  resolveWebMirrorAuth,
} from "../src/bun/web-mirror-auth";

/**
 * Policy tests for the mirror-auth hardening: a non-loopback bind
 * must never run with a missing/weak token — the server's
 * `if (!this.authToken) return true` makes that remote shell as the
 * user. The fix generates (never refuses) so the feature keeps
 * working behind a secret.
 */

describe("isLoopbackBind", () => {
  test("recognises loopback forms", () => {
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("localhost")).toBe(true);
    expect(isLoopbackBind("::1")).toBe(true);
  });

  test("rejects LAN binds", () => {
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
    expect(isLoopbackBind("192.168.1.10")).toBe(false);
  });
});

describe("resolveWebMirrorAuth", () => {
  test("loopback + empty token: honoured as-is, no intervention", () => {
    const d = resolveWebMirrorAuth("127.0.0.1", "");
    expect(d).toEqual({
      bind: "127.0.0.1",
      authToken: "",
      generatedToken: false,
      note: null,
    });
  });

  test("LAN bind + strong token: honoured as-is", () => {
    const token = "a".repeat(MIN_MIRROR_TOKEN_LEN);
    const d = resolveWebMirrorAuth("0.0.0.0", token);
    expect(d.generatedToken).toBe(false);
    expect(d.authToken).toBe(token);
    expect(d.note).toBeNull();
  });

  test("LAN bind + EMPTY token: generates a strong token", () => {
    const d = resolveWebMirrorAuth("0.0.0.0", "", () => "generated-token-xyz");
    expect(d.generatedToken).toBe(true);
    expect(d.authToken).toBe("generated-token-xyz");
    expect(d.note).toContain("no webMirrorAuthToken");
  });

  test("LAN bind + WEAK token: replaced, not honoured", () => {
    const d = resolveWebMirrorAuth("0.0.0.0", "short", () => "g".repeat(32));
    expect(d.generatedToken).toBe(true);
    expect(d.authToken).toBe("g".repeat(32));
    expect(d.note).toContain("shorter than");
  });

  test("whitespace-only token counts as empty", () => {
    const d = resolveWebMirrorAuth("0.0.0.0", "   ", () => "gen");
    expect(d.generatedToken).toBe(true);
  });

  test("default generator produces URL-safe tokens of sufficient length", () => {
    const t = defaultTokenGenerator();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url — survives ?t=
    // Two calls never collide.
    expect(defaultTokenGenerator()).not.toBe(t);
  });
});
