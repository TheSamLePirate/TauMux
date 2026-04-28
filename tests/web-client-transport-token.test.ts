// D.4 — auth token in URL is scrubbed via history.replaceState after
// the first successful WebSocket open. Reconnects keep authenticating
// because the token is captured into module scope at construction time.
//
// happy-dom only honors the URL passed at GlobalRegistrator.register()
// time — `history.replaceState` updates `history.state` but not
// `location.href`. We test by registering with a token-bearing URL,
// then asserting:
//   1. the captured WebSocket URL contains `t=secret` (proves capture
//      worked)
//   2. after the open handler fires, the constructed WS URL on a
//      second connect still contains the token (proves reconnects
//      keep authenticating).
// The actual `history.replaceState` invocation is best verified by a
// real browser; we cover the call path via spy here.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/app?t=secret" });
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

interface FakeStoreState {
  connection: { sessionId: string | null; lastSeenSeq: number; status: string };
}

function makeFakeStore() {
  const state: FakeStoreState = {
    connection: { sessionId: null, lastSeenSeq: -1, status: "disconnected" },
  };
  return {
    getState: () => state as unknown as never,
    dispatch: (action: { kind: string; status?: string }) => {
      if (action.kind === "connection/status" && action.status) {
        state.connection.status = action.status;
      }
    },
  };
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  readyState = 0;
  binaryType = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send(_data: string | ArrayBuffer | ArrayBufferView): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  constructor(url: string) {
    this.url = url;
  }
}

describe("transport — auth token URL scrub (D.4)", () => {
  test("captured token is preserved on the WebSocket URL across reconnects", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const builtUrls: string[] = [];
    let lastWs: FakeWebSocket | null = null;
    (globalThis as { WebSocket: unknown }).WebSocket = function (url: string) {
      builtUrls.push(url);
      lastWs = new FakeWebSocket(url);
      return lastWs;
    } as unknown as typeof WebSocket;
    Object.assign(globalThis.WebSocket, {
      OPEN: FakeWebSocket.OPEN,
      CLOSED: FakeWebSocket.CLOSED,
    });

    // Spy on history.replaceState — happy-dom doesn't propagate the
    // change to location, but we can still verify the call.
    const original = history.replaceState.bind(history);
    let replaceStateCalls = 0;
    history.replaceState = ((...args: Parameters<typeof original>) => {
      replaceStateCalls += 1;
      return original(...args);
    }) as typeof history.replaceState;

    try {
      const { createTransport } = await import("../src/web-client/transport");
      const store = makeFakeStore();
      const transport = createTransport({
        store: store as unknown as Parameters<
          typeof createTransport
        >[0]["store"],
        onTextMessage: () => {},
        onBinaryFrame: () => {},
      });

      transport.connect();
      expect(builtUrls.length).toBe(1);
      expect(builtUrls[0]).toContain("t=secret");
      // No replaceState call until the connection opens — preserves
      // the token in the URL on a 401 so the developer can see what
      // failed.
      expect(replaceStateCalls).toBe(0);

      // Simulate the server accepting the upgrade.
      lastWs!.readyState = FakeWebSocket.OPEN;
      lastWs!.onopen?.(new Event("open"));
      expect(replaceStateCalls).toBe(1);

      // Reconnect — must still authenticate.
      transport.connect();
      expect(builtUrls.length).toBe(2);
      expect(builtUrls[1]).toContain("t=secret");

      // Subsequent open shouldn't re-call replaceState (idempotent).
      lastWs!.readyState = FakeWebSocket.OPEN;
      lastWs!.onopen?.(new Event("open"));
      expect(replaceStateCalls).toBe(1);
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
      history.replaceState = original;
    }
  });
});
