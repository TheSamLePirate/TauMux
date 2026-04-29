import type { SessionManager } from "../session-manager";
import type { AppState } from "../rpc-handler";
import type {
  SurfaceMetadata,
  SidebandContentMessage,
  PanelEvent as SidebandPanelEvent,
} from "../../shared/types";
import {
  WEB_PROTOCOL_VERSION,
  type BinaryFrameHeader,
  type HelloPayload,
  type ServerMessageType,
  type ServerWorkspaceRef,
  type Snapshot,
} from "../../shared/web-protocol";
import {
  NERD_FONT_REGULAR,
  NERD_FONT_BOLD,
  NOTIFICATION_SOUND_FINISH,
  readAsset,
} from "./asset-loader";
import { buildHtmlPage, invalidatePageCache } from "./page";
import {
  CLIENT_MESSAGE_MAX_BYTES,
  CLIENT_STDIN_MAX_BYTES,
  decideBackpressure,
  makeServerInstanceId,
  makeSessionId,
  OUTPUT_COALESCE_MS,
  OUTPUT_COALESCE_SOFT_CAP,
  SessionBuffer,
  SESSION_TTL_MS,
  TERMINAL_COLS_MAX,
  TERMINAL_COLS_MIN,
  TERMINAL_ROWS_MAX,
  TERMINAL_ROWS_MIN,
  type ClientData,
  type WS,
} from "./connection";
import { WebStateStore } from "./state-store";

/** Recommended minimum auth-token length on `0.0.0.0` (H.3 / S4).
 *  16 chars of high-entropy base64 (≈96 bits) is the floor below
 *  which an online brute-force at modest connection rates becomes
 *  feasible against the per-IP throttle (H.4). The check is a warn,
 *  not a refuse-to-start, so existing users with a 12-char token
 *  aren't locked out by an upgrade. */
export const TOKEN_MIN_LEN_FOR_LAN = 16;

/** Per-IP brute-force throttle on auth (H.4 / S5). Counts failed
 *  auth attempts per source IP in a sliding window; once the count
 *  exceeds `AUTH_FAIL_LIMIT` within `AUTH_FAIL_WINDOW_MS`, every
 *  subsequent request from that IP gets a 429 for `AUTH_FAIL_COOL_MS`
 *  regardless of token correctness. Cleanup is lazy — entries are
 *  expired on next access. */
const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_COOL_MS = 10 * 60_000;

interface AuthFailRecord {
  count: number;
  windowStart: number;
  /** Set when the IP has tripped the limit; rejected with 429 until
   *  this timestamp (epoch ms). */
  cooldownUntil: number;
}

