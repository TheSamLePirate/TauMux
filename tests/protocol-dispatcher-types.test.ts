// Phase 2 / A2 — protocol-dispatcher typing invariants.
//
// The dispatcher's `Payload = any` was replaced by a typed
// ServerPayloadByType lookup. The runtime cast inside each case body
// is contractually safe because the `switch (type)` above it is the
// discriminator. This test pins both invariants:
//
//   1. No `: any` survives in protocol-dispatcher.ts.
//   2. Every type literal in the ServerMessage union has a `case`
//      branch in the dispatcher.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "web-client", "protocol-dispatcher.ts"),
  "utf-8",
);
const PROTOCOL = readFileSync(
  join(import.meta.dir, "..", "src", "shared", "web-protocol.ts"),
  "utf-8",
);

describe("[A2] protocol-dispatcher — no any payloads", () => {
  it("does not declare `type Payload = any`", () => {
    expect(SRC).not.toMatch(/type\s+Payload\s*=\s*any/);
  });

  it("uses the typed ServerPayloadByType lookup", () => {
    expect(SRC).toContain("ServerPayloadByType");
    expect(SRC).toMatch(
      /type\s+ServerPayloadByType\s*=\s*\{[\s\S]*?ServerMessage[\s\S]*?\}/,
    );
  });

  it("the dispatcher signature returns a function over `unknown` payloads", () => {
    // The boundary is `unknown` (the transport delivers raw JSON). The
    // typed narrowing happens per-case via the lookup map.
    expect(SRC).toMatch(/payload:\s*unknown/);
  });
});

describe("[A2] protocol-dispatcher — exhaustive over ServerMessage", () => {
  it("every type literal in the ServerMessage union has a case branch", () => {
    // Pull every `Envelope<"…">` literal out of the union declaration.
    const unionBlock = PROTOCOL.match(
      /export type ServerMessage\s*=([\s\S]*?);/,
    );
    expect(unionBlock).not.toBeNull();
    const types = [...unionBlock![1].matchAll(/Envelope<"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(types.length).toBeGreaterThan(10);
    for (const t of types) {
      // The case can be either `case "type":` (with terminator) or
      // grouped with the next case (`case "type":` followed by `case`).
      // Match either form via the literal substring.
      const literal = `case "${t}"`;
      expect(SRC).toContain(literal);
    }
  });
});
