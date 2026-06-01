/** HTTP response parsing helpers for `shareBin/show_http`. */

export interface HttpHeader {
  name: string;
  value: string;
}

export interface HttpResponseBlock {
  protocol: string;
  statusCode: number;
  reason: string;
  headers: HttpHeader[];
}

export interface ParsedHttpResponse {
  history: HttpResponseBlock[];
  final: HttpResponseBlock | null;
  body: string;
}

export type HttpBodyMode = "json" | "html" | "text" | "empty";

const STATUS_RE = /^HTTP\/(\S+)\s+(\d{3})(?:\s+(.*))?$/i;

export function parseHttpResponse(raw: string): ParsedHttpResponse {
  const normalized = raw.replace(/\r\n/g, "\n");
  const parts = normalized.split(/\n\n/);
  const history: HttpResponseBlock[] = [];
  let bodyStart = 0;

  for (let i = 0; i < parts.length; i++) {
    const maybeHeader = parts[i] ?? "";
    const lines = maybeHeader.split("\n");
    if (!STATUS_RE.test(lines[0] ?? "")) break;
    const block = parseHeaderBlock(maybeHeader);
    if (!block) break;
    history.push(block);
    bodyStart = i + 1;
  }

  if (history.length === 0) {
    return { history: [], final: null, body: raw };
  }

  return {
    history,
    final: history[history.length - 1] ?? null,
    body: parts.slice(bodyStart).join("\n\n"),
  };
}

export function responseFromFetch(
  response: Response,
  body: string,
): ParsedHttpResponse {
  const headers: HttpHeader[] = [];
  response.headers.forEach((value, name) => headers.push({ name, value }));
  const block: HttpResponseBlock = {
    protocol: "fetch",
    statusCode: response.status,
    reason: response.statusText,
    headers,
  };
  return { history: [block], final: block, body };
}

export function headerValue(
  headers: readonly HttpHeader[],
  name: string,
): string {
  const lower = name.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === lower)?.value ?? "";
}

export function detectBodyMode(
  response: ParsedHttpResponse,
): HttpBodyMode {
  const body = response.body.trim();
  if (body.length === 0) return "empty";
  const contentType = response.final ? headerValue(response.final.headers, "content-type").toLowerCase() : "";
  if (contentType.includes("json") || /^[\[{]/.test(body)) return "json";
  if (contentType.includes("html") || /^<!doctype html|^<html[\s>]/i.test(body)) return "html";
  return "text";
}

export function statusClass(statusCode: number): "info" | "success" | "redirect" | "client" | "server" | "unknown" {
  if (statusCode >= 100 && statusCode < 200) return "info";
  if (statusCode >= 200 && statusCode < 300) return "success";
  if (statusCode >= 300 && statusCode < 400) return "redirect";
  if (statusCode >= 400 && statusCode < 500) return "client";
  if (statusCode >= 500 && statusCode < 600) return "server";
  return "unknown";
}

function parseHeaderBlock(block: string): HttpResponseBlock | null {
  const lines = block.split("\n");
  const status = lines.shift() ?? "";
  const match = status.match(STATUS_RE);
  if (!match) return null;
  const headers: HttpHeader[] = [];
  let previous: HttpHeader | null = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && previous) {
      previous.value += ` ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    previous = { name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    headers.push(previous);
  }
  return {
    protocol: match[1] ?? "",
    statusCode: Number(match[2] ?? 0),
    reason: (match[3] ?? "").trim(),
    headers,
  };
}
