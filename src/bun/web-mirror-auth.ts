import { randomBytes } from "node:crypto";

/**
 * Web mirror bind/auth policy — the single decision point for "is this
 * mirror configuration safe to start?".
 *
 * Why this exists: the mirror's `stdin` path writes into a real PTY,
 * so an unauthenticated mirror on a non-loopback bind is remote code
 * execution as the user. The server itself treats an empty token as
 * "authorise everyone" (`if (!this.authToken) return true`), which is
 * a defensible choice for loopback but a footgun the moment the bind
 * is `0.0.0.0` — and `0.0.0.0` + empty token was the shipped default,
 * one Settings toggle away from a LAN-wide shell. This module makes
 * the safe path automatic instead of documentary:
 *
 *   - loopback bind          → token optional, config untouched;
 *   - non-loopback + strong token (≥16 chars) → honoured as-is;
 *   - non-loopback + missing/weak token → a strong token is GENERATED
 *     and handed back for persistence, so the mirror still works but
 *     is unreachable without the secret. Refusing to start would just
 *     read as "the mirror is broken"; generating reads as "the mirror
 *     works, here's your URL".
 *
 * Pure functions + an injectable generator so the policy is unit-
 * testable without touching sockets.
 */

export type WebMirrorBind = "127.0.0.1" | "0.0.0.0";

/** Tokens shorter than this are brute-forceable over a LAN and are
 *  replaced rather than honoured. */
export const MIN_MIRROR_TOKEN_LEN = 16;

export interface MirrorAuthDecision {
  bind: WebMirrorBind;
  /** The token the server must run with (possibly freshly generated). */
  authToken: string;
  /** True when `authToken` was generated here and must be persisted
   *  + surfaced to the user — an un-persisted generated token would
   *  change on every restart and lock the owner out of their own
   *  mirror. */
  generatedToken: boolean;
  /** Human-readable explanation of any intervention, null when the
   *  configuration was honoured unchanged. */
  note: string | null;
}

/** Loopback binds never leave the machine, so an empty token there is
 *  a same-user trust boundary, not a network one. */
export function isLoopbackBind(bind: string): boolean {
  return bind === "127.0.0.1" || bind === "localhost" || bind === "::1";
}

export function defaultTokenGenerator(): string {
  // 24 bytes → 32 base64url chars; ~192 bits of entropy, URL-safe so
  // it survives the `?t=` query param without escaping.
  return randomBytes(24).toString("base64url");
}

/** Apply the policy at server-construction time: resolve, and when a
 *  token was generated, persist it (so restarts and the settings UI
 *  agree) and log the full URL once — a generated token nobody can
 *  find would lock the owner out of their own mirror. Kept here so
 *  the single construction path in index.ts stays a one-liner. */
export function enforceWebMirrorAuth(
  settings: { webMirrorBind: WebMirrorBind; webMirrorAuthToken: string },
  port: number,
  persist: (token: string) => void,
  warn: (message: string) => void,
): { bind: WebMirrorBind; authToken: string } {
  const d = resolveWebMirrorAuth(
    settings.webMirrorBind,
    settings.webMirrorAuthToken,
  );
  if (d.generatedToken) {
    warn(`[web] ${d.note}`);
    warn(`[web] mirror URL: http://${d.bind}:${port}/?t=${d.authToken}`);
    persist(d.authToken);
  }
  return { bind: d.bind, authToken: d.authToken };
}

export function resolveWebMirrorAuth(
  bind: WebMirrorBind,
  authToken: string,
  generate: () => string = defaultTokenGenerator,
): MirrorAuthDecision {
  const token = authToken.trim();
  if (isLoopbackBind(bind)) {
    return { bind, authToken: token, generatedToken: false, note: null };
  }
  if (token.length >= MIN_MIRROR_TOKEN_LEN) {
    return { bind, authToken: token, generatedToken: false, note: null };
  }
  const generated = generate();
  return {
    bind,
    authToken: generated,
    generatedToken: true,
    note:
      token.length === 0
        ? `no webMirrorAuthToken configured with a ${bind} bind — generated one; ` +
          `the mirror is unreachable without it`
        : `webMirrorAuthToken is shorter than ${MIN_MIRROR_TOKEN_LEN} chars with a ${bind} bind — ` +
          `replaced with a generated token`,
  };
}
