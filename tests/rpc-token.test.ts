// W2 (full_app_review_2026-05.md §6.1) — shared RPC-token helpers used by
// the app, bin/ht, and the pi bridge to agree on where the token lives and
// which methods are exempt.

import { describe, test, expect } from "bun:test";
import {
  RPC_TOKEN_FILENAME,
  RPC_TOKEN_FIELD,
  UNAUTHENTICATED_RPC_METHODS,
  rpcTokenPathForSocket,
} from "../src/shared/rpc-token";

describe("rpc-token helpers", () => {
  test("token file sits beside the socket", () => {
    expect(
      rpcTokenPathForSocket("/Users/x/Library/App/ht/hyperterm.sock"),
    ).toBe("/Users/x/Library/App/ht/socket.token");
    expect(rpcTokenPathForSocket("/tmp/hyperterm.sock")).toBe(
      "/tmp/socket.token",
    );
  });

  test("constants are stable wire/file contracts", () => {
    expect(RPC_TOKEN_FILENAME).toBe("socket.token");
    expect(RPC_TOKEN_FIELD).toBe("__token");
  });

  test("read-only diagnostics are exempt; mutating + shutdown are not", () => {
    for (const m of [
      "system.ping",
      "system.version",
      "system.identify",
      "system.capabilities",
      "system.health",
      "system.tree",
    ]) {
      expect(UNAUTHENTICATED_RPC_METHODS.has(m)).toBe(true);
    }
    for (const m of [
      "system.shutdown",
      "surface.send_text",
      "surface.send_key",
      "surface.kill_pid",
      "script.run",
    ]) {
      expect(UNAUTHENTICATED_RPC_METHODS.has(m)).toBe(false);
    }
  });
});
