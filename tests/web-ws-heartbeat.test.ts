// Triple-A H.5 / L3+L5 — verify the WebSocket heartbeat is configured
// server-side and the reconnect path applies jitter + a retry cap on
// the client. Backfill from Phase 0 audit (PR 12).
//
// End-to-end testing of half-open detection would require simulating a
// silent NAT timeout, which we can't do in a unit test. The actual
// mechanism is Bun's own idleTimeout/sendPings — we pin the configuration
// so a future refactor can't accidentally drop them.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "web", "server.ts"),
  "utf-8",
);
const CLIENT_SRC = readFileSync(
  join(import.meta.dir, "..", "src", "web-client", "transport.ts"),
  "utf-8",
);

describe("[L3] WebSocket heartbeat — server-side config", () => {
  it("sets Bun WebSocket idleTimeout to 60 seconds", () => {
    expect(SERVER_SRC).toMatch(/idleTimeout:\s*60\b/);
  });

  it("enables sendPings so Bun emits PINGs on idle", () => {
    expect(SERVER_SRC).toMatch(/sendPings:\s*true/);
  });
});

describe("[L5] WebSocket reconnect — client-side jitter + cap", () => {
  it("caps reconnect attempts to prevent leaking warn-lines forever", () => {
    expect(CLIENT_SRC).toMatch(/MAX_RECONNECT_ATTEMPTS\s*=\s*30/);
  });

  it("applies ±25% jitter to the backoff delay", () => {
    // The jitter math: `(Math.random() - 0.5) * 0.5` produces a
    // shift in [-0.25, +0.25], applied to `reconnectDelay * (1 + jitter)`.
    // Pin both the magnitude (0.5) and the comment marker so a future
    // refactor can't silently drop the jitter back to deterministic.
    expect(CLIENT_SRC).toMatch(/\(Math\.random\(\)\s*-\s*0\.5\)\s*\*\s*0\.5/);
    expect(CLIENT_SRC).toContain("±25");
  });

  it("doubles the base delay between retries (exponential backoff)", () => {
    // The original L5 bug was deterministic 30s — no jitter, no cap.
    // The fix is exponential backoff with jitter. Pin the *2 step.
    expect(CLIENT_SRC).toMatch(/reconnectDelay\s*\*\s*2/);
  });
});
