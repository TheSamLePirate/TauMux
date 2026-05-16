// Triple-A H.3 / S4 — verify the web-mirror logs a token-entropy
// warning when bound to 0.0.0.0 with a token shorter than the
// recommended floor. Backfill from Phase 0 audit (PR 11).
//
// Live exercise would require starting Bun.serve with a short token
// and capturing console.warn — testable but heavier than the
// regression we're guarding (a future refactor that drops the
// length check or weakens the floor). Source-grep covers it.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "web", "server.ts"),
  "utf-8",
);

describe("[S4] token entropy floor on 0.0.0.0", () => {
  it("declares TOKEN_MIN_LEN_FOR_LAN = 16", () => {
    expect(SRC).toMatch(/TOKEN_MIN_LEN_FOR_LAN\s*=\s*16/);
  });

  it("compares the auth token length against the floor when bound 0.0.0.0", () => {
    // The check shape:
    //   bind === "0.0.0.0" && authToken && authToken.length < TOKEN_MIN_LEN_FOR_LAN
    // A future refactor that loosens the bind check (e.g. only `127.0.0.1`
    // path) or drops the length comparison would silently re-introduce
    // the unauthenticated-LAN exposure.
    expect(SRC).toContain('this.bind === "0.0.0.0"');
    expect(SRC).toMatch(/this\.authToken\.length\s*<\s*TOKEN_MIN_LEN_FOR_LAN/);
  });

  it("emits a console.warn with the actual token length and the floor", () => {
    expect(SRC).toContain("[web] Warning: webMirrorAuthToken");
    expect(SRC).toContain("recommended minimum on 0.0.0.0");
    expect(SRC).toContain("openssl rand -base64");
  });
});
