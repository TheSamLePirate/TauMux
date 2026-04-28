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

  // D.4 — capture the auth token from the page URL once at module load
  // and remember it for the lifetime of the page. Reconnects read from
  // this variable rather than `location.search`, so we can safely scrub
  // the token out of the URL after the first successful connect (see
  // `scrubTokenFromUrl` below). Without this, a script that logs
  // `window.location` or an analytics call that captures the URL would
  // leak the token; with it, the URL bar shows just `/` after the
  // initial handshake.
  const capturedAuthToken = (() => {
    try {
      return new URLSearchParams(location.search).get("t") || null;
    } catch {
      return null;
    }
  })();
  let urlScrubbed = false;

  function scrubTokenFromUrl(): void {
    if (urlScrubbed) return;
    urlScrubbed = true;
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has("t")) return;
      url.searchParams.delete("t");
      const search = url.searchParams.toString();
      const next =
        url.pathname + (search ? `?${search}` : "") + (url.hash || "");
      // replaceState swaps the URL without a navigation, so the page
      // doesn't reload and the WebSocket stays open. We pass the
      // current state so a future history.state read still sees what
      // it expects.
      history.replaceState(history.state, "", next);
    } catch {
      /* In some embedded contexts replaceState can throw (about:blank,
       * sandboxed iframes). The token reuse path doesn't depend on the
       * URL bar, so a failed scrub is non-fatal — we just leave the
       * URL alone. */
    }
  }

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
    // Preserve the auth token across reconnects (see `capturedAuthToken`
    // above). Without this, loading `/?t=abc` would serve the page with
    // the token on the HTTP request but then build a tokenless
    // `ws://host/` URL, which the server rejects with 401.
    const params = new URLSearchParams();
    if (sessionId && lastSeenSeq >= 0) {
      params.set("resume", sessionId);
      params.set("seq", String(lastSeenSeq));
    }
    if (capturedAuthToken) params.set("t", capturedAuthToken);
    const qs = params.toString() ? `?${params.toString()}` : "";
    ws = new WebSocket(proto + "//" + location.host + "/" + qs);
    ws.binaryType = "arraybuffer";
    store.dispatch({ kind: "connection/status", status: "connecting" });

    ws.onopen = () => {
      reconnectDelay = 1000;
      store.dispatch({ kind: "connection/status", status: "connected" });
      // D.4 — once the first connection succeeds, scrub the token out of
      // the page URL. Subsequent reconnects use the captured value, so
      // the URL bar can safely lose the secret. We do this AFTER the
      // first successful open so a 401 (token rejected) leaves the
      // token visible in the URL — easier to debug than a silently
      // empty URL bar paired with a "connection failed" error.
      if (!urlScrubbed) {
        scrubTokenFromUrl();
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        handleBinaryFrame(event.data);
        return;
      }
      handleTextFrame(event.data);
    };

    ws.onclose = (event: CloseEvent) => {
      // Surface the close reason in the console so operators can tell
      // a 1008 (policy violation, e.g. wrong token) from a 1011 (server
      // error) from a 1006 (transport-level abort). Dropped frames look
      // identical to the user without this. Issue N1 in
      // doc/full_analysis.md.
      const reason = event.reason ? ` reason="${event.reason}"` : "";
      const wasClean = event.wasClean ? " clean" : "";
      console.warn(
        `[mirror] ws closed code=${event.code}${reason}${wasClean}; reconnecting in ${reconnectDelay}ms`,
      );
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
