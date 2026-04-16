/**
 * cookie-parsers.ts — Import/export parsers for browser cookies.
 *
 * Supports two common formats:
 * - JSON (EditThisCookie / cookie-editor browser extension format)
 * - Netscape/cURL (tab-separated, used by wget, curl, etc.)
 */

import type { CookieEntry } from "./cookie-store";

// ── JSON format (EditThisCookie / cookie-editor) ──

interface JsonCookieInput {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  /** EditThisCookie uses "expirationDate", some tools use "expires" */
  expirationDate?: number;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  /** Some exports use "session" boolean */
  session?: boolean;
}

export function parseJsonCookies(json: string): CookieEntry[] {
  const results: CookieEntry[] = [];
  try {
    const parsed = JSON.parse(json);
    const arr: JsonCookieInput[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of arr) {
      if (!c.name || !c.domain) continue;
      const expires = c.expirationDate ?? c.expires ?? 0;
      results.push({
        name: c.name,
        value: c.value ?? "",
        domain: normalizeDomain(c.domain),
        path: c.path || "/",
        expires: typeof expires === "number" ? Math.round(expires) : 0,
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        sameSite: normalizeSameSite(c.sameSite),
        source: "imported",
        updatedAt: Date.now(),
      });
    }
  } catch {
    /* invalid JSON — return empty */
  }
  return results;
}

// ── Netscape/cURL format ──
// Tab-separated: domain, flag, path, secure, expiry, name, value
// Lines starting with # are comments.

export function parseNetscapeCookies(text: string): CookieEntry[] {
  const results: CookieEntry[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secure, expiry, name, ...valueParts] = parts;
    if (!name || !domain) continue;
    results.push({
      name,
      value: valueParts.join("\t"), // value may contain tabs
      domain: normalizeDomain(domain),
      path: path || "/",
      expires: parseInt(expiry, 10) || 0,
      secure: secure === "TRUE",
      httpOnly: false, // Netscape format doesn't track httpOnly
      sameSite: "",
      source: "imported",
      updatedAt: Date.now(),
    });
  }
  return results;
}

// ── Export formatters ──

export function exportAsJson(cookies: CookieEntry[]): string {
  const out = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expirationDate: c.expires,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite || "unspecified",
    session: c.expires === 0,
  }));
  return JSON.stringify(out, null, 2);
}

export function exportAsNetscape(cookies: CookieEntry[]): string {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# https://curl.se/docs/http-cookies.html",
    "",
  ];
  for (const c of cookies) {
    const flag = c.domain.startsWith(".") ? "TRUE" : "FALSE";
    const secure = c.secure ? "TRUE" : "FALSE";
    lines.push(
      `${c.domain}\t${flag}\t${c.path}\t${secure}\t${c.expires}\t${c.name}\t${c.value}`,
    );
  }
  return lines.join("\n") + "\n";
}

// ── Helpers ──

function normalizeDomain(domain: string): string {
  // Ensure leading dot for subdomain matching, unless it's an exact host
  let d = domain.trim().toLowerCase();
  if (!d.startsWith(".") && d.includes(".") && !isIpAddress(d)) {
    d = "." + d;
  }
  return d;
}

function isIpAddress(s: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(s) || s.startsWith("[") || s === "::1";
}

function normalizeSameSite(
  s: string | undefined,
): "Strict" | "Lax" | "None" | "" {
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "strict") return "Strict";
  if (lower === "lax") return "Lax";
  if (lower === "none") return "None";
  return "";
}
