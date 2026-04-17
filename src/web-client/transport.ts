/**
 * Web-mirror WebSocket transport.
 *
 * Owns the WS lifecycle — connect, reconnect with exponential backoff,
 * resume-on-reconnect (sessionId + lastSeenSeq), binary-frame header
 * parsing, auth-token preservation across reconnects, and the outbound
 * `send(type, payload)` envelope builder.
 *
 * Kept separate from main.ts so the protocol dispatcher has something
 * to talk to that can be tested with a fake WebSocket. The transport
 * itself doesn't know what server messages mean — it hands each one
 * off to `onTextMessage(type, payload)` and binary frames to
 * `onBinaryFrame(id, data)`.
 */

import type { Store } from "./store";
import { WEB_PROTOCOL_VERSION } from "../shared/web-protocol";

export interface TransportDeps {
  store: Store;
  /** Called once per non-binary message envelope. Errors in the
   *  handler are the handler's problem — the transport doesn't
   *  catch them. */
  onTextMessage: (type: string, payload: unknown) => void;
  /** Called for each binary sideband frame. `id` is the panel id
   *  carried in the frame header. */
  onBinaryFrame: (id: string, data: Uint8Array) => void;
}

export interface Transport {
  /** Send an envelope with the current protocol version + ack seq.
   *  No-op when the socket isn't open — callers can fire without
   *  caring about connection state. */
  send: (type: string, payload: Record<string, unknown>) => void;
  /** Open the initial connection. Subsequent reconnects happen
   *  automatically on close. */
  connect: () => void;
}

export function createTransport(deps: TransportDeps): Transport {
  const { store, onTextMessage, onBinaryFrame } = deps;

  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;

  function send(type: string, payload: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const s = store.getState();
    ws.send(
      JSON.stringify({
        v: WEB_PROTOCOL_VERSION,
        ack:
          s.connection.lastSeenSeq >= 0 ? s.connection.lastSeenSeq : undefined,
        type,
        payload,
      }),
    );
  }

  function connect(): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const { sessionId, lastSeenSeq } = store.getState().connection;
    // Preserve the auth token from the page URL (if present). Without
    // this, loading `/?t=abc` would serve the page with the token on
    // the HTTP request but then build a tokenless `ws://host/` URL,
    // which the server rejects with 401. We also honor Authorization:
    // Bearer headers on the HTTP fetch — those survive automatically —
    // but the query-string path is the one browsers hit from a plain
    // link, so it's the one that needs preserving here.
    const pageT = new URLSearchParams(location.search).get("t");
    const params = new URLSearchParams();
    if (sessionId && lastSeenSeq >= 0) {
      params.set("resume", sessionId);
      params.set("seq", String(lastSeenSeq));
    }
    if (pageT) params.set("t", pageT);
    const qs = params.toString() ? `?${params.toString()}` : "";
    ws = new WebSocket(proto + "//" + location.host + "/" + qs);
    ws.binaryType = "arraybuffer";
    store.dispatch({ kind: "connection/status", status: "connecting" });

    ws.onopen = () => {
      reconnectDelay = 1000;
      store.dispatch({ kind: "connection/status", status: "connected" });
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        handleBinaryFrame(event.data);
        return;
      }
      handleTextFrame(event.data);
    };

    ws.onclose = () => {
      store.dispatch({
        kind: "connection/status",
        status: "disconnected",
      });
      // Keep session id + lastSeenSeq — the reconnect attempt will use
      // them to resume. State is preserved across brief disconnects; a
      // fresh hello from the server (with a new sessionId) will
      // overwrite it.
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connect();
      }, reconnectDelay);
    };
    ws.onerror = () => {
      /* the close handler drives reconnect; suppress default noise */
    };
  }

  function handleBinaryFrame(buffer: ArrayBuffer): void {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    const hLen = dv.getUint32(0, false);
    let hdr: { seq?: number; type?: string; id?: string };
    try {
      hdr = JSON.parse(
        new TextDecoder().decode(bytes.subarray(4, 4 + hLen)),
      ) as typeof hdr;
    } catch {
      return;
    }
    const payload = bytes.subarray(4 + hLen);
    if (typeof hdr.seq === "number")
      store.dispatch({ kind: "connection/seq", seq: hdr.seq });
    if (hdr.type === "sidebandData" && hdr.id) {
      onBinaryFrame(hdr.id, payload);
    }
  }

  function handleTextFrame(raw: string): void {
    let msg: { seq?: number; type?: string; payload?: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.seq === "number")
      store.dispatch({ kind: "connection/seq", seq: msg.seq });
    const type = msg.type;
    if (!type) return;
    const payload =
      msg && typeof msg.payload === "object" && msg.payload !== null
        ? msg.payload
        : msg;
    onTextMessage(type, payload);
  }

  return { send, connect };
}