export class WebServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  /** Clients (live sessions, attached or recently detached). */
  private clients = new Set<WS>();
  private sessions = new Map<string, SessionBuffer>();
  private ttlTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private clientCounter = 0;
  private nativeViewport: { width: number; height: number } | null = null;
  private store = new WebStateStore();
  private serverInstanceId = makeServerInstanceId();
  /** Exposed to tests; caps the ring buffer per session. */
  sessionBufferMaxBytes?: number;
  /** Exposed to tests; time after disconnect before a session is dropped. */
  sessionTtlMs = SESSION_TTL_MS;

  onSidebarToggle: ((visible: boolean) => void) | null = null;
  onSelectWorkspace: ((workspaceId: string) => void) | null = null;
  onFocusSurface: ((surfaceId: string) => void) | null = null;
  onClearNotifications: (() => void) | null = null;
  onDismissNotification: ((id: string) => void) | null = null;
  onPanelUpdate:
    | ((
        surfaceId: string,
        panelId: string,
        fields: Record<string, unknown>,
      ) => void)
    | null = null;
  /** Optional: called when a web client proposes a terminal resize.
   *  Host decides whether to honor it. Left null by default so the
   *  native webview stays authoritative in the standard desktop case. */
  onSurfaceResizeRequest:
    | ((surfaceId: string, cols: number, rows: number) => void)
    | null = null;
  /** Web client requests an outbound Telegram message. */
  onTelegramSend: ((chatId: string, text: string) => void) | null = null;
  /** Web client wants paginated history. Server replies with a
   *  `telegramHistory` envelope to all clients. */
  onTelegramRequestHistory:
    | ((chatId: string, before: number | undefined) => void)
    | null = null;
  /** Web client (re)requests the chat list + service status. */
  onTelegramRequestState: (() => void) | null = null;

  /** Plan #09 commit C — fired before every web-mirror stdin packet
   *  so the auto-continue engine can reset its runaway counter when
   *  a real user types from the browser. Settable via
   *  `setOnHumanInput` after construction since the engine may not
   *  exist at WebServer instantiation time. */
  private onHumanInput: (surfaceId: string) => void = () => {};

  constructor(
    private port: number,
    private sessionsManager: SessionManager,
    private getAppState: () => AppState,
    private getFocusedSurfaceId: () => string | null,
    private getSidebarVisible: () => boolean = () => true,
    private bind: "127.0.0.1" | "0.0.0.0" = "0.0.0.0",
    private authToken: string = "",
  ) {}

  setOnHumanInput(fn: (surfaceId: string) => void): void {
    this.onHumanInput = fn;
  }

  /** Allow live updates from the settings panel without restarting. */
  setAuthToken(token: string): void {
    this.authToken = (token ?? "").trim();
  }

  /** Per-IP brute-force throttle state (H.4 / S5). Map keyed on the
   *  source IP recovered from `req`. */
  private authFails = new Map<string, AuthFailRecord>();

  /** Extract a best-effort source IP from a Request. Bun.serve
   *  exposes `server.requestIP(req)` for this in newer versions; we
   *  fall back to `x-forwarded-for` (first hop) for proxy setups,
   *  then to the `host` header as a last resort. None of these are
   *  spoofable from the LAN itself but they're best-effort. */
  private clientIp(req: Request): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.headers.get("host") ?? "unknown";
  }

  /** Returns true if the IP is currently under cooldown. Also expires
   *  stale records lazily. */
  private throttled(ip: string): boolean {
    const rec = this.authFails.get(ip);
    if (!rec) return false;
    const now = Date.now();
    if (rec.cooldownUntil && rec.cooldownUntil > now) return true;
    if (rec.cooldownUntil && rec.cooldownUntil <= now) {
      // Cooldown expired — clear the record entirely so the next
      // failure starts a fresh window.
      this.authFails.delete(ip);
      return false;
    }
    if (now - rec.windowStart > AUTH_FAIL_WINDOW_MS) {
      this.authFails.delete(ip);
      return false;
    }
    return false;
  }

  /** Record a failed auth attempt; trips the cooldown when the count
   *  exceeds the limit within the window. */
  private recordAuthFail(ip: string): void {
    const now = Date.now();
    const rec = this.authFails.get(ip);
    if (!rec) {
      this.authFails.set(ip, {
        count: 1,
        windowStart: now,
        cooldownUntil: 0,
      });
      return;
    }
    if (now - rec.windowStart > AUTH_FAIL_WINDOW_MS) {
      // Reset the window
      rec.count = 1;
      rec.windowStart = now;
      rec.cooldownUntil = 0;
      return;
    }
    rec.count += 1;
    if (rec.count > AUTH_FAIL_LIMIT) {
      rec.cooldownUntil = now + AUTH_FAIL_COOL_MS;
      console.warn(
        `[web] auth-throttle: IP ${ip} tripped at ${rec.count} failures; cooling for ${AUTH_FAIL_COOL_MS / 1000}s`,
      );
    }
  }

  private authorized(url: URL, req: Request): boolean {
    if (!this.authToken) return true;
    const t = url.searchParams.get("t");
    if (t && timingSafeEqualStr(t, this.authToken)) return true;
    const auth = req.headers.get("authorization");
    if (auth && timingSafeEqualStr(auth, `Bearer ${this.authToken}`))
      return true;
    return false;
  }

  /** Default security headers for every HTTP response (H.2 / S6).
   *  - frame-ancestors=none: a neighbor's malicious page can't iframe
   *    `http://your-laptop.local:8080/` and clickjack into typing.
   *  - X-Content-Type-Options=nosniff: the browser refuses to MIME-
   *    sniff resources, so a sideband-served HTML chunk can't be
   *    misinterpreted as a script.
   *  - Referrer-Policy=no-referrer: no token leakage in third-party
   *    navigations.
   *  - Permissions-Policy: deny camera/mic/geolocation by default.
   *  Returns plain object so callers can spread into their own
   *  `headers:` map. */
  private securityHeaders(): Record<string, string> {
    return {
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy":
        "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
      // CSP for the HTML page is set inline on `/` since the inline
      // bootstrap script needs `unsafe-inline`. Static assets get a
      // stricter default.
      "content-security-policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    };
  }

  /** CSRF protection: reject WebSocket upgrades from a cross-origin page.
   *  Native clients (curl, Bun tests, non-browser) usually omit Origin;
   *  we allow that. Browsers always send Origin, so a mismatch is a real
   *  cross-site request. */
  private originAllowed(_url: URL, req: Request): boolean {
    const origin = req.headers.get("origin");
    if (!origin) return true;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false;
    }
    const host = req.headers.get("host") ?? `${this.bind}:${this.port}`;
    return originHost === host;
  }

  start(): void {
    if (this.server) return;
    this.serverInstanceId = makeServerInstanceId();
    invalidatePageCache();

    try {
      this.server = Bun.serve({
        port: this.port,
        hostname: this.bind,

        fetch: (req, server) => {
          const url = new URL(req.url);

          // Helper: merge security headers into every response so
          // we don't have to remember at each call-site (H.2 / S6).
          // Hoisted above the WebSocket-upgrade branch so error
          // responses on that path also get the headers.
          const sec = this.securityHeaders();
          const respond = (
            body: BodyInit | null,
            init: ResponseInit & { headers?: Record<string, string> } = {},
          ) =>
            new Response(body, {
              ...init,
              headers: { ...sec, ...(init.headers ?? {}) },
            });

          // Per-IP throttle check on any auth-gated path (H.4 / S5).
          const ip = this.clientIp(req);
          if (this.authToken && this.throttled(ip)) {
            return respond("Too Many Requests", {
              status: 429,
              headers: { "retry-after": "600" },
            });
          }

          if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            if (!this.authorized(url, req)) {
              if (this.authToken) this.recordAuthFail(ip);
              return respond("Unauthorized", { status: 401 });
            }
            if (!this.originAllowed(url, req))
              return respond("Forbidden: cross-origin", { status: 403 });
            const resumeId = url.searchParams.get("resume") || undefined;
            const resumeSeqRaw = url.searchParams.get("seq");
            const resumeSeq =
              resumeSeqRaw !== null && resumeSeqRaw !== ""
                ? Number(resumeSeqRaw)
                : undefined;
            const data: ClientData = {
              clientId: `web:${++this.clientCounter}`,
              // Filled in open() once we decide resume-vs-fresh.
              session: null,
              resumeId,
              resumeSeq,
            };
            const ok = server.upgrade(req, { data });
            if (ok) return undefined;
            return respond("WebSocket upgrade failed", { status: 400 });
          }

          if (url.pathname === "/" || url.pathname === "/index.html") {
            if (!this.authorized(url, req)) {
              if (this.authToken) this.recordAuthFail(ip);
              return respond("Unauthorized", { status: 401 });
            }
            return respond(buildHtmlPage(), {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          }

          if (url.pathname === "/fonts/nerd-regular.ttf" && NERD_FONT_REGULAR) {
            return respond(NERD_FONT_REGULAR.buffer as ArrayBuffer, {
              headers: {
                "content-type": "font/ttf",
                "cache-control": "public, max-age=31536000",
              },
            });
          }
          if (url.pathname === "/fonts/nerd-bold.ttf" && NERD_FONT_BOLD) {
            return respond(NERD_FONT_BOLD.buffer as ArrayBuffer, {
              headers: {
                "content-type": "font/ttf",
                "cache-control": "public, max-age=31536000",
              },
            });
          }
          if (
            url.pathname === "/audio/finish.mp3" &&
            NOTIFICATION_SOUND_FINISH
          ) {
            return respond(NOTIFICATION_SOUND_FINISH.buffer as ArrayBuffer, {
              headers: {
                "content-type": "audio/mpeg",
                "cache-control": "public, max-age=31536000",
              },
            });
          }

          if (url.pathname.endsWith(".map")) {
            return respond('{"version":3,"sources":[],"mappings":""}', {
              headers: { "content-type": "application/json" },
            });
          }

          // ── PWA shell ────────────────────────────────────────
          // Service workers must register from the same scope they
          // serve, so /sw.js MUST live at the root and pre-auth.
          // Manifest + icon are public — they don't expose terminal
          // state, just chrome metadata.
          if (url.pathname === "/sw.js") {
            const sw = readAsset("assets/web-client/sw.js");
            return respond(sw, {
              headers: {
                "content-type": "application/javascript; charset=utf-8",
                // `no-store` so the browser always re-fetches; the SW
                // itself versions the cache so a fresh fetch picks up
                // a new bundle's assets immediately.
                "cache-control": "no-store",
                "service-worker-allowed": "/",
              },
            });
          }
          if (url.pathname === "/manifest.json") {
            const manifest = readAsset("assets/web-client/manifest.json");
            return respond(manifest, {
              headers: {
                "content-type": "application/manifest+json; charset=utf-8",
                "cache-control": "public, max-age=600",
              },
            });
          }
          if (
            url.pathname === "/icons/icon.svg" ||
            url.pathname === "/icons/apple-touch-icon.png"
          ) {
            // Single SVG icon serves both manifest + iOS slots; iOS
            // accepts SVG since 16.4 and falls back gracefully.
            const svg = readAsset("assets/web-client/icon.svg");
            return respond(svg, {
              headers: {
                "content-type": "image/svg+xml",
                "cache-control": "public, max-age=86400",
              },
            });
          }

          return respond("Not found", { status: 404 });
        },

        websocket: {
          // H.5 / L3 — half-open WebSockets used to survive ~2 hours
          // (the macOS TCP keepalive default) because nothing was
          // pinging on a quiet session. `idleTimeout` is in seconds;
          // 60 s with `sendPings: true` lets Bun close idle peers
          // automatically. The 2 MiB resume ring is unaffected — a
          // detached session still survives `SESSION_TTL_MS`.
          idleTimeout: 60,
          sendPings: true,
          open: (ws: WS) => {
            const { resumeId, resumeSeq } = ws.data;
            ws.data.resumeId = undefined;
            ws.data.resumeSeq = undefined;
            const resumed = this.tryResume(ws, resumeId, resumeSeq);
            if (!resumed) {
              const session = this.createSession();
              session.ws = ws;
              ws.data.session = session;
              this.clients.add(ws);
              this.sendHello(ws);
            } else {
              this.clients.add(ws);
            }
          },

          message: (ws: WS, raw: string | Buffer) => {
            // Drop oversize frames before we even parse them — a 100 MB
            // payload from a malicious client should not reach JSON.parse.
            const rawBytes =
              typeof raw === "string"
                ? new TextEncoder().encode(raw).byteLength
                : raw.byteLength;
            if (rawBytes > CLIENT_MESSAGE_MAX_BYTES) {
              console.warn(
                `[web] frame exceeded CLIENT_MESSAGE_MAX_BYTES (${rawBytes}); dropping`,
              );
              return;
            }
            const session = ws.data.session;
            if (session && !session.consumeRateToken()) {
              // Silently drop: a chatty client hits this briefly on
              // startup bursts; a malicious one is effectively muted.
              return;
            }
            const text = typeof raw === "string" ? raw : raw.toString();
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(text);
            } catch {
              return;
            }
            this.handleClientMessage(ws, msg);
          },

          close: (ws: WS) => {
            this.clients.delete(ws);
            const session = ws.data.session;
            if (!session) return;
            if (session.ws === ws) {
              session.ws = null;
              session.detachedAt = Date.now();
              this.scheduleSessionCleanup(session.id);
            }
          },
        },
      });

      console.log(
        `[web] Terminal mirror at http://${this.bind}:${this.port}${this.authToken ? " (auth required)" : ""}`,
      );
      if (this.bind === "0.0.0.0" && !this.authToken) {
        console.log(
          `[web] Warning: bound to 0.0.0.0 without auth. Anyone on your network can view and type in your terminal.`,
        );
      } else if (
        this.bind === "0.0.0.0" &&
        this.authToken &&
        this.authToken.length < TOKEN_MIN_LEN_FOR_LAN
      ) {
        // H.3 / S4: a short / weak token on `0.0.0.0` is fundamentally
        // insufficient. We don't refuse-to-start (would surprise users
        // who have a long-running config); we log loudly and tell them
        // exactly what the floor is. Settings UI should also expose a
        // "Generate" button (deferred to a later PR).
        console.warn(
          `[web] Warning: webMirrorAuthToken is only ${this.authToken.length} chars; ` +
            `recommended minimum on 0.0.0.0 is ${TOKEN_MIN_LEN_FOR_LAN} chars of high entropy. ` +
            `Generate one with: openssl rand -base64 24`,
        );
      }
    } catch (error) {
      this.server = null;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[web] Terminal mirror unavailable on port ${this.port}: ${message}`,
      );
    }
  }

  stop(): void {
    if (!this.server) return;
    for (const session of this.sessions.values()) {
      if (session.outputFlushTimer) {
        clearTimeout(session.outputFlushTimer);
        session.outputFlushTimer = null;
      }
    }
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    for (const timer of this.ttlTimers.values()) clearTimeout(timer);
    this.ttlTimers.clear();
    this.sessions.clear();
    // Pass true so existing connections are dropped and the port is
    // released immediately — tests re-bind the same port back-to-back.
    this.server.stop(true);
    this.server = null;
    console.log("[web] Terminal mirror stopped.");
  }

  get running(): boolean {
    return this.server !== null;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  // ------------------------------------------------------------------
  // Session lifecycle
  // ------------------------------------------------------------------

  private createSession(): SessionBuffer {
    const s = new SessionBuffer(makeSessionId(), this.sessionBufferMaxBytes);
    this.sessions.set(s.id, s);
    return s;
  }

  private scheduleSessionCleanup(sessionId: string): void {
    const existing = this.ttlTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.ttlTimers.delete(sessionId);
      const s = this.sessions.get(sessionId);
      if (!s) return;
      if (s.ws) return; // Reattached while timer was armed.
      if (s.outputFlushTimer) {
        clearTimeout(s.outputFlushTimer);
        s.outputFlushTimer = null;
      }
      this.sessions.delete(sessionId);
    }, this.sessionTtlMs);
    // Avoid keeping the event loop alive just for a cleanup timer.
    (timer as { unref?: () => void }).unref?.();
    this.ttlTimers.set(sessionId, timer);
  }

  private tryResume(
    ws: WS,
    resumeId: string | undefined,
    resumeSeq: number | undefined,
  ): boolean {
    if (!resumeId || resumeSeq === undefined || !Number.isFinite(resumeSeq))
      return false;
    const session = this.sessions.get(resumeId);
    if (!session || session.truncated) return false;
    const toReplay = session.since(resumeSeq);
    if (toReplay === null) return false;

    // Swap: if a previous ws is still attached (e.g. stale), close it.
    if (session.ws && session.ws !== ws) {
      const stale = session.ws;
      this.clients.delete(stale);
      try {
        stale.close();
      } catch {
        /* ignore */
      }
    }
    session.ws = ws;
    session.detachedAt = null;
    const timer = this.ttlTimers.get(session.id);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(session.id);
    }
    ws.data.session = session;
    for (const m of toReplay) {
      try {
        if (typeof m.data === "string") ws.send(m.data);
        else ws.send(m.data.buffer as ArrayBuffer);
      } catch {
        /* client gone */
      }
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Client-directed sends
  // ------------------------------------------------------------------

  private sendHello(ws: WS): void {
    const session = ws.data.session;
    if (!session) return;
    const payload: HelloPayload = {
      sessionId: session.id,
      serverInstanceId: this.serverInstanceId,
      protocolVersion: WEB_PROTOCOL_VERSION,
      capabilities: [],
      snapshot: this.buildSnapshot(),
    };
    this.sendTo(ws, "hello", payload);

    const state = this.getAppState();
    const activeWs = state.workspaces.find(
      (w) => w.id === state.activeWorkspaceId,
    );
    if (activeWs) {
      for (const sid of activeWs.surfaceIds) {
        session.subscribedSurfaceIds.add(sid);
        const history = this.sessionsManager.getOutputHistory(sid);
        if (history) {
          this.sendTo(ws, "history", { surfaceId: sid, data: history });
        }
      }
    }
  }

  private buildSnapshot(): Snapshot {
    const state = this.getAppState();
    const surfaces = this.sessionsManager.getAllSurfaces().map((s) => ({
      id: s.id,
      title: s.title,
      cols: s.pty.cols,
      rows: s.pty.rows,
    }));
    const workspaces: ServerWorkspaceRef[] = state.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      color: w.color,
      surfaceIds: w.surfaceIds,
      focusedSurfaceId: w.focusedSurfaceId,
      layout: w.layout,
    }));
    return {
      nativeViewport: this.nativeViewport,
      surfaces,
      workspaces,
      activeWorkspaceId: state.activeWorkspaceId,
      focusedSurfaceId: this.getFocusedSurfaceId(),
      sidebarVisible: this.getSidebarVisible(),
      metadata: this.store.getMetadata(),
      panels: this.store.getPanels(),
      notifications: this.store.getNotifications(),
      logs: this.store.getLogs(),
      status: this.store.getStatus(),
      progress: this.store.getProgress(),
    };
  }

  /** Serialize + buffer + send an envelope to a specific session. The
   *  seq is assigned from the session's monotonic counter, so clients
   *  see strictly-increasing seq across disconnect/resume. */
  private sendTo(ws: WS, type: ServerMessageType, payload: unknown): void {
    const session = ws.data.session;
    if (!session) return;
    const envelope = {
      v: WEB_PROTOCOL_VERSION,
      seq: session.nextSeq,
      type,
      payload,
    };
    const serialized = JSON.stringify(envelope);
    session.append(serialized);
    this.wsSend(session, serialized);
  }

  /** Send with backpressure tracking. If the underlying WS is stalled,
   *  we skip the actual `ws.send` call — the message stays in the
   *  session buffer so a resume can replay it. If the stall persists
   *  past WS_STALL_KICK_MS we force-close the ws; the session survives
   *  TTL so the client reconnects with ?resume= and catches up via
   *  delta replay rather than silently receiving nothing. */
  private wsSend(session: SessionBuffer, data: string | Uint8Array): void {
    const ws = session.ws;
    if (!ws) return;
    const buffered = ws.getBufferedAmount?.() ?? 0;
    const decision = decideBackpressure(session, buffered);
    if (decision === "kick") {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      return;
    }
    if (decision === "skip") return;
    try {
      if (typeof data === "string") ws.send(data);
      else ws.send(data.buffer as ArrayBuffer);
    } catch {
      /* client gone */
    }
  }

  /** Enqueue an envelope on every session — attached or not. Sessions
   *  that are currently detached buffer the message so a reconnect can
   *  resume with delta replay. */
  private broadcastEnvelope(
    type: ServerMessageType,
    payload: unknown,
    filter?: (session: SessionBuffer) => boolean,
  ): void {
    for (const session of this.sessions.values()) {
      if (filter && !filter(session)) continue;
      const envelope = {
        v: WEB_PROTOCOL_VERSION,
        seq: session.nextSeq,
        type,
        payload,
      };
      const serialized = JSON.stringify(envelope);
      session.append(serialized);
      this.wsSend(session, serialized);
    }
  }

  /** Flush the coalesced stdout buffer for a session+surface pair. */
  private flushOutput(session: SessionBuffer, surfaceId: string): void {
    const pending = session.pendingOutput.get(surfaceId);
    if (!pending) return;
    session.pendingOutput.delete(surfaceId);
    const envelope = {
      v: WEB_PROTOCOL_VERSION,
      seq: session.nextSeq,
      type: "output" as const,
      payload: { surfaceId, data: pending },
    };
    const serialized = JSON.stringify(envelope);
    session.append(serialized);
    this.wsSend(session, serialized);
  }

  /** Flush every surface's pending buffer for a given session. */
  private flushAllOutput(session: SessionBuffer): void {
    if (session.outputFlushTimer) {
      clearTimeout(session.outputFlushTimer);
      session.outputFlushTimer = null;
    }
    for (const surfaceId of Array.from(session.pendingOutput.keys())) {
      this.flushOutput(session, surfaceId);
    }
  }

  // ------------------------------------------------------------------
  // Public broadcast API
  // ------------------------------------------------------------------

  broadcastStdout(surfaceId: string, data: string): void {
    // Coalesce: append to each subscribed session's pending buffer and
    // arm a shared flush timer. Chunks arriving within OUTPUT_COALESCE_MS
    // collapse into a single output envelope, which massively reduces
    // per-chunk JSON.stringify + send overhead for fast producers.
    for (const session of this.sessions.values()) {
      if (!session.subscribedSurfaceIds.has(surfaceId)) continue;
      const prev = session.pendingOutput.get(surfaceId) ?? "";
      const merged = prev + data;
      if (merged.length >= OUTPUT_COALESCE_SOFT_CAP) {
        // Over soft cap — flush immediately so we don't build huge frames.
        session.pendingOutput.set(surfaceId, merged);
        this.flushOutput(session, surfaceId);
        continue;
      }
      session.pendingOutput.set(surfaceId, merged);
      if (!session.outputFlushTimer) {
        const captured = session;
        session.outputFlushTimer = setTimeout(() => {
          captured.outputFlushTimer = null;
          this.flushAllOutput(captured);
        }, OUTPUT_COALESCE_MS);
        (session.outputFlushTimer as { unref?: () => void }).unref?.();
      }
    }
  }

  setNativeViewport(width: number, height: number): void {
    this.nativeViewport = { width, height };
    this.broadcastEnvelope("nativeViewport", { width, height });
  }

  sendSurfaceCreated(surfaceId: string, title: string): void {
    this.broadcastEnvelope("surfaceCreated", { surfaceId, title });
  }

  sendSurfaceRenamed(surfaceId: string, title: string): void {
    this.broadcastEnvelope("surfaceRenamed", { surfaceId, title });
  }

  sendSurfaceClosed(surfaceId: string): void {
    this.store.forgetSurface(surfaceId);
    this.broadcastEnvelope("surfaceClosed", { surfaceId });
  }

  sendSurfaceExited(surfaceId: string, exitCode: number): void {
    this.broadcastEnvelope("surfaceExited", { surfaceId, exitCode });
  }

  sendResize(surfaceId: string, cols: number, rows: number): void {
    this.broadcastEnvelope("resize", { surfaceId, cols, rows });
  }

  sendFocusChanged(surfaceId: string): void {
    this.broadcastEnvelope("focusChanged", { surfaceId });
  }

  sendLayoutChanged(
    workspaces: ServerWorkspaceRef[],
    activeWorkspaceId: string | null,
    focusedSurfaceId: string | null,
  ): void {
    this.broadcastEnvelope("layoutChanged", {
      workspaces,
      activeWorkspaceId,
      focusedSurfaceId,
    });
  }

  sendSurfaceMetadata(surfaceId: string, metadata: SurfaceMetadata): void {
    // Dedup identical snapshots. The 1 Hz poller already skips
    // unchanged snapshots, but a stable field identity from the native
    // app can still cost JSON.stringify across many clients. Ignore
    // `updatedAt` when comparing — it ticks every second by design.
    const prev = this.store.getMetadata()[surfaceId];
    if (prev && metadataEquivalent(prev, metadata)) return;
    this.store.setMetadata(surfaceId, metadata);
    this.broadcastEnvelope("surfaceMetadata", { surfaceId, metadata });
  }

  sendSidebandMeta(surfaceId: string, meta: SidebandContentMessage): void {
    this.store.applySidebandMeta(surfaceId, meta);
    this.broadcastEnvelope("sidebandMeta", { surfaceId, meta });
  }

  sendSidebandDataFailed(surfaceId: string, id: string, reason: string): void {
    this.broadcastEnvelope("sidebandDataFailed", { surfaceId, id, reason });
  }

  sendNotification(
    id: string,
    title: string,
    body: string,
    surfaceId?: string,
  ): void {
    const at = Date.now();
    this.store.addNotification({ id, at, title, body, surfaceId });
    this.broadcastEnvelope("notification", { id, title, body, surfaceId, at });
  }

  sendNotificationClear(): void {
    this.store.clearNotifications();
    this.broadcastEnvelope("notificationClear", {});
  }

  sendNotificationDismiss(id: string): void {
    this.store.dismissNotification(id);
    this.broadcastEnvelope("notificationDismiss", { id });
  }

  sendSidebarState(visible: boolean): void {
    this.broadcastEnvelope("sidebarState", { visible });
  }

  sendSidebarAction(action: string, payload: Record<string, unknown>): void {
    this.store.applySidebarAction(
      action,
      payload,
      this.getAppState().activeWorkspaceId,
    );
    this.broadcastEnvelope("sidebarAction", { action, payload });
  }

  broadcast(msg: Record<string, unknown>): void {
    const type = msg["type"];
    if (typeof type !== "string") return;
    const payload: Record<string, unknown> = {};
    for (const k in msg) {
      if (k !== "type") payload[k] = msg[k];
    }

    switch (type) {
      case "surfaceCreated":
        this.sendSurfaceCreated(
          payload["surfaceId"] as string,
          payload["title"] as string,
        );
        return;
      case "surfaceRenamed":
        this.sendSurfaceRenamed(
          payload["surfaceId"] as string,
          payload["title"] as string,
        );
        return;
      case "surfaceClosed":
        this.sendSurfaceClosed(payload["surfaceId"] as string);
        return;
      case "surfaceExited":
        this.sendSurfaceExited(
          payload["surfaceId"] as string,
          payload["exitCode"] as number,
        );
        return;
      case "resize":
        this.sendResize(
          payload["surfaceId"] as string,
          payload["cols"] as number,
          payload["rows"] as number,
        );
        return;
      case "focusChanged":
        this.sendFocusChanged(payload["surfaceId"] as string);
        return;
      case "layoutChanged":
        this.sendLayoutChanged(
          payload["workspaces"] as ServerWorkspaceRef[],
          (payload["activeWorkspaceId"] as string | null) ?? null,
          (payload["focusedSurfaceId"] as string | null) ?? null,
        );
        return;
      case "surfaceMetadata":
        this.sendSurfaceMetadata(
          payload["surfaceId"] as string,
          payload["metadata"] as SurfaceMetadata,
        );
        return;
      case "sidebandMeta":
        this.sendSidebandMeta(
          payload["surfaceId"] as string,
          payload["meta"] as SidebandContentMessage,
        );
        return;
      case "sidebandDataFailed":
        this.sendSidebandDataFailed(
          payload["surfaceId"] as string,
          payload["id"] as string,
          payload["reason"] as string,
        );
        return;
      case "notification":
        this.sendNotification(
          (payload["id"] as string) ?? "",
          (payload["title"] as string) ?? "",
          (payload["body"] as string) ?? "",
          payload["surfaceId"] as string | undefined,
        );
        return;
      case "notificationClear":
        this.sendNotificationClear();
        return;
      case "notificationDismiss":
        this.sendNotificationDismiss(payload["id"] as string);
        return;
      case "sidebarState":
        this.sendSidebarState(Boolean(payload["visible"]));
        return;
      case "sidebarAction":
        this.sendSidebarAction(
          payload["action"] as string,
          (payload["payload"] as Record<string, unknown>) ?? {},
        );
        return;
      case "nativeViewport":
        this.setNativeViewport(
          payload["width"] as number,
          payload["height"] as number,
        );
        return;
      case "panelEvent": {
        this.broadcastEnvelope("panelEvent", {
          surfaceId: payload["surfaceId"] as string,
          id: payload["id"] as string,
          event: payload["event"] as string,
          x: payload["x"] as number | undefined,
          y: payload["y"] as number | undefined,
          width: payload["width"] as number | undefined,
          height: payload["height"] as number | undefined,
        });
        return;
      }
    }

    // Unknown type — still pass through wrapped so new bun-side types surface.
    for (const session of this.sessions.values()) {
      const envelope = {
        v: WEB_PROTOCOL_VERSION,
        seq: session.nextSeq,
        type,
        payload,
      };
      const serialized = JSON.stringify(envelope);
      session.append(serialized);
      this.wsSend(session, serialized);
    }
  }

  broadcastSidebandBinary(
    surfaceId: string,
    id: string,
    data: Uint8Array,
  ): void {
    for (const session of this.sessions.values()) {
      // Flush any pending coalesced output so this binary frame doesn't
      // overtake a pending `output` envelope for the same seq timeline.
      this.flushAllOutput(session);
      const header: BinaryFrameHeader = {
        v: WEB_PROTOCOL_VERSION,
        seq: session.nextSeq,
        type: "sidebandData",
        surfaceId,
        id,
      };
      const headerBytes = new TextEncoder().encode(JSON.stringify(header));
      const frame = new Uint8Array(
        4 + headerBytes.byteLength + data.byteLength,
      );
      const view = new DataView(frame.buffer);
      view.setUint32(0, headerBytes.byteLength, false);
      frame.set(headerBytes, 4);
      frame.set(data, 4 + headerBytes.byteLength);
      session.append(frame);
      this.wsSend(session, frame);
    }
  }

  // ------------------------------------------------------------------
  // Client → server message dispatch
  // ------------------------------------------------------------------

  private handleClientMessage(ws: WS, raw: Record<string, unknown>): void {
    const type = raw["type"];
    if (typeof type !== "string") return;
    const session = ws.data.session;
    if (!session) return;
    const isEnvelope =
      raw["v"] === WEB_PROTOCOL_VERSION &&
      typeof raw["payload"] === "object" &&
      raw["payload"] !== null;
    const fields = (
      isEnvelope ? (raw["payload"] as Record<string, unknown>) : raw
    ) as Record<string, unknown>;

    switch (type) {
      case "stdin": {
        const surfaceId = fields["surfaceId"] as string;
        const data = fields["data"];
        if (!surfaceId || typeof data !== "string" || data.length === 0) break;
        // TextEncoder is avoided here: `data.length` is the JS code-unit
        // count; every code unit is ≥1 UTF-8 byte, so the char-length cap
        // is always at least as strict as a true byte cap. Keeps the hot
        // path allocation-free.
        if (data.length > CLIENT_STDIN_MAX_BYTES) {
          console.warn(
            `[web] stdin oversized (${data.length} chars) for surface ${surfaceId}; dropping`,
          );
          break;
        }
        this.onHumanInput(surfaceId);
        this.sessionsManager.writeStdin(surfaceId, data);
        break;
      }
      case "sidebarToggle": {
        const visible = Boolean(fields["visible"]);
        this.onSidebarToggle?.(visible);
        break;
      }
      case "focusSurface": {
        const surfaceId = fields["surfaceId"] as string;
        if (surfaceId) this.onFocusSurface?.(surfaceId);
        break;
      }
      case "selectWorkspace": {
        const workspaceId = fields["workspaceId"] as string;
        if (workspaceId) this.onSelectWorkspace?.(workspaceId);
        break;
      }
      case "clearNotifications": {
        this.onClearNotifications?.();
        break;
      }
      case "dismissNotification": {
        const id = fields["id"];
        if (typeof id === "string" && id) this.onDismissNotification?.(id);
        break;
      }
      case "surfaceResizeRequest": {
        const surfaceId = fields["surfaceId"] as string;
        const colsRaw = fields["cols"];
        const rowsRaw = fields["rows"];
        if (
          !surfaceId ||
          typeof colsRaw !== "number" ||
          typeof rowsRaw !== "number" ||
          !Number.isFinite(colsRaw) ||
          !Number.isFinite(rowsRaw)
        ) {
          break;
        }
        // Clamp to sane terminal dimensions. Clients proposing 1e9×1e9
        // would crash xterm or OOM the PTY. Under-spec values (0, NaN)
        // are replaced with the lower bound — better a 10-col terminal
        // than none.
        const cols = Math.min(
          TERMINAL_COLS_MAX,
          Math.max(TERMINAL_COLS_MIN, Math.round(colsRaw)),
        );
        const rows = Math.min(
          TERMINAL_ROWS_MAX,
          Math.max(TERMINAL_ROWS_MIN, Math.round(rowsRaw)),
        );
        this.onSurfaceResizeRequest?.(surfaceId, cols, rows);
        break;
      }
      case "subscribeSurface": {
        const surfaceId = fields["surfaceId"] as string;
        if (!surfaceId) break;
        session.subscribedSurfaceIds.add(surfaceId);
        const history = this.sessionsManager.getOutputHistory(surfaceId);
        if (history) {
          this.sendTo(ws, "history", { surfaceId, data: history });
        }
        break;
      }
      case "telegramSend": {
        const chatId = fields["chatId"];
        const text = fields["text"];
        if (typeof chatId === "string" && chatId && typeof text === "string") {
          this.onTelegramSend?.(chatId, text);
        }
        break;
      }
      case "telegramRequestHistory": {
        const chatId = fields["chatId"];
        const before = fields["before"];
        if (typeof chatId === "string" && chatId) {
          this.onTelegramRequestHistory?.(
            chatId,
            typeof before === "number" ? before : undefined,
          );
        }
        break;
      }
      case "telegramRequestState": {
        this.onTelegramRequestState?.();
        break;
      }
      case "subscribeWorkspace": {
        const workspaceId = fields["workspaceId"] as string;
        if (!workspaceId) break;
        const state = this.getAppState();
        const targetWs = state.workspaces.find((w) => w.id === workspaceId);
        if (!targetWs) break;
        session.subscribedSurfaceIds.clear();
        for (const sid of targetWs.surfaceIds) {
          session.subscribedSurfaceIds.add(sid);
          const wsHistory = this.sessionsManager.getOutputHistory(sid);
          if (wsHistory) {
            this.sendTo(ws, "history", { surfaceId: sid, data: wsHistory });
          }
        }
        break;
      }
      case "panelMouseEvent": {
        const surfaceId = fields["surfaceId"] as string;
        if (!surfaceId) break;
        // Untyped JSON coming off the WebSocket — we reshape into the
        // discriminated PanelEvent union via an unchecked cast. The
        // fields that are relevant per `event` kind are picked up
        // downstream; extras are harmless.
        const panelEvt = {
          id: fields["id"] as string,
          event: fields["event"] as string,
          x: fields["x"] as number | undefined,
          y: fields["y"] as number | undefined,
          width: fields["width"] as number | undefined,
          height: fields["height"] as number | undefined,
          button: fields["button"] as number | undefined,
          buttons: fields["buttons"] as number | undefined,
          deltaX: fields["deltaX"] as number | undefined,
          deltaY: fields["deltaY"] as number | undefined,
          cols: fields["cols"] as number | undefined,
          rows: fields["rows"] as number | undefined,
          pxWidth: fields["pxWidth"] as number | undefined,
          pxHeight: fields["pxHeight"] as number | undefined,
        } as unknown as SidebandPanelEvent;
        this.sessionsManager.sendEvent(surfaceId, panelEvt);
        if (panelEvt.event === "dragend") {
          this.broadcastEnvelope("panelEvent", {
            surfaceId,
            id: panelEvt.id,
            event: panelEvt.event,
            x: panelEvt.x,
            y: panelEvt.y,
          });
          const updated: Record<string, unknown> = {
            x: panelEvt.x,
            y: panelEvt.y,
          };
          this.onPanelUpdate?.(surfaceId, panelEvt.id, updated);
        } else if (panelEvt.event === "resize") {
          this.broadcastEnvelope("panelEvent", {
            surfaceId,
            id: panelEvt.id,
            event: panelEvt.event,
            width: panelEvt.width,
            height: panelEvt.height,
          });
          const updated: Record<string, unknown> = {};
          if (panelEvt.width !== undefined) updated["width"] = panelEvt.width;
          if (panelEvt.height !== undefined)
            updated["height"] = panelEvt.height;
          this.onPanelUpdate?.(surfaceId, panelEvt.id, updated);
        } else if (panelEvt.event === "close") {
          this.broadcastEnvelope("panelEvent", {
            surfaceId,
            id: panelEvt.id,
            event: panelEvt.event,
          });
          this.onPanelUpdate?.(surfaceId, panelEvt.id, {});
        }
        break;
      }
    }
  }
}

/** Constant-time string compare. A short-circuiting `===` lets an
 *  on-path attacker brute-force the auth token one byte at a time by
 *  measuring reject latency. This runs in time proportional to the
 *  longer of the two strings and never returns early on content. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  // Always encode both sides so the work is independent of which is
  // longer. The lengths themselves leak — that's accepted for auth
  // tokens, which have a known, non-secret length.
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }
  return diff === 0;
}

/** Structural equality for SurfaceMetadata, ignoring the per-tick
 *  `updatedAt` timestamp. Cheap enough to run per broadcast at 1 Hz. */
function metadataEquivalent(a: SurfaceMetadata, b: SurfaceMetadata): boolean {
  if (a === b) return true;
  if (a.pid !== b.pid) return false;
  if (a.foregroundPid !== b.foregroundPid) return false;
  if (a.cwd !== b.cwd) return false;
  if (a.tree.length !== b.tree.length) return false;
  for (let i = 0; i < a.tree.length; i++) {
    const x = a.tree[i]!;
    const y = b.tree[i]!;
    if (
      x.pid !== y.pid ||
      x.ppid !== y.ppid ||
      x.command !== y.command ||
      x.cpu !== y.cpu ||
      x.rssKb !== y.rssKb
    )
      return false;
  }
  if (a.listeningPorts.length !== b.listeningPorts.length) return false;
  for (let i = 0; i < a.listeningPorts.length; i++) {
    const x = a.listeningPorts[i]!;
    const y = b.listeningPorts[i]!;
    if (
      x.pid !== y.pid ||
      x.port !== y.port ||
      x.proto !== y.proto ||
      x.address !== y.address
    )
      return false;
  }
  if (!gitEquivalent(a.git, b.git)) return false;
  if (!packageJsonEquivalent(a.packageJson, b.packageJson)) return false;
  return true;
}

function gitEquivalent(
  a: SurfaceMetadata["git"],
  b: SurfaceMetadata["git"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.branch === b.branch &&
    a.head === b.head &&
    a.upstream === b.upstream &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.staged === b.staged &&
    a.unstaged === b.unstaged &&
    a.untracked === b.untracked &&
    a.conflicts === b.conflicts &&
    a.insertions === b.insertions &&
    a.deletions === b.deletions &&
    a.detached === b.detached
  );
}

function packageJsonEquivalent(
  a: SurfaceMetadata["packageJson"],
  b: SurfaceMetadata["packageJson"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.path === b.path && a.version === b.version && a.name === b.name;
}
